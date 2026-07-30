// Unit coverage for the overlay pipeline gates. Both are pure and load-bearing:
// hasAnyOverlay decides whether the whole GPS-overlay pass runs, and
// isFinitePosition is the NaN guard that keeps a lost-fix sample (NaN lat/lon
// from some parsers) out of zoomForDiameterKm / the text widgets, where it would
// render "NaN km/h" and break the map snapshotter's jumpTo.

import { describe, it, expect } from "vitest";

import type { GpsRecord } from "../parsers/types.js";
import { hasAnyOverlay, isFinitePosition, recordsInWallWindow } from "./overlay-pipeline-helpers.js";
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
