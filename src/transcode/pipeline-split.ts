// Split-screen transcode pipeline. Architecturally separate from regular
// transcode() (see pipeline.ts) because split decodes N sources in parallel
// into the same frame - a different VideoSampleSink access pattern
// (getSample(t) for each slot per frame), more complex in terms of memory/IO,
// and requires its own validation.
//
// Per output tick (at output fps):
//  - for each slot: find the active segment by trip-time;
//  - if decoder is not open or is past the active segment: swap;
//  - getSample(localTime) for that tripTime, one composition via drawSplitScreen.

import { BlobSource, Input, type VideoSample, VideoSampleSink } from "mediabunny";

import { probeAudioUniformity } from "../export.js";
import { rangeSourceFps, sliceCandidatesForRange, type FileSegment } from "../export-range.js";
import { resolveRegionBlursAt, type BlurRegion } from "../blur-regions.js";
import { openAdpcmAudioAuto } from "./adpcm-audio.js";
import { createLogger } from "../log.js";
import type { Channel } from "../parsers/types.js";
import { tripCandidatesByChannel, contentToWallUtc } from "../trips.js";
import type { Trip } from "../trips.js";
import { VIDEO_INPUT_FORMATS } from "../video-formats.js";

import {
    computeEffectiveAspect,
    computeOutputSize,
    createBlurHelper,
    createRegionBlurHelper,
    drawSplitScreen,
    getSplitSlotCount,
    getSplitSlots,
} from "./compose.js";
import type { BlurHelper, CropRect, RegionBlurHelper, SplitLayout } from "./compose.js";
import {
    clampSpeedFactor,
    framesForSpeed,
    resolveBitrate,
    type AspectId,
    type CapturedMoovBytes,
    type TranscodeProgress,
    type TranscodeResult,
    type WatermarkAnchor,
} from "./types.js";
import { drawWatermark, ensureWatermarkFontReady } from "./watermark.js";
import { hasAnyOverlay, isFinitePosition } from "./overlay-pipeline-helpers.js";
import { ensureOverlayFontsReady } from "./overlay-styles.js";
import { interpScalar, recordsHaveAccel, resolveFramePos } from "./frame-pos.js";
import {
    achievedKbps,
    resolveOutputFps,
    type ActiveAudioPlan,
    applyAudioPlan,
    cancelOutputQuietly,
    consumeMapSnapshot,
    createH264VideoSource,
    createMp4StreamOutput,
    createTranscodeProgressReporter,
    emitSilence,
    feedSegmentAudio,
    feedSegmentAudioAdpcm,
    feedSegmentAudioCopy,
    finalizeTranscodeOutput,
    joinAllOrThrowFirst,
    nextTolerant,
    round2,
} from "./pipeline-common.js";
import { drawTelemetryOverlays } from "./telemetry-overlays.js";
import { createVideoSourceResolver } from "./normalize-degenerate-video.js";
import { interpolatePosition } from "../parser.js";
import type { OverlayPipelineArgs } from "./types.js";

const log = createLogger("transcode:split");

interface TranscodeSplitSource {
    trip: Trip;
    /** Channels per slot, in getSplitSlots layout order. length must equal slotCount(layout). */
    slotChannels: Channel[];
    /** Range in trip-local seconds. All slots share the same range. */
    startTripSec: number;
    endTripSec: number;
}

interface TranscodeSplitOutput {
    height: number;
    aspect: AspectId;
    layout: SplitLayout;
    bitrate: number | null;
    watermarkAnchor: WatermarkAnchor | null;
    /** Audio from slot 0 (master). */
    withAudio: boolean;
    /**
     * Custom crop per slot. length must match the layout's slot count.
     * null in slotCrops[i] means "use the full frame" - drawSplitScreen fits
     * it into the slot with keep-aspect-fit (letterbox/pillarbox when slot and
     * source have different aspect ratios).
     */
    slotCrops?: (CropRect | null)[];
    /**
     * Custom PiP overlay positions in output coords (0..1, top-left corner).
     * Applied only in pip-layouts (pip2/pip3/pip4) and only for overlay slots
     * (slotIdx >= 1). null = default (bottom-right stack).
     */
    overlayPositions?: ({ xPct: number; yPct: number } | null)[];
    /** Per-slot user-controlled scale for PiP overlays (slotIdx >= 1 in pip-*).
     *  Default 1.0 - the default size from compose constants. */
    slotPipScales?: (number | null | undefined)[];
    /** Fill for letterbox inside slots and composition background. Default "black". */
    letterboxFill: import("./types.js").LetterboxFill;
    /** GPS-derived overlays painted on every frame. null = no overlays. */
    overlays: OverlayPipelineArgs | null;
    /** Timelapse speed-up factor (see TranscodeOutput.speedFactor). 1 = real time. */
    speedFactor: number;
    /** Privacy blur regions for the active trip (see TranscodeOutput.blurRegions).
     *  Resolved per tick and routed to slots by each slot's channel. */
    blurRegions: BlurRegion[] | null;
}

export interface TranscodeSplitArgs {
    source: TranscodeSplitSource;
    output: TranscodeSplitOutput;
    writable: FileSystemWritableFileStream;
    signal: AbortSignal;
    onProgress: (p: TranscodeProgress) => void;
    /** Same contract as TranscodeArgs.mapSnapshotter - see that doc. */
    mapSnapshotter?: import("./map-snapshotter-types.js").MapSnapshotter;
}

export async function transcodeSplit(args: TranscodeSplitArgs): Promise<TranscodeResult> {
    const { source, output, writable, signal, onProgress, mapSnapshotter } = args;
    if (signal.aborted) throw new DOMException("aborted", "AbortError");

    const expectedSlotCount = getSplitSlotCount(output.layout);
    if (source.slotChannels.length !== expectedSlotCount) {
        throw new Error(
            `transcodeSplit: layout ${output.layout} expects ${expectedSlotCount} channels, got ${source.slotChannels.length}`,
        );
    }

    const startMs = performance.now();
    const dims = computeOutputSize(output.height, output.aspect);
    const widthPx = dims.width;
    const heightPx = dims.height;
    const bitrate = output.bitrate ?? resolveBitrate(widthPx, heightPx);

    const anyOverlay = !!output.overlays && hasAnyOverlay(output.overlays);
    // Register overlay fonts in the overlay locale's subset before the first
    // rasterization - see pipeline.ts for the rationale.
    if (anyOverlay) await ensureOverlayFontsReady(output.overlays?.localeScript ?? "latin");
    if (output.watermarkAnchor) await ensureWatermarkFontReady();

    // Build per-slot segment lists for the trip range.
    const slotSegments: FileSegment[][] = source.slotChannels.map((ch) => {
        const cands = tripCandidatesByChannel(source.trip, ch);
        // Range is footage-axis (content) seconds; the timeline places files on it.
        return sliceCandidatesForRange(cands, source.trip.timeline, source.startTripSec, source.endTripSec);
    });

    // Turns a degenerate-packet MKV slot source into a clean stream-copy MP4 for
    // the video decode path (identity for every other container). Audio is read
    // from the original file separately below, so only the slot VIDEO input is
    // redirected. Shared across slots; memoizes per File.
    const videoResolver = createVideoSourceResolver();

    // Master segments for audio and timing - slot 0 (user-selected primary).
    // If the master channel has no files in the range, throw.
    const masterSegments = slotSegments[0]!;
    if (masterSegments.length === 0) {
        throw new Error("transcodeSplit: master slot has no candidates intersecting range");
    }

    // Preflight: compute source aspect per slot via a minimal Input on the first
    // segment. Opened without decoding - cheap, ~10 ms per file. Needed for
    // dynamic-aspect PiP overlays and the precomputed splitSlots array (fixed
    // geometry for the entire clip - channel aspect is constant within a trip).
    const slotSourceAspects = await Promise.all(
        slotSegments.map(async (segs, slotIdx) => {
            const first = segs[0];
            if (!first) return widthPx / heightPx;
            const input = new Input({ source: new BlobSource(first.file), formats: VIDEO_INPUT_FORMATS });
            try {
                const vt = await input.getPrimaryVideoTrack();
                if (!vt) return widthPx / heightPx;
                const w = await vt.getDisplayWidth();
                const h = await vt.getDisplayHeight();
                return h > 0 ? w / h : widthPx / heightPx;
            } catch (err) {
                // Probe failed (unreadable/corrupt slot file): fall back to output
                // aspect. Breadcrumb so a "slot N is wrongly letterboxed" report has
                // a trace - this is the only place the file is opened pre-loop.
                log.debug("split slot aspect probe failed", { slot: slotIdx, file: first.file.name, err: String(err) });
                return widthPx / heightPx;
            } finally {
                input.dispose();
            }
        }),
    );
    // Effective aspect per slot - accounting for per-slot crop (aspect of the
    // cropped area), used to compute PiP overlay dimensions.
    const slotEffectiveAspects = slotSourceAspects.map((sa, i) =>
        computeEffectiveAspect(sa, output.slotCrops?.[i] ?? null),
    );
    const splitSlots = getSplitSlots(output.layout, {
        outputAspect: widthPx / heightPx,
        slotEffectiveAspects,
        overlayPositions: output.overlayPositions,
        slotPipScales: output.slotPipScales,
    });

    // Timelapse speed-up: fewer output ticks, each advancing the source clock by
    // speedFactor frames (see the main loop). Audio is dropped upstream at N > 1.
    const speedFactor = clampSpeedFactor(output.speedFactor);

    // Split renders onto ONE fixed grid (N slots with independent source clocks
    // have to be sampled onto a common one), so this rate is the output's real
    // frame rate - not just a metadata hint. Take the busiest slot's: sampling a
    // 60 fps camera onto a 30 fps grid would throw away half its motion.
    const outputFps = resolveOutputFps(
        slotSegments.reduce<number | null>((best, segs) => {
            const fps = rangeSourceFps(segs);
            return fps !== null && (best === null || fps > best) ? fps : best;
        }, null),
    );
    const totalOutputSec = source.endTripSec - source.startTripSec;
    const framesTotal = framesForSpeed(totalOutputSec, outputFps, speedFactor);

    log.info("split transcode started", {
        layout: output.layout,
        slots: source.slotChannels,
        outputW: widthPx,
        outputH: heightPx,
        aspect: output.aspect,
        bitrateKbps: Math.round(bitrate / 1000),
        fps: outputFps,
        speedFactor,
        watermarkAnchor: output.watermarkAnchor,
        masterSegmentsCount: masterSegments.length,
        totalOutputSec: round2(totalOutputSec),
        framesTotal,
    });

    let totalBytesWritten = 0;
    let capturedMoov: CapturedMoovBytes | undefined;
    const out = createMp4StreamOutput(
        writable,
        signal,
        (sizeBytes) => {
            totalBytesWritten += sizeBytes;
        },
        (bytes, position) => {
            // Copy: mediabunny may reuse the buffer after the callback.
            capturedMoov = { position, bytes: bytes.slice() };
        },
    );

    // Composition canvas: created up front because the video source is now a
    // CanvasSource bound to it (mediabunny captures the canvas on each add()).
    const canvas = new OffscreenCanvas(widthPx, heightPx);
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("OffscreenCanvas 2d context unavailable");
    // Each slot is downscaled into a tile of the grid; the canvas default
    // imageSmoothingQuality "low" softens that downscale. Match pipeline.ts.
    ctx.imageSmoothingQuality = "high";

    // Encoder + AAC target shared with pipeline.ts via pipeline-common - one
    // place so a tuning fix cannot land on one pipeline only.
    const videoSource = createH264VideoSource(canvas, bitrate);
    out.addVideoTrack(videoSource, { frameRate: outputFps });

    // Audio plan from the master channel: passthrough (stream-copy AAC/MP3, no
    // encoder), encode (AAC, or Opus when AAC encode is unavailable), or skip.
    // See resolveAudioPlan.
    let audioPlan: ActiveAudioPlan | null = null;
    // True when audio was requested but the master channel mixes audio formats;
    // surfaced to the user (export.notify.audioFormatMixed) and in the result.
    let audioDroppedHeterogeneous = false;
    // True when audio was requested but no encoder exists and the source could not
    // be stream-copied (ADPCM / exotic codec on a no-encoder browser). Drop+notify.
    let audioDroppedNoEncoder = false;
    if (output.withAudio) {
        // Heterogeneous master audio (e.g. an original clip spliced with a
        // re-export) cannot share one track - drop audio rather than crash the
        // muxer mid-stream. `format` is the first audio-bearing master segment's
        // format.
        // Deliberate: the master's first file is opened 3x on this path (aspect
        // preflight, this probe, then lazily in the slot runtime), each re-reading
        // its moov. The single-channel pipeline shares one firstInput
        // (probeAudioUniformity's reuseFirstInput); split's slot runtime owns
        // Inputs dynamically (lazy open on segment swap in ensureSlotForTripTime),
        // so threading a shared Input through it buys little here - split implies
        // multi-channel cameras with short per-file segments and small moovs, not
        // the one-big-file case that reuse targets.
        const probe = await probeAudioUniformity(masterSegments.map((s) => s.file));
        const audio = await applyAudioPlan(out, probe, masterSegments[0]!.file, speedFactor === 1);
        audioPlan = audio.audioPlan;
        audioDroppedHeterogeneous = audio.audioDroppedHeterogeneous;
        audioDroppedNoEncoder = audio.audioDroppedNoEncoder;
    }

    // Blur helper is created only when the background fill is "blur". Passed to
    // drawSplitScreen for per-slot blur backdrop (each slot gets its own blur
    // from its own channel, not a shared one).
    const blurHelper: BlurHelper | null = output.letterboxFill === "blur" ? createBlurHelper() : null;
    // Privacy-region scratch canvas, allocated once per run (see compose.ts).
    const regionBlurHelper: RegionBlurHelper | null = output.blurRegions?.length ? createRegionBlurHelper() : null;
    const renderOpts = { fill: output.letterboxFill, blurHelper, regionBlurHelper };

    // Wall-clock range bounds: graph progress + distance base, mirroring
    // pipeline.ts (the graph is sampled on the wall axis, so the marker tracks
    // wall progress; the distance widget subtracts the cumulative at range start).
    let rangeStartUtc = 0;
    let rangeEndUtc = 0;
    let distanceBaseM = 0;
    if (anyOverlay && output.overlays) {
        rangeStartUtc = contentToWallUtc(source.trip.timeline, source.startTripSec);
        rangeEndUtc = contentToWallUtc(source.trip.timeline, source.endTripSec);
        if (output.overlays.cumulativeDistanceM) {
            distanceBaseM = interpScalar(
                output.overlays.gpsRecords,
                output.overlays.cumulativeDistanceM,
                rangeStartUtc,
            );
        }
        log.debug("overlays enabled", {
            style: output.overlays.style,
            gSource: recordsHaveAccel(output.overlays.gpsRecords) ? "recorded" : "derived",
        });
    }

    onProgress({
        stage: "preparing",
        stageProgress: 1,
        totalProgress: 0,
        framesDone: 0,
        framesTotal,
        etaSec: -1,
        bytesWritten: 0,
    });
    await out.start();

    // Slot runtime: pipelined decoder via iter `sink.samples(start, end)` -
    // mediabunny pipelines decode with the consumer, decoding each source packet
    // exactly once (vs per-frame getSample(t) which did a discrete seek+decode
    // for EVERY frame for every slot - in 4x split at 30fps that caused ~5-10x
    // slowdown).
    //
    // Drift protection: current/next samples are tracked explicitly in SlotRuntime.
    // Per output frame we advance the iter just enough for next.timestamp to pass
    // the current outTs. current = last sample ≤ outTs - valid for composition
    // (temporally close). This is stable against source fps != output fps and
    // rare null-sample edge cases.
    interface SlotRuntime {
        currentSegmentIdx: number;
        // The active segment's start in trip-local seconds (seg.tripStart).
        // localTime in the source file = tripTimeSec - segTripStart. Absolute,
        // not a back-to-back duration sum, so a mid-range gap in this slot does
        // not shift later footage forward.
        segTripStart: number;
        input: Input | null;
        sink: VideoSampleSink | null;
        iter: AsyncIterator<VideoSample> | null;
        iterDone: boolean;
        // True when this slot's iter ended via a decode error on a damaged tail
        // (vs a clean end-of-stream). The master slot failing this way ends the
        // main loop; a non-master slot just freezes on rt.current.
        decodeFailed: boolean;
        // current = last decoded sample with timestamp ≤ current request.
        // May be reused across several output frames when source fps > output fps.
        // Not closed on composite - closed on segment swap.
        current: VideoSample | null;
        // next = pre-fetched look-ahead sample. When its timestamp passes the
        // current outTs: move current ← next and pre-fetch the next one.
        next: VideoSample | null;
    }
    const slotRuntimes: SlotRuntime[] = source.slotChannels.map(() => ({
        currentSegmentIdx: -1,
        segTripStart: 0,
        input: null,
        sink: null,
        iter: null,
        iterDone: false,
        decodeFailed: false,
        current: null,
        next: null,
    }));

    const disposeSlot = (rt: SlotRuntime): void => {
        if (rt.current) {
            try {
                rt.current.close();
            } catch {
                /* ignore */
            }
            rt.current = null;
        }
        if (rt.next) {
            try {
                rt.next.close();
            } catch {
                /* ignore */
            }
            rt.next = null;
        }
        if (rt.input) {
            try {
                rt.input.dispose();
            } catch {
                /* ignore */
            }
            rt.input = null;
        }
        rt.sink = null;
        rt.iter = null;
        rt.iterDone = false;
        rt.decodeFailed = false;
    };
    const disposeAllSlots = (): void => {
        for (const rt of slotRuntimes) disposeSlot(rt);
    };

    // mediabunny is already pipelined internally (see pipeline.ts) - rely on
    // its videoSource.add() backpressure directly.

    let framesDone = 0;
    // See pipeline.ts: latch after first map-snapshot failure so we keep the
    // export running with text overlays + video instead of aborting wholesale.
    let mapOverlayFailed = false;
    // Latched when any slot (or master audio) stops early on a damaged tail.
    // The clip still finalizes; the caller turns this into a soft notice.
    let decodeTruncated = false;

    const reportProgress = createTranscodeProgressReporter(framesTotal, onProgress);

    const frameDur = 1 / outputFps;

    /**
     * Prepares the slot for reading samples around tripTimeSec: on a segment
     * change closes the old Input/iter and opens a new one, pre-fetching the
     * first sample. After swap rt.iter is active and rt.next holds the lookahead.
     */
    const ensureSlotForTripTime = async (slotIdx: number, tripTimeSec: number): Promise<void> => {
        const segs = slotSegments[slotIdx]!;
        const rt = slotRuntimes[slotIdx]!;

        // Find the segment whose ABSOLUTE trip-time window contains tripTimeSec.
        // A segment covers [seg.tripStart + seg.startInFile, seg.tripStart +
        // seg.endInFile). Anchoring on seg.tripStart (not a back-to-back duration
        // sum) keeps this slot aligned to the master clock even when it is
        // missing a file mid-range - in that gap no segment matches and we keep
        // the last valid frame instead of pulling later footage forward.
        let activeIdx = -1;
        for (let i = 0; i < segs.length; i++) {
            const seg = segs[i]!;
            const segTripStart = seg.tripStart + seg.startInFile;
            const segTripEnd = seg.tripStart + seg.endInFile;
            if (tripTimeSec >= segTripStart - 1e-6 && tripTimeSec < segTripEnd + 1e-6) {
                activeIdx = i;
                break;
            }
            if (tripTimeSec < segTripStart) break; // before this seg, no earlier match -> in a gap
        }

        if (activeIdx < 0) {
            // tripTime is in a gap or past all slot segments - leave rt as-is
            // (current/next are kept for composite if still valid).
            return;
        }

        if (activeIdx === rt.currentSegmentIdx) return;

        // Swap segment.
        disposeSlot(rt);
        const seg = segs[activeIdx]!;
        // Video source: a clean stream-copy MP4 for a degenerate-packet MKV, else
        // seg.file unchanged. This slot input feeds only the video decode; the
        // audio loop below reads the original seg.file through its own Input.
        const videoFile = await videoResolver.resolve(seg.file);
        const input = new Input({ source: new BlobSource(videoFile), formats: VIDEO_INPUT_FORMATS });
        let videoTrack: Awaited<ReturnType<typeof input.getPrimaryVideoTrack>>;
        try {
            videoTrack = await input.getPrimaryVideoTrack();
        } catch (err) {
            // Probe threw (corrupt segment file): `input` is not yet stored in
            // rt.input, so disposeAllSlots in the outer catch cannot reach it -
            // dispose here before rethrowing, like the no-track branch below.
            input.dispose();
            throw err;
        }
        if (!videoTrack) {
            input.dispose();
            log.warn("split slot segment has no video track", { slot: slotIdx, file: seg.file.name });
            rt.currentSegmentIdx = activeIdx;
            rt.segTripStart = seg.tripStart;
            rt.iterDone = true;
            return;
        }
        rt.input = input;
        rt.sink = new VideoSampleSink(videoTrack);
        // Async iterator from mediabunny - pipelines decode in parallel with the consumer.
        rt.iter = rt.sink.samples(seg.startInFile, seg.endInFile)[Symbol.asyncIterator]();
        rt.iterDone = false;
        rt.currentSegmentIdx = activeIdx;
        rt.segTripStart = seg.tripStart;
        // Pre-fetch the first sample into rt.next.
        await advanceSlotIter(slotIdx);
    };

    /** Advances the slot iter by 1 sample. Puts the result in rt.next, or sets
     *  iterDone. A decode error on a damaged tail (nextTolerant) ends the iter
     *  with decodeFailed=true and keeps rt.current as the last good frame. */
    const advanceSlotIter = async (slotIdx: number): Promise<void> => {
        const rt = slotRuntimes[slotIdx]!;
        if (!rt.iter || rt.iterDone) return;
        const pull = await nextTolerant(rt.iter);
        if (pull.done) {
            rt.iterDone = true;
            rt.next = null;
            if (pull.truncated) {
                rt.decodeFailed = true;
                decodeTruncated = true;
                log.warn("split slot decode stopped early on damaged source", { slot: slotIdx, framesDone });
            }
            return;
        }
        rt.next = pull.value;
    };

    /**
     * Returns (borrowed) slot sample for the current outputTs. The iter advances
     * while next.timestamp ≤ localTime - the last "passed" sample becomes current
     * and is used for composition. Caller must NOT close it - the sample may be
     * reused by the next frame if source fps > output fps. Closed on segment swap
     * or disposeAll.
     */
    const getSlotSampleForFrame = async (slotIdx: number, tripTimeSec: number): Promise<VideoSample | null> => {
        await ensureSlotForTripTime(slotIdx, tripTimeSec);
        const rt = slotRuntimes[slotIdx]!;
        if (!rt.sink) return rt.current;
        // localTime is source-file time; the active segment's samples are read in
        // [startInFile, endInFile). tripTimeSec - segTripStart maps absolute
        // trip-time back to file-time (== startInFile at the segment's start).
        const localTime = tripTimeSec - rt.segTripStart;
        // Advance next → current until next passes localTime. One advance =
        // one decoded source packet from the iter (pipelined).
        while (rt.next && rt.next.timestamp <= localTime + 1e-6) {
            if (rt.current) {
                try {
                    rt.current.close();
                } catch {
                    /* ignore */
                }
            }
            rt.current = rt.next;
            rt.next = null;
            await advanceSlotIter(slotIdx);
        }
        return rt.current;
    };

    try {
        // Main loop over output frames: fixed fps, each tick fetches a sample
        // from every slot in parallel via Promise.all - independent decoders +
        // one composition canvas. Watch the WebCodecs decoder limit (~10-16):
        // at split-4, the concurrent audio pass and the encoder the peak is 7
        // resources simultaneously, which is safe. Add throttling if expanding
        // further.
        // Each output tick advances the source clock by speedFactor frames, so
        // the same trip range is covered in framesTotal/speedFactor ticks. outTs
        // is the (compressed) muxer timestamp; tripTimeSec is the real source
        // time used to fetch slot samples and interpolate GPS overlays.
        const srcStep = frameDur * speedFactor;
        const runVideoTicks = async (): Promise<void> => {
            for (let f = 0; f < framesTotal; f++) {
                if (signal.aborted) throw new DOMException("aborted", "AbortError");
                const outTs = f * frameDur;
                const tripTimeSec = source.startTripSec + f * srcStep;

                // GPS interpolation and the map snapshot request both depend
                // only on (lat, lon, bearing, zoom) - not on decoded pixels.
                // Compute them BEFORE the Promise.all wait so the snapshot
                // round-trip (5-30 ms to main thread and back) overlaps slot
                // decode instead of sitting in series after it. Without this
                // overlap, split-4 + map exports run ~2-3x slower because the
                // hot loop pays full snapshot latency per frame on top of
                // decode and composite.
                const overlays = output.overlays;
                const overlayMapOpts = overlays?.map ?? null;
                let pos: ReturnType<typeof interpolatePosition> = null;
                // tripTimeSec is an absolute footage-axis position; map it to
                // wall-clock UTC (skipping pauses) once per frame, reused for GPS
                // interpolation and resolveFramePos below.
                const frameUtc = overlays ? contentToWallUtc(source.trip.timeline, tripTimeSec) : 0;
                if (overlays && hasAnyOverlay(overlays)) {
                    const interp = interpolatePosition(overlays.gpsRecords, frameUtc);
                    if (interp && isFinitePosition(interp)) pos = interp;
                }
                let snapPromise: Promise<ImageBitmap> | null = null;
                if (pos && overlayMapOpts && mapSnapshotter && !mapOverlayFailed) {
                    snapPromise = mapSnapshotter.snapshot({
                        lat: pos.lat,
                        lon: pos.lon,
                        bearingDeg: pos.bearingDeg,
                        zoomKm: overlayMapOpts.zoomKm,
                        speedMs: pos.speedMs,
                    });
                    // Attach a noop drain so a rejection that lands BEFORE we
                    // reach `await snapPromise` (e.g. Promise.all below throws
                    // first) does not surface as "unhandled promise rejection".
                    // The real rejection is still observed by the await in the
                    // consumer block - .catch() returns a new promise, it does
                    // not swallow the original one.
                    snapPromise.catch(() => {});
                }

                let samples: (VideoSample | null)[];
                try {
                    samples = await Promise.all(
                        source.slotChannels.map((_, slotIdx) => getSlotSampleForFrame(slotIdx, tripTimeSec)),
                    );
                } catch (err) {
                    // Slot decode / abort threw before the snapshot was consumed.
                    // Free the in-flight bitmap (consumeMapSnapshot is below and now
                    // unreachable) so a cancelled split+map export does not strand a
                    // GPU surface per outstanding frame.
                    if (snapPromise)
                        snapPromise.then(
                            (b) => b.close(),
                            () => {},
                        );
                    throw err;
                }

                // Master (slot 0) decode died on a damaged tail: it can no longer
                // supply frames, so end the clip here instead of padding the
                // remaining ticks with its last frozen frame. A non-master slot that
                // died just keeps showing rt.current until this point. decodeTruncated
                // was already latched in advanceSlotIter.
                if (slotRuntimes[0]!.decodeFailed) {
                    // Same as the catch above: the snapshot for this frame is never
                    // consumed past the break, so release it.
                    if (snapPromise)
                        snapPromise.then(
                            (b) => b.close(),
                            () => {},
                        );
                    log.warn("split master slot exhausted by decode failure, finalizing early", { framesDone });
                    break;
                }

                // Compose split-screen directly into the final output canvas.
                // Blur rects resolve at the content time of the frame each slot
                // ACTUALLY shows - a slot in a gap (or after a decode failure)
                // keeps displaying an earlier frozen frame, and resolving at the
                // tick time would leave a frozen plate uncovered whenever the
                // region span does not include the gap.
                const slotRegionBlurs = output.blurRegions?.length
                    ? source.slotChannels.map((ch, slotIdx) => {
                          const rt = slotRuntimes[slotIdx]!;
                          const shownSec = rt.current ? rt.segTripStart + rt.current.timestamp : tripTimeSec;
                          return resolveRegionBlursAt(output.blurRegions ?? [], ch, shownSec);
                      })
                    : undefined;
                drawSplitScreen(
                    ctx,
                    samples,
                    splitSlots,
                    widthPx,
                    heightPx,
                    output.slotCrops,
                    renderOpts,
                    slotRegionBlurs,
                );
                if (pos && overlays) {
                    const span = rangeEndUtc - rangeStartUtc;
                    const progress = span > 0 ? (frameUtc - rangeStartUtc) / span : 0;
                    const framePos = resolveFramePos({
                        records: overlays.gpsRecords,
                        base: pos,
                        cumulative: overlays.cumulativeDistanceM,
                        distanceBaseM,
                        frameUtc,
                        progress,
                    });
                    drawTelemetryOverlays(ctx, widthPx, heightPx, overlays, framePos);
                    if (snapPromise && overlayMapOpts) {
                        // Failure policy (disable-for-the-run latch, AbortError
                        // rethrow, bitmap close) lives in the shared
                        // consumeMapSnapshot.
                        mapOverlayFailed = await consumeMapSnapshot(
                            ctx,
                            widthPx,
                            heightPx,
                            overlayMapOpts,
                            snapPromise,
                            framesDone,
                        );
                    }
                }
                // Watermark last - on top of scrim + telemetry.
                if (output.watermarkAnchor) {
                    drawWatermark(ctx, widthPx, heightPx, output.watermarkAnchor);
                }

                // CanvasSource captures the canvas synchronously here. The per-slot
                // source samples are borrowed from rt.current (closed on the next iter
                // advance or in the slots' finally), so there is nothing to close here.
                await videoSource.add(outTs, frameDur);
                framesDone++;
                reportProgress(framesDone, totalBytesWritten, false);
            }
        };

        // Audio from master segments. Each segment's audio anchors at its
        // ABSOLUTE content-axis position relative to the range start - the same
        // anchoring the video ticks use (seg.tripStart). A back-to-back
        // accumulator would desync A/V by the gap length whenever the master
        // channel is missing a file mid-range (TripFrame.channels is Partial, so
        // that input is structurally possible): every post-gap audio sample
        // would play earlier than its video.
        const runAudio = async (): Promise<void> => {
            if (audioPlan && output.withAudio) {
                if (audioPlan.mode === "passthrough") {
                    // Stream-copy master AAC/MP3 packets - no encoder, no silence
                    // synthesis. A master-channel gap is just an audio hole; the
                    // absolute segBaseOutSec keeps later audio aligned and
                    // feedSegmentAudioCopy's max(segBaseOutSec, audioLastEndSec) base
                    // keeps the track monotonic.
                    let audioCopyLastEndSec = 0;
                    let audioConfigPushed = false;
                    for (const seg of masterSegments) {
                        if (signal.aborted) throw new DOMException("aborted", "AbortError");
                        const segBaseOutSec = Math.max(0, seg.tripStart + seg.startInFile - source.startTripSec);
                        const input = new Input({ source: new BlobSource(seg.file), formats: VIDEO_INPUT_FORMATS });
                        try {
                            const res = await feedSegmentAudioCopy({
                                audioSource: audioPlan.source,
                                input,
                                startInFile: seg.startInFile,
                                endInFile: seg.endInFile,
                                segBaseOutSec,
                                audioLastEndSec: audioCopyLastEndSec,
                                pushDecoderConfig: !audioConfigPushed,
                                signal,
                                onTruncated: () => {
                                    decodeTruncated = true;
                                },
                            });
                            audioCopyLastEndSec = res.audioLastEndSec;
                            if (res.configPushed) audioConfigPushed = true;
                        } finally {
                            input.dispose();
                        }
                    }
                } else {
                    // Encode path: re-encode master audio, filling master-channel gaps
                    // AND audio-less segments with silence so the muxer sees a
                    // continuous timeline aligned with the composited video.
                    const silenceFormat = audioPlan.silenceFormat;
                    let nextExpectedOutSec = 0;
                    for (const [segIdx, seg] of masterSegments.entries()) {
                        if (signal.aborted) throw new DOMException("aborted", "AbortError");
                        const segDur = seg.endInFile - seg.startInFile;
                        const segBaseOutSec = Math.max(0, seg.tripStart + seg.startInFile - source.startTripSec);
                        if (segBaseOutSec > nextExpectedOutSec + 1e-3) {
                            // Master-channel gap: cover it with silence so the muxer
                            // sees a continuous audio timeline and later segments stay
                            // aligned with their video. Silence at the tracked source
                            // format, not 48k/2: it is fed before the source's transform
                            // like a real sample, and the input-constancy guard rejects
                            // a format change.
                            await emitSilence(
                                audioPlan.source,
                                nextExpectedOutSec,
                                segBaseOutSec - nextExpectedOutSec,
                                silenceFormat.sampleRate,
                                silenceFormat.numberOfChannels,
                                signal,
                            );
                        }
                        if (audioPlan.adpcmReader) {
                            // ADPCM master: decode this segment ourselves (mediabunny
                            // can't). Reuse the first reader for segment 0; open a fresh
                            // one per later file. No mediabunny Input needed.
                            const reader = segIdx === 0 ? audioPlan.adpcmReader : await openAdpcmAudioAuto(seg.file);
                            await feedSegmentAudioAdpcm({
                                audioSource: audioPlan.source,
                                reader,
                                startInFile: seg.startInFile,
                                endInFile: seg.endInFile,
                                segBaseOutSec,
                                silenceFormat,
                                signal,
                            });
                        } else {
                            const input = new Input({ source: new BlobSource(seg.file), formats: VIDEO_INPUT_FORMATS });
                            try {
                                await feedSegmentAudio({
                                    audioSource: audioPlan.source,
                                    input,
                                    startInFile: seg.startInFile,
                                    endInFile: seg.endInFile,
                                    segBaseOutSec,
                                    silenceFormat,
                                    signal,
                                    fileName: seg.file.name,
                                    onTruncated: () => {
                                        decodeTruncated = true;
                                    },
                                });
                            } finally {
                                input.dispose();
                            }
                        }
                        nextExpectedOutSec = segBaseOutSec + segDur;
                    }
                }
            }
        };

        // Concurrently, not back-to-back. Audio reads its own Inputs and feeds a
        // separate muxer track (mediabunny guards the muxer with its own mutex),
        // so running it after the ticks left every decoder and the video encoder
        // idle for the whole audio pass. It also interleaves the mdat properly:
        // serial passes wrote the entire video track before the first audio byte.
        await joinAllOrThrowFirst([runVideoTicks(), runAudio()]);
    } catch (err) {
        log.error("split transcode aborted or failed", { framesDone, err: String(err) });
        disposeAllSlots();
        await cancelOutputQuietly(out);
        throw err;
    } finally {
        disposeAllSlots();
    }

    const result = await finalizeTranscodeOutput({
        out,
        signal,
        onProgress,
        framesDone,
        framesTotal,
        bytesWritten: totalBytesWritten,
        durationSec: framesDone * (1 / outputFps),
    });

    // Opus fallback (the encode path could not use AAC) means audio is present
    // but less compatible - the caller surfaces a soft notice.
    const audioReencodedToOpus = audioPlan?.mode === "encode" && audioPlan.codec === "opus";

    log.info("split transcode done", {
        framesEncoded: framesDone,
        durationSec: round2(framesDone * (1 / outputFps)),
        sizeBytes: totalBytesWritten,
        // See pipeline.ts: requested vs delivered is the one pair that tells a
        // too-low budget apart from an encoder that undershot it.
        bitrateKbps: Math.round(bitrate / 1000),
        achievedKbps: achievedKbps(totalBytesWritten, framesDone / outputFps),
        elapsedMs: Math.round(performance.now() - startMs),
        mapOverlayDropped: mapOverlayFailed,
        decodeTruncated,
        audioDroppedHeterogeneous,
        audioDroppedNoEncoder,
        audioMode: audioPlan?.mode ?? "none",
        audioReencodedToOpus,
    });

    // mapOverlayFailed only ever becomes true on the map-overlay path, so it
    // already encodes "requested AND dropped" - safe to pass straight through.
    return {
        ...result,
        mapOverlayDropped: mapOverlayFailed,
        decodeTruncated,
        audioDroppedHeterogeneous,
        audioDroppedNoEncoder,
        audioReencodedToOpus,
        capturedMoov,
    };
}
