// Per-trip store of privacy blur regions (src/blur-regions.ts model).
//
// Keyed by Trip object identity in a WeakMap - deliberately NOT reset on trip
// change (unlike perSlotCrops): marking regions is labor, and switching trips
// back and forth must not discard it. A re-ingest that rebuilds Trip objects
// simply orphans the old entries for GC - annotations are in-memory-only, like
// every other session state. Regions store rects in normalized source coords
// and keyframe times on the trip's content axis, so they stay valid for their
// trip regardless of layout/crop/output changes.

import type { BlurRegion } from "../blur-regions.js";
import { tripAllCandidates } from "../trips.js";
import type { Trip } from "../trips.js";

import { activeTrip } from "./state.js";

const regionsByTrip = new WeakMap<Trip, BlurRegion[]>();

type Listener = () => void;
const listeners = new Set<Listener>();

/** Subscribes to blur-region list/geometry changes. Returns unsubscribe. */
export function subscribeBlurRegions(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

/** Wakes subscribers. Call after any region mutation (add/remove/keyframe/style
 *  edits) - mutations are in-place per the codebase convention, so subscribers
 *  re-read via activeBlurRegions(). */
export function notifyBlurRegionsChanged(): void {
    for (const l of listeners) l();
}

/** Blur regions of the active trip (live array - do not hold across trip
 *  switches). Empty when no trip is active. */
export function activeBlurRegions(): BlurRegion[] {
    const trip = activeTrip();
    if (!trip) return [];
    let list = regionsByTrip.get(trip);
    if (!list) {
        list = [];
        regionsByTrip.set(trip, list);
    }
    return list;
}

export function addBlurRegion(region: BlurRegion): void {
    activeBlurRegions().push(region);
    notifyBlurRegionsChanged();
}

export function removeBlurRegion(id: string): void {
    const list = activeBlurRegions();
    const i = list.findIndex((r) => r.id === id);
    if (i >= 0) {
        list.splice(i, 1);
        notifyBlurRegionsChanged();
    }
}

// Aborts a dropped region's in-flight Follow pass. Injected from app.ts
// (blur-track.cancelTrackPass) rather than imported directly, so this module
// stays out of blur-track's import graph (blur-track already imports this one -
// a direct back-import would be a cycle). No-op until wired / when nothing runs.
let droppedRegionPassCanceller: ((regionId: string) => void) | null = null;

/** Wires the tracker-pass canceller so carryBlurRegions can abort the Follow
 *  pass of a region that a regroup drops (its file set changed). */
export function setDroppedRegionPassCanceller(fn: (regionId: string) => void): void {
    droppedRegionPassCanceller = fn;
}

/**
 * Carries blur regions from replaced Trip objects onto their rebuilt
 * successors. Trip objects are rebuilt in-session by every regroup
 * (applyRegroup, the settings-modal gap change) and by the lazy embedded-GPS
 * refresh - without this the user's marking silently vanishes on those paths.
 * Matching mirrors carryOverTripPreviews: the first candidate's File identity
 * names a trip across a rebuild. Regions transfer ONLY when the successor has
 * the exact same file set: same files = identical timeline = keyframe times
 * stay valid, while a merged/split trip shifts content-axis offsets and a
 * carried keyframe would blur the wrong moment - dropping there is honest.
 */
export function carryBlurRegions(oldTrips: readonly Trip[], newTrips: readonly Trip[]): void {
    const byFirstFile = new Map<File, { regions: BlurRegion[]; files: Set<File> }>();
    // Every region that existed before the regroup, to tell carried from dropped.
    const oldRegionIds = new Set<string>();
    for (const trip of oldTrips) {
        const regions = regionsByTrip.get(trip);
        if (!regions || regions.length === 0) continue;
        for (const r of regions) oldRegionIds.add(r.id);
        const cands = tripAllCandidates(trip);
        const first = cands[0];
        if (first) byFirstFile.set(first.file, { regions, files: new Set(cands.map((c) => c.file)) });
    }
    if (byFirstFile.size === 0) return;
    const carriedRegionIds = new Set<string>();
    for (const trip of newTrips) {
        if (regionsByTrip.get(trip)?.length) continue;
        const cands = tripAllCandidates(trip);
        const first = cands[0];
        if (!first) continue;
        const carried = byFirstFile.get(first.file);
        if (!carried) continue;
        if (cands.length !== carried.files.size || !cands.every((c) => carried.files.has(c.file))) continue;
        regionsByTrip.set(trip, carried.regions);
        for (const r of carried.regions) carriedRegionIds.add(r.id);
    }
    // A dropped region (merge/split invalidated its keyframe times, so it was not
    // carried) may still have a Follow pass decoding. Abort it, or the orphaned
    // pass keeps holding the tracker worker's single-pass gate and blocks the
    // next Follow until it drains. No-op for carried regions (same objects) and
    // when nothing is running.
    for (const id of oldRegionIds) {
        if (!carriedRegionIds.has(id)) droppedRegionPassCanceller?.(id);
    }
    // Old trips HAD regions, so the active list identity changed either way -
    // carried over or (on a merge/split) legitimately dropped. Listeners must
    // re-read via activeBlurRegions() in both cases, or the panel keeps
    // rendering rows for zones that no longer exist.
    notifyBlurRegionsChanged();
}
