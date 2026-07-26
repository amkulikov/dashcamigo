// Pins the distance metric of buildMercatorCumulativeDistances to Web Mercator.
// MapLibre measures line-progress in projected tile units (mercator), so the
// fractions fed to line-gradient stops and the trail veil MUST be computed in
// the same metric. A planar-degrees metric put the veil boundary whole percents
// of track length away from the car marker on mixed-direction routes (verified
// against MapLibre's rendering: a step gradient at the mercator-predicted
// fraction lands exactly on the route corner; a degree-predicted one does not).

import { describe, expect, it } from "vitest";

import type { GpsRecord } from "../parser.js";
import { buildMercatorCumulativeDistances } from "./speed-gradient.js";

/** Minimal record - the helper reads only lat/lon. */
function rec(lat: number, lon: number): GpsRecord {
    return { lat, lon } as GpsRecord;
}

describe("buildMercatorCumulativeDistances", () => {
    it("returns zero totals for empty and single-record input", () => {
        expect(buildMercatorCumulativeDistances([])).toEqual({ cumDist: [], total: 0 });
        expect(buildMercatorCumulativeDistances([rec(55, 30)])).toEqual({ cumDist: [0], total: 0 });
    });

    it("weighs a N-S degree 1/cos(lat) heavier than an E-W degree (mercator, not planar degrees)", () => {
        // L-route at 55°N with legs EQUAL IN DEGREES: 0.1° east, then 0.1° north.
        // Planar degrees would put the corner at fraction 0.5; mercator puts it
        // at legEW / (legEW + legNS/cos(55°)) ~= 0.365 - which is where MapLibre
        // actually renders line-progress 0.365 (the corner of the drawn line).
        const { cumDist, total } = buildMercatorCumulativeDistances([
            rec(55.0, 30.0),
            rec(55.0, 30.1),
            rec(55.1, 30.1),
        ]);
        const cornerFraction = cumDist[1]! / total;
        // 0.1 / (0.1 + (mercY(55.1)-mercY(55.0))) with the exact projection;
        // 4 decimal places separates it cleanly from both the planar-degree 0.5
        // and any accidental cos-at-wrong-latitude variant.
        expect(cornerFraction).toBeCloseTo(0.36422, 4);
        expect(cornerFraction).not.toBeCloseTo(0.5, 1);
    });

    it("gives zero length to repeated coordinates (deduped-line totals stay equal)", () => {
        // refreshMap builds the trail over activeRecs (with stationary
        // duplicates) but the line geometry over dedupedRecs; the fractions only
        // stay interchangeable if duplicate segments measure exactly 0.
        const withDups = buildMercatorCumulativeDistances([
            rec(55.0, 30.0),
            rec(55.0, 30.0),
            rec(55.05, 30.1),
            rec(55.05, 30.1),
            rec(55.1, 30.0),
        ]);
        const deduped = buildMercatorCumulativeDistances([rec(55.0, 30.0), rec(55.05, 30.1), rec(55.1, 30.0)]);
        expect(withDups.total).toBe(deduped.total);
        expect(withDups.cumDist[1]).toBe(0);
    });

    it("clamps poles instead of producing Infinity", () => {
        const { total } = buildMercatorCumulativeDistances([rec(-90, 0), rec(90, 0)]);
        expect(Number.isFinite(total)).toBe(true);
        expect(total).toBeGreaterThan(0);
    });
});
