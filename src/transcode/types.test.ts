// Unit tests for the pure pipeline math in types.ts: clampSpeedFactor,
// framesForSpeed (timelapse frame budget), aspectRatio, ensureEven,
// resolveBitrate. No WebCodecs / mediabunny involved - these are plain numbers.

import { describe, expect, it } from "vitest";

import { aspectRatio, clampSpeedFactor, ensureEven, framesForSpeed, resolveBitrate } from "./types.js";

describe("clampSpeedFactor", () => {
    it("passes valid integer factors through", () => {
        expect(clampSpeedFactor(1)).toBe(1);
        expect(clampSpeedFactor(8)).toBe(8);
        expect(clampSpeedFactor(32)).toBe(32);
    });

    it("rounds fractional input to the nearest integer", () => {
        // A fractional factor would desync the frame-drop modulo and timestamp
        // division; round to a usable integer.
        expect(clampSpeedFactor(2.4)).toBe(2);
        expect(clampSpeedFactor(2.6)).toBe(3);
    });

    it("floors anything below 1 / non-finite to 1 (real time)", () => {
        expect(clampSpeedFactor(0)).toBe(1);
        expect(clampSpeedFactor(0.5)).toBe(1);
        expect(clampSpeedFactor(-4)).toBe(1);
        expect(clampSpeedFactor(Number.NaN)).toBe(1);
        expect(clampSpeedFactor(Number.POSITIVE_INFINITY)).toBe(1);
    });
});

describe("framesForSpeed", () => {
    it("at 1x equals full frame count (sec * fps)", () => {
        expect(framesForSpeed(10, 30, 1)).toBe(300);
    });

    it("divides the frame budget by the factor (timelapse keeps every Nth)", () => {
        expect(framesForSpeed(60, 30, 8)).toBe(225); // 1800 / 8
        expect(framesForSpeed(60, 30, 32)).toBe(56); // round(1800 / 32) = 56
    });

    it("never returns less than 1 (so ETA never divides by zero)", () => {
        expect(framesForSpeed(0, 30, 1)).toBe(1);
        expect(framesForSpeed(0.001, 30, 32)).toBe(1);
    });

    it("clamps a bad factor to real time before dividing", () => {
        expect(framesForSpeed(10, 30, 0)).toBe(300);
        expect(framesForSpeed(10, 30, Number.NaN)).toBe(300);
    });
});

describe("aspectRatio", () => {
    it("parses string presets", () => {
        expect(aspectRatio("16:9")).toBeCloseTo(16 / 9);
        expect(aspectRatio("1:1")).toBe(1);
    });

    it("computes custom dims", () => {
        expect(aspectRatio({ kind: "custom", w: 1920, h: 1080 })).toBeCloseTo(16 / 9);
    });

    it("throws on a zero-height custom aspect", () => {
        expect(() => aspectRatio({ kind: "custom", w: 100, h: 0 })).toThrow();
    });
});

describe("ensureEven", () => {
    it("keeps even, bumps odd up by one (H.264 needs even dims)", () => {
        expect(ensureEven(1080)).toBe(1080);
        expect(ensureEven(607)).toBe(608);
        expect(ensureEven(607.5)).toBe(608);
    });
});

describe("resolveBitrate", () => {
    it("is 4 bps/pixel of the output area", () => {
        expect(resolveBitrate(1920, 1080)).toBe(1920 * 1080 * 4);
    });
});
