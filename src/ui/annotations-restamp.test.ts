// A marker placed before recording metadata is ready stores a UTC computed
// from a filename-derived startUtc. Once the measured
// timeline lands, restampProvisionalMarkers must move the marker with the
// trip - otherwise the wrong absolute time is permanent and flows into the
// notes file.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { fileIdentityKey } from "../persist/identity.js";
import { tripAllCandidates, type Trip, type TripTimeline, type VideoCandidate } from "../trips.js";
import { vendorFileKey } from "../vendor-file-key.js";

// annotations.ts reaches folder-sources (-> icons/notifications, which want a
// DOM). Only the file->folder lookup is touched here, so stub the module out
// to keep this a node-environment unit test.
vi.mock("./folder-sources.js", () => ({
    folderIdForFileKey: (_identityKey: string, sourceKey?: string) => (sourceKey ? `folder-${sourceKey}` : ""),
}));

import { _resetForTests, addMarker, markerById, markersForTrip, restampProvisionalMarkers } from "./annotations.js";
import { state } from "./state.js";

// One-frame trip whose single candidate carries the metadata read flag. The same
// File object is reused across the provisional and metadata-ready builds - identity
// (relativePath, size, lastModified) is what anchors the marker.
function buildTrip(file: File, startUtc: number, metadataReady: boolean, sourceKey?: string): Trip {
    const durationSec = 60;
    const candidate = {
        file,
        relativePath: file.name,
        startUtc,
        durationSec,
        metadataReady,
        ...(sourceKey === undefined ? {} : { sourceKey }),
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

function buildTwoFrameTrip(firstFile: File, secondFile: File, startUtc: number, secondStartOffsetSec = 60): Trip {
    const durationSec = 60;
    const first = {
        file: firstFile,
        relativePath: `CARD/${firstFile.name}`,
        sourceKey: "a",
        startUtc,
        durationSec,
        metadataReady: true,
    } as unknown as VideoCandidate;
    const second = {
        file: secondFile,
        relativePath: `CARD/${secondFile.name}`,
        sourceKey: "b",
        startUtc: startUtc + secondStartOffsetSec,
        durationSec,
        metadataReady: true,
    } as unknown as VideoCandidate;
    const timeline: TripTimeline = {
        contentDurationSec: durationSec * 2,
        segments: [
            {
                contentStart: 0,
                contentEnd: durationSec,
                wallStart: startUtc,
                durationSec,
                wallDurationSec: durationSec,
                frameIndex: 0,
            },
            {
                contentStart: durationSec,
                contentEnd: durationSec * 2,
                wallStart: startUtc + secondStartOffsetSec,
                durationSec,
                wallDurationSec: durationSec,
                frameIndex: 1,
            },
        ],
        gaps: [],
    };
    return {
        frames: [
            { startUtc, durationSec, wallDurationSec: durationSec, channels: { front: first } },
            {
                startUtc: startUtc + secondStartOffsetSec,
                durationSec,
                wallDurationSec: durationSec,
                channels: { front: second },
            },
        ],
        startUtc,
        endUtc: startUtc + secondStartOffsetSec + durationSec,
        durationSec: secondStartOffsetSec + durationSec,
        timeline,
    } as unknown as Trip;
}

const PROVISIONAL_START = 1_700_000_000;
// The camera-TZ-sized error the filename guess is off by.
const CLOCK_REFINEMENT_SHIFT_SEC = 3600;

describe("restampProvisionalMarkers", () => {
    beforeEach(() => {
        _resetForTests();
        state.trips = [];
        state.pendingHeavyEmbeddedGps.clear();
        state.inflightEmbeddedGps.clear();
    });

    it("moves a marker placed before metadata read onto the re-derived timeline", () => {
        const file = new File(["x"], "REC0001.MP4", { lastModified: 42 });
        const provisional = buildTrip(file, PROVISIONAL_START, false);
        state.trips = [provisional];

        // Marker 30s into the clip, computed against the provisional start.
        const marker = addMarker(provisional, (PROVISIONAL_START + 30) * 1000, "brake");
        expect(marker.utc, "stored with the provisional UTC").toBe((PROVISIONAL_START + 30) * 1000);

        // Metadata read: same file, real startUtc an hour later.
        state.trips = [buildTrip(file, PROVISIONAL_START + CLOCK_REFINEMENT_SHIFT_SEC, true)];

        expect(restampProvisionalMarkers()).toBe(1);
        expect(markerById(marker.id)?.utc, "follows the clip to its real time").toBe(
            (PROVISIONAL_START + CLOCK_REFINEMENT_SHIFT_SEC + 30) * 1000,
        );
    });

    it("bumps updatedAt so the corrected UTC wins the merge over the stale copy", () => {
        const file = new File(["x"], "REC0002.MP4", { lastModified: 42 });
        state.trips = [buildTrip(file, PROVISIONAL_START, false)];
        const marker = addMarker(state.trips[0]!, (PROVISIONAL_START + 10) * 1000, "");
        const originalUpdatedAt = marker.updatedAt;

        state.trips = [buildTrip(file, PROVISIONAL_START + CLOCK_REFINEMENT_SHIFT_SEC, true)];
        restampProvisionalMarkers();

        expect(markerById(marker.id)?.updatedAt).toBeGreaterThanOrEqual(originalUpdatedAt);
        expect(markerById(marker.id)?.utc).not.toBe(marker.utc);
    });

    it("leaves a marker on a still-pending clip for a later pass", () => {
        const file = new File(["x"], "REC0003.MP4", { lastModified: 42 });
        state.trips = [buildTrip(file, PROVISIONAL_START, false)];
        const marker = addMarker(state.trips[0]!, (PROVISIONAL_START + 5) * 1000, "");

        // Metadata is still pending: nothing moves yet, the anchor survives.
        expect(restampProvisionalMarkers()).toBe(0);

        state.trips = [buildTrip(file, PROVISIONAL_START + CLOCK_REFINEMENT_SHIFT_SEC, true)];
        expect(restampProvisionalMarkers(), "the kept anchor applies once terminal").toBe(1);
        expect(markerById(marker.id)?.utc).toBe((PROVISIONAL_START + CLOCK_REFINEMENT_SHIFT_SEC + 5) * 1000);
    });

    it("keeps the anchor after a per-trip pass so the closing sweep can move the marker again", () => {
        const file = new File(["x"], "REC0007.MP4", { lastModified: 42 });
        state.trips = [buildTrip(file, PROVISIONAL_START, false)];
        const marker = addMarker(state.trips[0]!, (PROVISIONAL_START + 15) * 1000, "");

        // Per-trip metadata read: the clip is terminal, the marker follows it.
        state.trips = [buildTrip(file, PROVISIONAL_START + CLOCK_REFINEMENT_SHIFT_SEC, true)];
        expect(restampProvisionalMarkers(), "per-trip pass moves it").toBe(1);

        // The closing regroup reconciles boundaries and shifts the trip again.
        state.trips = [buildTrip(file, PROVISIONAL_START + CLOCK_REFINEMENT_SHIFT_SEC + 120, true)];
        expect(restampProvisionalMarkers({ final: true }), "final sweep moves it again").toBe(1);
        expect(markerById(marker.id)?.utc).toBe((PROVISIONAL_START + CLOCK_REFINEMENT_SHIFT_SEC + 120 + 15) * 1000);
    });

    it("releases the anchors on the final sweep", () => {
        const file = new File(["x"], "REC0008.MP4", { lastModified: 42 });
        state.trips = [buildTrip(file, PROVISIONAL_START, false)];
        addMarker(state.trips[0]!, (PROVISIONAL_START + 15) * 1000, "");

        state.trips = [buildTrip(file, PROVISIONAL_START + CLOCK_REFINEMENT_SHIFT_SEC, true)];
        expect(restampProvisionalMarkers({ final: true })).toBe(1);

        // A regroup after the sweep must not drag the marker along anymore.
        state.trips = [buildTrip(file, PROVISIONAL_START + CLOCK_REFINEMENT_SHIFT_SEC + 600, true)];
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

    it("projects a restored marker's persistent anchor onto the current timeline", () => {
        const file = new File(["x"], "REC0005.MP4", { lastModified: 42 });
        state.trips = [buildTrip(file, PROVISIONAL_START, true)];
        const marker = addMarker(state.trips[0]!, (PROVISIONAL_START + 30) * 1000, "");

        // A fully-ready marker has no provisional session entry. Its persistent
        // anchor still has to survive a later restore/parser clock shift.
        const shifted = buildTrip(file, PROVISIONAL_START + CLOCK_REFINEMENT_SHIFT_SEC, true);
        state.trips = [shifted];
        expect(restampProvisionalMarkers()).toBe(0);
        expect(markersForTrip(shifted)[0]?.utc).toBe((PROVISIONAL_START + CLOCK_REFINEMENT_SHIFT_SEC + 30) * 1000);
        expect(markerById(marker.id)?.utc, "stored UTC stays available as a legacy fallback").toBe(
            (PROVISIONAL_START + 30) * 1000,
        );
    });

    it("anchors an exact clip boundary to the following clip and its folder", () => {
        const firstFile = new File(["a"], "REC0010.MP4", { lastModified: 42 });
        const secondFile = new File(["b"], "REC0011.MP4", { lastModified: 43 });
        const trip = buildTwoFrameTrip(firstFile, secondFile, PROVISIONAL_START);
        state.trips = [trip];

        const marker = addMarker(trip, (PROVISIONAL_START + 60) * 1000, "boundary");

        expect(marker.anchor).toEqual({
            fileIdentityKey: fileIdentityKey({
                relativePath: `CARD/${secondFile.name}`,
                size: secondFile.size,
                lastModified: secondFile.lastModified,
            }),
            startUtc: (PROVISIONAL_START + 60) * 1000,
            offsetSec: 0,
        });
        expect(marker.folderId, "the sidecar follows the clip under the playhead").toBe("folder-b");
    });

    it("recovers a later clip after regrouping and a recording-root rename", () => {
        const firstFile = new File(["a"], "REC0013.MP4", { lastModified: 42 });
        const secondFile = new File(["b"], "REC0014.MP4", { lastModified: 43 });
        const original = buildTwoFrameTrip(firstFile, secondFile, PROVISIONAL_START, 600);
        state.trips = [original];
        const marker = addMarker(original, (PROVISIONAL_START + 630) * 1000, "later clip");
        expect(marker.anchor?.startUtc, "the anchor stores its clip start, not the old trip start").toBe(
            (PROVISIONAL_START + 600) * 1000,
        );

        const split = buildTrip(secondFile, PROVISIONAL_START + 600, true, "b");
        tripAllCandidates(split)[0]!.relativePath = `RENAMED/${secondFile.name}`;
        state.trips = [split];

        expect(markersForTrip(split).map((item) => item.id)).toEqual([marker.id]);
    });

    it("keeps a clip anchor until deferred GPS clock evidence settles", () => {
        const file = new File(["x"], "REC0009.MP4", { lastModified: 42 });
        const initial = buildTrip(file, PROVISIONAL_START, true);
        const candidate = tripAllCandidates(initial)[0]!;
        state.trips = [initial];
        state.pendingHeavyEmbeddedGps.set(vendorFileKey(candidate), {} as never);
        const marker = addMarker(initial, (PROVISIONAL_START + 12) * 1000, "");

        state.pendingHeavyEmbeddedGps.clear();
        const refined = buildTrip(file, PROVISIONAL_START + CLOCK_REFINEMENT_SHIFT_SEC, true);
        state.trips = [refined];
        expect(restampProvisionalMarkers({ final: true, finalCandidates: tripAllCandidates(refined) })).toBe(1);
        expect(markerById(marker.id)?.utc).toBe((PROVISIONAL_START + CLOCK_REFINEMENT_SHIFT_SEC + 12) * 1000);
    });

    it("re-stamps against the physical source when two cards contain an identical clip", () => {
        const file = new File(["same"], "REC0012.MP4", { lastModified: 42 });
        const first = buildTrip(file, PROVISIONAL_START, false, "a");
        const second = buildTrip(file, PROVISIONAL_START + 600, false, "b");
        state.trips = [first, second];
        const marker = addMarker(second, (PROVISIONAL_START + 630) * 1000, "second card");

        const readyFirst = buildTrip(file, PROVISIONAL_START + 120, true, "a");
        const readySecond = buildTrip(file, PROVISIONAL_START + 1200, true, "b");
        state.trips = [readyFirst, readySecond];

        expect(restampProvisionalMarkers({ final: true })).toBe(1);
        expect(markerById(marker.id)?.utc, "must follow card B, not the first identical clip").toBe(
            (PROVISIONAL_START + 1230) * 1000,
        );
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
