// Tests for drawWatermark: the watermark text is drawn, it lands in the
// correct corner for each anchor, geometry scales with frame size, and the
// font-size clamp holds on tiny frames.
//
// Deliberately NOT asserted: how the logo is painted (arc count, fillStyle
// order, exact font family/px, shadow internals). Those are implementation
// details - re-drawing the mark with a different glyph or font must not fail
// this test. Pixel-level correctness of the watermark is a visual concern,
// covered in the e2e/visual suite, not here.
//
// Approach: a mock CanvasRenderingContext2D-like object that records all calls
// as a trace. Node has no real canvas, but drawWatermark only uses a fixed set
// of 2D operations (fillText, arc, fillRect, etc.).

import { describe, expect, it } from "vitest";

import { drawWatermark, type WatermarkAnchor } from "./watermark.js";

interface CtxCall {
    op: string;
    args: unknown[];
}

interface MockState {
    fillStyle: string;
    font: string;
    textBaseline: string;
    textAlign: string;
    globalAlpha: number;
    shadowColor: string;
    shadowBlur: number;
    shadowOffsetX: number;
    shadowOffsetY: number;
}

/** Creates a mock ctx that records all calls and reads/writes state. */
function makeCtx(): {
    ctx: CanvasRenderingContext2D;
    calls: CtxCall[];
    states: MockState[];
} {
    const calls: CtxCall[] = [];
    const states: MockState[] = [];
    let cur: MockState = {
        fillStyle: "",
        font: "",
        textBaseline: "alphabetic",
        textAlign: "start",
        globalAlpha: 1,
        shadowColor: "transparent",
        shadowBlur: 0,
        shadowOffsetX: 0,
        shadowOffsetY: 0,
    };
    const stack: MockState[] = [];

    const handler: ProxyHandler<Record<string, unknown>> = {
        get(_target, prop) {
            if (prop in cur) return (cur as unknown as Record<string, unknown>)[prop as string];
            if (prop === "measureText") {
                return (text: string) => {
                    calls.push({ op: "measureText", args: [text] });
                    // Mock: each character is ~0.5 * fontSize wide.
                    const fontSizeMatch = cur.font.match(/(\d+)px/);
                    const fontSize = fontSizeMatch ? Number(fontSizeMatch[1]) : 16;
                    return { width: text.length * fontSize * 0.5 };
                };
            }
            if (prop === "save") {
                return () => {
                    stack.push({ ...cur });
                    calls.push({ op: "save", args: [] });
                };
            }
            if (prop === "restore") {
                return () => {
                    const prev = stack.pop();
                    if (prev) cur = prev;
                    calls.push({ op: "restore", args: [] });
                };
            }
            // All other methods - just record the call + snapshot state.
            return (...args: unknown[]) => {
                calls.push({ op: prop as string, args });
                states.push({ ...cur });
            };
        },
        set(_target, prop, value) {
            (cur as unknown as Record<string, unknown>)[prop as string] = value;
            calls.push({ op: `set:${String(prop)}`, args: [value] });
            return true;
        },
    };

    const ctx = new Proxy({}, handler) as unknown as CanvasRenderingContext2D;
    return { ctx, calls, states };
}

describe("drawWatermark", () => {
    it("isolates its state via save/restore (no leak into the caller's ctx)", () => {
        // Contract: the watermark mutates font/alpha/shadow on the shared export
        // ctx, so it must bracket everything in save/restore or it corrupts the
        // next frame's drawing.
        const { ctx, calls } = makeCtx();
        drawWatermark(ctx, 1920, 1080);
        const ops = calls.map((c) => c.op);
        expect(ops[0]).toBe("save");
        expect(ops[ops.length - 1]).toBe("restore");
    });

    it("respects min fontSize 10 on tiny frames", () => {
        const { ctx, calls } = makeCtx();
        drawWatermark(ctx, 200, 100);
        // 100 * 0.033 = 3.3 → Math.max(10, ...) = 10. Below the clamp the mark
        // would be sub-pixel and invisible, so the clamp is real behavior.
        const fontSet = calls.find((c) => c.op === "set:font");
        expect(fontSet!.args[0]).toMatch(/\b10px\b/);
    });

    it("draws the text 'dashcamigo.app'", () => {
        const { ctx, calls } = makeCtx();
        drawWatermark(ctx, 1920, 1080);
        const fillTextCall = calls.find((c) => c.op === "fillText");
        expect(fillTextCall).toBeDefined();
        expect(fillTextCall!.args[0]).toBe("dashcamigo.app");
    });

    it("draws semi-transparent (globalAlpha < 1)", () => {
        // The mark must not be fully opaque - it sits over footage. Exact alpha
        // is a design choice; "is translucent" is the behavioral invariant.
        const { ctx, calls } = makeCtx();
        drawWatermark(ctx, 1920, 1080);
        const alphaSet = calls.find((c) => c.op === "set:globalAlpha");
        expect(alphaSet).toBeDefined();
        expect(alphaSet!.args[0]).toBeGreaterThan(0);
        expect(alphaSet!.args[0]).toBeLessThan(1);
    });

    it("positions in bottom-right by default (anchor br)", () => {
        const { ctx, calls } = makeCtx();
        drawWatermark(ctx, 1000, 1000);
        const fillText = calls.find((c) => c.op === "fillText");
        const x = fillText!.args[1] as number;
        const y = fillText!.args[2] as number;
        expect(x).toBeGreaterThan(500); // right half
        expect(y).toBeGreaterThan(500); // bottom half
    });

    it("positions in top-left for anchor=tl", () => {
        const { ctx, calls } = makeCtx();
        drawWatermark(ctx, 1000, 1000, "tl");
        const fillText = calls.find((c) => c.op === "fillText");
        const x = fillText!.args[1] as number;
        const y = fillText!.args[2] as number;
        expect(x).toBeLessThan(100);
        expect(y).toBeLessThan(100);
    });

    it("positions in top-right for anchor=tr", () => {
        const { ctx, calls } = makeCtx();
        drawWatermark(ctx, 1000, 1000, "tr");
        const fillText = calls.find((c) => c.op === "fillText");
        const x = fillText!.args[1] as number;
        const y = fillText!.args[2] as number;
        expect(x).toBeGreaterThan(500); // right
        expect(y).toBeLessThan(100); // top
    });

    it("positions in bottom-left for anchor=bl", () => {
        const { ctx, calls } = makeCtx();
        drawWatermark(ctx, 1000, 1000, "bl");
        const fillText = calls.find((c) => c.op === "fillText");
        const x = fillText!.args[1] as number;
        const y = fillText!.args[2] as number;
        expect(x).toBeLessThan(100); // left
        expect(y).toBeGreaterThan(500); // bottom
    });

    it("position scales with frame size proportionally", () => {
        // Margin = 4% of min-axis. A bigger frame pushes the top-left text
        // further from the origin, so the mark keeps a constant relative inset.
        const ctx1 = makeCtx();
        drawWatermark(ctx1.ctx, 500, 500, "tl");
        const ctx2 = makeCtx();
        drawWatermark(ctx2.ctx, 2000, 2000, "tl");

        const x1 = ctx1.calls.find((c) => c.op === "fillText")!.args[1] as number;
        const x2 = ctx2.calls.find((c) => c.op === "fillText")!.args[1] as number;
        expect(x2).toBeGreaterThan(x1);
    });
});

describe("drawWatermark - all anchors smoke", () => {
    const anchors: WatermarkAnchor[] = ["tl", "tr", "bl", "br"];
    for (const a of anchors) {
        it(`runs without throwing for anchor=${a}`, () => {
            const { ctx } = makeCtx();
            expect(() => drawWatermark(ctx, 1920, 1080, a)).not.toThrow();
        });
    }
});

// Not covered: ensureWatermarkFontReady - requires document.fonts / self.fonts
// API, not available in Node; stubbing via vi.stubGlobal is too much boilerplate
// for the minimal value it would add.
