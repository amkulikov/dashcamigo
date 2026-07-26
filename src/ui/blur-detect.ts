// Main-thread client of the detection pass (the "blur all plates / faces"
// checkboxes on the export panel). Owns the per-trip checkbox flags, the pass
// result cache and the single running pass; the heavy work - native-res decode
// + tiled detector inference - runs in src/workers/tracker-worker.ts (shared
// with the Follow pass, one worker = one wasm runtime).
//
// Result model: the pass converts confirmed detector tracks into ordinary
// BlurRegion objects (auto-* ids, unpinned keyframes) kept OUTSIDE the manual
// zone list - the preview painter and the export concatenate them, the zone
// editor never sees them (dozens of non-editable rows would drown the panel;
// a false positive is cheap, a miss is fixed with a manual zone).
//
// Freshness: results are keyed by (range, channels, kinds). The key mismatching
// the current params means STALE - stale results are not painted and not
// exported (they cover a different span); ensureDetectPass() re-runs. Range
// edits re-trigger through a debounce so a trim-bar drag does not thrash
// multi-minute passes.

import { type BlurRegion, type BlurStyle } from "../blur-regions.js";
import { sliceCandidatesForRange } from "../export-range.js";
import { subtractIntervals, type TimeInterval, unionIntervals } from "../tracking/interval-set.js";
import { createLogger } from "../log.js";
import { tripCandidatesByChannel } from "../trips.js";
import type { Trip } from "../trips.js";
import type { Channel } from "../parsers/types.js";
import {
    DETECT_NOTIFY_PROGRESS,
    DETECT_REQUEST,
    type DetectKind,
    type DetectProgressData,
    type DetectRequestData,
    type DetectResult,
    type DetectResultTrack,
} from "../workers/tracker-protocol.js";

import {
    type BlurAssetGroupId,
    blurAssetsNeedDownload,
    downloadBlurAssets,
    FACE_MODEL_URL,
    PLATE_MODEL_URL,
    TRACKER_MODEL_URL,
    TRACKER_ORT_WASM_DIR,
} from "./blur-assets.js";
import { exportPanelState, notifyExportStateChanged, subscribeExportState } from "./export-state.js";
import { notify } from "./notifications.js";
import { activeTrip, state } from "./state.js";
import { subscribeTrackerWorkerNotifications, trackerWorkerClient } from "./tracker-worker-client.js";

export type { DetectKind } from "../workers/tracker-protocol.js";

const log = createLogger("blur-detect");

/** Inactivity cap, reset on every progress tick - catches only a wedged worker
 *  (same rationale and value as the Follow pass's). */
const DETECT_REQUEST_TIMEOUT_MS = 10 * 60 * 1000;

/** Debounce for re-running after range/layout edits: a trim-bar drag emits
 *  state changes at pointer rate, and each re-run cancels a multi-minute pass. */
const ENSURE_DEBOUNCE_MS = 1200;

export interface DetectCounts {
    plate: number;
    face: number;
}

interface TrackCacheEntry {
    /** Intervals of the trip content axis this channel+kind has analyzed. */
    intervals: TimeInterval[];
    /** Confirmed tracks produced within them (each already clamped to the
     *  interval it was found in - the worker flushes tracks at interval
     *  boundaries, so a cached track never spans an un-analyzed gap).
     *
     *  Accepted trade-off of that flush: an object straddling the boundary
     *  between a cached interval and a newly analyzed one splits into two
     *  tracks that confirm INDEPENDENTLY. Usually that just means two
     *  overlapping covers (cheap); the real cost is a face whose detector hits
     *  split below the 3-hit bar on both sides - it drops entirely, where one
     *  continuous pass would confirm it (plates are saved by tracker-sustain).
     *  Deliberate: carrying hits across the boundary would re-create the
     *  deleted merge's cross-pass coupling for a miss a manual zone fixes. */
    tracks: DetectResultTrack[];
}

interface TripDetectState {
    enabled: { plate: boolean; face: boolean };
    /** Last completed pass; `key` names the params it covered. */
    result: { key: string; regions: BlurRegion[]; counts: DetectCounts } | null;
    /** Per-channel track cache: survives range edits, so a re-keyed pass decodes
     *  only what the covered intervals miss - a shrunk range costs nothing (serve
     *  the overlapping cached tracks), a grown one only the added tail. */
    trackCache: Map<Channel, Partial<Record<DetectKind, TrackCacheEntry>>>;
}

const stateByTrip = new WeakMap<Trip, TripDetectState>();

function tripState(trip: Trip): TripDetectState {
    let st = stateByTrip.get(trip);
    if (!st) {
        st = { enabled: { plate: false, face: false }, result: null, trackCache: new Map() };
        stateByTrip.set(trip, st);
    }
    return st;
}

interface RunningDetect {
    trip: Trip;
    key: string;
    runId: string;
    channelCount: number;
    /** Aggregate 0..1 across all channel requests. */
    fraction: number;
    controller: AbortController;
    /** Settles when the pass stores a result (true) or fails/cancels (false). */
    promise: Promise<boolean>;
    armTimeout: () => void;
}

// One running pass app-wide: the worker serializes anyway, and a background
// pass for a switched-away trip would burn minutes of CPU while blocking the
// visible trip's pass.
let running: RunningDetect | null = null;
let runCounter = 0;
let autoRegionCounter = 0;
// Params key of the last FAILED (not cancelled) run. The auto re-ensure path
// (debounced export-state subscription) skips it - a deterministic failure
// would otherwise retry in a loop, toasting forever. Any explicit user action
// (checkbox toggle, download button, Save) clears it and retries.
let lastFailedRunKey: string | null = null;

type Listener = () => void;
const listeners = new Set<Listener>();

/** Subscribes to checkbox/pass/result changes (panel + preview re-render hook). */
export function subscribeBlurDetect(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

function notifyDetectChanged(): void {
    for (const l of listeners) l();
}

// Route this pass's progress off the shared worker's notification stream.
subscribeTrackerWorkerNotifications((msg) => {
    if (msg.type !== DETECT_NOTIFY_PROGRESS) return;
    const data = msg.data as DetectProgressData & { passId?: string };
    const run = running;
    if (!run || !data.passId?.startsWith(`${run.runId}:`)) return;
    const channelIndex = Number(data.passId.slice(run.runId.length + 1));
    if (!Number.isFinite(channelIndex)) return;
    run.fraction = Math.min(1, (channelIndex + data.fractionDone) / run.channelCount);
    run.armTimeout();
    notifyDetectChanged();
});

// Range / layout / panel edits re-key the pass; the debounce keeps a trim-bar
// drag from thrashing it. ensureDetectPass no-ops when the key is unchanged.
subscribeExportState(() => {
    if (anyDetectEnabled()) scheduleEnsureDetectPass();
});

// Probe for a WebGPU adapter once at startup: detection (both kinds) is
// WebGPU-only - an adapter here means the worker almost certainly has one too
// (a create failing there anyway fails the pass loudly - see tracker-worker).
// The probe resolves in milliseconds - long before any consent interaction -
// but re-render just in case one raced. Until it settles, detectAvailable()
// stays optimistic: rendering the checkboxes disabled for the probe's few ms
// would flash the "needs GPU" note on every machine (and flake the VRT
// baselines).
let probeConcludedNoGpu = false;
void (async () => {
    let adapter: object | null = null;
    try {
        adapter = typeof navigator !== "undefined" && navigator.gpu ? await navigator.gpu.requestAdapter() : null;
    } catch {
        // No WebGPU - treated the same as a null adapter below.
    }
    if (!adapter) probeConcludedNoGpu = true;
    notifyDetectChanged();
})();

interface PassParams {
    key: string;
    startSec: number;
    endSec: number;
    channels: Channel[];
    kinds: DetectKind[];
}

/** Current pass parameters for the trip, or null when no kind is enabled.
 *  No range picked yet = the full trip (matches what an export would cover). */
function passParams(trip: Trip): PassParams | null {
    const st = tripState(trip);
    const kinds: DetectKind[] = [];
    if (st.enabled.plate) kinds.push("plate");
    if (st.enabled.face) kinds.push("face");
    if (kinds.length === 0) return null;
    const range = exportPanelState.range;
    const startSec = range ? range.startTripSec : 0;
    const endSec = range ? range.endTripSec : trip.timeline.contentDurationSec;
    const channels = [...state.composition.channelOrder];
    return {
        key: `${startSec.toFixed(2)}|${endSec.toFixed(2)}|${channels.join("+")}|${kinds.join("+")}`,
        startSec,
        endSec,
        channels,
        kinds,
    };
}

/** Asset groups the given kinds need (consent / readiness gating). */
export function detectAssetGroups(kinds: readonly DetectKind[]): BlurAssetGroupId[] {
    return kinds.map((k) => (k === "plate" ? "detect-plate" : "detect-face"));
}

/** Detection is WebGPU-only for both kinds (faces: yolov9s-960 is ~600 ms/tile
 *  on wasm; plates: 5 fps x 9 tiles x ~140 ms is ~6x realtime - both a crawl,
 *  not a degradation). Once the probe concludes there is no adapter, the panel
 *  disables both checkboxes with an explanation. */
export function detectAvailable(): boolean {
    return !probeConcludedNoGpu;
}

/** Checkbox state of the active trip. */
export function detectEnabled(kind: DetectKind): boolean {
    const trip = activeTrip();
    return trip ? tripState(trip).enabled[kind] : false;
}

export function anyDetectEnabled(): boolean {
    const trip = activeTrip();
    if (!trip) return false;
    const en = tripState(trip).enabled;
    return en.plate || en.face;
}

/** Flips a checkbox flag. Does NOT start the pass - the panel routes through
 *  the asset consent first and then calls ensureDetectPass(). */
export function setDetectEnabled(kind: DetectKind, on: boolean): void {
    const trip = activeTrip();
    if (!trip) return;
    if (on && !detectAvailable()) return; // UI-disabled, belt and braces
    tripState(trip).enabled[kind] = on;
    if (!on && !anyDetectEnabled() && running?.trip === trip) {
        running.controller.abort();
    }
    notifyDetectChanged();
}

/** Running-pass snapshot for the active trip (progress display), or null. */
export function detectPassState(): { fraction: number } | null {
    const trip = activeTrip();
    return running && trip && running.trip === trip ? { fraction: running.fraction } : null;
}

/** Fresh per-kind track counts for the current params, or null (stale / off). */
export function detectCounts(): DetectCounts | null {
    const trip = activeTrip();
    if (!trip) return null;
    const params = passParams(trip);
    const result = tripState(trip).result;
    return params && result && result.key === params.key ? result.counts : null;
}

/** Auto blur regions to PAINT and EXPORT: only when fresh for the current
 *  params - a stale result covers a different range/layout and painting it
 *  would promise protection the export will not deliver. */
export function detectRegions(): BlurRegion[] {
    const trip = activeTrip();
    if (!trip) return [];
    const params = passParams(trip);
    const result = tripState(trip).result;
    return params && result && result.key === params.key ? result.regions : [];
}

/** True when a checkbox is on but the current params have no fresh result and
 *  no pass is running for them - i.e. ensureDetectPass would start one. */
export function detectStale(): boolean {
    const trip = activeTrip();
    if (!trip) return false;
    const params = passParams(trip);
    if (!params) return false;
    const result = tripState(trip).result;
    if (result && result.key === params.key) return false;
    return !(running && running.trip === trip && running.key === params.key);
}

/** The manual style select restyles auto regions too - one style for all blur. */
export function setDetectStyle(style: BlurStyle): void {
    const trip = activeTrip();
    if (!trip) return;
    const result = tripState(trip).result;
    if (!result) return;
    for (const region of result.regions) region.style = style;
    notifyDetectChanged();
}

let ensureTimer: number | undefined;

/** Debounced ensureDetectPass (range-drag friendly). */
function scheduleEnsureDetectPass(): void {
    if (ensureTimer !== undefined) window.clearTimeout(ensureTimer);
    ensureTimer = window.setTimeout(() => {
        ensureTimer = undefined;
        ensureDetectPass({ auto: true });
    }, ENSURE_DEBOUNCE_MS);
}

/**
 * Reconciles the running pass with the current params: cancels a pass whose
 * key (or trip) no longer matches, starts one when enabled kinds have no fresh
 * result. No-op when everything matches, and while the models still need a
 * consent download (the panel's strip owns that; starting a pass here would
 * make the worker pull megabytes the user never agreed to).
 */
export function ensureDetectPass(opts?: { auto?: boolean }): void {
    const trip = activeTrip();
    if (!trip) return;
    const params = passParams(trip);
    if (!params) {
        if (running?.trip === trip) running.controller.abort();
        return;
    }
    if (opts?.auto && lastFailedRunKey === params.key) return; // no auto retry loops
    if (!opts?.auto) lastFailedRunKey = null;
    if (blurAssetsNeedDownload(detectAssetGroups(params.kinds))) return;
    if (running) {
        if (running.trip === trip && running.key === params.key) return; // already on it
        running.controller.abort(); // stale pass (old range/kinds/trip) - stop burning CPU
    }
    const result = tripState(trip).result;
    if (result && result.key === params.key) return; // fresh
    startRun(trip, params);
}

/**
 * Export-time guarantee: resolves with the auto regions for the CURRENT params,
 * running (or awaiting) the pass as needed. `onFraction` reports pass progress
 * 0..1 for the export progress bar. Aborting `signal` cancels the pass and
 * rejects with AbortError; a failed pass rejects with the original error.
 * Resolves [] immediately when no kind is enabled.
 */
export async function ensureDetectRegionsForExport(
    signal: AbortSignal,
    onFraction: (fraction: number) => void,
): Promise<BlurRegion[]> {
    const trip = activeTrip();
    if (!trip) return [];
    const params = passParams(trip);
    if (!params) return [];
    // Consent leftover: the box is checked but the download strip was ignored
    // (never answered) and Save got clicked. Silently exporting WITHOUT the
    // promised blur is the one failure this feature must never have, so Save
    // with the checkbox on counts as the go-ahead - the strip already told the
    // user the size, and the pass right after makes the download visible.
    if (blurAssetsNeedDownload(detectAssetGroups(params.kinds))) {
        const ok = await downloadBlurAssets(detectAssetGroups(params.kinds), signal);
        if (signal.aborted) throw new DOMException("aborted", "AbortError");
        if (!ok) throw new Error("detect model download failed");
    }
    const st = tripState(trip);
    for (;;) {
        if (signal.aborted) throw new DOMException("aborted", "AbortError");
        if (st.result && st.result.key === params.key) return st.result.regions;
        // Adopt a matching running pass or start one, then await it.
        if (!(running && running.trip === trip && running.key === params.key)) {
            ensureDetectPass();
        }
        const run = running;
        if (!run || run.trip !== trip || run.key !== params.key) {
            // ensureDetectPass declined to start (e.g. no channels sliced) -
            // treat as "nothing detected" rather than spin.
            return [];
        }
        const onAbort = (): void => run.controller.abort();
        signal.addEventListener("abort", onAbort, { once: true });
        const unsubscribe = subscribeBlurDetect(() => {
            if (running === run) onFraction(run.fraction);
        });
        try {
            const ok = await run.promise;
            if (signal.aborted) throw new DOMException("aborted", "AbortError");
            if (!ok) throw new Error("detect pass failed");
        } finally {
            signal.removeEventListener("abort", onAbort);
            unsubscribe();
        }
        // Loop: re-check freshness (a range edit could have re-keyed mid-await).
    }
}

/** The sub-span of a cached track that lies within the export range, or null
 *  when the track is entirely outside it. Keyframes are kept whole - the render
 *  is range-bounded, so interpolation at the clamped edge still reads the
 *  neighbor keyframes correctly. */
function trackRegionSpan(
    track: DetectResultTrack,
    startSec: number,
    endSec: number,
): { startSec: number; endSec: number } | null {
    const s = Math.max(startSec, track.startSec);
    const e = Math.min(endSec, track.endSec);
    return e > s ? { startSec: s, endSec: e } : null;
}

function buildRegion(
    kind: DetectKind,
    channel: Channel,
    track: {
        startSec: number;
        endSec: number;
        keyframes: Array<{ contentSec: number; rect: BlurRegion["keyframes"][number]["rect"] }>;
    },
): BlurRegion {
    autoRegionCounter += 1;
    return {
        id: `auto-${kind}-${autoRegionCounter}`,
        channel,
        style: exportPanelState.blurStyle,
        startSec: track.startSec,
        endSec: track.endSec,
        autoEnd: false,
        lastTrackLost: false,
        keyframes: track.keyframes.map((k) => ({ contentSec: k.contentSec, rect: { ...k.rect }, pinned: false })),
    };
}

function startRun(trip: Trip, params: PassParams): void {
    const controller = new AbortController();
    runCounter += 1;
    const runId = `detect-${runCounter}`;
    // Inactivity timeout via signal (the worker client has no built-in one):
    // armed/reset from progress ticks so a queued pass's wait is not counted -
    // mirrors the Follow pass.
    const timeoutCtrl = new AbortController();
    let timedOut = false;
    let timeoutTimer: number | undefined;
    const armTimeout = (): void => {
        if (timeoutTimer !== undefined) window.clearTimeout(timeoutTimer);
        timeoutTimer = window.setTimeout(() => {
            timedOut = true;
            timeoutCtrl.abort();
        }, DETECT_REQUEST_TIMEOUT_MS);
    };
    const run: RunningDetect = {
        trip,
        key: params.key,
        runId,
        channelCount: Math.max(1, params.channels.length),
        fraction: 0,
        controller,
        armTimeout,
        promise: Promise.resolve(false), // replaced synchronously below
    };
    run.promise = (async (): Promise<boolean> => {
        try {
            const st = tripState(trip);
            const regions: BlurRegion[] = [];
            const counts: DetectCounts = { plate: 0, face: 0 };
            for (let i = 0; i < params.channels.length; i++) {
                const channel = params.channels[i]!;
                const candidates = tripCandidatesByChannel(trip, channel);
                const segments = sliceCandidatesForRange(candidates, trip.timeline, params.startSec, params.endSec).map(
                    (seg) => ({
                        file: seg.file,
                        startInFile: seg.startInFile,
                        endInFile: seg.endInFile,
                        tripStart: seg.tripStart,
                    }),
                );
                if (segments.length === 0) continue;
                // Incremental contract: analyze only what the track cache does
                // not cover. A shrunk range analyzes nothing (the cache already
                // holds the tracks); a grown one only decodes the added tail.
                const chCache = st.trackCache.get(channel) ?? {};
                const analyzeIntervalsByKind: DetectRequestData["analyzeIntervalsByKind"] = {};
                for (const kind of params.kinds) {
                    analyzeIntervalsByKind[kind] = subtractIntervals(
                        { startSec: params.startSec, endSec: params.endSec },
                        chCache[kind]?.intervals ?? [],
                    );
                }
                const request: DetectRequestData & { passId: string } = {
                    passId: `${runId}:${i}`,
                    segments,
                    startContentSec: params.startSec,
                    endContentSec: params.endSec,
                    kinds: params.kinds,
                    analyzeIntervalsByKind,
                    plateModelUrl: PLATE_MODEL_URL,
                    faceModelUrl: FACE_MODEL_URL,
                    trackerModelUrl: TRACKER_MODEL_URL,
                    ortWasmDir: TRACKER_ORT_WASM_DIR,
                };
                const result = await trackerWorkerClient().request<DetectResult>(DETECT_REQUEST, request, {
                    signal: AbortSignal.any([controller.signal, timeoutCtrl.signal]),
                });
                // Fold the newly produced tracks into the cache - only on a
                // completed request, so an abort/failure leaves it untouched.
                const updatedCache = st.trackCache.get(channel) ?? {};
                for (const kind of params.kinds) {
                    const entry = updatedCache[kind] ?? { intervals: [], tracks: [] };
                    entry.tracks = [...entry.tracks, ...(result.tracksByKind[kind] ?? [])];
                    entry.intervals = unionIntervals([...entry.intervals, ...(analyzeIntervalsByKind[kind] ?? [])]);
                    updatedCache[kind] = entry;
                }
                st.trackCache.set(channel, updatedCache);
                // The effort breakdown is the arbiter for "the pass feels slow"
                // field reports - which kind ate the wall time (discovery scans
                // vs the per-object tracker), versus the decode share.
                log.info("detect pass stats", {
                    channel,
                    spanSec: Math.round((params.endSec - params.startSec) * 10) / 10,
                    passMs: result.passMs,
                    decodedFrames: result.decodedFrames,
                    ...result.statsByKind,
                });
                // Full track dump (compact strings): the forensic record for
                // "the cover moved wrong" field reports - only THIS pass's fresh
                // tracks (the cache holds the earlier intervals'). Shows every
                // keyframe the render interpolates, so a bad motion can be traced
                // to the exact track without a repro clip.
                for (const kind of params.kinds) {
                    const tracks = result.tracksByKind[kind] ?? [];
                    if (tracks.length === 0) continue;
                    log.info("detect tracks", {
                        channel,
                        kind,
                        tracks: tracks.map(
                            (track) =>
                                `${track.startSec.toFixed(2)}..${track.endSec.toFixed(2)} ` +
                                `hits=${track.detHits} best=${track.bestScore.toFixed(2)} ` +
                                track.keyframes
                                    .map(
                                        (k) =>
                                            `${k.contentSec.toFixed(2)}@${k.rect.xPct.toFixed(3)},${k.rect.yPct.toFixed(3)},${k.rect.wPct.toFixed(3)},${k.rect.hPct.toFixed(3)}`,
                                    )
                                    .join(" "),
                        ),
                    });
                }
                // Build regions from the WHOLE cache (this pass + earlier
                // intervals), each clamped to the current range; a track fully
                // outside it is skipped.
                const cache = st.trackCache.get(channel)!;
                for (const kind of params.kinds) {
                    for (const track of cache[kind]?.tracks ?? []) {
                        const span = trackRegionSpan(track, params.startSec, params.endSec);
                        if (!span) continue;
                        counts[kind] += 1;
                        regions.push(
                            buildRegion(kind, channel, {
                                startSec: span.startSec,
                                endSec: span.endSec,
                                keyframes: track.keyframes,
                            }),
                        );
                    }
                }
            }
            tripState(trip).result = { key: params.key, regions, counts };
            return true;
        } catch (err) {
            if ((err as DOMException)?.name === "AbortError") {
                if (timedOut) {
                    lastFailedRunKey = params.key;
                    log.warn("detect pass timed out", { key: params.key });
                    notify({ severity: "warn", messageKey: "export.blur.detect.failed" });
                } else {
                    log.info("detect pass cancelled", { key: params.key });
                }
            } else {
                lastFailedRunKey = params.key;
                log.warn("detect pass failed", { key: params.key, err: String(err) });
                notify({ severity: "warn", messageKey: "export.blur.detect.failed" });
            }
            return false;
        } finally {
            if (timeoutTimer !== undefined) window.clearTimeout(timeoutTimer);
            if (running === run) running = null;
            notifyDetectChanged();
            // A settled pass can flip the copy-vs-encode gate (fresh empty
            // result re-enables stream-copy; found regions pin re-encode) -
            // the panel's estimate listens on export-state, not on this module.
            notifyExportStateChanged();
        }
    })();
    running = run;
    notifyDetectChanged();
}
