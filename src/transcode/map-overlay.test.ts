// coverFit is the center-crop math behind the map-overlay minimap (and the same
// cover-fit contract every widget slot relies on). It is pure and canvas-free,
// so a headless unit lock guards the geometry that only the local VRT suite
// otherwise exercises.

import { describe, it, expect } from "vitest";

import { _internal } from "./map-overlay.js";

const { coverFit } = _internal;

describe("coverFit", () => {
    it("returns the full source rect when aspects already match", () => {
        expect(coverFit(100, 100, 50, 50)).toEqual({ sx: 0, sy: 0, sw: 100, sh: 100 });
    });

    it("crops width symmetrically when the source is too wide for the slot", () => {
        // 200x100 source into a 100x100 (1:1) slot: keep height, crop width to
        // 100, offset half the excess (50) on the left.
        expect(coverFit(200, 100, 100, 100)).toEqual({ sx: 50, sy: 0, sw: 100, sh: 100 });
    });

    it("crops height symmetrically when the source is too tall for the slot", () => {
        // 100x200 into 100x100: keep width, crop height to 100, offset 50 on top.
        expect(coverFit(100, 200, 100, 100)).toEqual({ sx: 0, sy: 50, sw: 100, sh: 100 });
    });

    it("keeps the visible rect's aspect equal to the destination aspect", () => {
        const dstAspect = 16 / 9;
        const r = coverFit(1920, 1080, 320, 180);
        expect(r.sw / r.sh).toBeCloseTo(dstAspect, 5);
    });

    it("degenerate (non-positive) dimensions fall back to the source rect, never NaN", () => {
        expect(coverFit(0, 100, 50, 50)).toEqual({ sx: 0, sy: 0, sw: 0, sh: 100 });
        expect(coverFit(100, 100, 0, 50)).toEqual({ sx: 0, sy: 0, sw: 100, sh: 100 });
    });
});
