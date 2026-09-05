import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createRegionBlurHelper, paintRegionBlur } from "./compose.js";

interface ScratchDraw {
    width: number;
    height: number;
    smoothing: boolean;
    quality: string;
    hasPreviousPixels: boolean;
}

let allocations = 0;
let resizes = 0;
let draws: ScratchDraw[] = [];

/** Browser boundary: retain resize/reset semantics without simulating filters.
 *  Pixel equivalence is checked separately on real OffscreenCanvas. */
class CanvasBoundary {
    private currentWidth: number;
    private currentHeight: number;
    private hasPixels = false;
    private readonly ctx = {
        imageSmoothingEnabled: true,
        imageSmoothingQuality: "low",
        clearRect: (): void => {
            this.hasPixels = false;
        },
        drawImage: (): void => {
            draws.push({
                width: this.width,
                height: this.height,
                smoothing: this.ctx.imageSmoothingEnabled,
                quality: this.ctx.imageSmoothingQuality,
                hasPreviousPixels: this.hasPixels,
            });
            this.hasPixels = true;
        },
    };

    constructor(width: number, height: number) {
        allocations++;
        this.currentWidth = width;
        this.currentHeight = height;
    }

    get width(): number {
        return this.currentWidth;
    }

    set width(value: number) {
        this.currentWidth = value;
        this.reset();
    }

    get height(): number {
        return this.currentHeight;
    }

    set height(value: number) {
        this.currentHeight = value;
        this.reset();
    }

    private reset(): void {
        resizes++;
        this.hasPixels = false;
        this.ctx.imageSmoothingEnabled = true;
        this.ctx.imageSmoothingQuality = "low";
    }

    getContext(): typeof this.ctx {
        return this.ctx;
    }
}

function painter() {
    const helper = createRegionBlurHelper();
    // The destination and source are browser-owned objects, not code under test.
    const ctx = { imageSmoothingEnabled: false, drawImage: () => {} } as unknown as OffscreenCanvasRenderingContext2D;
    const source = {} as CanvasImageSource;
    const rect = { x: 10, y: 20, w: 160, h: 90 };
    return (cols: number, rows: number): void => {
        paintRegionBlur(ctx, source, rect, rect, "blur", helper, { cols, rows });
        expect(ctx.imageSmoothingEnabled).toBe(false);
    };
}

beforeEach(() => {
    allocations = 0;
    resizes = 0;
    draws = [];
    vi.stubGlobal("OffscreenCanvas", CanvasBoundary);
});

afterEach(() => vi.unstubAllGlobals());

describe("region blur scratch reuse", () => {
    it("avoids backing-store resizes as differently shaped masks repeat across frames", () => {
        const paint = painter();
        paint(7, 6);
        paint(19, 12);
        const warmAllocations = allocations;
        const warmResizes = resizes;
        for (let frame = 0; frame < 100; frame++) {
            paint(7, 6);
            paint(19, 12);
        }
        expect(allocations).toBe(warmAllocations);
        expect(resizes).toBe(warmResizes);
    });

    it("preserves transparent-input history only while the sampling grid stays unchanged", () => {
        const paint = painter();
        paint(7, 6);
        paint(19, 12);
        paint(7, 6);
        paint(7, 6);
        expect(draws.map((draw) => draw.hasPreviousPixels)).toEqual([false, false, false, true]);
    });

    it("bounds allocations while retaining exact grids and high-quality sampling after eviction", () => {
        const paint = painter();
        for (let i = 0; i < 200; i++) paint(i + 2, 6);
        const warmAllocations = allocations;
        for (let i = 200; i < 400; i++) paint(i + 2, 6);
        expect(allocations).toBe(warmAllocations);
        for (const [i, draw] of draws.entries()) {
            expect(draw, `sample grid ${i}`).toEqual({
                width: i + 2,
                height: 6,
                smoothing: true,
                quality: "high",
                hasPreviousPixels: false,
            });
        }
    });
});
