// Unit coverage for the overlay pipeline gates. Both are pure and load-bearing:
// hasAnyOverlay decides whether the whole GPS-overlay pass runs, and
// isFinitePosition is the NaN guard that keeps a lost-fix sample (NaN lat/lon
// from some parsers) out of zoomForDiameterKm / the text widgets, where it would
// render "NaN km/h" and break the map snapshotter's jumpTo.

import { describe, it, expect } from "vitest";

import { hasAnyOverlay, isFinitePosition } from "./overlay-pipeline-helpers.js";
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
