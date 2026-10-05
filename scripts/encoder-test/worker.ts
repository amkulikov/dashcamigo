import { CanvasSource, Mp4OutputFormat, NullTarget, Output, Quality } from "mediabunny";
import { createEncoderProbeScene as createScene } from "../../src/transcode/encoder-probe-scene.js";
import { errorMessage, initialResult, type TestCase, type WorkerMessage } from "./shared.js";

function hex(bytes: Uint8Array): string {
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function decoderMetadata(config: VideoDecoderConfig): Record<string, unknown> {
    const { description, ...fields } = config;
    if (!description) return fields;
    const bytes = ArrayBuffer.isView(description)
        ? new Uint8Array(description.buffer, description.byteOffset, description.byteLength)
        : new Uint8Array(description);
    return { ...fields, descriptionBytes: bytes.length, descriptionHex: hex(bytes.subarray(0, 512)) };
}

async function run(test: TestCase): Promise<void> {
    const start = performance.now();
    const result = initialResult(test);
    const encodedParts: Uint8Array[] = [];
    let hashBytes = 0;
    let encoder: VideoEncoder | undefined;
    let output: Output | undefined;
    const send = (type: WorkerMessage["type"]) => {
        result.elapsedMs = Math.round(performance.now() - start);
        postMessage({ type, result } satisfies WorkerMessage);
    };
    const packet = (
        bytes: Uint8Array,
        timestamp: number,
        duration: number | null,
        isKey: boolean,
        metadata?: EncodedVideoChunkMetadata,
    ) => {
        const stats = result.stats;
        stats.frames++;
        stats.keyframes += Number(isKey);
        stats.bytes += bytes.length;
        stats.firstTimestampUs = Math.min(stats.firstTimestampUs ?? timestamp, timestamp);
        if (duration === null) stats.missingDurations++;
        const end = timestamp + (duration ?? 1e6 / test.fps);
        stats.lastEndTimestampUs = Math.max(stats.lastEndTimestampUs ?? end, end);
        const second = Math.max(0, Math.floor(timestamp / 1e6));
        stats.bytesPerSecond[second] = (stats.bytesPerSecond[second] ?? 0) + bytes.length;
        if (metadata?.decoderConfig) stats.decoderConfigs.push(decoderMetadata(metadata.decoderConfig));
        hashBytes += bytes.length;
        if (hashBytes <= 64 * 1024 * 1024) encodedParts.push(bytes);
        else {
            encodedParts.length = 0;
            result.hashError = "encoded data exceeds hash memory limit";
        }
    };
    try {
        result.workerEnvironment = {
            secureContext: isSecureContext,
            videoEncoder: typeof VideoEncoder !== "undefined",
            videoFrame: typeof VideoFrame !== "undefined",
            offscreenCanvas: typeof OffscreenCanvas !== "undefined",
        };
        result.phase = "checking support";
        send("progress");
        if (
            typeof VideoEncoder === "undefined" ||
            typeof VideoFrame === "undefined" ||
            typeof OffscreenCanvas === "undefined"
        ) {
            result.status = "unsupported";
            result.error = "required browser APIs unavailable in worker";
            return;
        }
        const config: VideoEncoderConfig = {
            codec: test.codec,
            width: test.width,
            height: test.height,
            framerate: test.fps,
            bitrate: test.bitrate,
            bitrateMode: test.bitrateMode,
            latencyMode: "quality",
            hardwareAcceleration: test.hardwareAcceleration,
            alpha: "discard",
            avc: { format: "avc" },
        };
        result.requestedConfig = config;
        result.support = await VideoEncoder.isConfigSupported(config);
        send("progress");
        if (!result.support.supported) {
            result.status = "unsupported";
            return;
        }
        const scene = createScene(test.width, test.height);
        const frames = Math.round(test.seconds * test.fps);
        let encoderError: unknown;
        if (test.pipeline === "webcodecs") {
            encoder = new VideoEncoder({
                output(chunk, metadata) {
                    const bytes = new Uint8Array(chunk.byteLength);
                    chunk.copyTo(bytes);
                    packet(bytes, chunk.timestamp, chunk.duration, chunk.type === "key", metadata);
                },
                error(error) {
                    encoderError = error;
                },
            });
            encoder.configure(config);
        } else {
            const source = new CanvasSource(scene.canvas, {
                codec: "avc",
                fullCodecString: test.codec,
                quality: new Quality({ bitrate: test.bitrate, bitrateMode: test.bitrateMode }),
                latencyMode: "quality",
                hardwareAcceleration: test.hardwareAcceleration,
                keyFrameInterval: 2,
                sizeChangeBehavior: "deny",
                onEncoderConfig(config) {
                    result.libraryConfigs.push(config);
                    send("progress");
                },
                onEncodedPacket(encoded, metadata) {
                    packet(
                        encoded.data.slice(),
                        encoded.timestamp * 1e6,
                        encoded.duration * 1e6,
                        encoded.type === "key",
                        metadata,
                    );
                },
            });
            output = new Output({ format: new Mp4OutputFormat(), target: new NullTarget() });
            output.addVideoTrack(source, { frameRate: test.fps });
            await output.start();
            result.phase = "encoding";
            for (let frame = 0; frame < frames; frame++) {
                scene.draw(frame / test.fps);
                await source.add(frame / test.fps, 1 / test.fps, { keyFrame: frame % (2 * test.fps) === 0 });
                result.submittedFrames++;
                if (frame % test.fps === 0) send("progress");
            }
        }
        if (encoder) {
            result.phase = "encoding";
            for (let frame = 0; frame < frames; frame++) {
                while (encoder.encodeQueueSize > 4 && !encoderError)
                    await new Promise((resolve) => setTimeout(resolve, 5));
                if (encoderError) throw encoderError;
                scene.draw(frame / test.fps);
                const timestamp = Math.round((frame * 1e6) / test.fps);
                const sample = new VideoFrame(scene.canvas, {
                    timestamp,
                    duration: Math.round(((frame + 1) * 1e6) / test.fps) - timestamp,
                });
                try {
                    encoder.encode(sample, { keyFrame: frame % (2 * test.fps) === 0 });
                } finally {
                    sample.close();
                }
                result.submittedFrames++;
                if (frame % test.fps === 0) send("progress");
            }
        }
        result.phase = "flushing";
        send("progress");
        if (encoder) await encoder.flush();
        if (encoderError) throw encoderError;
        if (output) await output.finalize();
        const { stats } = result;
        const durationUs = (stats.lastEndTimestampUs ?? 0) - (stats.firstTimestampUs ?? 0);
        result.measuredBitrate = durationUs > 0 ? Math.round((stats.bytes * 8 * 1e6) / durationUs) : 0;
        result.targetRatio = result.measuredBitrate / test.bitrate;
        result.allFramesReceived = stats.frames === frames && result.submittedFrames === frames;
        result.phase = "hashing";
        send("progress");
        if (!result.hashError) {
            try {
                const bytes = new Uint8Array(hashBytes);
                let offset = 0;
                for (const part of encodedParts) {
                    bytes.set(part, offset);
                    offset += part.length;
                }
                result.encodedSha256 = hex(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)));
            } catch (error) {
                result.hashError = errorMessage(error);
            }
        }
        result.status = "completed";
        result.phase = "finished";
    } catch (error) {
        result.status = "error";
        result.error = errorMessage(error);
    } finally {
        if (encoder && encoder.state !== "closed") encoder.close();
        // Deliver the evidence before cleanup: the main thread can terminate a stuck worker.
        send("done");
        if (output && output.state !== "finalized" && output.state !== "canceled") {
            await output.cancel().catch(() => undefined);
        }
    }
}

globalThis.onmessage = (event: MessageEvent<TestCase>) => {
    void run(event.data);
};
