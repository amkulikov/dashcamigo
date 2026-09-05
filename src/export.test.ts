import { readFileSync } from "node:fs";
import {
    BlobSource,
    BufferTarget,
    EncodedPacketSink,
    EncodedVideoPacketSource,
    Input,
    Mp4OutputFormat,
    Output,
    type EncodedPacket,
    type InputTrack,
} from "mediabunny";
import { describe, expect, it, vi } from "vitest";
import { exportClip, probeAudioUniformity } from "./export.js";
import { getInputTimeOrigin } from "./media-time.js";
import { groupTrips, type VideoCandidate } from "./trips.js";
import { createInMemoryFileHandle } from "./ui/in-memory-file.js";
import { VIDEO_INPUT_FORMATS } from "./video-formats.js";

const H264_FIXTURE = "../tests/testdata/70mai-multichannel/Normal/Front/NO20260101-120000-000001F.MP4";

function fixture(path: string): File {
    return new File([readFileSync(new URL(path, import.meta.url))], path.split("/").at(-1)!);
}

function open(file: File): Input {
    return new Input({ source: new BlobSource(file), formats: VIDEO_INPUT_FORMATS });
}

async function packets(track: InputTrack): Promise<EncodedPacket[]> {
    const sink = new EncodedPacketSink(track);
    const result: EncodedPacket[] = [];
    for (let packet = await sink.getFirstPacket(); packet; packet = await sink.getNextPacket(packet)) {
        result.push(packet);
    }
    return result;
}

async function tripOf(files: File[]) {
    let startUtc = 1_700_000_000;
    const candidates: VideoCandidate[] = [];
    for (const file of files) {
        const input = open(file);
        try {
            const durationSec = (await input.computeDuration()) - (await getInputTimeOrigin(input));
            candidates.push({
                file,
                relativePath: file.name,
                fingerprint: "export-test-camera",
                appliedExtractors: [],
                classifierMatches: { time: null, channel: null, mode: null, sequence: null },
                channel: "front",
                channelConfident: true,
                sequence: candidates.length,
                recordingMode: "normal",
                isTimelapse: false,
                startUtc,
                durationSec,
                wallDurationSec: null,
                driftLeadSec: null,
                startSource: "mp4",
                cameraTzSec: 0,
                localClockOffsetHintSec: null,
                createdUtc: null,
                records: [],
                codec: null,
                codecParam: null,
                videoCodecString: null,
                rotation: 0,
                width: null,
                height: null,
                fps: 30,
                audio: null,
                canPlay: true,
                needsHevcRemux: false,
                isTransportStream: false,
                isMatroska: false,
                audioNeedsTranscode: false,
                embeddedStartUtcHint: null,
            });
            startUtc += durationSec;
        } finally {
            input.dispose();
        }
    }
    const trips = groupTrips(candidates);
    expect(trips).toHaveLength(1);
    return trips[0]!;
}

async function save(files: File[], end?: number) {
    const trip = await tripOf(files);
    const handle = createInMemoryFileHandle(
        "export.mp4",
        files.reduce((sum, file) => sum + file.size, 0),
    );
    const result = await exportClip({
        trip,
        channel: "front",
        startTripSec: 0,
        endTripSec: end ?? trip.timeline.contentDurationSec,
        withAudio: true,
        withGpmf: false,
        mp4Writable: await handle.createWritable(),
        onProgress() {},
        signal: new AbortController().signal,
    });
    return { result, file: await handle.getFile() };
}

async function withoutAudio(file: File): Promise<File> {
    const input = open(file);
    const target = new BufferTarget();
    const output = new Output({ target, format: new Mp4OutputFormat() });
    try {
        const track = await input.getPrimaryVideoTrack();
        if (!track) throw new Error("fixture has no video track");
        const codec = await track.getCodec();
        const config = await track.getDecoderConfig();
        if (!codec || !config) throw new Error("fixture has no video config");
        const source = new EncodedVideoPacketSource(codec);
        output.addVideoTrack(source);
        await output.start();
        let first = true;
        for (const packet of await packets(track)) {
            await source.add(packet, first ? { decoderConfig: config } : undefined);
            first = false;
        }
        await output.finalize();
        return new File([target.buffer!], "silent.mp4");
    } finally {
        input.dispose();
    }
}

describe("stream-copy export", () => {
    it.each([
        "./parsers/__fixtures__/juscar/real-anonymized.TS",
        "./parsers/__fixtures__/novatek-ts/real-anonymized.TS",
    ])("copies video and audio from a transport clock in %s", async (path) => {
        const file = fixture(path);
        const source = open(file);
        const output = open((await save([file, file])).file);
        try {
            const sourceVideo = (await source.getPrimaryVideoTrack())!;
            const outputVideo = await output.getPrimaryVideoTrack();
            const outputAudio = await output.getPrimaryAudioTrack();
            expect(outputVideo).not.toBeNull();
            expect(outputAudio).not.toBeNull();
            const sourcePackets = await packets(sourceVideo);
            const outputPackets = await packets(outputVideo!);
            expect(outputPackets).toHaveLength(sourcePackets.length * 2);
            expect(outputPackets[0]!.timestamp).toBeCloseTo(0);
            expect(outputPackets[sourcePackets.length]!.data).toEqual(outputPackets[0]!.data);
            expect((await packets(outputAudio!)).length).toBeGreaterThan(1);
        } finally {
            source.dispose();
            output.dispose();
        }
    });

    it("keeps B-frame segment joins on the complete presentation timeline", async () => {
        const file = fixture(H264_FIXTURE);
        const output = open((await save(Array<File>(30).fill(file))).file);
        try {
            const video = (await output.getPrimaryVideoTrack())!;
            const audio = (await output.getPrimaryAudioTrack())!;
            const outputPackets = await packets(video);
            expect(outputPackets).toHaveLength(1800);
            expect(await video.computeDuration()).toBeCloseTo(60);
            expect(await audio.computeDuration()).toBeCloseTo(60);
            expect(outputPackets[60]!.timestamp).toBeCloseTo(2);
            expect(new Set(outputPackets.map((packet) => packet.timestamp)).size).toBe(1800);
        } finally {
            output.dispose();
        }
    });

    it("retains in-range B-frames and the later-presented references they depend on", async () => {
        const file = fixture(H264_FIXTURE);
        const source = open(file);
        const output = open((await save([file], 0.5)).file);
        try {
            const sourcePackets = await packets((await source.getPrimaryVideoTrack())!);
            const outputPackets = await packets((await output.getPrimaryVideoTrack())!);
            for (const packet of sourcePackets.filter((packet) => packet.timestamp < 0.5)) {
                expect(outputPackets.find((candidate) => candidate.timestamp === packet.timestamp)?.data).toEqual(
                    packet.data,
                );
            }
            expect(outputPackets.some((packet) => packet.timestamp > 0.5)).toBe(true);
            expect(outputPackets.map((packet) => packet.data)).toEqual(
                sourcePackets.slice(0, outputPackets.length).map((packet) => packet.data),
            );
        } finally {
            source.dispose();
            output.dispose();
        }
    });

    it("starts the audio track when the first audio-bearing file starts", async () => {
        const file = fixture(H264_FIXTURE);
        const silent = await withoutAudio(file);
        const probe = await probeAudioUniformity([silent, file]);
        expect(probe.uniform).toBe(true);
        expect(probe.firstFile).toBe(file);
        const saved = await save([silent, file]);
        expect(saved.result.audioDroppedHeterogeneous).toBe(false);
        const output = open(saved.file);
        try {
            const audio = await output.getPrimaryAudioTrack();
            expect(audio).not.toBeNull();
            expect(await audio!.getFirstTimestamp()).toBeCloseTo(2);
            expect(await audio!.computeDuration()).toBeCloseTo(4);
        } finally {
            output.dispose();
        }
    });

    it("rejects incompatible video before committing any output", async () => {
        const files = [fixture(H264_FIXTURE), fixture("../tests/testdata/no-gps-h264/clip-no-gps.mp4")];
        const trip = await tripOf(files);
        const handle = createInMemoryFileHandle("export.mp4");
        await expect(
            exportClip({
                trip,
                channel: "front",
                startTripSec: 0,
                endTripSec: trip.timeline.contentDurationSec,
                withAudio: true,
                withGpmf: false,
                mp4Writable: await handle.createWritable(),
                onProgress() {},
            }),
        ).rejects.toMatchObject({ name: "IncompatibleVideoConfigError" });
        expect((await handle.getFile()).size).toBe(0);
    });

    it("rejects packet framing changes with an otherwise identical video configuration", async () => {
        const file = fixture("./parsers/__fixtures__/juscar/real-anonymized.TS");
        const remuxed = await withoutAudio(file);
        const source = open(file);
        const mp4 = open(remuxed);
        try {
            const originalConfig = await (await source.getPrimaryVideoTrack())!.getDecoderConfig();
            const remuxedConfig = await (await mp4.getPrimaryVideoTrack())!.getDecoderConfig();
            expect(originalConfig?.codec).toBe(remuxedConfig?.codec);
            expect(originalConfig?.codedWidth).toBe(remuxedConfig?.codedWidth);
            expect(originalConfig?.description).toBeUndefined();
            expect(remuxedConfig?.description).toBeDefined();
        } finally {
            source.dispose();
            mp4.dispose();
        }
        await expect(save([file, remuxed])).rejects.toMatchObject({ name: "IncompatibleVideoConfigError" });
    });

    it("preserves an existing destination when cancelled after copying begins", async () => {
        const file = fixture(H264_FIXTURE);
        const trip = await tripOf([file]);
        const handle = createInMemoryFileHandle("existing.mp4", file.size);
        const existing = await handle.createWritable();
        await existing.write(await file.arrayBuffer());
        await existing.close();
        const controller = new AbortController();
        // The progress throttle is the cancellation trigger under test.
        vi.useFakeTimers({ toFake: ["performance"] });
        try {
            vi.advanceTimersByTime(1000);
            await expect(
                exportClip({
                    trip,
                    channel: "front",
                    startTripSec: 0,
                    endTripSec: trip.timeline.contentDurationSec,
                    withAudio: false,
                    withGpmf: false,
                    mp4Writable: await handle.createWritable(),
                    signal: controller.signal,
                    onProgress(progress) {
                        if (progress.pct !== undefined) controller.abort();
                    },
                }),
            ).rejects.toMatchObject({ name: "AbortError" });
            expect(await (await handle.getFile()).arrayBuffer()).toEqual(await file.arrayBuffer());
        } finally {
            vi.useRealTimers();
        }
    });

    it("propagates an exhausted source-read failure during audio preflight", async () => {
        const file = fixture(H264_FIXTURE);
        const failure = new DOMException("requested file could not be read", "NotReadableError");
        const slice = file.slice.bind(file);
        let attempts = 0;
        file.slice = (...args) => {
            const blob = slice(...args);
            blob.stream = () =>
                new ReadableStream({
                    start(controller) {
                        attempts++;
                        controller.error(failure);
                    },
                });
            return blob;
        };
        vi.useFakeTimers();
        try {
            const rejected = expect(probeAudioUniformity([file])).rejects.toBe(failure);
            await vi.advanceTimersByTimeAsync(10_000);
            await rejected;
            expect(attempts).toBeGreaterThan(1);
        } finally {
            vi.useRealTimers();
        }
    });
});
