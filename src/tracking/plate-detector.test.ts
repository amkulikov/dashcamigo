import { describe, expect, it } from "vitest";

import type { RawDetection } from "./detect-common.js";
import { plateBoxPlausible } from "./plate-detector.js";

function det(x: number, y: number, w: number, h: number): RawDetection {
    return { x, y, w, h, score: 0.3 };
}

// 4K frame - where the whole-car false positives were reported.
const W = 3840;
const H = 2160;

describe("plateBoxPlausible", () => {
    it("passes real plate sizes, up to a very close readable plate", () => {
        expect(plateBoxPlausible(det(1800, 1200, 86, 20), W, H)).toBe(true); // barely readable
        expect(plateBoxPlausible(det(1600, 1400, 400, 90), W, H)).toBe(true); // right behind a car
    });

    it("drops a whole side-on car claimed as one plate", () => {
        // A parked car spans a quarter-plus of the frame width.
        expect(plateBoxPlausible(det(800, 900, 1100, 500), W, H)).toBe(false);
    });

    it("drops a box over the width cap even when its area is small", () => {
        expect(plateBoxPlausible(det(0, 1000, 700, 30), W, H)).toBe(false); // 18% wide sliver
    });

    it("drops a box over the area cap even when its width is under the cap", () => {
        expect(plateBoxPlausible(det(1000, 500, 500, 400), W, H)).toBe(false); // ~2.4% of the frame
    });

    it("degenerate frame dims pass everything through (corroboration owns it)", () => {
        expect(plateBoxPlausible(det(0, 0, 5000, 5000), 0, 0)).toBe(true);
    });
});
