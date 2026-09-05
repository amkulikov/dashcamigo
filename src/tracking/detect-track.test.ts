import { describe, expect, it } from "vitest";

import { createBlurRegion, regionRectAt } from "../blur-regions.js";
import type { CropRect } from "../transcode/compose.js";
import {
    appendTrackKeyframe,
    type ConfirmOptions,
    finalizeTrack,
    type FinalizeOptions,
    iou,
    isTrackConfirmed,
    matchDetectionsToTracks,
    type TrackAccumulator,
    type TrackKeyframe,
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

function renderedRect(keyframes: TrackKeyframe[], contentSec: number): CropRect {
    const region = createBlurRegion("front", "fill", 0, 100, 0, keyframes[0]!.rect);
    region.keyframes = keyframes.map((keyframe) => ({ ...keyframe, pinned: false }));
    return regionRectAt(region, contentSec)!;
}

describe("appendTrackKeyframe", () => {
    it("covers a small plate throughout a brief lateral reversal", () => {
        const keyframes: TrackKeyframe[] = [];
        const samples = [
            { contentSec: 0, rect: rect(0.5, 0.5, 0.00896, 0.00448) },
            { contentSec: 1 / 15, rect: rect(0.504, 0.5, 0.00896, 0.00448) },
            { contentSec: 2 / 15, rect: rect(0.5, 0.5, 0.00896, 0.00448) },
            { contentSec: 0.2, rect: rect(0.5, 0.5, 0.00896, 0.00448) },
        ];
        for (const sample of samples) appendTrackKeyframe(keyframes, sample.contentSec, sample.rect);
        for (const sample of samples) {
            const cover = renderedRect(keyframes, sample.contentSec);
            expect(cover.xPct, `plate position at ${sample.contentSec}`).toBeCloseTo(sample.rect.xPct);
            expect(cover.wPct).toBeCloseTo(sample.rect.wPct);
        }
    });

    it("preserves small size changes while the target approaches", () => {
        const keyframes: TrackKeyframe[] = [];
        appendTrackKeyframe(keyframes, 0, rect(0.5, 0.5, 0.008, 0.004));
        appendTrackKeyframe(keyframes, 1 / 15, rect(0.499, 0.499, 0.01, 0.006));
        appendTrackKeyframe(keyframes, 2 / 15, rect(0.5, 0.5, 0.008, 0.004));
        const cover = renderedRect(keyframes, 1 / 15);
        expect(cover.wPct).toBeCloseTo(0.01);
        expect(cover.hPct).toBeCloseTo(0.006);
    });

    it("bounds stationary storage without starting subsequent motion early", () => {
        const keyframes: TrackKeyframe[] = [];
        for (let sec = 0; sec <= 60; sec++) appendTrackKeyframe(keyframes, sec, rect(0.5, 0.5));
        expect(keyframes.length).toBeLessThanOrEqual(3);
        appendTrackKeyframe(keyframes, 61, rect(0.6, 0.5));
        expect(renderedRect(keyframes, 59.5).xPct).toBeCloseTo(0.5);
        expect(renderedRect(keyframes, 60).xPct).toBeCloseTo(0.5);
        expect(renderedRect(keyframes, 60.5).xPct).toBeCloseTo(0.55);
    });

    it("keeps the preceding hold when a detector replaces the current tracker box", () => {
        const keyframes: TrackKeyframe[] = [];
        for (let sec = 0; sec <= 60; sec++) appendTrackKeyframe(keyframes, sec, rect(0.5, 0.5));
        appendTrackKeyframe(keyframes, 60, rect(0.6, 0.5));
        expect(renderedRect(keyframes, 59).xPct).toBeCloseTo(0.5);
        expect(renderedRect(keyframes, 59.5).xPct).toBeCloseTo(0.55);
        expect(renderedRect(keyframes, 60).xPct).toBeCloseTo(0.6);
        expect(keyframes.filter((keyframe) => keyframe.contentSec === 60)).toHaveLength(1);
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
