import { describe, expect, it } from "vitest";

import {
    iouOf,
    packRgbPlanarNormalized,
    type RawDetection,
    suppressOverlaps,
    tileGridSize,
    tileRects,
} from "./detect-common.js";

function det(x: number, y: number, w: number, h: number, score: number): RawDetection {
    return { x, y, w, h, score };
}

describe("tileGridSize", () => {
    it("scales with source width: 4K->3, 2.5K/1080p->2, SD->1", () => {
        expect(tileGridSize(3840)).toBe(3);
        expect(tileGridSize(2560)).toBe(2);
        expect(tileGridSize(1920)).toBe(2);
        expect(tileGridSize(1280)).toBe(1);
        expect(tileGridSize(848)).toBe(1);
    });

    it("degenerate width falls back to a single tile", () => {
        expect(tileGridSize(0)).toBe(1);
        expect(tileGridSize(Number.NaN)).toBe(1);
    });
});

describe("tileRects", () => {
    it("covers the full frame including edges", () => {
        const tiles = tileRects(3840, 2160);
        expect(tiles).toHaveLength(9);
        const maxRight = Math.max(...tiles.map((t) => t.sx + t.sw));
        const maxBottom = Math.max(...tiles.map((t) => t.sy + t.sh));
        expect(maxRight).toBe(3840);
        expect(maxBottom).toBe(2160);
        for (const t of tiles) {
            expect(t.sx).toBeGreaterThanOrEqual(0);
            expect(t.sy).toBeGreaterThanOrEqual(0);
        }
    });

    it("neighbor tiles overlap so seam objects are fully inside one tile", () => {
        const tiles = tileRects(3840, 2160);
        // First-row neighbors: tile 0 ends past where tile 1 begins.
        expect(tiles[0]!.sx + tiles[0]!.sw).toBeGreaterThan(tiles[1]!.sx);
    });
});

describe("suppressOverlaps", () => {
    it("keeps the higher-scored of two heavily overlapping boxes", () => {
        const kept = suppressOverlaps([det(100, 100, 50, 20, 0.4), det(102, 101, 50, 20, 0.7)], 0.5);
        expect(kept).toHaveLength(1);
        expect(kept[0]!.score).toBe(0.7);
    });

    it("keeps disjoint boxes", () => {
        const kept = suppressOverlaps([det(0, 0, 50, 20, 0.4), det(500, 500, 50, 20, 0.3)], 0.5);
        expect(kept).toHaveLength(2);
    });

    it("iouOf: identical boxes -> 1, disjoint -> 0", () => {
        const a = det(10, 10, 20, 20, 1);
        expect(iouOf(a, a)).toBe(1);
        expect(iouOf(a, det(100, 100, 20, 20, 1))).toBe(0);
    });
});

describe("packRgbPlanarNormalized", () => {
    it("packs interleaved RGBA pixels into normalized RGB planes", () => {
        const target = new Float32Array(6);
        packRgbPlanarNormalized(new Uint8ClampedArray([255, 128, 0, 7, 64, 32, 16, 9]), target);
        expect(target).toEqual(new Float32Array([1, 64 / 255, 128 / 255, 32 / 255, 0, 16 / 255]));
    });
});
