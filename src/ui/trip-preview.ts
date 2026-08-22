// First-frame preview for the trip sidebar - the only visual on the card.
// Extracts one keyframe via mediabunny VideoSampleSink, draws to a canvas with fit:"cover",
// stores as JPEG dataURL on trip.previewDataUrl. On extraction failure (broken codec /
// no primary video track / unsupported codec in browser) the card stays as a dark placeholder.
//
// Architecture: all decode/encode work runs in Web Workers (src/workers/preview-worker.ts).
// Main thread only runs a pool of POOL_SIZE workers and round-robins File objects across them.
// Each File is passed via postMessage without copying (File is structured-cloneable; File.arrayBuffer()
// in the worker reads content directly through the Blob backend).
//
// Why a pool: the browser's hardware-decoder pool has multiple slots (Chromium on Apple Silicon
// hits VideoToolbox through 3-4 slots simultaneously). Sequential extraction left them idle.
// On long lists (50+ trips, HEVC 4K) parallel extraction gives a real wall-clock speedup.
//
// Storage: in-memory only (on the Trip object). Previews regenerate on reload since Files don't survive it.

import { createLogger } from "../log.js";
import type { Trip } from "../trips.js";
import { tripAllCandidates } from "../trips.js";
import {
    PREVIEW_REQUEST_EXTRACT,
    type PreviewExtractRequestData,
    type PreviewExtractResult,
} from "../workers/preview-protocol.js";
import { createWorkerClient } from "../workers/_protocol/worker-client.js";
import { createWorkerPool } from "../workers/_protocol/worker-pool.js";

const log = createLogger("preview");

/** Pool size. 2 is a compromise: more causes contention on the HEVC hardware decoder (M-chips have 3-4 VT slots, Intel iGPU 1-2); fewer wastes wall-clock. On typical 10-50 trip lists a 2× speedup over sequential is measurable. */
const POOL_SIZE = 2;

// Playback throttle. While a trip is actively playing, background preview
// decoding contends with the player for the same hardware decoder pool - the
// suspected trigger of runtime decode failures under heavy concurrent decode. So
// the extra pool worker(s) park during playback and only worker 0 keeps going:
// previews still fill (slower), the player keeps decoder headroom. Not a hard
// pause - a deprioritization.
let previewPlaybackActive = false;
// resolve callbacks of workers parked on the throttle gate; released together
// when playback stops (or per-worker when its run aborts).
const throttleWaiters = new Set<() => void>();

/** Wakes every parked worker (playback stopped, or the queue drained). */
function releaseThrottleWaiters(): void {
    const waiters = [...throttleWaiters];
    throttleWaiters.clear();
    for (const release of waiters) release();
}

/** Player play/pause bridge: true while a trip actively plays. Idempotent. */
export function setPreviewPlaybackActive(active: boolean): void {
    if (active === previewPlaybackActive) return;
    previewPlaybackActive = active;
    if (!active) releaseThrottleWaiters();
}

/** Parks a throttled worker until playback stops, the queue drains, or its run
 *  aborts. Resolves immediately when not throttling. Worker 0 never calls this. */
function awaitThrottleRelease(signal: AbortSignal): Promise<void> {
    if (!previewPlaybackActive || signal.aborted) return Promise.resolve();
    return new Promise<void>((resolve) => {
        const release = (): void => {
            signal.removeEventListener("abort", release);
            throttleWaiters.delete(release);
            resolve();
        };
        throttleWaiters.add(release);
        signal.addEventListener("abort", release, { once: true });
    });
}

const pool = createWorkerPool({
    name: "preview",
    capacity: POOL_SIZE,
    factory: (idx, opts) => {
        // name is intentionally the same for all slots: Vite's worker plugin requires static options.
        // Slot index lives in the pool, not the DevTools label.
        const worker = new Worker(new URL("../workers/preview-worker.ts", import.meta.url), {
            type: "module",
            name: "preview-worker",
        });
        return createWorkerClient(worker, { name: `preview-${idx}`, onCrash: opts.onCrash });
    },
});

/**
 * Spawns one preview worker ahead of time so its chunk is warm by the time the
 * trip list renders and previews start generating. Called at idle from app.ts;
 * the real preview run reuses the warm slot.
 */
export function prewarmPreview(): void {
    pool.prewarm();
}

/**
 * Sends a File to the least-loaded pool slot and awaits the result.
 * Returns a dataURL or null if the file cannot be decoded. Throws on worker-level errors
 * (unhandled exception in the worker) - the caller logs and skips the preview for that trip.
 */
function extractFirstFrameDataUrl(file: File): Promise<string | null> {
    const req: PreviewExtractRequestData = { file };
    return pool.request<PreviewExtractResult>(PREVIEW_REQUEST_EXTRACT, req).then((res) => res.dataUrl);
}

/**
 * Single-flight token for the active background run. A new schedulePopulateTripPreviews call
 * cancels the previous one so fresh trips get previews without waiting for the old queue.
 * Already-generated previews survive cancellation (cached on the Trip object).
 *
 * Worker-side: in-flight requests run to completion (workers are stateless between requests).
 * Their results are silently discarded via the signal.aborted check after await.
 */
let activeRun: AbortController | null = null;

// Files whose first-frame extraction returned nothing or threw - TERMINAL (the
// file cannot produce a thumbnail; a different codec the player handles via MSE,
// a truncated clip, etc.). Keyed by the FIRST candidate's File OBJECT: groupTrips
// reuses the same candidate Files across a regroup, so the flag survives the Trip
// rebuild, and a re-drop makes fresh File objects so it naturally resets. The
// retrying it during every regroup would waste decoder time. The sidebar uses
// the same static placeholder before and after a failed attempt, so this stays
// an internal scheduling detail.
const previewFailedFiles = new WeakSet<File>();

// In-flight first-frame extractions keyed by File, so the opened-trip path
// (ensureTripPreview) and the authoritative background pass (populateTrip-
// PreviewsImpl) never decode the SAME first frame twice when they target one
// trip concurrently - they share the one decode instead. Entry is removed when
// it settles.
const inflightExtractions = new Map<File, Promise<string | null>>();

/** Single-flight wrapper over extractFirstFrameDataUrl, deduped by File. */
function extractFirstFrameShared(file: File): Promise<string | null> {
    const existing = inflightExtractions.get(file);
    if (existing) return existing;
    const pending = extractFirstFrameDataUrl(file).finally(() => {
        if (inflightExtractions.get(file) === pending) inflightExtractions.delete(file);
    });
    inflightExtractions.set(file, pending);
    return pending;
}

/**
 * Ensures ONE trip has a first-frame preview, extracting it if missing. Unlike
 * schedulePopulateTripPreviews this does NOT abort any in-flight run - it just
 * queues one extraction on the shared worker pool. So opening a trip mid-fill
 * (or progressive recording analysis) can request previews without
 * cancelling each other, which is what left a preview "never loaded" when the
 * trip was opened early. No-op if the trip already has a preview or already
 * failed. onUpdate fires with (trip, dataUrl) on success.
 */
export async function ensureTripPreview(trip: Trip, onUpdate: (trip: Trip, dataUrl: string) => void): Promise<void> {
    if (trip.previewDataUrl) return;
    const first = tripAllCandidates(trip)[0];
    if (!first || previewFailedFiles.has(first.file)) return;
    try {
        const url = await extractFirstFrameShared(first.file);
        if (url) {
            trip.previewDataUrl = url;
            onUpdate(trip, url);
        } else {
            previewFailedFiles.add(first.file);
        }
    } catch (err) {
        previewFailedFiles.add(first.file);
        log.debug("preview extract failed", {
            file: first.file.name,
            err: err instanceof Error ? err.message : String(err),
        });
    }
}

async function populateTripPreviewsImpl(
    trips: Trip[],
    onUpdate: (trip: Trip, dataUrl: string) => void,
    signal: AbortSignal,
): Promise<void> {
    // Parallel queue: POOL_SIZE files in flight at once. cursor is the next trip index to take.
    let cursor = 0;
    const runOne = async (workerIndex: number): Promise<void> => {
        while (!signal.aborted) {
            // Throttle: the extra worker(s) park while a trip actively plays so
            // preview decoding yields the hardware decoder to the player. Worker 0
            // keeps going, so previews never fully stall. Only park while work
            // remains - otherwise a parked worker would hold up Promise.all after
            // worker 0 drained the queue (playback may never stop on its own).
            if (workerIndex > 0 && previewPlaybackActive && cursor < trips.length) {
                await awaitThrottleRelease(signal);
                if (signal.aborted) return;
            }
            const tripIdx = cursor++;
            if (tripIdx >= trips.length) {
                // Queue drained: wake any parked peer so it exits too (its park
                // guard now sees cursor >= length and it returns).
                releaseThrottleWaiters();
                return;
            }
            const trip = trips[tripIdx];
            if (!trip || trip.previewDataUrl) continue;
            const candidates = tripAllCandidates(trip);
            if (candidates.length === 0) continue;
            const first = candidates[0];
            // Terminal failure already recorded (e.g. by ensureTripPreview on an
            // earlier open) - re-decoding the same broken file on every reschedule
            // wastes a worker slot for a result we already know.
            if (!first || previewFailedFiles.has(first.file)) continue;
            try {
                const url = await extractFirstFrameShared(first.file);
                if (signal.aborted) return;
                if (url) {
                    trip.previewDataUrl = url;
                    // Hand the TRIP OBJECT to onUpdate, not the index into the
                    // array captured at schedule time: a cancelled run keeps
                    // filling cards in the background by design, and a regroup
                    // (next ingest) reorders state.trips - a stale index then
                    // painted the preview onto the wrong card.
                    onUpdate(trip, url);
                } else {
                    // No decodable first frame - terminal, so the card stops
                    // shimmering and shows the "no thumbnail" placeholder.
                    previewFailedFiles.add(first.file);
                }
            } catch (err) {
                // Worker-level error for this file - continue to the next trip; the card stays as a placeholder.
                previewFailedFiles.add(first.file);
                log.debug("preview extract failed", {
                    tripIdx,
                    file: first.file.name,
                    err: err instanceof Error ? err.message : String(err),
                });
            }
        }
    };
    const tasks = Array.from({ length: POOL_SIZE }, (_unused, i) => runOne(i));
    await Promise.all(tasks);
}

/**
 * Starts background preview generation for all trips without previewDataUrl.
 * Cancels any previous run and starts fresh over the current state.trips.
 * Already-generated previews survive cancellation (cached on the Trip object).
 *
 * Parallelizes via POOL_SIZE workers; decoding and JPEG encode happen off the main thread.
 *
 * onUpdate is called per ready preview with (trip, dataUrl) - the trip OBJECT,
 * resolved to its current index/card at paint time (stale schedule-time indices
 * painted wrong cards after a regroup). The caller must do a targeted DOM
 * update (see sidebar.updateTripPreview), NOT a full renderTrips - otherwise
 * the DOM is rebuilt N times on a long list, stealing clicks from the user.
 */
export function schedulePopulateTripPreviews(
    trips: Trip[],
    onUpdate: (trip: Trip, dataUrl: string) => void,
): Promise<void> {
    if (activeRun) {
        activeRun.abort();
    }
    const ctrl = new AbortController();
    activeRun = ctrl;
    return populateTripPreviewsImpl(trips, onUpdate, ctrl.signal).finally(() => {
        if (activeRun === ctrl) activeRun = null;
    });
}

/**
 * Carries previewDataUrl from old Trip objects to new ones across a regroup.
 * groupTrips() builds fresh Trip objects from the same candidates - without
 * this transfer, every regroup wipes all previews and schedulePopulateTrip-
 * Previews re-extracts them, aborting in-flight worker decodes and producing
 * visible card flicker.
 *
 * Match key is the first candidate's File OBJECT identity, not file.name:
 * groupTrips reuses the same candidate File objects across a regroup (the
 * same invariant previewFailedFiles relies on), but basenames collide across
 * trips in first-class layouts like TeslaCam (every event folder has its own
 * front.mp4) - keying by name smeared one trip's thumbnail onto all of them.
 * For split trips, only the half that kept the original first file inherits
 * the preview; the other half re-extracts on the next schedule.
 */
export function carryOverTripPreviews(oldTrips: Trip[], newTrips: Trip[]): void {
    const previewByFirstFile = new Map<File, string>();
    for (const t of oldTrips) {
        if (!t.previewDataUrl) continue;
        const first = tripAllCandidates(t)[0];
        if (first) previewByFirstFile.set(first.file, t.previewDataUrl);
    }
    for (const t of newTrips) {
        if (t.previewDataUrl) continue;
        const first = tripAllCandidates(t)[0];
        if (!first) continue;
        const url = previewByFirstFile.get(first.file);
        if (url) t.previewDataUrl = url;
    }
}
