// A marker placed on a lazily-ingested trip BEFORE hydration (the Skip path)
// stores a UTC computed from a filename-guessed startUtc. Once the real
// timeline lands, restampProvisionalMarkers must move the marker with the
// trip - otherwise the wrong absolute time is permanent and flows into the
// notes file.

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Trip, TripTimeline, VideoCandidate } from "../trips.js";

// annotations.ts reaches folder-sources (-> icons/notifications, which want a
// DOM). Only the file->folder lookup is touched here, so stub the module out
// to keep this a node-environment unit test.
vi.mock("./folder-sources.js", () => ({ folderIdForFileKey: () => "" }));

import { _resetForTests, addMarker, markerById, restampProvisionalMarkers } from "./annotations.js";
import { state } from "./state.js";

// One-frame trip whose single candidate carries the hydration flag. The same
// File object is reused across the provisional and hydrated builds - identity
// (relativePath, size, lastModified) is what anchors the marker.
function buildTrip(file: File, startUtc: number, hydrated: boolean): Trip {
    const durationSec = 60;
    const candidate = {
        file,
        relativePath: file.name,
        startUtc,
        durationSec,
        hydrated,
    } as unknown as VideoCandidate;
    const timeline: TripTimeline = {
        contentDurationSec: durationSec,
        segments: [
            {
                contentStart: 0,
                contentEnd: durationSec,
                wallStart: startUtc,
                durationSec,
                wallDurationSec: durationSec,
                frameIndex: 0,
            },
        ],
        gaps: [],
    };
    return {
        frames: [{ startUtc, durationSec, wallDurationSec: durationSec, channels: { front: candidate } }],
        startUtc,
        endUtc: startUtc + durationSec,
        durationSec,
        timeline,
    } as unknown as Trip;
}

const PROVISIONAL_START = 1_700_000_000;
// The camera-TZ-sized error the filename guess is off by.
const HYDRATION_SHIFT_SEC = 3600;

describe("restampProvisionalMarkers", () => {
    beforeEach(() => {
        _resetForTests();
        state.trips = [];
    });

    it("moves a marker placed before hydration onto the re-derived timeline", () => {
        const file = new File(["x"], "REC0001.MP4", { lastModified: 42 });
        const provisional = buildTrip(file, PROVISIONAL_START, false);
        state.trips = [provisional];

        // Marker 30s into the clip, computed against the provisional start.
        const marker = addMarker(provisional, (PROVISIONAL_START + 30) * 1000, "brake");
        expect(marker.utc, "stored with the provisional UTC").toBe((PROVISIONAL_START + 30) * 1000);

        // Hydration: same file, real startUtc an hour later.
        state.trips = [buildTrip(file, PROVISIONAL_START + HYDRATION_SHIFT_SEC, true)];

        expect(restampProvisionalMarkers()).toBe(1);
        expect(markerById(marker.id)?.utc, "follows the clip to its real time").toBe(
            (PROVISIONAL_START + HYDRATION_SHIFT_SEC + 30) * 1000,
        );
    });

    it("bumps updatedAt so the corrected UTC wins the merge over the stale copy", () => {
        const file = new File(["x"], "REC0002.MP4", { lastModified: 42 });
        state.trips = [buildTrip(file, PROVISIONAL_START, false)];
        const marker = addMarker(state.trips[0]!, (PROVISIONAL_START + 10) * 1000, "");
        const originalUpdatedAt = marker.updatedAt;

        state.trips = [buildTrip(file, PROVISIONAL_START + HYDRATION_SHIFT_SEC, true)];
        restampProvisionalMarkers();

        expect(markerById(marker.id)?.updatedAt).toBeGreaterThanOrEqual(originalUpdatedAt);
        expect(markerById(marker.id)?.utc).not.toBe(marker.utc);
    });

    it("leaves a marker on a still-pending clip for a later pass", () => {
        const file = new File(["x"], "REC0003.MP4", { lastModified: 42 });
        state.trips = [buildTrip(file, PROVISIONAL_START, false)];
        const marker = addMarker(state.trips[0]!, (PROVISIONAL_START + 5) * 1000, "");

        // Still not hydrated: nothing moves yet, the anchor survives.
        expect(restampProvisionalMarkers()).toBe(0);

        state.trips = [buildTrip(file, PROVISIONAL_START + HYDRATION_SHIFT_SEC, true)];
        expect(restampProvisionalMarkers(), "the kept anchor applies once terminal").toBe(1);
        expect(markerById(marker.id)?.utc).toBe((PROVISIONAL_START + HYDRATION_SHIFT_SEC + 5) * 1000);
    });

    it("keeps the anchor after a per-trip pass so the closing sweep can move the marker again", () => {
        const file = new File(["x"], "REC0007.MP4", { lastModified: 42 });
        state.trips = [buildTrip(file, PROVISIONAL_START, false)];
        const marker = addMarker(state.trips[0]!, (PROVISIONAL_START + 15) * 1000, "");

        // Per-trip hydration: the clip is terminal, the marker follows it.
        state.trips = [buildTrip(file, PROVISIONAL_START + HYDRATION_SHIFT_SEC, true)];
        expect(restampProvisionalMarkers(), "per-trip pass moves it").toBe(1);

        // The closing regroup reconciles boundaries and shifts the trip again.
        state.trips = [buildTrip(file, PROVISIONAL_START + HYDRATION_SHIFT_SEC + 120, true)];
        expect(restampProvisionalMarkers({ final: true }), "final sweep moves it again").toBe(1);
        expect(markerById(marker.id)?.utc).toBe((PROVISIONAL_START + HYDRATION_SHIFT_SEC + 120 + 15) * 1000);
    });

    it("releases the anchors on the final sweep", () => {
        const file = new File(["x"], "REC0008.MP4", { lastModified: 42 });
        state.trips = [buildTrip(file, PROVISIONAL_START, false)];
        addMarker(state.trips[0]!, (PROVISIONAL_START + 15) * 1000, "");

        state.trips = [buildTrip(file, PROVISIONAL_START + HYDRATION_SHIFT_SEC, true)];
        expect(restampProvisionalMarkers({ final: true })).toBe(1);

        // A regroup after the sweep must not drag the marker along anymore.
        state.trips = [buildTrip(file, PROVISIONAL_START + HYDRATION_SHIFT_SEC + 600, true)];
        expect(restampProvisionalMarkers({ final: true })).toBe(0);
    });

    it("skips the write when the re-derived position is within half a second", () => {
        const file = new File(["x"], "REC0004.MP4", { lastModified: 42 });
        state.trips = [buildTrip(file, PROVISIONAL_START, false)];
        const marker = addMarker(state.trips[0]!, (PROVISIONAL_START + 20) * 1000, "");

        state.trips = [buildTrip(file, PROVISIONAL_START + 0.2, true)];
        expect(restampProvisionalMarkers()).toBe(0);
        expect(markerById(marker.id)?.utc, "sub-threshold drift keeps the stored value").toBe(marker.utc);
    });

    it("does not touch a marker placed on an eager (never-pending) trip", () => {
        const file = new File(["x"], "REC0005.MP4", { lastModified: 42 });
        state.trips = [buildTrip(file, PROVISIONAL_START, true)];
        const marker = addMarker(state.trips[0]!, (PROVISIONAL_START + 30) * 1000, "");

        // Even if the trip is later rebuilt elsewhere, no anchor was captured.
        state.trips = [buildTrip(file, PROVISIONAL_START + HYDRATION_SHIFT_SEC, true)];
        expect(restampProvisionalMarkers()).toBe(0);
        expect(markerById(marker.id)?.utc).toBe((PROVISIONAL_START + 30) * 1000);
    });

    it("drops the anchor when the clip left the session", () => {
        const file = new File(["x"], "REC0006.MP4", { lastModified: 42 });
        state.trips = [buildTrip(file, PROVISIONAL_START, false)];
        addMarker(state.trips[0]!, (PROVISIONAL_START + 30) * 1000, "");

        state.trips = [];
        expect(restampProvisionalMarkers()).toBe(0);
        // A later pass finds nothing to redo - the anchor is gone, not stuck.
        expect(restampProvisionalMarkers()).toBe(0);
    });
});
