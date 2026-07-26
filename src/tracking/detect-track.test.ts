import { describe, expect, it } from "vitest";

import type { CropRect } from "../transcode/compose.js";
import {
    type ConfirmOptions,
    finalizeTrack,
    type FinalizeOptions,
    iou,
    isTrackConfirmed,
    matchDetectionsToTracks,
    shouldEmitKeyframe,
    type TrackAccumulator,
} from "./detect-track.js";

function rect(xPct: number, yPct: number, wPct = 0.04, hPct = 0.02): CropRect {
    return { xPct, yPct, wPct, hPct };
}

const CONFIRM: ConfirmOptions = { confirmMinHits: 2, confirmStrongScore: 0.6, confirmTrackSec: 0.4 };

describe("iou", () => {
    it("is 1 for identical rects and 0 for disjoint ones", () => {
        expect(iou(rect(0.5, 0.5), rect(0.5, 0.5))).toBeCloseTo(1);
        expect(iou(rect(0.1, 0.1), rect(0.8, 0.8))).toBe(0);
    });

    it("is fractional for partial overlap", () => {
        // Two 0.1x0.1 boxes offset by half their width: overlap 0.05x0.1.
        const a: CropRect = { xPct: 0, yPct: 0, wPct: 0.1, hPct: 0.1 };
        const b: CropRect = { xPct: 0.05, yPct: 0, wPct: 0.1, hPct: 0.1 };
        // inter = 0.05*0.1 = 0.005; union = 0.01+0.01-0.005 = 0.015.
        expect(iou(a, b)).toBeCloseTo(0.005 / 0.015);
    });
});

describe("matchDetectionsToTracks", () => {
    it("matches a detection to the overlapping track and flags the rest fresh", () => {
        const dets = [rect(0.5, 0.5), rect(0.2, 0.2)];
        const tracks = [rect(0.505, 0.5)]; // near the first detection, far from the second
        const m = matchDetectionsToTracks(dets, tracks, { minIou: 0.3 });
        expect(m[0]).toBe(0);
        expect(m[1]).toBe(-1);
    });

    it("is one-to-one: a second detection cannot claim an already-taken track", () => {
        const track = rect(0.5, 0.5);
        // Two detections both overlap the one track; only the higher-IoU one wins.
        const dets = [rect(0.51, 0.5), rect(0.5, 0.5)];
        const m = matchDetectionsToTracks(dets, [track], { minIou: 0.3 });
        // The exact-overlap detection (index 1) wins the track; index 0 is fresh.
        expect(m[1]).toBe(0);
        expect(m[0]).toBe(-1);
    });

    it("returns all -1 when nothing clears the IoU gate", () => {
        const m = matchDetectionsToTracks([rect(0.5, 0.5)], [rect(0.9, 0.9)], { minIou: 0.3 });
        expect(m).toEqual([-1]);
    });
});

describe("isTrackConfirmed", () => {
    it("confirms via enough detector hits", () => {
        expect(isTrackConfirmed({ detHits: 2, bestScore: 0.1, trackedGoodSec: 0 }, CONFIRM)).toBe(true);
    });

    it("confirms via one strong hit", () => {
        expect(isTrackConfirmed({ detHits: 1, bestScore: 0.65, trackedGoodSec: 0 }, CONFIRM)).toBe(true);
    });

    it("confirms via a sustained tracker lock (the sparse-discovery corroboration)", () => {
        expect(isTrackConfirmed({ detHits: 1, bestScore: 0.2, trackedGoodSec: 0.5 }, CONFIRM)).toBe(true);
    });

    it("rejects a lone weak detection the tracker could not sustain (flicker)", () => {
        expect(isTrackConfirmed({ detHits: 1, bestScore: 0.2, trackedGoodSec: 0.1 }, CONFIRM)).toBe(false);
    });
});

describe("shouldEmitKeyframe", () => {
    const opts = { minIntervalSec: 0.2, minMovePct: 0.005 };
    it("always emits the first keyframe", () => {
        expect(shouldEmitKeyframe(null, 1.0, rect(0.5, 0.5), opts)).toBe(true);
    });
    it("emits once the interval elapsed even without motion", () => {
        const last = { contentSec: 1.0, rect: rect(0.5, 0.5) };
        expect(shouldEmitKeyframe(last, 1.25, rect(0.5, 0.5), opts)).toBe(true);
    });
    it("emits on meaningful motion inside the interval", () => {
        const last = { contentSec: 1.0, rect: rect(0.5, 0.5) };
        expect(shouldEmitKeyframe(last, 1.05, rect(0.52, 0.5), opts)).toBe(true);
    });
    it("skips a near-still keyframe inside the interval", () => {
        const last = { contentSec: 1.0, rect: rect(0.5, 0.5) };
        expect(shouldEmitKeyframe(last, 1.05, rect(0.5005, 0.5), opts)).toBe(false);
    });
});

const FINALIZE: FinalizeOptions = {
    ...CONFIRM,
    extendBackSec: 0.7,
    extendForwardSec: 0.7,
    clampStartSec: 0,
    clampEndSec: 60,
};

function acc(partial: Partial<TrackAccumulator>): TrackAccumulator {
    return { detHits: 2, bestScore: 0.3, trackedGoodSec: 0.5, keyframes: [], ...partial };
}

describe("finalizeTrack", () => {
    it("drops an unconfirmed track (flicker)", () => {
        const track = finalizeTrack(
            acc({
                detHits: 1,
                bestScore: 0.2,
                trackedGoodSec: 0.1,
                keyframes: [{ contentSec: 1.0, rect: rect(0.5, 0.5) }],
            }),
            FINALIZE,
        );
        expect(track).toBeNull();
    });

    it("holds the edge rects backward and forward, clamped to the interval", () => {
        const track = finalizeTrack(
            acc({
                keyframes: [
                    { contentSec: 1.0, rect: rect(0.5, 0.5) },
                    { contentSec: 1.4, rect: rect(0.55, 0.5) },
                ],
            }),
            FINALIZE,
        );
        expect(track).not.toBeNull();
        // Backward hold at 1.0 - 0.7 = 0.3 with the FIRST rect; forward at 1.4 + 0.7.
        expect(track!.startSec).toBeCloseTo(0.3);
        expect(track!.endSec).toBeCloseTo(2.1);
        expect(track!.keyframes[0]!.rect.xPct).toBeCloseTo(0.5); // held first rect, not moved
        expect(track!.keyframes[track!.keyframes.length - 1]!.rect.xPct).toBeCloseTo(0.55); // held last rect
    });

    it("clamps the backward hold to the interval start", () => {
        const track = finalizeTrack(acc({ keyframes: [{ contentSec: 1.0, rect: rect(0.5, 0.5) }] }), {
            ...FINALIZE,
            clampStartSec: 0.8,
        });
        expect(track!.startSec).toBeCloseTo(0.8); // 1.0 - 0.7 = 0.3, clamped up to 0.8
    });

    it("clamps the forward hold to the interval end", () => {
        const track = finalizeTrack(acc({ keyframes: [{ contentSec: 1.0, rect: rect(0.5, 0.5) }] }), {
            ...FINALIZE,
            clampEndSec: 1.2,
        });
        expect(track!.endSec).toBeCloseTo(1.2); // 1.0 + 0.7 = 1.7, clamped down to 1.2
    });
});
