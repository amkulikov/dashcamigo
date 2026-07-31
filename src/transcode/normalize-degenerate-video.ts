// Normalize a container whose encoded video stream carries degenerate/empty
// packets into a clean MP4 that mediabunny's strict WebCodecs decode path can
// consume.
//
// WHY this exists: some viewers re-export dashcam clips as Matroska with an empty
// ~4-byte access unit (a bare length-prefix / zero-length NAL, no coded picture)
// about once a second. Playback survives (MSE decoders skip them) and stream-copy
// export survives (export.ts drops them in its copy loop), but the RE-ENCODE
// pipelines decode through mediabunny's VideoSampleSink, which feeds every packet
// straight to a WebCodecs VideoDecoder - and a strict decoder throws EncodingError
// on the empty packet, aborting the whole segment (a mid-stream bad packet kills
// the single decoder the sink wraps; it cannot resume). mediabunny exposes no
// packet-filter / decode-tolerance hook (verified against its current docs and
// type surface), so the clean fix is to normalize the source ONCE up front: a
// pure stream-copy remux (NO re-encode) that drops the degenerate packets, then
// feed the resulting clean MP4 to the UNCHANGED decode path - which keeps all of
// mediabunny's per-packet Chromium/Safari/HEVC decoder workarounds intact.
//
// This is the same machinery - and the same drop threshold - as export.ts's
// stream-copy loop, just targeting an in-memory BufferTarget instead of the disk
// writable. Scope is MKV only: healthy MP4/TS never carry these packets, so they
// pass through untouched (identity resolve), preserving the mature export path
// byte-for-byte.
//
// RAM: the clean copy is buffered whole in memory (no OPFS in this project, and a
// stream target cannot be re-opened as an Input). MKV inputs here are viewer
// re-exports of single clips (tens of seconds), so the copy is small; a
// pathological multi-minute MKV would double its video RAM for the export. The
// remux is per unique File and cached, so a multi-segment range remuxes once.

import { BufferTarget, EncodedPacketSink, EncodedVideoPacketSource, Input, Mp4OutputFormat, Output } from "mediabunny";
import { createLogger } from "../log.js";
import { createRetryingBlobSource } from "../retrying-blob-source.js";
import { isMatroskaName } from "../video-format-names.js";
import { VIDEO_INPUT_FORMATS } from "../video-formats.js";

const log = createLogger("normalize-video");

// Max byte length of a video packet treated as an empty/phantom access unit and
// dropped. A real coded H.264/HEVC picture - even a tiny P-frame - is well above
// this; only a bare length-prefix (a zero-length NAL, ~4 bytes) falls under it.
// Single source of truth: export.ts's stream-copy loop imports this constant.
export const DEGENERATE_VIDEO_PACKET_MAX_BYTES = 4;

export interface VideoSourceResolver {
    /**
     * Returns a strictly-decodable video File for `file`. For MKV this is a
     * stream-copy MP4 with degenerate packets dropped (cached per File, so a
     * multi-segment range of one file remuxes once). For any other container -
     * or when the remux is not possible - returns `file` unchanged.
     *
     * Never throws: a remux failure logs and falls back to the original, leaving
     * the caller no worse off than before this normalization existed.
     */
    resolve(file: File): Promise<File>;
}

/**
 * Creates a per-export resolver that turns degenerate-packet MKV sources into
 * clean MP4s on demand, memoizing by File identity. One instance per pipeline
 * run; drop the reference when the export ends to release the cached buffers.
 */
export function createVideoSourceResolver(): VideoSourceResolver {
    // Cache the PROMISE (not the File) so concurrent slots/segments asking for the
    // same file dedupe onto one remux. Each entry always resolves (failures are
    // mapped to the original file below), so a cached miss never rejects.
    const cache = new Map<File, Promise<File>>();
    return {
        resolve(file: File): Promise<File> {
            if (!isMatroskaName(file.name)) return Promise.resolve(file);
            let pending = cache.get(file);
            if (!pending) {
                pending = normalizeToCleanMp4(file).catch((err) => {
                    log.warn("degenerate-video normalize failed, using original source", {
                        file: file.name,
                        err: String(err),
                    });
                    return file;
                });
                cache.set(file, pending);
            }
            return pending;
        },
    };
}

/**
 * Stream-copies `file`'s primary video track into an in-memory MP4, dropping
 * degenerate packets. Timestamps are preserved verbatim so the pipeline's
 * file-time seg range still addresses the same frames on the clean copy. Returns
 * the original file untouched when there is nothing to normalize or the copy is
 * not possible (no video track / unreadable codec config / unmuxable codec).
 */
async function normalizeToCleanMp4(file: File): Promise<File> {
    const input = new Input({ source: createRetryingBlobSource(file), formats: VIDEO_INPUT_FORMATS });
    try {
        const track = await input.getPrimaryVideoTrack();
        if (!track) return file;
        const codec = await track.getCodec();
        // The decoder config rides the first packet into the output moov; without
        // it the muxer throws. A null here means the source is not cleanly
        // stream-copyable - fall back rather than fail the export.
        const decoderConfig = await track.getDecoderConfig();
        if (!codec || !decoderConfig) return file;
        // Carry the display-matrix rotation so a rotated source does not open
        // sideways after the round-trip (mirrors export.ts).
        const rotation = await track.getRotation();

        const target = new BufferTarget();
        const output = new Output({ format: new Mp4OutputFormat({ fastStart: false }), target });
        const videoSource = new EncodedVideoPacketSource(codec);
        output.addVideoTrack(videoSource, { rotation });
        await output.start();

        const sink = new EncodedPacketSink(track);
        // verifyKeyPackets bitstream-checks the key/delta flag we copy verbatim
        // into the output sync-sample table - a mislabeled source flag would
        // otherwise corrupt seeking on the clean copy (same rationale as export.ts).
        let packet = await sink.getFirstPacket({ verifyKeyPackets: true });
        let pushedAny = false;
        let dropped = 0;
        while (packet) {
            if (packet.byteLength <= DEGENERATE_VIDEO_PACKET_MAX_BYTES) {
                dropped++;
                packet = await sink.getNextPacket(packet, { verifyKeyPackets: true });
                continue;
            }
            // Packets arrive in decode order with presentation timestamps; B-frames
            // are reordered by the muxer automatically. The decoder config is pushed
            // once, with the first kept packet.
            await videoSource.add(packet, pushedAny ? undefined : { decoderConfig });
            pushedAny = true;
            packet = await sink.getNextPacket(packet, { verifyKeyPackets: true });
        }
        await output.finalize();

        const buffer = target.buffer;
        // A track that was all-degenerate (pushedAny false) or a muxer that yielded
        // no bytes leaves nothing usable - keep the original.
        if (!buffer || !pushedAny) return file;
        log.info("normalized degenerate video to clean mp4", {
            file: file.name,
            droppedPackets: dropped,
            bytes: buffer.byteLength,
        });
        return new File([buffer], `${file.name}.clean.mp4`, { type: "video/mp4" });
    } finally {
        input.dispose();
    }
}
