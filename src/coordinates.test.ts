import { describe, expect, it } from "vitest";
import { projectTrackToViewport, unwrapLongitude, unwrapTrackCoordinates, wrapDegrees } from "./coordinates.js";

describe("longitude wrapping", () => {
    it("takes the short arc in both directions across the antimeridian", () => {
        expect(unwrapLongitude(-179, 179)).toBe(181);
        expect(unwrapLongitude(179, -179)).toBe(-181);
        expect(wrapDegrees(359)).toBe(-1);
        expect(wrapDegrees(-359)).toBe(1);
    });

    it("keeps repeated crossings in a continuous world copy without mutating input", () => {
        const coords: [number, number][] = [
            [179, 50],
            [-179, 50],
            [179, 51],
            [-179, 51],
        ];
        expect(unwrapTrackCoordinates(coords)).toEqual([
            [179, 50],
            [181, 50],
            [179, 51],
            [181, 51],
        ]);
        expect(coords[1]![0]).toBe(-179);
    });
});

describe("projectTrackToViewport", () => {
    it("keeps an equatorial square square and puts north above south", () => {
        const points = projectTrackToViewport(
            [
                [0, 0],
                [1, 0],
                [1, 1],
            ],
            640,
            360,
            36,
        );
        const east = points[1]![0] - points[0]![0];
        const north = points[1]![1] - points[2]![1];
        expect(east / north).toBeCloseTo(1, 3);
        expect(points[2]![1]).toBeCloseTo(36);
        expect(points[0]![1]).toBeCloseTo(324);
    });

    it("fits a crossing route exactly like the equivalent unwrapped route", () => {
        const crossing = projectTrackToViewport(
            [
                [179, 50],
                [-179, 51],
            ],
            640,
            360,
            36,
        );
        const unwrapped = projectTrackToViewport(
            [
                [179, 50],
                [181, 51],
            ],
            640,
            360,
            36,
        );
        expect(crossing).toEqual(unwrapped);
        expect(crossing[1]![0]).toBeGreaterThan(crossing[0]![0]);
    });

    it("centers stationary routes and accepts empty routes", () => {
        expect(projectTrackToViewport([], 640, 360, 36)).toEqual([]);
        expect(
            projectTrackToViewport(
                [
                    [30, 50],
                    [30, 50],
                ],
                640,
                360,
                36,
            ),
        ).toEqual([
            [320, 180],
            [320, 180],
        ]);
    });
});
