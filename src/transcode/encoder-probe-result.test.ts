import { describe, expect, it } from "vitest";
import {
    isEncoderBitrateSuspicious,
    luminanceSquaredError,
    shouldUseSoftwareEncoder,
    type EncoderProbeMeasurement,
} from "./encoder-probe-result.js";

const standard: EncoderProbeMeasurement = {
    bitrate: 4_000_000,
    frames: 50,
    expectedFrames: 50,
    duration: 2,
    elapsedMs: 1000,
    psnr: 23,
};
const software: EncoderProbeMeasurement = { ...standard, bitrate: 32_000_000, elapsedMs: 5000, psnr: 34 };

describe("encoder selection evidence", () => {
    it("selects software after severe undershoot and confirmed loss of detail regardless of speed", () => {
        expect(shouldUseSoftwareEncoder(standard, software, 32_000_000)).toBe(true);
        expect(shouldUseSoftwareEncoder(standard, { ...software, elapsedMs: 100_000 }, 32_000_000)).toBe(true);
    });

    it("keeps efficient output when its image retains detail despite a low bitrate", () => {
        expect(isEncoderBitrateSuspicious(standard, 32_000_000)).toBe(true);
        expect(shouldUseSoftwareEncoder({ ...standard, psnr: 40 }, { ...software, psnr: 44 }, 32_000_000)).toBe(false);
        expect(shouldUseSoftwareEncoder({ ...standard, bitrate: 30_000_000 }, software, 32_000_000)).toBe(false);
    });

    it("requires a meaningful quality improvement and a usable output size", () => {
        expect(shouldUseSoftwareEncoder(standard, { ...software, psnr: 24 }, 32_000_000)).toBe(false);
        expect(shouldUseSoftwareEncoder(standard, { ...software, bitrate: 60_000_000 }, 32_000_000)).toBe(false);
        expect(shouldUseSoftwareEncoder(standard, { ...software, bitrate: 8_000_000 }, 32_000_000)).toBe(false);
    });

    it("retains the default when frames or reliable quality measurements are missing", () => {
        for (const change of [{ frames: 49 }, { duration: 0 }, { psnr: null }, { psnr: Number.NaN }, { bitrate: 0 }]) {
            expect(shouldUseSoftwareEncoder({ ...standard, ...change }, software, 32_000_000)).toBe(false);
            expect(shouldUseSoftwareEncoder(standard, { ...software, ...change }, 32_000_000)).toBe(false);
        }
    });
});

describe("luminance error", () => {
    it("preserves an exact match and ignores the unused alpha channel", () => {
        expect(
            luminanceSquaredError(new Uint8ClampedArray([20, 30, 40, 255]), new Uint8ClampedArray([20, 30, 40, 0])),
        ).toBe(0);
    });

    it("measures missing fine detail even when average brightness is unchanged", () => {
        expect(
            luminanceSquaredError(
                new Uint8ClampedArray([90, 90, 90, 255, 110, 110, 110, 255]),
                new Uint8ClampedArray([100, 100, 100, 255, 100, 100, 100, 255]),
            ),
        ).toBeCloseTo(100);
    });
});
