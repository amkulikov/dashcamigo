import { describe, expect, it } from "vitest";
import { haversineKm } from "../../parser.js";
import { estimateSpeedSegments, type SpeedEstimationPoint } from "./position-speed.js";

const START = Date.UTC(2026, 0, 1) / 1000;
const METERS_PER_DEGREE = (6_371_000 * Math.PI) / 180;

function point(seconds: number, meters: number): SpeedEstimationPoint {
    return {
        canEstimateSpeed: true,
        record: {
            unixSeconds: START + seconds,
            active: true,
            lat: 50 + meters / METERS_PER_DEGREE,
            lon: 30,
            speedMs: 0,
            speedSource: "unavailable",
            bearingDeg: 0,
            accelXg: 0,
            accelYg: 0,
            accelZg: 0,
            mp4Filename: "trip.mp4",
        },
    };
}

describe("position speed estimation", () => {
    it.each([0, 0.2, 1.4, 30])("preserves constant motion at %s m/s including the edges", (speed) => {
        const points = Array.from({ length: 12 }, (_, i) => point(i * 2, i * 2 * speed));
        const original = structuredClone(points);
        const records = estimateSpeedSegments(points)[0]!;
        for (const record of records) {
            expect(record.speedSource).toBe("estimated");
            expect(record.speedMs).toBeCloseTo(speed, 6);
        }
        expect(points).toEqual(original);
        expect(records.map(({ lat, lon }) => [lat, lon])).toEqual(points.map(({ record }) => [record.lat, record.lon]));
    });

    it.each([0.5, -0.5])("preserves acceleration of %s m/s² without a half-interval delay", (acceleration) => {
        const times = [0, 0.75, 2, 3.5, 4, 6, 7, 8, 9, 10, 11, 12];
        const points = times.map((t) => point(t, 20 * t + (acceleration * t * t) / 2));
        const records = estimateSpeedSegments(points)[0]!;
        records.forEach((record, i) => {
            expect(record.speedMs, `speed at ${times[i]} s`).toBeCloseTo(20 + acceleration * times[i]!, 5);
        });
    });

    it("rejects isolated acquisition-time errors without requiring paired speed thresholds", () => {
        const points = Array.from({ length: 15 }, (_, i) => {
            const acquisitionTime = 2 * i + (i === 5 ? 1 : i === 9 ? -1 : 0);
            return point(2 * i, 30 * acquisitionTime);
        });
        const records = estimateSpeedSegments(points)[0]!;
        for (const record of records) expect(record.speedMs).toBeCloseTo(30, 5);
    });

    it("retains braking near the end of a track with acquisition-time errors", () => {
        const points = Array.from({ length: 12 }, (_, i) => {
            const t = 2 * i + (i === 5 ? 1 : i === 9 ? -1 : 0);
            return point(2 * i, 30 * t - 0.25 * Math.max(0, t - 16) ** 2);
        });
        const records = estimateSpeedSegments(points)[0]!;
        for (let i = 0; i < records.length; i++) {
            const expected = 30 - 0.5 * Math.max(0, i * 2 - 16);
            expect(Math.abs(records[i]!.speedMs - expected), `speed at ${i * 2} s`).toBeLessThan(0.6);
        }
        expect(records[11]!.speedMs).toBeLessThan(records[10]!.speedMs);
        expect(records[10]!.speedMs).toBeLessThan(records[9]!.speedMs);
    });

    it("follows a tight bend without differentiating a shortcut across it", () => {
        const radius = 50;
        const speed = 15;
        const points = Array.from({ length: 12 }, (_, i) => {
            const angle = (speed * i * 2) / radius;
            const p = point(i * 2, radius * Math.sin(angle));
            p.record.lon += (radius * Math.cos(angle)) / (METERS_PER_DEGREE * Math.cos((50 * Math.PI) / 180));
            return p;
        });
        const records = estimateSpeedSegments(points)[0]!;
        for (const record of records) expect(Math.abs(record.speedMs - speed)).toBeLessThan(0.25);
    });

    it("handles an antimeridian crossing without a longitude discontinuity", () => {
        const points = Array.from({ length: 12 }, (_, i) => {
            const p = point(i * 2, 0);
            p.record.lat = 0;
            p.record.lon = ((179.999 + (i * 2 * 30) / METERS_PER_DEGREE + 180) % 360) - 180;
            return p;
        });
        for (const record of estimateSpeedSegments(points)[0]!) expect(record.speedMs).toBeCloseTo(30, 5);
    });

    it("preserves measured, exported estimated and explicit unavailable values in a fitted window", () => {
        const points = Array.from({ length: 9 }, (_, i) => point(i, i * 20));
        for (const [i, source] of (["measured", "estimated", "unavailable"] as const).entries()) {
            const p = points[i + 3]!;
            p.canEstimateSpeed = false;
            p.record.speedMs = source === "estimated" ? 7 : 0;
            p.record.speedSource = source;
        }
        const records = estimateSpeedSegments(points)[0]!;
        expect(records.slice(3, 6)).toEqual(points.slice(3, 6).map((p) => p.record));
        expect(records[2]!.speedMs).toBeCloseTo(20, 5);
        expect(records[6]!.speedMs).toBeCloseTo(20, 5);
    });

    it("keeps fitting within valid segments after no-fix, reversed-clock and teleport breaks", () => {
        const before = Array.from({ length: 7 }, (_, i) => point(i, i * 30));
        const after = Array.from({ length: 7 }, (_, i) => point(i + 10, 500 + i));
        const expected = estimateSpeedSegments(after)[0]!;
        const withGap = estimateSpeedSegments([...before, null, ...after]);
        expect(withGap).toHaveLength(2);
        expect(withGap[1]).toEqual(expected);
        const withTeleport = estimateSpeedSegments([...before, point(7, 10_000), ...after]);
        expect(withTeleport).toHaveLength(3);
        expect(withTeleport[1]![0]!.speedSource).toBe("unavailable");
        expect(withTeleport[2]).toEqual(expected);
        const reversed = after.map((p) => ({ ...p, record: { ...p.record, unixSeconds: p.record.unixSeconds - 10 } }));
        expect(estimateSpeedSegments([...before, ...reversed])[1]).toEqual(estimateSpeedSegments(reversed)[0]);
    });

    it("does not backfill a sparse gap from the dense run that follows it", () => {
        const points = [point(0, 0), ...Array.from({ length: 7 }, (_, i) => point(60 + i, 600 + 10 * i))];
        const segments = estimateSpeedSegments(points);
        expect(segments).toHaveLength(1);
        expect(segments[0]!.slice(0, 2).map((r) => r.speedSource)).toEqual(["unavailable", "unavailable"]);
        for (const record of segments[0]!.slice(2)) expect(record.speedMs).toBeCloseTo(10, 5);
    });

    it("uses interval speeds when a polynomial would span too much unobserved time", () => {
        const points = Array.from({ length: 7 }, (_, i) => point(i * 10, 100 * i + 10 * i * i));
        const records = estimateSpeedSegments(points)[0]!;
        records.forEach((record, i) => {
            const end = Math.max(1, i);
            expect(record.speedMs).toBeCloseTo((100 + 10 * (2 * end - 1)) / 10, 5);
        });
    });

    it.each([
        { kind: "excessive", meters: [0, 0, 0, 60, 159] },
        { kind: "negative", meters: [0, 99, 110, 111, 112] },
    ])("falls back to the observed interval when an edge derivative is $kind", ({ meters }) => {
        const points = meters.map((distance, i) => point(i, distance));
        const records = estimateSpeedSegments(points)[0]!;
        for (const record of records) {
            expect(record.speedMs).toBeGreaterThanOrEqual(0);
            expect(record.speedMs).toBeLessThanOrEqual(100);
        }
        const a = records[3]!;
        const b = records[4]!;
        expect(b.speedMs).toBeCloseTo(haversineKm(a.lat, a.lon, b.lat, b.lon) * 1000, 6);
    });
});
