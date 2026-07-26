// Unit tests for the shared canvas path/math helpers. We can't rasterize in
// node, but we can assert the path verbs each shape emits (so the mini-map clip
// and its border trace the same outline) and the NaN-safe clamp.

import { describe, expect, it } from "vitest";

import { circlePath, clamp, shapePath } from "./canvas-draw.js";

/** A 2D context stub that records the path verbs it receives. */
function makeCtx(): { ctx: CanvasRenderingContext2D; verbs: string[] } {
    const verbs: string[] = [];
    const ctx = {
        beginPath: () => verbs.push("begin"),
        closePath: () => verbs.push("close"),
        moveTo: () => verbs.push("moveTo"),
        lineTo: () => verbs.push("lineTo"),
        arcTo: () => verbs.push("arcTo"),
        arc: () => verbs.push("arc"),
    } as unknown as CanvasRenderingContext2D;
    return { ctx, verbs };
}

describe("clamp", () => {
    it("bounds and maps non-finite to lo", () => {
        expect(clamp(5, 0, 10)).toBe(5);
        expect(clamp(-3, 0, 10)).toBe(0);
        expect(clamp(99, 0, 10)).toBe(10);
        expect(clamp(Number.NaN, 50, 200)).toBe(50);
        expect(clamp(Number.POSITIVE_INFINITY, 50, 200)).toBe(50);
    });
});

describe("circlePath", () => {
    it("emits a single arc subpath", () => {
        const { ctx, verbs } = makeCtx();
        circlePath(ctx, 50, 50, 20);
        expect(verbs).toEqual(["begin", "arc", "close"]);
    });
});

describe("shapePath", () => {
    it("circle uses an arc", () => {
        const { ctx, verbs } = makeCtx();
        shapePath(ctx, "circle", 0, 0, 40, 30, 6);
        expect(verbs).toContain("arc");
        expect(verbs).not.toContain("arcTo");
    });
    it("rect uses rounded-rect arcs (arcTo), not a circle", () => {
        const { ctx, verbs } = makeCtx();
        shapePath(ctx, "rect", 0, 0, 40, 30, 6);
        expect(verbs).toContain("arcTo");
        expect(verbs).not.toContain("arc");
    });
});
