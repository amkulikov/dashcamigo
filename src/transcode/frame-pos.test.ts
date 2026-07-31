// Unit tests for the per-frame telemetry derivation (heading/G/distance). These
// are the pure formulas behind the burned-in compass / G-force / distance /
// graph widgets, so a regression here silently corrupts every export.

import { describe, expect, it } from "vitest";

import type { GpsRecord } from "../parsers/types.js";
import {
    computeCumulativeDistanceM,
    deriveGLat,
    deriveGLong,
    FIX_TOLERANCE_SEC,
    hasFixAt,
    haversineMeters,
    interpScalar,
    recordsHaveAccel,
    resolveFramePos,
    resolveNoFixFramePos,
    sampleSpeedAcross,
} from "./frame-pos.js";

/** Builds a 1 Hz record series. `speed(i)` and `bearing(i)` drive the samples;
 *  lat advances north by ~1 m/sample so distance is well-defined. */
function series(
    n: number,
    opts: { base?: number; speed?: (i: number) => number; bearing?: (i: number) => number; accel?: boolean } = {},
): GpsRecord[] {
    const base = opts.base ?? 1000;
    const out: GpsRecord[] = [];
    for (let i = 0; i < n; i++) {
        out.push({
            unixSeconds: base + i,
            active: true,
            lat: 47 + i * 0.00001, // ~1.11 m north per sample
            lon: 30,
            bearingDeg: opts.bearing ? ((opts.bearing(i) % 360) + 360) % 360 : 0,
            speedMs: opts.speed ? opts.speed(i) : 10,
            accelXg: opts.accel ? 0.2 : 0,
            accelYg: 0,
            accelZg: 0,
            mp4Filename: "A.MP4",
        });
    }
    return out;
}

describe("haversineMeters", () => {
    it("measures ~111 km per degree of latitude", () => {
        const d = haversineMeters(47, 30, 48, 30);
        expect(d).toBeGreaterThan(111_000);
        expect(d).toBeLessThan(111_400);
    });
    it("is zero for identical points", () => {
        expect(haversineMeters(47, 30, 47, 30)).toBe(0);
    });
});

describe("computeCumulativeDistanceM", () => {
    it("is monotonic non-decreasing and starts at 0", () => {
        const recs = series(5);
        const cum = computeCumulativeDistanceM(recs);
        expect(cum).toHaveLength(5);
        expect(cum[0]).toBe(0);
        for (let i = 1; i < cum.length; i++) expect(cum[i]!).toBeGreaterThanOrEqual(cum[i - 1]!);
        expect(cum[4]!).toBeGreaterThan(0);
    });
    it("skips lost-fix / non-finite segments", () => {
        const recs = series(4);
        recs[2]!.active = false;
        recs[2]!.lat = Number.NaN;
        const cum = computeCumulativeDistanceM(recs);
        // segment 1->2 and 2->3 contribute 0; 0->1 contributes the only distance
        expect(cum[1]!).toBeGreaterThan(0);
        expect(cum[2]).toBe(cum[1]);
        expect(cum[3]).toBe(cum[2]);
        expect(Number.isFinite(cum[3]!)).toBe(true);
    });
});

describe("interpScalar", () => {
    it("linearly interpolates between records", () => {
        const recs = series(3); // unix 1000,1001,1002
        const values = [0, 10, 30];
        expect(interpScalar(recs, values, 1000)).toBe(0);
        expect(interpScalar(recs, values, 1000.5)).toBeCloseTo(5, 5);
        expect(interpScalar(recs, values, 1001.5)).toBeCloseTo(20, 5);
    });
    it("clamps to the ends (no tolerance cutoff)", () => {
        const recs = series(3);
        const values = [0, 10, 30];
        expect(interpScalar(recs, values, 900)).toBe(0);
        expect(interpScalar(recs, values, 5000)).toBe(30);
    });
});

describe("deriveGLong", () => {
    it("is positive while accelerating, negative while braking", () => {
        // +2 m/s^2 -> ~0.204 g
        const accel = series(6, { speed: (i) => 10 + 2 * i });
        const g = deriveGLong(accel, 1002);
        expect(g).toBeGreaterThan(0.18);
        expect(g).toBeLessThan(0.23);

        const brake = series(6, { speed: (i) => 30 - 4 * i });
        const gb = deriveGLong(brake, 1002);
        expect(gb).toBeLessThan(-0.35); // ~ -0.408 g
    });
    it("is ~0 at constant speed", () => {
        const flat = series(6, { speed: () => 20 });
        expect(Math.abs(deriveGLong(flat, 1002))).toBeLessThan(1e-6);
    });
});

describe("deriveGLat", () => {
    it("is non-zero when turning at speed, zero when straight", () => {
        const straight = series(6, { speed: () => 20, bearing: () => 90 });
        expect(Math.abs(deriveGLat(straight, 1002))).toBeLessThan(1e-6);

        // 10 deg/s turn at 20 m/s -> ~0.356 g
        const turn = series(6, { speed: () => 20, bearing: (i) => 10 * i });
        const g = deriveGLat(turn, 1002);
        expect(Math.abs(g)).toBeGreaterThan(0.3);
        expect(Math.abs(g)).toBeLessThan(0.42);
    });
    it("handles the 360 wraparound without a spurious spike", () => {
        // heading crossing 350 -> 10 deg is a +20 deg change, not -340
        const wrap = series(6, { speed: () => 20, bearing: (i) => 350 + 10 * i });
        const g = deriveGLat(wrap, 1002);
        expect(Math.abs(g)).toBeLessThan(0.5);
    });
});

describe("sampleSpeedAcross", () => {
    it("returns `count` samples spanning the window", () => {
        const recs = series(11, { speed: (i) => i }); // speed 0..10 over unix 1000..1010
        const s = sampleSpeedAcross(recs, 1000, 1010, 11);
        expect(s).toHaveLength(11);
        expect(s[0]).toBeCloseTo(0, 5);
        expect(s[10]).toBeCloseTo(10, 5);
        expect(s[5]).toBeCloseTo(5, 5);
    });
    it("never returns fewer than 2 samples", () => {
        expect(sampleSpeedAcross(series(3), 1000, 1002, 1)).toHaveLength(2);
    });
});

describe("resolveFramePos", () => {
    const recs = series(6, { speed: (i) => 10 + 2 * i, bearing: () => 90, accel: true });
    const cum = computeCumulativeDistanceM(recs);

    it("subtracts the range-start distance base", () => {
        const base = { lat: 47, lon: 30, speedMs: 14, bearingDeg: 90 };
        const distanceBaseM = interpScalar(recs, cum, 1001);
        const fp = resolveFramePos({
            records: recs,
            base,
            cumulative: cum,
            distanceBaseM,
            frameUtc: 1003,
            progress: 0.5,
        });
        expect(fp.distanceM).toBeCloseTo(interpScalar(recs, cum, 1003) - distanceBaseM, 5);
        expect(fp.distanceM).toBeGreaterThan(0);
    });

    it("clamps progress to 0..1 and carries heading from base", () => {
        const base = { lat: 47, lon: 30, speedMs: 14, bearingDeg: 123 };
        const fp = resolveFramePos({
            records: recs,
            base,
            cumulative: null,
            distanceBaseM: 0,
            frameUtc: 1003,
            progress: 1.7,
        });
        expect(fp.progress).toBe(1);
        expect(fp.headingDeg).toBe(123);
        expect(fp.distanceM).toBe(0); // cumulative null -> distance off
    });

    it("gMag is at least the derived vector magnitude", () => {
        const base = { lat: 47, lon: 30, speedMs: 14, bearingDeg: 90 };
        const fp = resolveFramePos({
            records: recs,
            base,
            cumulative: cum,
            distanceBaseM: 0,
            frameUtc: 1003,
            progress: 0.5,
        });
        expect(fp.gMag).toBeGreaterThanOrEqual(Math.hypot(fp.gLong, fp.gLat) - 1e-9);
    });
});

describe("recordsHaveAccel", () => {
    it("detects a recorded accelerometer", () => {
        expect(recordsHaveAccel(series(3, { accel: true }))).toBe(true);
        expect(recordsHaveAccel(series(3))).toBe(false);
    });
});

describe("hasFixAt", () => {
    it("covers frames near a record and refuses frames outside the tolerance", () => {
        const recs = series(3); // unix 1000..1002
        expect(hasFixAt(recs, 1001), "inside coverage").toBe(true);
        expect(hasFixAt(recs, 1000 - FIX_TOLERANCE_SEC), "warm-up edge, still tolerated").toBe(true);
        expect(hasFixAt(recs, 1000 - FIX_TOLERANCE_SEC - 0.5), "warm-up beyond tolerance").toBe(false);
        expect(hasFixAt(recs, 1002 + FIX_TOLERANCE_SEC + 0.5), "tail beyond tolerance").toBe(false);
        expect(hasFixAt([], 1000), "no records at all").toBe(false);
    });

    it("keeps short interior gaps and rejects the middle of a long one", () => {
        // Records at 1000..1002, then a 20 s hole, then 1022..1024.
        const recs = [...series(3), ...series(3, { base: 1022 })];
        expect(hasFixAt(recs, 1004), "near the gap's left edge").toBe(true);
        expect(hasFixAt(recs, 1012), "middle of a 20 s dropout").toBe(false);
        expect(hasFixAt(recs, 1020), "near the gap's right edge").toBe(true);
    });

    it("ignores active=false records - the receiver's own no-fix markers", () => {
        const recs = series(3).map((r) => ({ ...r, active: false }));
        expect(hasFixAt(recs, 1001)).toBe(false);
    });
});

describe("resolveNoFixFramePos", () => {
    it("keeps the timeline fields real and everything GPS-fed NaN", () => {
        const fp = resolveNoFixFramePos(1234, 0.5);
        expect(fp.hasFix).toBe(false);
        expect(fp.epochSec).toBe(1234);
        expect(fp.progress).toBe(0.5);
        expect(fp.speedMs).toBeNaN();
        expect(fp.lat).toBeNaN();
        expect(fp.distanceM).toBeNaN();
    });

    it("resolveFramePos flags a frame inside a long dropout even with a finite base", () => {
        const recs = [...series(3), ...series(3, { base: 1022 })];
        const base = { lat: 47, lon: 30, speedMs: 10, bearingDeg: 0 };
        const inGap = resolveFramePos({
            records: recs,
            base,
            cumulative: null,
            distanceBaseM: 0,
            frameUtc: 1012,
            progress: 0.5,
        });
        expect(inGap.hasFix, "interpolated straight line across a 20 s hole is not a fix").toBe(false);
        const covered = resolveFramePos({
            records: recs,
            base,
            cumulative: null,
            distanceBaseM: 0,
            frameUtc: 1001,
            progress: 0.1,
        });
        expect(covered.hasFix).toBe(true);
    });
});
