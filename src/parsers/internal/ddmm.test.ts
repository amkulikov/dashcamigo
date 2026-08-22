import { describe, expect, it } from "vitest";

import { ddmmToDegrees, isCoordinateInRange } from "./ddmm.js";

describe("ddmmToDegrees", () => {
    it("converts valid signed coordinates", () => {
        expect(ddmmToDegrees(5228.16177)).toBeCloseTo(52 + 28.16177 / 60, 7);
        expect(ddmmToDegrees(-12345.6789)).toBeCloseTo(-(123 + 45.6789 / 60), 7);
    });

    it("rejects an impossible minute field", () => {
        expect(ddmmToDegrees(1260)).toBeNaN();
        expect(ddmmToDegrees(9999.9999)).toBeNaN();
    });
});

describe("isCoordinateInRange", () => {
    it("uses axis-specific world bounds", () => {
        expect(isCoordinateInRange(90, "lat")).toBe(true);
        expect(isCoordinateInRange(90.0001, "lat")).toBe(false);
        expect(isCoordinateInRange(-180, "lon")).toBe(true);
        expect(isCoordinateInRange(-180.0001, "lon")).toBe(false);
    });
});
