// Regression pin for the basename-keying bug in the regroup remap: a read-only
// backup copy (Viofo RO/) and its Movie/ sibling share a basename but are
// distinct Files in distinct trips. Keying the file-location map by basename let
// one overwrite the other, so remapping state.active / state.expandedTrips after
// a regroup landed on the wrong trip. The fix keys by File identity.

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Trip, VideoCandidate } from "../trips.js";

// apply-regroup pulls in sidebar (-> dom, which needs a DOM at import) and
// trip-preview. Neither is exercised by the pure remap helpers under test, so
// stub them out to keep this a node-environment unit test.
vi.mock("./sidebar.js", () => ({ clearTripEventCycle: () => {} }));
vi.mock("./trip-preview.js", () => ({ carryOverTripPreviews: () => {} }));

import { buildFileLocationMap, remapActiveAndExpanded } from "./apply-regroup.js";
import { state } from "./state.js";

// Minimal candidate/trip: the remap helpers only read frames[].channels[].file.
function cand(file: File): VideoCandidate {
    return { file, relativePath: file.name } as VideoCandidate;
}
function trip(...files: File[]): Trip {
    return { frames: files.map((f) => ({ channels: { front: cand(f) } })) } as unknown as Trip;
}

describe("regroup remap keys by File identity, not basename", () => {
    beforeEach(() => {
        state.trips = [];
        state.active = null;
        state.expandedTrips = new Set();
    });

    it("buildFileLocationMap keeps two same-basename Files as distinct entries", () => {
        const a = new File([], "FILE0001.MP4");
        const b = new File([], "FILE0001.MP4");
        const map = buildFileLocationMap([trip(a), trip(b)]);
        // A basename key would collapse these to one slot (size 1).
        expect(map.size).toBe(2);
        expect(map.get(a)).toEqual({ trip: 0, frame: 0 });
        expect(map.get(b)).toEqual({ trip: 1, frame: 0 });
    });

    it("active selection follows its own File when a same-basename sibling sorts after it", () => {
        const a = new File([], "FILE0001.MP4");
        const b = new File([], "FILE0001.MP4");
        const oldTrips = [trip(a)];
        // a stays at index 0; b (same basename) is a new sibling at index 1. A
        // basename map would record "FILE0001.MP4" -> {trip:1} (last writer wins),
        // yanking the active selection onto b's trip.
        const newTrips = [trip(a), trip(b)];
        state.active = { trip: 0, frame: 0 };

        remapActiveAndExpanded(oldTrips, newTrips);

        expect(state.active).toEqual({ trip: 0, frame: 0 });
    });

    it("expanded set follows its own File across the regroup", () => {
        const a = new File([], "FILE0001.MP4");
        const b = new File([], "FILE0001.MP4");
        const oldTrips = [trip(a)];
        const newTrips = [trip(a), trip(b)];
        state.expandedTrips = new Set([0]);

        remapActiveAndExpanded(oldTrips, newTrips);

        expect([...state.expandedTrips]).toEqual([0]);
    });
});
