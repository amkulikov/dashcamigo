// Generic 2D-canvas math/path helpers shared across the transcode drawing
// modules (watermark, text overlay, map overlay). Kept in one place so the
// same rounded-rect recipe and NaN-safe clamp do not drift between modules.

type AnyCanvas2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/**
 * Clamps n into [lo, hi]. NaN/Infinity map to lo - overlay placement comes
 * from user-controlled percentages, and a non-finite value must not leak into
 * canvas coordinates (it would silently break drawing).
 */
export function clamp(n: number, lo: number, hi: number): number {
    if (!Number.isFinite(n)) return lo;
    return Math.max(lo, Math.min(hi, n));
}

/**
 * Builds a rounded-rect path on ctx (does not stroke/fill). radius is capped
 * to half the smaller side. CanvasRenderingContext2D.roundRect is not in all
 * target browsers, so the path is built explicitly via arcTo.
 */
export function roundRectPath(ctx: AnyCanvas2D, x: number, y: number, w: number, h: number, r: number): void {
    const radius = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
    ctx.closePath();
}

/** Builds a full-circle path centered at (cx, cy) (does not stroke/fill). The
 *  G-force / compass dials and the circular mini-map clip share it. */
export function circlePath(ctx: AnyCanvas2D, cx: number, cy: number, radius: number): void {
    ctx.beginPath();
    ctx.arc(cx, cy, Math.max(0, radius), 0, Math.PI * 2);
    ctx.closePath();
}

/**
 * Builds a clip/border path for one of the mini-map shapes inside the (x,y,w,h)
 * box. Single source of truth so the clip and the border stroke trace the same
 * outline (a drift between them leaves a hairline gap):
 *  - "rect": rounded rectangle, radius = `rectRadius`;
 *  - "circle": the inscribed circle (largest circle that fits the box).
 */
export function shapePath(
    ctx: AnyCanvas2D,
    shape: "rect" | "circle",
    x: number,
    y: number,
    w: number,
    h: number,
    rectRadius: number,
): void {
    if (shape === "circle") {
        const r = Math.min(w, h) / 2;
        circlePath(ctx, x + w / 2, y + h / 2, r);
        return;
    }
    roundRectPath(ctx, x, y, w, h, rectRadius);
}
