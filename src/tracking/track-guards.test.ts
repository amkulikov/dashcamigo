import { describe, expect, it } from "vitest";

import {
    boxVisibleFraction,
    EXIT_VISIBLE_FRACTION,
    isPlausibleStep,
    MAX_BOX_FRAME_FRACTION,
    SEED_CAP_MIN_FRACTION,
    seedSizeCap,
    SIZE_GUARD_WARMUP_FRAMES,
    type TrackBox,
} from "./track-guards.js";

const FRAME_W = 854;
const FRAME_H = 480;
// One analysis step at the worker's 15 fps subsampling - the dt the guards
// most commonly see.
const DT_STEP = 1 / 15;
// Past the warmup, so the size-rate guard is active unless a test says otherwise.
const SETTLED = SIZE_GUARD_WARMUP_FRAMES + 1;
// A roomy cap (whole-vehicle-zone scale) so motion/rate tests exercise only the
// guard under test, never the ceiling.
const ROOMY_CAP = { maxW: FRAME_W * MAX_BOX_FRAME_FRACTION, maxH: FRAME_H * MAX_BOX_FRAME_FRACTION };

function box(x: number, y: number, w: number, h: number): TrackBox {
    return { x, y, w, h };
}

describe("isPlausibleStep", () => {
    const prev = box(400, 220, 60, 40);

    it("accepts a small drift step", () => {
        const cand = box(408, 222, 62, 41);
        expect(isPlausibleStep(prev, cand, ROOMY_CAP, FRAME_W, FRAME_H, SETTLED, DT_STEP)).toBe(true);
    });

    it("accepts fast-but-plausible pass motion (~2.5 frame-widths/sec)", () => {
        // 0.16 of the frame in one 15fps step - the apparent speed of a plate at
        // the closest point of a near pass. Must NOT be rejected.
        const cand = box(prev.x + Math.round(FRAME_W * 0.16), prev.y, prev.w, prev.h);
        expect(isPlausibleStep(prev, cand, ROOMY_CAP, FRAME_W, FRAME_H, SETTLED, DT_STEP)).toBe(true);
    });

    it("rejects an identity-switch jump (30% of the frame in one step)", () => {
        const cand = box(prev.x + Math.round(FRAME_W * 0.3), prev.y, prev.w, prev.h);
        expect(isPlausibleStep(prev, cand, ROOMY_CAP, FRAME_W, FRAME_H, SETTLED, DT_STEP)).toBe(false);
    });

    it("accepts gradual apparent growth of an approaching target", () => {
        const cand = box(prev.x - 5, prev.y - 3, Math.round(prev.w * 1.15), Math.round(prev.h * 1.15));
        expect(isPlausibleStep(prev, cand, ROOMY_CAP, FRAME_W, FRAME_H, SETTLED, DT_STEP)).toBe(true);
    });

    it("rejects a balloon step (1.3x in one 15fps step)", () => {
        const cand = box(prev.x, prev.y, Math.round(prev.w * 1.3), Math.round(prev.h * 1.3));
        expect(isPlausibleStep(prev, cand, ROOMY_CAP, FRAME_W, FRAME_H, SETTLED, DT_STEP)).toBe(false);
    });

    it("rejects a sudden collapse (the mirror of the balloon)", () => {
        const cand = box(prev.x, prev.y, Math.round(prev.w * 0.6), Math.round(prev.h * 0.6));
        expect(isPlausibleStep(prev, cand, ROOMY_CAP, FRAME_W, FRAME_H, SETTLED, DT_STEP)).toBe(false);
    });

    it("tolerates quantization jitter on a plate-sized box", () => {
        // +3px on a 9px-tall box is +33% relative - pure measurement noise, not
        // growth. The relative limit alone would freeze the track here.
        const tinyPrev = box(500, 300, 25, 9);
        const cand = box(501, 300, 27, 12);
        expect(isPlausibleStep(tinyPrev, cand, ROOMY_CAP, FRAME_W, FRAME_H, SETTLED, DT_STEP)).toBe(true);
    });

    it("still rejects a real jump on a plate-sized box past the pixel slack", () => {
        const tinyPrev = box(500, 300, 25, 9);
        const cand = box(498, 297, 32, 15);
        expect(isPlausibleStep(tinyPrev, cand, ROOMY_CAP, FRAME_W, FRAME_H, SETTLED, DT_STEP)).toBe(false);
    });

    it("lets the seed settle: the same size jump passes during warmup", () => {
        const cand = box(prev.x, prev.y, Math.round(prev.w * 1.3), Math.round(prev.h * 1.3));
        expect(isPlausibleStep(prev, cand, ROOMY_CAP, FRAME_W, FRAME_H, SIZE_GUARD_WARMUP_FRAMES, DT_STEP)).toBe(true);
    });

    it("stops a gradual balloon at the seed cap even when each step is slow", () => {
        // The per-step rate guard cannot catch this (1.05x per step); the
        // seed-derived ceiling is what bounds the sum.
        const cap = { maxW: 200, maxH: 100 };
        const bigPrev = box(300, 200, 195, 96);
        const cand = box(297, 199, 205, 100);
        expect(isPlausibleStep(bigPrev, cand, cap, FRAME_W, FRAME_H, SETTLED, DT_STEP)).toBe(false);
    });

    it("applies the cap regardless of warmup", () => {
        const cap = { maxW: 200, maxH: 100 };
        const cand = box(300, 200, 210, 90);
        expect(isPlausibleStep(box(300, 200, 190, 88), cand, cap, FRAME_W, FRAME_H, 1, DT_STEP)).toBe(false);
    });

    it("clamps dt: a long analysis gap does not fully open the center guard", () => {
        // 5s gap, box teleported across two frame widths - still implausible.
        const cand = box(prev.x + FRAME_W * 2, prev.y, prev.w, prev.h);
        expect(isPlausibleStep(prev, cand, ROOMY_CAP, FRAME_W, FRAME_H, SETTLED, 5)).toBe(false);
    });

    it("rejects non-finite and collapsed predictions even during warmup", () => {
        for (const candidate of [
            { ...prev, x: Number.NaN },
            { ...prev, w: Number.POSITIVE_INFINITY },
            { ...prev, w: 0 },
            { ...prev, h: -1 },
        ]) {
            expect(isPlausibleStep(prev, candidate, ROOMY_CAP, FRAME_W, FRAME_H, 1, DT_STEP)).toBe(false);
        }
    });
});

describe("seedSizeCap", () => {
    it("grants a tiny tight seed the physical floor, not 10x of nothing", () => {
        const cap = seedSizeCap(box(0, 0, 8, 4), FRAME_W, FRAME_H);
        expect(cap.maxW).toBeCloseTo(FRAME_W * SEED_CAP_MIN_FRACTION);
        expect(cap.maxH).toBeCloseTo(FRAME_H * SEED_CAP_MIN_FRACTION);
    });

    it("bounds a five-percent seed before it expands beyond fifteen percent", () => {
        const cap = seedSizeCap(box(0, 0, FRAME_W * 0.05, FRAME_H * 0.05), FRAME_W, FRAME_H);
        expect(cap.maxW).toBeCloseTo(FRAME_W * 0.15);
        expect(cap.maxH).toBeCloseTo(FRAME_H * 0.15);
    });

    it("clips a whole-vehicle seed at the frame ceiling", () => {
        const cap = seedSizeCap(box(0, 0, 300, 200), FRAME_W, FRAME_H);
        expect(cap.maxW).toBeCloseTo(FRAME_W * MAX_BOX_FRAME_FRACTION);
        expect(cap.maxH).toBeCloseTo(FRAME_H * MAX_BOX_FRAME_FRACTION);
    });

    it("allows a large manual seed to hold and grow without opening the whole frame", () => {
        const seed = box(100, 80, 500, 300);
        const cap = seedSizeCap(seed, FRAME_W, FRAME_H);
        expect(isPlausibleStep(seed, seed, cap, FRAME_W, FRAME_H, 1, DT_STEP)).toBe(true);
        expect(isPlausibleStep(seed, box(75, 65, 550, 330), cap, FRAME_W, FRAME_H, SETTLED, DT_STEP)).toBe(true);
        expect(isPlausibleStep(seed, box(40, 50, 620, 360), cap, FRAME_W, FRAME_H, 1, 0.5)).toBe(false);
        expect(cap.maxW).toBeLessThan(FRAME_W);
        expect(cap.maxH).toBeLessThan(FRAME_H);
    });

    it("bounds a nearly full-frame seed at the frame dimensions", () => {
        const seed = box(0, 0, 800, 450);
        const cap = seedSizeCap(seed, FRAME_W, FRAME_H);
        expect(cap).toEqual({ maxW: FRAME_W, maxH: FRAME_H });
        expect(isPlausibleStep(seed, seed, cap, FRAME_W, FRAME_H, SETTLED, DT_STEP)).toBe(true);
        expect(isPlausibleStep(seed, box(0, 0, FRAME_W + 1, 450), cap, FRAME_W, FRAME_H, 1, 0.5)).toBe(false);
    });
});

describe("boxVisibleFraction", () => {
    it("is 1 for a box fully inside the frame", () => {
        expect(boxVisibleFraction(box(100, 100, 200, 100), FRAME_W, FRAME_H)).toBe(1);
    });

    it("is 0.5 for a box half slid off the left edge", () => {
        expect(boxVisibleFraction(box(-100, 100, 200, 100), FRAME_W, FRAME_H)).toBeCloseTo(0.5);
    });

    it("is 0.25 for a corner exit (half out on both axes)", () => {
        expect(boxVisibleFraction(box(-100, -50, 200, 100), FRAME_W, FRAME_H)).toBeCloseTo(0.25);
    });

    it("is 0 for a box fully outside the frame", () => {
        expect(boxVisibleFraction(box(FRAME_W + 10, 100, 200, 100), FRAME_W, FRAME_H)).toBe(0);
    });

    it("is 0 for a degenerate box", () => {
        expect(boxVisibleFraction(box(100, 100, 0, 0), FRAME_W, FRAME_H)).toBe(0);
    });

    it("keeps a half-cut plate covered: 0.5 visible is above the exit threshold", () => {
        // Privacy invariant behind EXIT_VISIBLE_FRACTION: a half-visible plate is
        // still readable, the pass must not end there.
        expect(boxVisibleFraction(box(-100, 100, 200, 100), FRAME_W, FRAME_H)).toBeGreaterThan(EXIT_VISIBLE_FRACTION);
    });
});
