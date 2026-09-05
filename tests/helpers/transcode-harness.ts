import { BlobSource, Input, VideoSampleSink, type VideoSample } from "mediabunny";
import { getInputTimeOrigin } from "../../src/media-time.js";
import { createVideoSourceResolver } from "../../src/transcode/normalize-degenerate-video.js";
import { canReencodeH264 } from "../../src/transcode/capabilities.js";
import { transcode } from "../../src/transcode/pipeline.js";
import { transcodeSplit } from "../../src/transcode/pipeline-split.js";
import { finalizeTripFromFrames, type TripFrame, type VideoCandidate } from "../../src/trips.js";
import { VIDEO_INPUT_FORMATS } from "../../src/video-formats.js";

function candidate(file: File, startUtc: number, durationSec: number): VideoCandidate {
    return {
        file,
        startUtc,
        durationSec,
        relativePath: file.name,
        fingerprint: "transcode-fixture",
        appliedExtractors: [],
        classifierMatches: { time: null, channel: null, mode: null, sequence: null },
        channel: "front",
        channelConfident: true,
        sequence: null,
        recordingMode: null,
        isTimelapse: false,
        wallDurationSec: null,
        driftLeadSec: null,
        startSource: "mp4",
        cameraTzSec: null,
        createdUtc: null,
        records: [],
        codec: "avc",
        codecParam: null,
        videoCodecString: null,
        rotation: 0,
        width: 640,
        height: 360,
        fps: 30,
        audio: null,
        canPlay: true,
        needsHevcRemux: false,
        isTransportStream: file.name.endsWith(".TS"),
        isMatroska: false,
        audioNeedsTranscode: false,
        embeddedStartUtcHint: null,
        localClockOffsetHintSec: null,
    };
}

function captureOutput() {
    const writes: { position: number; data: Uint8Array<ArrayBuffer> }[] = [];
    const writable = {
        async write(chunk: { position: number; data: Uint8Array }) {
            writes.push({ position: chunk.position, data: chunk.data.slice() });
        },
        async close() {},
        async abort() {},
    } as unknown as FileSystemWritableFileStream;
    return {
        writable,
        file() {
            const size = writes.reduce((max, write) => Math.max(max, write.position + write.data.byteLength), 0);
            const bytes = new Uint8Array(size);
            for (const write of writes) bytes.set(write.data, write.position);
            return new File([bytes], "export.mp4");
        },
    };
}

async function fileTiming(file: File) {
    const input = new Input({ source: new BlobSource(file), formats: VIDEO_INPUT_FORMATS });
    try {
        const track = (await input.getPrimaryVideoTrack())!;
        const origin = await getInputTimeOrigin(input);
        return {
            duration: (await track.computeDuration()) - origin,
            firstTimestamp: (await track.getFirstTimestamp()) - origin,
        };
    } finally {
        input.dispose();
    }
}

export async function runTranscodeRegression(
    bytes: number[],
    kind: "split" | "single-ts" | "split-ts" | "split-large" | "cancel",
) {
    if (!(await canReencodeH264(640, 360, 1_000_000))) return { supported: false as const };
    const isTs = kind.endsWith("-ts");
    const original = new File([new Uint8Array(bytes)], isTs ? "source.TS" : "source.mkv");
    const file = await createVideoSourceResolver().resolve(original);
    const timing = await fileTiming(file);
    const count = isTs ? 1 : kind === "split-large" ? 24 : 8;
    const frames: TripFrame[] = Array.from({ length: count }, (_, index) => {
        const startUtc = 1000 + index * timing.duration;
        const c = candidate(file, startUtc, timing.duration);
        return {
            startUtc,
            durationSec: timing.duration,
            wallDurationSec: timing.duration,
            channels: { front: c, rear: { ...c, channel: "rear" } },
        };
    });
    const trip = finalizeTripFromFrames(frames);
    const captured = captureOutput();
    const live = new Set<VideoFrame>();
    const decoders: VideoDecoder[] = [];
    let decoded = 0;
    const originalClose = VideoFrame.prototype.close;
    const OriginalDecoder = globalThis.VideoDecoder;
    const originalSamples = VideoSampleSink.prototype.samples;
    const iterators: AsyncGenerator<VideoSample, void, unknown>[] = [];
    VideoFrame.prototype.close = function () {
        live.delete(this);
        originalClose.call(this);
    };
    globalThis.VideoDecoder = class extends OriginalDecoder {
        constructor(init: VideoDecoderInit) {
            super({
                ...init,
                output(frame) {
                    live.add(frame);
                    decoded++;
                    init.output(frame);
                },
            });
            decoders.push(this);
        }
    };
    // Retain abandoned iterators so GC cannot conceal missing close()/return().
    VideoSampleSink.prototype.samples = function (...args) {
        const iterator = originalSamples.apply(this, args);
        iterators.push(iterator);
        return iterator;
    };
    const abort = new AbortController();
    try {
        const common = {
            output: {
                height: 360,
                aspect: "16:9" as const,
                bitrate: 1_000_000,
                watermarkAnchor: null,
                withAudio: isTs,
                letterboxFill: "black" as const,
                overlays: null,
                speedFactor: isTs || kind === "split-large" ? 1 : 32,
                blurRegions: null,
            },
            writable: captured.writable,
            signal: abort.signal,
            onProgress(progress: { framesDone: number }) {
                if (kind === "cancel" && progress.framesDone > 0) abort.abort();
            },
        };
        let cancelled = false;
        let result: Awaited<ReturnType<typeof transcode>> | null = null;
        try {
            result =
                kind === "single-ts"
                    ? await transcode({
                          ...common,
                          source: { trip, channel: "front", startTripSec: 0, endTripSec: timing.duration },
                          output: { ...common.output, crop: null },
                      })
                    : await transcodeSplit({
                          ...common,
                          source: {
                              trip,
                              slotChannels: ["front", "rear"],
                              startTripSec: 0,
                              endTripSec: trip.timeline.contentDurationSec,
                          },
                          output: { ...common.output, layout: "h2" },
                      });
        } catch (error) {
            if (kind !== "cancel" || !(error instanceof DOMException) || error.name !== "AbortError") throw error;
            cancelled = true;
        }
        const unclosedFrames = live.size;
        if (cancelled) return { supported: true as const, cancelled: true as const, decoded, unclosedFrames };
        const outputFile = captured.file();
        const input = new Input({ source: new BlobSource(outputFile), formats: VIDEO_INPUT_FORMATS });
        try {
            const video = (await input.getPrimaryVideoTrack())!;
            const audio = await input.getPrimaryAudioTrack();
            return {
                supported: true as const,
                cancelled: false as const,
                decoded,
                unclosedFrames,
                resultFrames: result!.framesEncoded,
                reportedBytes: result!.sizeBytes,
                actualBytes: outputFile.size,
                videoStart: await video.getFirstTimestamp(),
                videoEnd: await video.computeDuration(),
                audioStart: audio ? await audio.getFirstTimestamp() : null,
                audioEnd: audio ? await audio.computeDuration() : null,
                sourceDuration: timing.duration,
                sourceVideoStart: timing.firstTimestamp,
            };
        } finally {
            input.dispose();
        }
    } finally {
        for (const iterator of iterators) await iterator.return();
        for (const frame of live) frame.close();
        for (const decoder of decoders) if (decoder.state !== "closed") decoder.close();
        VideoFrame.prototype.close = originalClose;
        globalThis.VideoDecoder = OriginalDecoder;
        VideoSampleSink.prototype.samples = originalSamples;
    }
}
