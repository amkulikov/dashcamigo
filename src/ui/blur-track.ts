// Main-thread client of the blur-zone auto-tracking pass. Owns the tracker
// worker singleton and the per-region pass state the panel renders (progress,
// cancel). The heavy work - decode + vittrack inference - runs in
// src/workers/tracker-worker.ts; this module slices the trip range into plain
// segments, fires the request, and folds the resulting keyframes back into the
// region (unpinned - user pins stay authoritative, replaceGeneratedKeyframes).

import { MIN_ZONE_SPAN_SEC, replaceGeneratedKeyframes, type BlurRegion } from "../blur-regions.js";
import { sliceCandidatesForRange } from "../export-range.js";
import { createLogger } from "../log.js";
import { tripCandidatesByChannel } from "../trips.js";
import type { Trip } from "../trips.js";
import {
    TRACK_NOTIFY_PROGRESS,
    TRACK_REQUEST,
    type TrackProgressData,
    type TrackRequestData,
    type TrackResult,
} from "../workers/tracker-protocol.js";

import { notifyBlurRegionsChanged } from "./blur-regions-state.js";
import { notify } from "./notifications.js";
import { TRACKER_MODEL_URL, TRACKER_ORT_WASM_DIR } from "./blur-assets.js";
import { subscribeTrackerWorkerNotifications, trackerWorkerClient } from "./tracker-worker-client.js";

const log = createLogger("blur-track");

// Route this pass's progress off the shared worker's notification stream
// (tracker-worker-client.ts - the worker is shared with blur-detect).
subscribeTrackerWorkerNotifications((msg) => {
    if (msg.type !== TRACK_NOTIFY_PROGRESS) return;
    const data = msg.data as TrackProgressData & { regionId?: string };
    const pass = data.regionId ? runningPasses.get(data.regionId) : null;
    if (pass) {
        pass.fractionDone = data.fractionDone;
        // Progress = the pass is actively decoding: (re)arm its inactivity
        // timeout. The first tick arms it (so a queued pass's wait is never
        // counted); later ticks reset it, so only a genuinely wedged worker
        // ever trips the cap.
        pass.armTimeout?.();
        notifyPassChanged();
    }
});

/** A full pass decodes the zone span once (7-36x realtime) + ~10ms/frame of
 *  WASM inference; 60s of footage lands around a minute on slow hardware.
 *  Used as an INACTIVITY cap (reset on every progress tick), so it only catches
 *  a wedged worker - a slow-but-progressing pass never trips it, however long. */
const TRACK_REQUEST_TIMEOUT_MS = 10 * 60 * 1000;

interface RunningPass {
    controller: AbortController;
    /** 0..1, updated from worker progress notifications. */
    fractionDone: number;
    /** (Re)arms the inactivity timeout. Called on every progress notification so
     *  the cap is measured from the pass's own decode activity, not from when it
     *  was requested - a pass queued behind another (the worker runs one at a
     *  time) must not count that queue wait toward its timeout. Set by
     *  toggleTrackPass; absent until the pass is wired. */
    armTimeout?: () => void;
}

// Passes keyed by region id; the panel polls via trackPassOf on its sync.
const runningPasses = new Map<string, RunningPass>();
type Listener = () => void;
const passListeners = new Set<Listener>();

/** Subscribes to pass lifecycle/progress changes (panel re-render hook). */
export function subscribeTrackPasses(listener: Listener): () => void {
    passListeners.add(listener);
    return () => passListeners.delete(listener);
}

function notifyPassChanged(): void {
    for (const l of passListeners) l();
}

/** Running pass state for a region, or null. */
export function trackPassOf(regionId: string): { fractionDone: number } | null {
    const pass = runningPasses.get(regionId);
    return pass ? { fractionDone: pass.fractionDone } : null;
}

/** Aborts a region's in-flight pass, if any. Call before removing a zone: an
 *  orphaned pass keeps decoding and holds the worker's single-pass gate, blocking
 *  the next Follow until it finishes or times out. No-op when nothing is running. */
export function cancelTrackPass(regionId: string): void {
    runningPasses.get(regionId)?.controller.abort();
}

/**
 * Starts (or cancels, when already running) the tracking pass for a region.
 * Seeds from the LAST pinned keyframe before the zone end - i.e. the user's
 * latest correction - and tracks forward. Resulting keyframes replace the
 * unpinned ones in the tracked span.
 *
 * Two end-of-span behaviors, keyed on region.autoEnd:
 *   - autoEnd (the "Follow a moving object" path): tracking OWNS the end. The
 *     pass runs to the end of the footage but stops itself when the object is
 *     lost; region.endSec is then set to that last-confident point, so the user
 *     never dials in an end for something that moves. On loss an info notice
 *     points them at the tail to verify (a false loss would under-cover).
 *   - manual end (drawn default / "whole clip" / a hand-set end): tracking fills
 *     keyframes only within the fixed span and, on early loss, freeze-holds the
 *     last confident rect to endSec (regionRectAt) rather than trimming - a span
 *     the user set by hand is never silently shortened; over-covering is the safe
 *     direction for a privacy feature. An info notice asks them to verify.
 *
 * Mutates the region + notifies; resolves when the pass settles.
 */
export async function toggleTrackPass(trip: Trip, region: BlurRegion): Promise<void> {
    const running = runningPasses.get(region.id);
    if (running) {
        running.controller.abort();
        return;
    }

    const contentDur = trip.timeline.contentDurationSec;
    const pinned = region.keyframes.filter((k) => k.pinned && k.contentSec < region.endSec);
    const seed = pinned.length > 0 ? pinned[pinned.length - 1]! : region.keyframes[0];
    if (!seed) return;
    const fromSec = Math.max(seed.contentSec, region.startSec);
    // autoEnd follows to the end of footage (the pass halts itself on loss);
    // a manual end tracks only within the user's span.
    const toSec = region.autoEnd ? contentDur : region.endSec;
    if (toSec - fromSec < 0.05) return;

    const candidates = tripCandidatesByChannel(trip, region.channel);
    const segments = sliceCandidatesForRange(candidates, trip.timeline, fromSec, toSec).map((seg) => ({
        file: seg.file,
        startInFile: seg.startInFile,
        endInFile: seg.endInFile,
        tripStart: seg.tripStart,
    }));
    if (segments.length === 0) return;

    const controller = new AbortController();
    // Inactivity timeout via signal (the client has no built-in timeout): only a
    // wedged worker should ever hit it, a slow-but-progressing pass keeps
    // resetting it. Armed from the FIRST progress tick, not here at request-send:
    // the worker runs passes one at a time (serialize gate), so a pass queued
    // behind another must not count that queue wait - counting it aborted a
    // perfectly healthy pass and silently discarded its result (no keyframes, a
    // misleading "timed out" toast).
    const timeoutCtrl = new AbortController();
    let timedOut = false;
    let timeoutTimer: number | undefined;
    const armTimeout = (): void => {
        if (timeoutTimer !== undefined) window.clearTimeout(timeoutTimer);
        timeoutTimer = window.setTimeout(() => {
            timedOut = true;
            timeoutCtrl.abort();
        }, TRACK_REQUEST_TIMEOUT_MS);
    };
    runningPasses.set(region.id, { controller, fractionDone: 0, armTimeout });
    // Clear any prior "verify the tail" flag while this pass runs - it will be
    // re-set from this pass's own outcome below.
    region.lastTrackLost = false;
    notifyPassChanged();
    try {
        const request: TrackRequestData & { regionId: string } = {
            regionId: region.id,
            segments,
            seedContentSec: fromSec,
            seedRect: { ...seed.rect },
            endContentSec: toSec,
            modelUrl: TRACKER_MODEL_URL,
            ortWasmDir: TRACKER_ORT_WASM_DIR,
        };
        let result: TrackResult;
        try {
            result = await trackerWorkerClient().request<TrackResult>(TRACK_REQUEST, request, {
                signal: AbortSignal.any([controller.signal, timeoutCtrl.signal]),
            });
        } finally {
            if (timeoutTimer !== undefined) window.clearTimeout(timeoutTimer);
        }

        // Follow is the only entry to a pass and it always sets autoEnd, so
        // tracking owns the end: pull it back to the last-confident point, keeping
        // at least a minimum span even on an immediate loss. (The autoEnd guard is
        // an invariant check - a non-Follow pass would leave the span untouched.)
        replaceGeneratedKeyframes(region, fromSec, toSec, result.keyframes);
        if (region.autoEnd) {
            region.endSec = Math.min(contentDur, Math.max(result.trackedUntilSec, region.startSec + MIN_ZONE_SPAN_SEC));
        }
        // Flag the tail for review when the object was lost before the footage
        // ran out: a false loss (occlusion longer than the ride-out window) could
        // end the cover early and expose a reappearing subject. The panel shows a
        // persistent "check end" badge; the toast is the immediate nudge.
        region.lastTrackLost = result.lostTarget;
        if (result.lostTarget) {
            notify({ severity: "warn", messageKey: "export.blur.track.followedEnd" });
        }
        notifyBlurRegionsChanged();
    } catch (err) {
        if ((err as DOMException)?.name === "AbortError") {
            if (timedOut) {
                // Not a user cancel: the pass ran past the cap (e.g. a near-static
                // subject followed across the whole trip). Say so rather than
                // vanish silently.
                log.warn("track pass timed out", { region: region.id });
                notify({ severity: "warn", messageKey: "export.blur.track.timeout" });
            } else {
                log.info("track pass cancelled", { region: region.id });
            }
        } else {
            log.warn("track pass failed", { region: region.id, err: String(err) });
            notify({ severity: "warn", messageKey: "export.blur.track.failed" });
        }
    } finally {
        runningPasses.delete(region.id);
        notifyPassChanged();
    }
}
