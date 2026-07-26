// Tests the degenerate-packet video normalizer: the fix that lets the re-encode
// export path decode an MKV whose stream carries empty ~4-byte access units. The
// bug (a strict WebCodecs decoder throws on the empty packet) can only be
// reproduced with a real decoder, which node has not; but the FIX is a pure
// stream-copy remux (no decode), so its core - drop the degenerate packets,
// preserve the real ones and their timestamps, emit a valid MP4 - is fully
// exercisable in node against a synthetic MKV built via mediabunny.

import {
    BlobSource,
    BufferTarget,
    EncodedPacket,
    EncodedPacketSink,
    EncodedVideoPacketSource,
    Input,
    MkvOutputFormat,
    Output,
    type PacketType,
    type Rotation,
    type VideoCodec,
} from "mediabunny";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { VIDEO_INPUT_FORMATS } from "../video-formats.js";
import { DEGENERATE_VIDEO_PACKET_MAX_BYTES, createVideoSourceResolver } from "./normalize-degenerate-video.js";

const FIXTURES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../parsers/__fixtures__/generic");

interface PacketRecord {
    data: Uint8Array;
    type: PacketType;
    timestamp: number;
    duration: number;
}

interface VideoStream {
    codec: VideoCodec;
    // WebCodecs VideoDecoderConfig (mediabunny's getDecoderConfig returns the DOM
    // type); no need to import it, it is a global.
    decoderConfig: VideoDecoderConfig;
    rotation: Rotation;
    packets: PacketRecord[];
}

// Reads a container's primary video track into plain packet records (copied out,
// so they survive the Input being disposed).
async function readVideoStream(file: File): Promise<VideoStream> {
    const input = new Input({ source: new BlobSource(file), formats: VIDEO_INPUT_FORMATS });
    try {
        const track = await input.getPrimaryVideoTrack();
        if (!track) throw new Error("fixture has no video track");
        const codec = await track.getCodec();
        const decoderConfig = await track.getDecoderConfig();
        if (!codec || !decoderConfig) throw new Error("fixture has no readable video codec config");
        const rotation = await track.getRotation();
        const sink = new EncodedPacketSink(track);
        const packets: PacketRecord[] = [];
        let packet = await sink.getFirstPacket();
        while (packet) {
            packets.push({
                data: packet.data.slice(),
                type: packet.type,
                timestamp: packet.timestamp,
                duration: packet.duration,
            });
            packet = await sink.getNextPacket(packet);
        }
        return { codec, decoderConfig, rotation, packets };
    } finally {
        input.dispose();
    }
}

// Muxes packet records into an in-memory MKV named `name` (so the resolver's
// isMatroska filename gate fires).
async function buildMkv(stream: VideoStream, packets: PacketRecord[], name: string): Promise<File> {
    const target = new BufferTarget();
    const output = new Output({ format: new MkvOutputFormat(), target });
    const source = new EncodedVideoPacketSource(stream.codec);
    output.addVideoTrack(source, { rotation: stream.rotation });
    await output.start();
    let first = true;
    for (const rec of packets) {
        const pkt = new EncodedPacket(rec.data, rec.type, rec.timestamp, rec.duration);
        await source.add(pkt, first ? { decoderConfig: stream.decoderConfig } : undefined);
        first = false;
    }
    await output.finalize();
    const buffer = target.buffer;
    if (!buffer) throw new Error("mkv mux produced no buffer");
    return new File([buffer], name, { type: "video/x-matroska" });
}

describe("createVideoSourceResolver", () => {
    // Non-MKV must be returned verbatim (same object): the mature MP4/TS export
    // path must not pay a remux or change behavior at all.
    it("returns non-Matroska files unchanged (identity)", async () => {
        const resolver = createVideoSourceResolver();
        const mp4 = new File([new Uint8Array([0, 0, 0, 0])], "clip.mp4", { type: "video/mp4" });
        const ts = new File([new Uint8Array([0, 0, 0, 0])], "clip.ts", { type: "video/mp2t" });
        await expect(resolver.resolve(mp4)).resolves.toBe(mp4);
        await expect(resolver.resolve(ts)).resolves.toBe(ts);
    });

    it("memoizes per file: two resolves of the same MKV yield the same result object", async () => {
        const buf = readFileSync(resolve(FIXTURES_DIR, "clip-h264.mkv"));
        const mkv = new File([buf], "clip-h264.mkv", { type: "video/x-matroska" });
        const resolver = createVideoSourceResolver();
        const [a, b] = await Promise.all([resolver.resolve(mkv), resolver.resolve(mkv)]);
        expect(a).toBe(b);
    });

    it("remuxes a clean MKV to a valid MP4, preserving every packet", async () => {
        const buf = readFileSync(resolve(FIXTURES_DIR, "clip-h264.mkv"));
        const mkv = new File([buf], "clip-h264.mkv", { type: "video/x-matroska" });
        const source = await readVideoStream(mkv);
        expect(source.packets.length).toBeGreaterThan(1);

        const resolver = createVideoSourceResolver();
        const clean = await resolver.resolve(mkv);
        // A real remux happened - a distinct File, not the original.
        expect(clean).not.toBe(mkv);
        expect(clean.name.endsWith(".mp4")).toBe(true);
        await expectValidMp4(clean);

        const out = await readVideoStream(clean);
        // No degenerate packets in the source -> count is preserved exactly.
        expect(out.packets.length).toBe(source.packets.length);
    });

    it("drops degenerate packets from an MKV and keeps the real frames + timestamps", async () => {
        const buf = readFileSync(resolve(FIXTURES_DIR, "clip-h264.mkv"));
        const mkv = new File([buf], "clip-h264.mkv", { type: "video/x-matroska" });
        const source = await readVideoStream(mkv);
        expect(source.packets.length).toBeGreaterThan(4);

        // Interleave one empty 4-byte access unit mid-stream, with a timestamp
        // between two real frames so the MKV muxer stays monotonic. This is the
        // exact shape seen on viewer-re-exported dashcam MKVs (~1 empty AU/sec).
        const insertAt = 3;
        const between = (source.packets[insertAt - 1]!.timestamp + source.packets[insertAt]!.timestamp) / 2;
        const degenerate: PacketRecord = {
            data: new Uint8Array(DEGENERATE_VIDEO_PACKET_MAX_BYTES),
            type: "delta",
            timestamp: between,
            duration: 0,
        };
        const withDegenerate = [...source.packets.slice(0, insertAt), degenerate, ...source.packets.slice(insertAt)];
        const dirtyMkv = await buildMkv(source, withDegenerate, "dirty.mkv");

        // Sanity: the dirty MKV really carries the degenerate packet.
        const dirty = await readVideoStream(dirtyMkv);
        expect(dirty.packets.some((p) => p.data.byteLength <= DEGENERATE_VIDEO_PACKET_MAX_BYTES)).toBe(true);
        expect(dirty.packets.length).toBe(source.packets.length + 1);

        const resolver = createVideoSourceResolver();
        const clean = await resolver.resolve(dirtyMkv);
        expect(clean).not.toBe(dirtyMkv);
        await expectValidMp4(clean);

        const out = await readVideoStream(clean);
        // The degenerate packet is gone; every real frame survives.
        expect(out.packets.length).toBe(source.packets.length);
        expect(out.packets.every((p) => p.data.byteLength > DEGENERATE_VIDEO_PACKET_MAX_BYTES)).toBe(true);
        // Timestamps of the surviving frames are preserved (remux carries pts
        // verbatim; allow a sub-millisecond tolerance for MP4 timescale rounding).
        for (let i = 0; i < source.packets.length; i++) {
            expect(out.packets[i]!.timestamp).toBeCloseTo(source.packets[i]!.timestamp, 3);
        }
    });
});

// Asserts the File is a structurally valid MP4: an `ftyp` box at the head plus
// `moov` and `mdat` boxes somewhere in the bytes.
async function expectValidMp4(file: File): Promise<void> {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const ascii = (offset: number): string => String.fromCharCode(...bytes.subarray(offset, offset + 4));
    // First box type sits at bytes 4..8 (after the 32-bit box size).
    expect(ascii(4)).toBe("ftyp");
    const haystack = new TextDecoder("latin1").decode(bytes);
    expect(haystack.includes("moov")).toBe(true);
    expect(haystack.includes("mdat")).toBe(true);
}
