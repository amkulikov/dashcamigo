// Shared regroup invariant: rebuild state.trips from a candidate pool while
// preserving everything keyed to the OLD positional trip indices - the active
// selection, the expanded cards, the carried-over previews, and the event-cycle
// cursor. groupTrips builds fresh Trip objects and renumbers indices on every
// call, so any regroup site that skips this sequence leaves the player pointing
// at a different trip than the one on screen and loses previews (the second
// lazy-drop bug). One module, one source of truth: both the eager ingest and
// the lazy path call applyRegroup instead of a bare `state.trips = groupTrips`.

import { groupTrips } from "../trips.js";
import type { Trip, VideoCandidate } from "../trips.js";

import { clearTripEventCycle } from "./sidebar.js";
import { state } from "./state.js";
import { carryBlurRegions } from "./blur-regions-state.js";
import { carryOverTripPreviews } from "./trip-preview.js";

/**
 * Maps each File object to (tripIdx, frameIdx) for the new trips array. Used to
 * remap state.active and state.expandedTrips after groupTrips replaces
 * state.trips - indices are positional, not identity-based, so a regroup
 * (merge/split/reorder) would otherwise leave the player pointing to the
 * wrong trip.
 *
 * Keyed by File identity, NOT basename: a Viofo RO/ read-only copy and its
 * Movie/ sibling share a basename but are distinct Files in distinct trips, so a
 * basename key lets one overwrite the other and the remap lands on the wrong
 * trip. groupTrips reuses the same File objects, so identity is a stable key
 * across a regroup (same invariant carryOverTripPreviews relies on).
 */
export function buildFileLocationMap(trips: Trip[]): Map<File, { trip: number; frame: number }> {
    const out = new Map<File, { trip: number; frame: number }>();
    for (let ti = 0; ti < trips.length; ti++) {
        const trip = trips[ti]!;
        for (let fi = 0; fi < trip.frames.length; fi++) {
            const frame = trip.frames[fi]!;
            for (const cand of Object.values(frame.channels)) {
                if (cand) out.set(cand.file, { trip: ti, frame: fi });
            }
        }
    }
    return out;
}

export function remapActiveAndExpanded(oldTrips: Trip[], newTrips: Trip[]): void {
    const fileToLoc = buildFileLocationMap(newTrips);

    if (state.active) {
        const oldTrip = oldTrips[state.active.trip];
        const oldFrame = oldTrip?.frames[state.active.frame];
        let remapped: { trip: number; frame: number } | null = null;
        if (oldFrame) {
            // First candidate that still exists wins. All channels of a frame
            // belong to the same moment, so any one of them gives the right location.
            for (const cand of Object.values(oldFrame.channels)) {
                if (!cand) continue;
                const loc = fileToLoc.get(cand.file);
                if (loc) {
                    remapped = loc;
                    break;
                }
            }
        }
        state.active = remapped;
    }

    const newExpanded = new Set<number>();
    for (const oldTripIdx of state.expandedTrips) {
        const oldTrip = oldTrips[oldTripIdx];
        if (!oldTrip) continue;
        // Any candidate from the old trip identifies its new home; if the trip
        // split, we only mark the new trip that absorbed the first frame as
        // expanded - re-expanding both halves would surprise the user.
        outer: for (const frame of oldTrip.frames) {
            for (const cand of Object.values(frame.channels)) {
                if (!cand) continue;
                const loc = fileToLoc.get(cand.file);
                if (loc) {
                    newExpanded.add(loc.trip);
                    break outer;
                }
            }
        }
    }
    state.expandedTrips = newExpanded;
}

/**
 * Rebuilds state.trips from `candidates`: regroup, remap the active/expanded
 * selection onto the new Trip objects, carry previews across so the sidebar does
 * not flash to placeholders, and clear the index-keyed event-cycle cursor. The
 * invariant sequence that must always run together on a regroup; callers add
 * only their own tail (renderTrips vs schedulePopulateTripPreviews).
 */
export function applyRegroup(candidates: VideoCandidate[]): void {
    const oldTrips = state.trips;
    const newTrips = groupTrips(candidates);
    remapActiveAndExpanded(oldTrips, newTrips);
    carryOverTripPreviews(oldTrips, newTrips);
    // The event-cycle cursor is keyed by positional trip index; groupTrips just
    // renumbered every trip, so a surviving cursor would point at a different
    // trip's events (G8). Clear it here so it cannot outlive a regroup.
    clearTripEventCycle();
    state.trips = newTrips;
    // AFTER the trips swap: carryBlurRegions notifies blur listeners, and
    // remapActiveAndExpanded already wrote NEW-array indices into state.active
    // - a notify before the swap would resolve activeTrip() against the OLD
    // array with a NEW index (wrong trip or undefined).
    carryBlurRegions(oldTrips, newTrips);
}
