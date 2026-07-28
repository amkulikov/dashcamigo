import { describe, expect, it } from "vitest";

import {
    clampManualBitrateMbps,
    MANUAL_BITRATE_MAX_MBPS,
    MANUAL_BITRATE_MIN_MBPS,
    reencodeBitrateForQuality,
} from "./export-bitrate.js";

const FHD_W = 1920;
const FHD_H = 1080;
const UHD_W = 3840;
const UHD_H = 2160;

// A 1080p dashcam's typical recorded rate; the figure the top tier is meant to
// track rather than undercut.
const FHD_SOURCE = 16_000_000;

describe("reencodeBitrateForQuality", () => {
    it("gives the top tier headroom over the source instead of matching it", () => {
        const top = reencodeBitrateForQuality("original", FHD_W, FHD_H, FHD_SOURCE, 30);
        expect(top).toBeGreaterThan(FHD_SOURCE);
    });

    it("floors the top tier at the pixel-area minimum for a thin source", () => {
        // 2 Mbps at 1080p is below the floor even with headroom applied.
        const top = reencodeBitrateForQuality("original", FHD_W, FHD_H, 2_000_000, 30);
        expect(top).toBe(FHD_W * FHD_H * 4);
    });

    it("keeps the 1080p30 ceiling at the historical ~25 Mbps", () => {
        // An absurd source must still be bounded, and bounded where it always was.
        const top = reencodeBitrateForQuality("original", FHD_W, FHD_H, 500_000_000, 30);
        expect(top / 1e6).toBeCloseTo(24.9, 1);
    });

    it("lets 4K exceed the old flat 25 Mbps cap", () => {
        // The regression this whole change is about: a 40 Mbps 4K source used to
        // come out at 25 Mbps because the flat cap sat below the pixel floor.
        const top = reencodeBitrateForQuality("original", UHD_W, UHD_H, 40_000_000, 30);
        expect(top).toBeGreaterThan(25_000_000);
        expect(top).toBeGreaterThan(40_000_000);
    });

    it("never drops 4K below its own pixel-area floor", () => {
        const floor = UHD_W * UHD_H * 4;
        const top = reencodeBitrateForQuality("original", UHD_W, UHD_H, 1_000_000, 30);
        expect(top).toBe(floor);
    });

    it("doubles the budget for a 60 fps source", () => {
        const at30 = reencodeBitrateForQuality("original", FHD_W, FHD_H, 1_000, 30);
        const at60 = reencodeBitrateForQuality("original", FHD_W, FHD_H, 1_000, 60);
        // Source is negligible, so both land on their floor - which is what scales.
        expect(at60).toBe(at30 * 2);
    });

    it("treats an unknown frame rate as the reference rate", () => {
        const known = reencodeBitrateForQuality("original", FHD_W, FHD_H, FHD_SOURCE, 30);
        const unknown = reencodeBitrateForQuality("original", FHD_W, FHD_H, FHD_SOURCE, null);
        expect(unknown).toBe(known);
    });

    it("keeps the size-saver tiers below the source", () => {
        const medium = reencodeBitrateForQuality("medium", FHD_W, FHD_H, FHD_SOURCE, 30);
        const low = reencodeBitrateForQuality("low", FHD_W, FHD_H, FHD_SOURCE, 30);
        expect(medium).toBeLessThan(FHD_SOURCE);
        expect(low).toBeLessThan(medium);
    });

    it("keeps the three tiers monotonic across sources from thin to absurd", () => {
        for (const source of [0, 500_000, 8_000_000, FHD_SOURCE, 60_000_000, 500_000_000]) {
            for (const fps of [24, 30, 60, null]) {
                const top = reencodeBitrateForQuality("original", FHD_W, FHD_H, source, fps);
                const medium = reencodeBitrateForQuality("medium", FHD_W, FHD_H, source, fps);
                const low = reencodeBitrateForQuality("low", FHD_W, FHD_H, source, fps);
                expect(top, `original >= medium at ${source}bps/${fps}fps`).toBeGreaterThanOrEqual(medium);
                expect(medium, `medium >= low at ${source}bps/${fps}fps`).toBeGreaterThanOrEqual(low);
            }
        }
    });

    it("returns the pixel floor when the source could not be measured", () => {
        expect(reencodeBitrateForQuality("original", FHD_W, FHD_H, 0, 30)).toBe(FHD_W * FHD_H * 4);
        expect(reencodeBitrateForQuality("original", FHD_W, FHD_H, Number.NaN, 30)).toBe(FHD_W * FHD_H * 4);
    });
});

describe("clampManualBitrateMbps", () => {
    it("passes a plausible request through", () => {
        expect(clampManualBitrateMbps(32)).toBe(32);
    });

    it("rounds to whole megabits", () => {
        expect(clampManualBitrateMbps(24.4)).toBe(24);
    });

    it("clamps to the allowed range at both ends", () => {
        expect(clampManualBitrateMbps(0.2)).toBe(MANUAL_BITRATE_MIN_MBPS);
        expect(clampManualBitrateMbps(9999)).toBe(MANUAL_BITRATE_MAX_MBPS);
    });

    it("reads an unusable value as auto", () => {
        expect(clampManualBitrateMbps(Number.NaN)).toBeNull();
        expect(clampManualBitrateMbps(0)).toBeNull();
        expect(clampManualBitrateMbps(-5)).toBeNull();
    });
});
