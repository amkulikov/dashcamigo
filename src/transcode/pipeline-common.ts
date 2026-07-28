// Helpers shared by the single-channel (pipeline.ts) and split-screen
// (pipeline-split.ts) transcode pipelines. The two pipelines keep separate
// decode/compose loops on purpose - those access patterns differ - but the
// muxer plumbing and a few tiny utilities are identical, so they live here.

import {
    AudioSample,
    AudioSampleSink,
    AudioSampleSource,
    CanvasSource,
    EncodedAudioPacketSource,
    type EncodedPacket,
    EncodedPacketSink,
    type Input,
    Mp4OutputFormat,
    Output,
    StreamTarget,
    type AudioCodec,
    type VideoCodec,
} from "mediabunny";

import { createLogger } from "../log.js";
import type { AudioTrackFormat } from "../export-range.js";
import { type AdpcmAudioReader, openAdpcmAudioAuto } from "./adpcm-audio.js";
import { createEncodeAudioSource, resolveEncodeAudioCodec } from "./capabilities.js";
import { drawMapOverlay } from "./map-overlay.js";
import type { OverlayMapPipelineOpts, TranscodeProgress, TranscodeResult } from "./types.js";

const log = createLogger("transcode:finalize");

/** Output frame rate used when the source's own rate is unknown. 30 is what most
 *  dashcams record at, so it is the least-wrong guess. */
export const FALLBACK_OUTPUT_FPS = 30;

/**
 * Bitrate (kbit/s) an output actually came out at, for the done-line next to the
 * requested figure. Includes the audio track and container overhead, so it reads
 * slightly above the video-only request even on a perfect match - it is a
 * "did the encoder land anywhere near what we asked" signal, not a measurement.
 * 0 for a zero-length output.
 */
export function achievedKbps(sizeBytes: number, durationSec: number): number {
    if (!(durationSec > 0.001)) return 0;
    return Math.round((sizeBytes * 8) / durationSec / 1000);
}

// Bounds on the frame rate an export will run at. The low end keeps a bad
// indexer estimate from producing a one-frame clip; the high end keeps it from
// asking the encoder for a rate no dashcam records at (and, via the budget, for
// an absurd bitrate).
const MIN_OUTPUT_FPS = 5;
const MAX_OUTPUT_FPS = 120;

/**
 * Frame rate the export runs at, from the source rate measured over the range
 * (rangeSourceFps). Clamped to a plausible band; null (nothing measurable)
 * falls back to FALLBACK_OUTPUT_FPS.
 *
 * This is load-bearing in three places, and it used to be pinned at 30 in all
 * three: the encode budget is per second, so a 60 fps source needs twice the
 * bits; the expected frame count drives the progress bar and its ETA; and the
 * value is written into the output track's metadata.
 */
export function resolveOutputFps(sourceFps: number | null): number {
    if (sourceFps === null || !Number.isFinite(sourceFps) || sourceFps <= 0) return FALLBACK_OUTPUT_FPS;
    return Math.min(MAX_OUTPUT_FPS, Math.max(MIN_OUTPUT_FPS, sourceFps));
}

// Source codecs we stream-copy straight into the output MP4 (no encoder, no
// quality loss). Both are universally MP4-muxable and decode everywhere, and
// they cover all real *readable* dashcam audio - the only other case, IMA-ADPCM,
// is codec===null (mediabunny cannot read it) and goes through the encode path.
const PASSTHROUGH_AUDIO_CODECS: readonly AudioCodec[] = ["aac", "mp3"];

/**
 * How the re-encode export will handle audio for a range, decided once from the
 * first audio-bearing segment's probe. Three shapes:
 *  - "passthrough": the source is an already-MP4-muxable codec (AAC/MP3) and the
 *    export is real-time, so we stream-copy the encoded packets - no decode, no
 *    re-encode, no audio ENCODER needed (this is what makes audio survive on a
 *    codec-stripped Chromium that cannot encode AAC). See feedSegmentAudioCopy.
 *  - "encode": the source must be decoded and re-encoded - IMA-ADPCM (we decode
 *    it ourselves; adpcmReader non-null), or a readable-but-not-passthrough codec
 *    (rare). `codec` is the chosen encode codec (aac, or opus fallback).
 *  - "skip": no audio track is added. noEncoder=true means audio was wanted but
 *    no encoder exists (drop + notify); noEncoder=false is a benign skip (an
 *    unreadable codec that is not our ADPCM).
 */
export type AudioPlan =
    | { mode: "passthrough"; codec: AudioCodec; source: EncodedAudioPacketSource }
    | {
          mode: "encode";
          codec: AudioCodec;
          source: AudioSampleSource;
          silenceFormat: SilenceFormat;
          adpcmReader: AdpcmAudioReader | null;
      }
    | { mode: "skip"; noEncoder: boolean };

/** An AudioPlan that actually produces an output track (passthrough or encode) -
 *  i.e. AudioPlan minus the "skip" case. The pipelines store this after handling
 *  skip, so the per-segment feed dispatch narrows to passthrough vs encode
 *  without TS seeing the field-less skip variant. */
export type ActiveAudioPlan = Exclude<AudioPlan, { mode: "skip" }>;

/**
 * Decides the AudioPlan for a re-encode range from the probe of the first
 * audio-bearing segment. Shared by the single-channel and split-screen pipelines
 * so the passthrough-vs-encode-vs-drop decision lives in one place.
 *
 * `allowPassthrough` is the speed gate: stream-copy keeps the source packet
 * timestamps, so it is only valid at real time (1x). At a timelapse speed audio
 * is dropped upstream anyway, but the gate keeps this correct if that ever
 * changes. `firstHasDecoderConfig` (from probeAudioUniformity) reports whether the
 * first audio-bearing track actually carries a decoder config; a readable codec
 * without one cannot be stream-copied (the muxer throws on the first packet), so
 * passthrough drops it benignly. Caller still owns addAudioTrack() and the segment
 * feed loop.
 */
export async function resolveAudioPlan(
    probeFormat: AudioTrackFormat,
    firstFile: File,
    allowPassthrough: boolean,
    firstHasDecoderConfig: boolean,
): Promise<AudioPlan> {
    // Stream-copy when the source is already an MP4-muxable codec at 1x: no
    // encoder needed, no generation loss. The common dashcam case (AAC source).
    if (allowPassthrough && probeFormat.codec && PASSTHROUGH_AUDIO_CODECS.includes(probeFormat.codec)) {
        // Same guard exportClip applies (export.ts): a readable codec tag with no
        // decoder config (damaged esds on a power-cut/corrupt file) cannot mux a
        // valid track - the muxer throws on the first packet's absent config. Drop
        // audio benignly (skip, not noEncoder) instead of crashing the export after
        // the user already committed the save dialog.
        if (!firstHasDecoderConfig) return { mode: "skip", noEncoder: false };
        return {
            mode: "passthrough",
            codec: probeFormat.codec,
            source: new EncodedAudioPacketSource(probeFormat.codec),
        };
    }
    // IMA-ADPCM (Mio/Navman): mediabunny reports no codec. Decode it ourselves,
    // then re-encode - so this path needs an audio encoder.
    if (probeFormat.codec === null) {
        const adpcmReader = await openAdpcmAudioAuto(firstFile);
        if (!adpcmReader) return { mode: "skip", noEncoder: false }; // unreadable, not our ADPCM
        const codec = await resolveEncodeAudioCodec();
        if (!codec) return { mode: "skip", noEncoder: true };
        return {
            mode: "encode",
            codec,
            source: createEncodeAudioSource(codec),
            silenceFormat: { sampleRate: adpcmReader.sampleRate, numberOfChannels: adpcmReader.channels },
            adpcmReader,
        };
    }
    // Readable but not a passthrough codec (or passthrough disabled by speed):
    // decode + re-encode.
    const codec = await resolveEncodeAudioCodec();
    if (!codec) return { mode: "skip", noEncoder: true };
    return {
        mode: "encode",
        codec,
        source: createEncodeAudioSource(codec),
        silenceFormat: { sampleRate: probeFormat.sampleRate, numberOfChannels: probeFormat.numberOfChannels },
        adpcmReader: null,
    };
}

export interface AudioPlanSetup {
    /** Active plan (encode/passthrough), or null when audio was dropped or absent. */
    audioPlan: ActiveAudioPlan | null;
    /** Audio requested but segments mix formats - dropped, surfaced to the user. */
    audioDroppedHeterogeneous: boolean;
    /** Audio requested but no encoder and not stream-copyable - dropped, surfaced. */
    audioDroppedNoEncoder: boolean;
}

/**
 * Turns a probeAudioUniformity result into the audio decision shared by both
 * pipelines: heterogeneous audio is dropped, a uniform audio-bearing set gets a
 * resolved plan (passthrough/encode/skip) whose track is added to `out`. This is
 * the audio-orchestration block that was otherwise copy-pasted between the
 * single-channel and split pipelines. The probe itself stays in each caller
 * (single-channel reuses its firstInput; split opens Inputs lazily), which also
 * keeps this module free of a value import of probeAudioUniformity from export.js
 * - that would close an export -> pipeline -> pipeline-common cycle.
 *
 * @param allowPassthrough - true only at speed 1 (passthrough is real-time only).
 */
export async function applyAudioPlan(
    out: Output,
    probe: { uniform: boolean; format: AudioTrackFormat | null; firstHasDecoderConfig: boolean },
    firstFile: File,
    allowPassthrough: boolean,
): Promise<AudioPlanSetup> {
    const setup: AudioPlanSetup = {
        audioPlan: null,
        audioDroppedHeterogeneous: false,
        audioDroppedNoEncoder: false,
    };
    if (!probe.uniform) {
        setup.audioDroppedHeterogeneous = true;
        log.warn("mixed audio formats across segments, exporting without audio");
        return setup;
    }
    if (!probe.format) {
        log.info("audio requested but no audio track in any source segment, skipping");
        return setup;
    }
    const plan = await resolveAudioPlan(probe.format, firstFile, allowPassthrough, probe.firstHasDecoderConfig);
    if (plan.mode === "skip") {
        if (plan.noEncoder) {
            setup.audioDroppedNoEncoder = true;
            log.warn("no audio encoder available, exporting without audio");
        } else {
            log.info("audio codec unreadable and not ADPCM, skipping audio");
        }
        return setup;
    }
    setup.audioPlan = plan;
    out.addAudioTrack(plan.source);
    log.debug("audio plan", {
        mode: plan.mode,
        outputCodec: plan.codec,
        sourceCodec: probe.format.codec ?? "ima-adpcm",
    });
    return setup;
}

/**
 * Audio format used to fill gaps with silence. Mutable on purpose: it tracks the
 * first decoded sample's ACTUAL format (see feedSegmentAudio). The container
 * probe (probeAudioUniformity) can misreport it - HE-AAC/SBR decodes at a
 * different rate than its AudioSpecificConfig declares - so silence keyed off the
 * probe would mismatch the real samples and trip the source's input-constancy
 * guard. The pipelines init it from the probe (the best guess before any sample
 * is decoded) and pass the same object to every feedSegmentAudio call.
 */
export interface SilenceFormat {
    sampleRate: number;
    numberOfChannels: number;
}

/**
 * Feeds one segment's audio to the AAC source, mapping source-file time onto the
 * output timeline (samples land at segBaseOutSec + their offset from
 * startInFile). The source's `transform` resamples each native sample to 48k/2.
 * A segment with no audio track is filled with silence instead, to keep A/V in
 * sync - without it a later segment's audio would shift earlier in the output. A
 * WebCodecs decode error on a damaged tail ends this segment's audio gracefully
 * (onTruncated) rather than aborting the whole export, matching the video loops'
 * tolerant drive.
 *
 * silenceFormat is a SHARED MUTABLE holder (see SilenceFormat). On the first real
 * decoded sample this updates it to the sample's actual format, so silence for
 * later gaps matches the real samples - the source guard rejects a mid-track
 * input-format change, and silence is just another input fed before the
 * transform. (A leading audio-less segment, before any sample is decoded, still
 * uses the probe format; the only residual mismatch is HE-AAC source + a LEADING
 * gap, doubly rare and a loud failure, not silent corruption.)
 *
 * Caller owns `input` (open + dispose).
 */
export async function feedSegmentAudio(opts: {
    audioSource: AudioSampleSource;
    input: Input;
    startInFile: number;
    endInFile: number;
    segBaseOutSec: number;
    silenceFormat: SilenceFormat;
    signal: AbortSignal;
    fileName: string;
    onTruncated: () => void;
}): Promise<void> {
    const { audioSource, input, startInFile, endInFile, segBaseOutSec, silenceFormat, signal, fileName, onTruncated } =
        opts;
    const audioTrack = await input.getPrimaryAudioTrack();
    if (!audioTrack) {
        // Fill this segment's span with silence at the tracked source format so
        // the muxer sees a continuous audio timeline aligned with the video.
        await emitSilence(
            audioSource,
            segBaseOutSec,
            endInFile - startInFile,
            silenceFormat.sampleRate,
            silenceFormat.numberOfChannels,
            signal,
        );
        return;
    }
    const audioSink = new AudioSampleSink(audioTrack);
    const audioIter = audioSink.samples(startInFile, endInFile)[Symbol.asyncIterator]();
    for (;;) {
        const pull = await nextTolerant(audioIter);
        if (pull.done) {
            if (pull.truncated) {
                onTruncated();
                log.warn("audio decode stopped early on damaged source", { file: fileName });
                await audioIter.return?.();
            }
            break;
        }
        const aSample = pull.value;
        // try/finally: audioSource.add or the abort check can throw before
        // close(). The source reads the sample throughout its (awaited) add,
        // so closing only after it resolves is safe.
        try {
            if (signal.aborted) throw new DOMException("aborted", "AbortError");
            // Track the real decoded format so silence for later gaps matches it
            // (the container probe can misreport HE-AAC/SBR - see SilenceFormat).
            if (
                aSample.sampleRate !== silenceFormat.sampleRate ||
                aSample.numberOfChannels !== silenceFormat.numberOfChannels
            ) {
                silenceFormat.sampleRate = aSample.sampleRate;
                silenceFormat.numberOfChannels = aSample.numberOfChannels;
            }
            const shifted = segBaseOutSec + (aSample.timestamp - startInFile);
            // Drop samples that begin before the segment in-point; clamp the
            // boundary one to >= 0 so the muxer never sees a negative start.
            if (shifted < -1e-3) continue;
            aSample.setTimestamp(Math.max(0, shifted));
            await audioSource.add(aSample);
        } finally {
            aSample.close();
        }
    }
}

/**
 * IMA-ADPCM counterpart of feedSegmentAudio: feeds one segment's audio when the
 * source codec is the Mio/Navman ADPCM that mediabunny cannot read. `reader` is
 * this segment's decoder (the caller opens it - reusing the range's first reader
 * for segment 0, opening a fresh one per later file); null means the segment has
 * no ADPCM audio, so its span is filled with silence to keep A/V aligned.
 *
 * Decodes the file-time range [startInFile, endInFile) to PCM-s16 and feeds it to
 * the AAC source at segBaseOutSec on the output timeline; the source's transform
 * resamples 32 kHz -> 48 kHz before the AAC encode. Mirrors feedSegmentAudio's
 * silence/alignment contract so the two audio paths are interchangeable.
 */
export async function feedSegmentAudioAdpcm(opts: {
    audioSource: AudioSampleSource;
    reader: AdpcmAudioReader | null;
    startInFile: number;
    endInFile: number;
    segBaseOutSec: number;
    silenceFormat: SilenceFormat;
    signal: AbortSignal;
}): Promise<void> {
    const { audioSource, reader, startInFile, endInFile, segBaseOutSec, silenceFormat, signal } = opts;
    if (!reader) {
        await emitSilence(
            audioSource,
            segBaseOutSec,
            endInFile - startInFile,
            silenceFormat.sampleRate,
            silenceFormat.numberOfChannels,
            signal,
        );
        return;
    }
    await reader.feedRange(audioSource, startInFile, endInFile, segBaseOutSec, signal);
}

/**
 * Stream-copies one segment's encoded audio packets onto the output timeline -
 * the passthrough path (source codec already MP4-muxable: AAC/MP3, at 1x). No
 * decode/encode: the original packets are cloned with shifted timestamps, so the
 * export needs NO audio encoder at all. That is the whole point - it is what
 * makes audio survive on a codec-stripped Chromium that cannot encode AAC, and it
 * avoids the generation loss of decode->re-encode for every overlay/crop export.
 *
 * Timeline & monotonicity: this segment's audio anchors at
 * `base = max(segBaseOutSec, audioLastEndSec)`. segBaseOutSec (the same base this
 * segment's re-encoded video uses) re-syncs audio to the video each segment; the
 * max() floor keeps the track non-decreasing across segments - a previous segment
 * whose packets overran its video span would otherwise overlap and trip
 * mediabunny's non-decreasing-PTS check. The first packet is the one covering
 * startInFile (getPacket snaps to pts <= startInFile) and is emitted WHOLE at
 * `base` - encoded packets cannot be sub-trimmed, so the lead-in before startInFile
 * is NOT dropped: at a non-packet-aligned in-point audio can lead video by up to
 * one packet (~21ms @ 48kHz AAC). Direction of the forward-only floor: when a
 * segment's audio outruns its video span the lead carries forward and accumulates
 * (audio drifts ahead, never behind), at most ~1 packet per file boundary; when
 * audio is shorter the floor re-syncs down to the video base and leaves a gap.
 * Bounded and sub-100ms on typical short ranges; matters only on long multi-file
 * passthrough exports.
 *
 * A segment with no audio track leaves a gap (passthrough cannot synthesize
 * encoded silence); the next segment's base keeps later audio aligned. Returns
 * the updated audioLastEndSec and whether the decoder config was pushed - the
 * caller threads both across segments (config is pushed once, with the first
 * emitted packet of the whole track). Sibling of exportClip's stream-copy audio
 * loop in export.ts, which uses a measured-range accumulator instead (its video
 * is also stream-copied, so a different sync trade-off applies there).
 */
export async function feedSegmentAudioCopy(opts: {
    audioSource: EncodedAudioPacketSource;
    input: Input;
    startInFile: number;
    endInFile: number;
    segBaseOutSec: number;
    audioLastEndSec: number;
    pushDecoderConfig: boolean;
    signal: AbortSignal;
    onTruncated: () => void;
}): Promise<{ audioLastEndSec: number; configPushed: boolean }> {
    const { audioSource, input, startInFile, endInFile, segBaseOutSec, signal, onTruncated } = opts;
    const audioTrack = await input.getPrimaryAudioTrack();
    // No audio in this segment: leave a gap, keep the timeline where it was.
    if (!audioTrack) return { audioLastEndSec: opts.audioLastEndSec, configPushed: false };

    const decoderConfig = opts.pushDecoderConfig ? await audioTrack.getDecoderConfig() : null;
    const sink = new EncodedPacketSink(audioTrack);

    // getPacket(t) returns the packet with pts <= t (latest by presentation
    // time) - the one covering startInFile. nextTolerant-style: a decode error on
    // a damaged tail ends this segment's audio gracefully instead of aborting.
    let startPacket: EncodedPacket | null;
    try {
        startPacket = await sink.getPacket(startInFile);
    } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") throw err;
        onTruncated();
        return { audioLastEndSec: opts.audioLastEndSec, configPushed: false };
    }
    if (!startPacket) return { audioLastEndSec: opts.audioLastEndSec, configPushed: false };

    const base = Math.max(segBaseOutSec, opts.audioLastEndSec);
    const startShift = startPacket.timestamp;
    let lastEnd = opts.audioLastEndSec;
    let configPushed = false;
    let pkt: EncodedPacket | null = startPacket;
    while (pkt) {
        if (signal.aborted) throw new DOMException("aborted", "AbortError");
        if (pkt.timestamp >= endInFile) break;
        // clone carries data/type/duration/sideData; only the timestamp is
        // shifted onto the continuous output timeline. Clamp to >= 0 defensively
        // (base >= 0 and pkt.timestamp >= startShift, so this is belt-and-braces).
        const shifted = pkt.clone({ timestamp: Math.max(0, pkt.timestamp - startShift + base) });
        // Push the audio decoder config exactly once, with the first emitted
        // packet of the whole track (mediabunny populates the sample entry then).
        const meta =
            opts.pushDecoderConfig && !configPushed ? { decoderConfig: decoderConfig ?? undefined } : undefined;
        await audioSource.add(shifted, meta);
        if (opts.pushDecoderConfig && !configPushed) configPushed = true;
        lastEnd = base + (pkt.timestamp + pkt.duration - startShift);
        try {
            pkt = await sink.getNextPacket(pkt);
        } catch (err) {
            if (err instanceof DOMException && err.name === "AbortError") throw err;
            onTruncated();
            break;
        }
    }
    return { audioLastEndSec: lastEnd, configPushed };
}

/**
 * H.264 video source with the encoder config both pipelines must share - one
 * place so a tuning fix cannot land on one pipeline only. A CanvasSource bound
 * to the composition canvas: the encode loop calls `add(timestamp, duration)`
 * and mediabunny captures the canvas state at that call (no per-frame
 * VideoSample to allocate and close).
 */
export function createH264VideoSource(canvas: OffscreenCanvas, bitrate: number): CanvasSource {
    return new CanvasSource(canvas, {
        // mediabunny's universal H.264 type - it selects the avcC
        // profile/level automatically from the encoded stream.
        codec: "avc" satisfies VideoCodec,
        bitrate,
        // Batch export, not a live stream: VBR (the WebCodecs default) gives the
        // better quality-per-byte for dashcam content. Pin it EXPLICITLY so a
        // future "make export smaller" edit cannot silently switch to constant.
        bitrateMode: "variable",
        keyFrameInterval: 2,
        sizeChangeBehavior: "deny",
        // Batch export, not a live stream: keep the encoder in "quality" mode
        // (the mediabunny default) EXPLICITLY so a future "make export faster"
        // edit cannot silently flip it to "realtime" - which "may drop frames if
        // the encoder becomes overloaded" (WebCodecs), corrupting the output. The
        // throughput knob here is hardwareAcceleration below, not latencyMode.
        latencyMode: "quality",
        // "no-preference" (the WebCodecs default): the UA uses a hardware
        // encoder when one is available (VideoToolbox / QSV / NVENC / VAAPI,
        // ~3-5x faster than software at 1080p) and transparently falls back to
        // software otherwise - both at configure time and on a runtime error.
        // NOT "prefer-hardware": Chrome treats that as a hard requirement, so
        // mediabunny's single isConfigSupported() check throws on any browser
        // without a hardware H.264 encoder (headless Linux CI, software-only
        // desktops) instead of degrading. See media-source.js encoder init.
        hardwareAcceleration: "no-preference",
    });
}

/**
 * Awaits a map-snapshot promise and paints the bitmap. Owns the shared
 * failure policy both pipelines must agree on:
 *  - AbortError is rethrown (cancellation belongs to the caller);
 *  - any other failure returns true ("disable the map overlay for the rest of
 *    the run") - the overlay is opt-in cosmetic, losing a 4-minute export to
 *    a tile-server hiccup is a bad trade;
 *  - the bitmap is closed on every path (GPU memory).
 */
export async function consumeMapSnapshot(
    ctx: OffscreenCanvasRenderingContext2D,
    widthPx: number,
    heightPx: number,
    mapOpts: OverlayMapPipelineOpts,
    snapPromise: Promise<ImageBitmap>,
    framesDone: number,
): Promise<boolean> {
    let bitmap: ImageBitmap | null = null;
    try {
        bitmap = await snapPromise;
        drawMapOverlay(ctx, bitmap, widthPx, heightPx, mapOpts);
        return false;
    } catch (mapErr) {
        if (mapErr instanceof DOMException && mapErr.name === "AbortError") throw mapErr;
        log.warn("map overlay disabled after snapshot failure", { err: String(mapErr), framesDone });
        return true;
    } finally {
        if (bitmap) bitmap.close();
    }
}

/** Rounds to 2 decimals - for human-readable seconds in log lines. */
export function round2(n: number): number {
    return Math.round(n * 100) / 100;
}

/** Result of nextTolerant: a value, or a graceful end that may be a decode
 *  truncation (truncated=true) rather than a clean end-of-stream. */
export type TolerantNext<T> = { done: false; value: T } | { done: true; truncated: boolean };

/**
 * Pulls the next sample from a mediabunny VideoSampleSink / AudioSampleSink
 * iterator, tolerating a WebCodecs decode error on a damaged source tail.
 *
 * Why: a power-cut dashcam recording leaves the last file's final GOP
 * incomplete; mediabunny's WebCodecs decoder reaches it and fires its error
 * callback ("EncodingError: Decoding error"), which the iterator rethrows on
 * .next(). The native MSE player conceals this (it just stops near the end);
 * the export decoder does not. Aborting a multi-minute export over a couple of
 * unreadable frames at the very end is the wrong trade - so a non-abort error
 * resolves to { done: true, truncated: true } and the caller finalizes with the
 * frames decoded so far. AbortError still propagates (cancellation is the
 * caller's, not a source defect).
 */
export async function nextTolerant<T>(iterator: AsyncIterator<T>): Promise<TolerantNext<T>> {
    try {
        const r = await iterator.next();
        return r.done ? { done: true, truncated: false } : { done: false, value: r.value };
    } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") throw err;
        return { done: true, truncated: true };
    }
}

/** Cancels the muxer output, swallowing any error - used on abort/failure
 *  paths where the original error (or AbortError) is what we care about. */
export async function cancelOutputQuietly(out: Output): Promise<void> {
    try {
        await out.cancel();
    } catch {
        /* ignore */
    }
}

/**
 * Emits silence into audioSource - a sequence of zero-filled AudioSamples of
 * durationSec starting at offsetSec in the output timeline. Split into 100ms
 * chunks so encoder backpressure works and memory stays bounded. Both pipelines
 * call this for a segment whose source has no audio track, to keep A/V in sync.
 */
export async function emitSilence(
    audioSource: AudioSampleSource,
    offsetSec: number,
    durationSec: number,
    sampleRate: number,
    channels: number,
    signal: AbortSignal,
): Promise<void> {
    const chunkSec = 0.1;
    const framesPerChunk = Math.floor(sampleRate * chunkSec);
    if (framesPerChunk <= 0) return;
    let elapsed = 0;
    while (elapsed < durationSec) {
        if (signal.aborted) throw new DOMException("aborted", "AbortError");
        const remaining = durationSec - elapsed;
        const thisFrames = remaining < chunkSec ? Math.floor(sampleRate * remaining) : framesPerChunk;
        if (thisFrames <= 0) break;
        const data = new Float32Array(thisFrames * channels);
        const sample = new AudioSample({
            data: data.buffer,
            // Interleaved f32 (all zeros). sampleRate/channels match the real
            // source samples (caller passes the probed format), so the source's
            // input-constancy guard sees one uniform format across silence and
            // audio; the layout (f32 vs planar) is abstracted by the encoder.
            format: "f32",
            numberOfChannels: channels,
            sampleRate,
            timestamp: offsetSec + elapsed,
        });
        await audioSource.add(sample);
        sample.close();
        elapsed += thisFrames / sampleRate;
    }
}

/**
 * Builds the throttled "transcoding" progress callback shared by both
 * pipelines. The returned function reports at most once per 200 ms (unless
 * force=true) and computes ETA from the average frame time since creation, so
 * it must be created right before the encode loop starts (its internal clock
 * baseline is the moment of the call).
 */
export function createTranscodeProgressReporter(
    framesTotal: number,
    onProgress: (p: TranscodeProgress) => void,
): (framesDone: number, bytesWritten: number, force: boolean) => void {
    let lastProgressMs = 0;
    const startMs = performance.now();
    return (framesDone, bytesWritten, force) => {
        const now = performance.now();
        if (!force && now - lastProgressMs < 200) return;
        lastProgressMs = now;
        const elapsed = now - startMs;
        const eta = framesDone < 30 ? -1 : Math.round(((framesTotal - framesDone) * elapsed) / framesDone / 1000);
        onProgress({
            stage: "transcoding",
            stageProgress: framesDone / framesTotal,
            totalProgress: framesDone / framesTotal,
            framesDone,
            framesTotal,
            etaSec: eta,
            bytesWritten,
        });
    };
}

/**
 * Shared finalize epilogue for both pipelines: re-checks abort (cancelling the
 * output and throwing AbortError), emits the two "finalizing" progress ticks
 * around out.finalize(), and returns the TranscodeResult. Callers log their
 * own done-line (logger name and durationSec source differ) after this returns.
 */
export async function finalizeTranscodeOutput(opts: {
    out: Output;
    signal: AbortSignal;
    onProgress: (p: TranscodeProgress) => void;
    framesDone: number;
    framesTotal: number;
    bytesWritten: number;
    durationSec: number;
}): Promise<TranscodeResult> {
    const { out, signal, onProgress, framesDone, framesTotal, bytesWritten, durationSec } = opts;

    if (signal.aborted) {
        await cancelOutputQuietly(out);
        throw new DOMException("aborted", "AbortError");
    }

    onProgress({
        stage: "finalizing",
        stageProgress: 0,
        totalProgress: framesDone / framesTotal,
        framesDone,
        framesTotal,
        etaSec: 0,
        bytesWritten,
    });

    // Breadcrumbs around finalize: encoder flush + moov write + writable close
    // all happen inside out.finalize(). Pairing these two lines (with the
    // elapsed ms) lets a "stuck at Finalizing" report show whether finalize
    // even returned - i.e. moov+close completed - or hung. The actual close
    // watchdog lives in the writable wrapper (writable-finalize.ts).
    const finalizeStartMs = performance.now();
    log.debug("finalize start", { framesDone, bytesWritten });
    await out.finalize();
    log.info("finalize done", { framesDone, bytesWritten, ms: Math.round(performance.now() - finalizeStartMs) });

    onProgress({
        stage: "finalizing",
        stageProgress: 1,
        totalProgress: 1,
        framesDone,
        framesTotal,
        etaSec: 0,
        bytesWritten,
    });

    return { durationSec, sizeBytes: bytesWritten, framesEncoded: framesDone };
}

/**
 * Builds the mediabunny Output that streams the muxed MP4 into writable in
 * 4 MiB chunks, counting bytes as they go. onBytesWritten is called with each
 * chunk's size AFTER the write resolves; the caller keeps the running total so
 * its progress/return code can read a plain local.
 *
 * byteLength is captured BEFORE the await defensively: the worker-scope writable
 * posts each chunk over a MessagePort (port-writable.ts). We copy rather than
 * transfer the chunk buffer today (mediabunny's chunk-buffer ownership is
 * undocumented), so nothing is detached - but reading the size first keeps this
 * correct if a future zero-copy transfer path detaches data.buffer on write.
 */
export function createMp4StreamOutput(
    writable: FileSystemWritableFileStream,
    signal: AbortSignal,
    onBytesWritten: (sizeBytes: number) => void,
    // Optional moov capture (fires inside finalize, when the moov box is
    // written). The pipelines relay it in TranscodeResult so the GPMF
    // post-process can skip re-reading the finished file.
    onMoov?: (bytes: Uint8Array, position: number) => void,
): Output {
    const targetWritable = new WritableStream<{ type: "write"; position: number; data: Uint8Array }>({
        async write(chunk) {
            if (signal.aborted) throw new DOMException("aborted", "AbortError");
            const sizeBytes = chunk.data.byteLength;
            await writable.write({
                type: "write",
                position: chunk.position,
                data: chunk.data as Uint8Array<ArrayBuffer>,
            });
            onBytesWritten(sizeBytes);
        },
        async close() {
            await writable.close();
        },
        async abort(reason) {
            try {
                await writable.abort(reason);
            } catch {
                /* ignore */
            }
        },
    });

    return new Output({
        format: new Mp4OutputFormat({ fastStart: false, onMoov }),
        target: new StreamTarget(targetWritable, { chunked: true, chunkSize: 4 * 1024 * 1024 }),
    });
}
