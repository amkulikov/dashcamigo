// Unit coverage for the overlay pipeline gates. Both are pure and load-bearing:
// hasAnyOverlay decides whether the whole GPS-overlay pass runs, and
// isFinitePosition is the NaN guard that keeps a lost-fix sample (NaN lat/lon
// from some parsers) out of zoomForDiameterKm / the text widgets, where it would
// render "NaN km/h" and break the map snapshotter's jumpTo.

import { describe, it, expect } from "vitest";

import type { GpsRecord } from "../parsers/types.js";
import type { TripTimeline } from "../trips.js";
import {
    createOverlayFrameResolver,
    hasAnyOverlay,
    isFinitePosition,
    recordsInWallWindow,
} from "./overlay-pipeline-helpers.js";
import type { OverlayPipelineArgs } from "./types.js";

// hasAnyOverlay only reads the 8 widget booleans; the rest of OverlayPipelineArgs
// (records, units, fonts, colors) is irrelevant, so a flags-only stub is enough.
const WIDGET_FLAGS = ["speed", "coords", "map", "clock", "compass", "gforce", "distance", "graph"] as const;

function overlaysWith(on: Partial<Record<(typeof WIDGET_FLAGS)[number], boolean>>): OverlayPipelineArgs {
    const base: Record<string, boolean> = {};
    for (const f of WIDGET_FLAGS) base[f] = false;
    return { ...base, ...on } as unknown as OverlayPipelineArgs;
}

describe("hasAnyOverlay", () => {
    it("is false when every widget is off", () => {
        expect(hasAnyOverlay(overlaysWith({}))).toBe(false);
    });

    it("is true if any single widget is on", () => {
        for (const flag of WIDGET_FLAGS) {
            expect(hasAnyOverlay(overlaysWith({ [flag]: true })), `${flag} alone should enable the pass`).toBe(true);
        }
    });
});

describe("isFinitePosition", () => {
    const finite = { lat: 55.75, lon: 37.61, bearingDeg: 90, speedMs: 12 };

    it("accepts a fully finite sample", () => {
        expect(isFinitePosition(finite)).toBe(true);
    });

    it("rejects a NaN in any single field (lost-fix guard)", () => {
        for (const field of ["lat", "lon", "bearingDeg", "speedMs"] as const) {
            expect(isFinitePosition({ ...finite, [field]: Number.NaN }), `NaN ${field} must be rejected`).toBe(false);
        }
    });

    it("rejects Infinity as non-finite too", () => {
        expect(isFinitePosition({ ...finite, lat: Number.POSITIVE_INFINITY })).toBe(false);
        expect(isFinitePosition({ ...finite, speedMs: Number.NEGATIVE_INFINITY })).toBe(false);
    });
});

describe("createOverlayFrameResolver", () => {
    const timeline: TripTimeline = {
        contentDurationSec: 20,
        segments: [
            { contentStart: 0, contentEnd: 10, wallStart: 1000, durationSec: 10, wallDurationSec: 10, frameIndex: 0 },
            { contentStart: 10, contentEnd: 20, wallStart: 1100, durationSec: 10, wallDurationSec: 20, frameIndex: 1 },
        ],
        gaps: [{ contentPos: 10, wallStart: 1010, durationSec: 90 }],
    };
    const record = (unixSeconds: number, overrides: Partial<GpsRecord> = {}): GpsRecord => ({
        unixSeconds,
        active: true,
        lat: 50,
        lon: 8,
        speedMs: 10,
        bearingDeg: 90,
        accelXg: 0,
        accelYg: 0,
        accelZg: 0,
        mp4Filename: "A.MP4",
        ...overrides,
    });
    const gpsRecords = [
        record(1000),
        record(1010),
        record(1100),
        record(1120, { lat: 52, lon: 10, speedMs: 30, bearingDeg: 110 }),
    ];

    it("keeps telemetry on wall time across pauses and timelapse segments", () => {
        const resolve = createOverlayFrameResolver(
            { gpsRecords, cumulativeDistanceM: [0, 100, 200, 400] },
            timeline,
            2,
            18,
        );
        expect(resolve(2).distanceM, "distance begins at the selected range").toBe(0);
        expect(resolve(5).distanceM, "distance before the pause").toBeCloseTo(30);
        const frame = resolve(12.5);
        expect(frame.epochSec, "timelapse footage maps to wall time after the pause").toBe(1105);
        expect(frame.progress, "graph progress includes the pause").toBeCloseTo(103 / 114);
        expect(frame.distanceM, "distance remains relative to the range start").toBeCloseTo(230);
        expect(frame.hasFix).toBe(true);
        expect(frame.lat).toBeCloseTo(50.5);
        expect(frame.lon).toBeCloseTo(8.5);
        expect(frame.speedMs).toBeCloseTo(15);
        expect(frame.headingDeg).toBeCloseTo(95);
    });

    it("resolves telemetry when the distance widget is disabled", () => {
        const resolve = createOverlayFrameResolver({ gpsRecords, cumulativeDistanceM: null }, timeline, 0, 20);
        const frame = resolve(5);
        expect(frame.hasFix).toBe(true);
        expect(frame.distanceM).toBe(0);
        expect(frame.speedMs).toBe(10);
    });

    it("preserves clock and progress when GPS is absent or non-finite", () => {
        for (const records of [[], [record(1105, { lat: Number.NaN, active: false })]]) {
            const resolve = createOverlayFrameResolver(
                { gpsRecords: records, cumulativeDistanceM: null },
                timeline,
                2,
                18,
            );
            const frame = resolve(12.5);
            expect(frame.hasFix).toBe(false);
            expect(frame.epochSec).toBe(1105);
            expect(frame.progress).toBeCloseTo(103 / 114);
            expect(frame.speedMs).toBeNaN();
        }
    });

    it("marks an interpolated position inside a long GPS dropout as no fix", () => {
        const resolve = createOverlayFrameResolver({ gpsRecords, cumulativeDistanceM: null }, timeline, 0, 20);
        const frame = resolve(15);
        expect(frame.epochSec).toBe(1110);
        expect(Number.isFinite(frame.lat), "interpolation alone does not establish GPS coverage").toBe(true);
        expect(frame.hasFix).toBe(false);
    });

    it("keeps progress finite for a zero-length range", () => {
        const resolve = createOverlayFrameResolver({ gpsRecords, cumulativeDistanceM: null }, timeline, 5, 5);
        expect(resolve(5).progress).toBe(0);
    });
});

describe("recordsInWallWindow", () => {
    const rec = (unixSeconds: number): GpsRecord => ({
        unixSeconds,
        active: true,
        lat: 50,
        lon: 8,
        bearingDeg: 0,
        speedMs: 10,
        accelXg: 0,
        accelYg: 0,
        accelZg: 0,
        mp4Filename: "NO20260101-120000-000001F.MP4",
    });
    // 1 Hz track spanning 1000..1099.
    const track = Array.from({ length: 100 }, (_, i) => rec(1000 + i));

    it("keeps only records inside the window plus the margin", () => {
        const got = recordsInWallWindow(track, 1030, 1040, 5);
        expect(got.length).toBe(21);
        expect(got[0]!.unixSeconds).toBe(1025);
        expect(got[got.length - 1]!.unixSeconds).toBe(1045);
    });

    it("includes records exactly on the margin boundary", () => {
        const got = recordsInWallWindow(track, 1050, 1050, 0);
        expect(got.length).toBe(1);
        expect(got[0]!.unixSeconds).toBe(1050);
    });

    it("returns empty when the window misses the track entirely", () => {
        expect(recordsInWallWindow(track, 5000, 6000, 30)).toEqual([]);
    });

    it("preserves source order", () => {
        const got = recordsInWallWindow(track, 1000, 1099, 0);
        expect(got.map((r) => r.unixSeconds)).toEqual(track.map((r) => r.unixSeconds));
    });
});
