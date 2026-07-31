// Graphical telemetry widgets painted on the transcoded frame: compass dial,
// G-force dial, running speed graph, and the hard-brake marker. Ported from the
// design mock's SVG recipes to canvas 2D. Each takes a normalized (xPct, yPct)
// top-left anchor + scalePct (mirrors the text widgets) and is themed by
// STYLE_CHROME + the run accent. Sizes are a fraction of the frame's shorter
// side so a widget reads the same on 16:9 / 9:16 / 1:1.

import { circlePath, clamp, drawNoFixIcon, measureTextWidth, roundRectPath } from "./canvas-draw.js";
import { composeFont, resolveStyleColor, STYLE_CHROME } from "./overlay-styles.js";
import type { OverlayStyleId } from "./types.js";
import type { FramePos } from "./frame-pos.js";

type AnyCtx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export interface WidgetPlacement {
    xPct: number;
    yPct: number;
    scalePct: number;
}

const MONO = `"JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace`;
const HEAVY = `"Inter", system-ui, sans-serif`;

/** Resolves a square dial box (top-left + size), clamped to the frame. */
function dialBox(
    W: number,
    H: number,
    opts: WidgetPlacement,
    baseFraction: number,
): { x: number; y: number; d: number } {
    const scale = clamp(opts.scalePct, 50, 200) / 100;
    const d = Math.max(48, Math.round(Math.min(W, H) * baseFraction * scale));
    const xLeft = clamp(opts.xPct, 0, 1) * W;
    const yTop = clamp(opts.yPct, 0, 1) * H;
    const x = Math.min(Math.max(0, xLeft), Math.max(0, W - d));
    const y = Math.min(Math.max(0, yTop), Math.max(0, H - d));
    return { x, y, d };
}

/** Heading-up compass (what a driver holding a compass sees): the rose rotates
 *  so North tracks the real world, a fixed index at the top marks the direction
 *  of travel, and the heading is read in the centre. */
export function drawCompass(
    ctx: AnyCtx,
    W: number,
    H: number,
    opts: WidgetPlacement,
    style: OverlayStyleId,
    accent: string,
    pos: FramePos,
    cardinals: readonly [string, string, string, string],
): void {
    const chrome = STYLE_CHROME[style];
    const { x, y, d } = dialBox(W, H, opts, 0.18);
    const cx = x + d / 2;
    const cy = y + d / 2;
    const r = d / 2 - Math.max(1, d * 0.02);

    ctx.save();
    ctx.shadowColor = "transparent";
    // ring
    circlePath(ctx, cx, cy, r);
    ctx.fillStyle = chrome.dialFill;
    ctx.fill();
    ctx.lineWidth = Math.max(1, d * 0.02);
    ctx.strokeStyle = resolveStyleColor(chrome.dialStroke, accent);
    ctx.stroke();

    // No fix: keep the dial chrome (ring + ticks) so the widget holds its
    // place, but no card rotation, cardinals, index, or readout - a heading
    // without a fix would be an invention. The icon carries the "why".
    if (!pos.hasFix) {
        ctx.strokeStyle = "rgba(255,255,255,0.25)";
        ctx.lineWidth = Math.max(1, d * 0.012);
        for (let i = 0; i < 24; i++) {
            const a = (i * 15 * Math.PI) / 180;
            const r1 = r * 0.92;
            const r2 = i % 2 === 0 ? r * 0.8 : r * 0.86;
            ctx.beginPath();
            ctx.moveTo(cx + r1 * Math.sin(a), cy - r1 * Math.cos(a));
            ctx.lineTo(cx + r2 * Math.sin(a), cy - r2 * Math.cos(a));
            ctx.stroke();
        }
        drawNoFixIcon(ctx, cx, cy, d * 0.34, "rgba(255,255,255,0.65)");
        ctx.restore();
        return;
    }

    // Heading-up: the card (ticks + labels) is rotated by -heading so the
    // travel direction comes to the top under the fixed index. A bearing b on
    // the card lands at screen angle (b - heading): heading 90 (driving East)
    // puts E at the top and N to the left, exactly as a held compass reads.
    const headRad = (pos.headingDeg * Math.PI) / 180;

    // ticks every 15deg, rotating with the card
    ctx.strokeStyle = "rgba(255,255,255,0.45)";
    ctx.lineWidth = Math.max(1, d * 0.012);
    for (let i = 0; i < 24; i++) {
        const a = (i * 15 * Math.PI) / 180 - headRad;
        const r1 = r * 0.92;
        const r2 = i % 2 === 0 ? r * 0.8 : r * 0.86;
        ctx.beginPath();
        ctx.moveTo(cx + r1 * Math.sin(a), cy - r1 * Math.cos(a));
        ctx.lineTo(cx + r2 * Math.sin(a), cy - r2 * Math.cos(a));
        ctx.stroke();
    }

    // cardinal labels N/E/S/W - positions orbit with the card, glyphs stay
    // upright for legibility. North in accent (the card's "red"), rest muted.
    const cardPx = Math.round(d * 0.13);
    ctx.font = composeFont("800", cardPx, HEAVY);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    // Localized cardinals in N, E, S, W order (С/В/Ю/З, ...); North gets the
    // accent color below, the rest are muted.
    const cards: Array<[string, number]> = [
        [cardinals[0], 0],
        [cardinals[1], 90],
        [cardinals[2], 180],
        [cardinals[3], 270],
    ];
    const labelR = r * 0.66;
    for (const [label, deg] of cards) {
        const a = (deg * Math.PI) / 180 - headRad;
        ctx.fillStyle = deg === 0 ? accent : "rgba(255,255,255,0.85)";
        ctx.fillText(label, cx + labelR * Math.sin(a), cy - labelR * Math.cos(a));
    }

    // Fixed "ahead" index at the top (lubber line): a downward triangle just
    // inside the rim. The card bearing under it is the heading.
    ctx.beginPath();
    ctx.moveTo(cx, cy - r * 0.74);
    ctx.lineTo(cx - d * 0.045, cy - r * 0.96);
    ctx.lineTo(cx + d * 0.045, cy - r * 0.96);
    ctx.closePath();
    ctx.fillStyle = "#FFFFFF";
    ctx.fill();

    // Heading readout centered in the dial, on a pill backdrop (read under the
    // top index). Centered rather than below-center, where it collided with a
    // cardinal label.
    const degPx = Math.round(d * 0.13);
    ctx.font = composeFont("700", degPx, MONO);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const degText = `${Math.round(pos.headingDeg)}°`;
    // Reserve the widest heading ("888°") so the centered pill keeps a constant
    // width as the value crosses 9->99->359 (textAlign stays centered below).
    const textW = Math.max(measureTextWidth(ctx, degText), measureTextWidth(ctx, "888°"));
    const pillH = Math.round(degPx * 1.5);
    const pillW = Math.ceil(textW) + Math.round(degPx * 0.9);
    ctx.shadowColor = "transparent";
    roundRectPath(ctx, cx - pillW / 2, cy - pillH / 2, pillW, pillH, pillH / 2);
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fill();
    ctx.lineWidth = Math.max(1, d * 0.008);
    ctx.strokeStyle = "rgba(255,255,255,0.25)";
    ctx.stroke();
    ctx.fillStyle = "#FFFFFF";
    ctx.fillText(degText, cx, cy);
    ctx.restore();
}

/** G-force dial: a dot on a crosshair, ±1 g to the edge, red while braking. */
export function drawGforce(
    ctx: AnyCtx,
    W: number,
    H: number,
    opts: WidgetPlacement,
    style: OverlayStyleId,
    accent: string,
    pos: FramePos,
    brakeThresholdG: number,
): void {
    const chrome = STYLE_CHROME[style];
    const { x, y, d } = dialBox(W, H, opts, 0.17);
    const cx = x + d / 2;
    const cy = y + d / 2;
    const r = d / 2 - Math.max(1, d * 0.02);

    ctx.save();
    ctx.shadowColor = "transparent";
    circlePath(ctx, cx, cy, r);
    ctx.fillStyle = chrome.dialFill;
    ctx.fill();
    ctx.lineWidth = Math.max(1, d * 0.02);
    ctx.strokeStyle = resolveStyleColor(chrome.dialStroke, accent);
    ctx.stroke();

    // crosshair + inner ring
    ctx.strokeStyle = "rgba(255,255,255,0.3)";
    ctx.lineWidth = Math.max(1, d * 0.01);
    circlePath(ctx, cx, cy, r * 0.5);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx, cy + r);
    ctx.moveTo(cx - r, cy);
    ctx.lineTo(cx + r, cy);
    ctx.stroke();

    // No fix: crosshair chrome only - no dot, no magnitude (derived G IS a GPS
    // quantity here). Icon in place of the readout.
    if (!pos.hasFix) {
        drawNoFixIcon(ctx, cx, cy, d * 0.34, "rgba(255,255,255,0.65)");
        ctx.restore();
        return;
    }

    // acceleration dot: gLat -> x, -gLong -> y (braking pushes the dot down)
    const reach = r * 0.74;
    const px = cx + clampUnit(pos.gLat) * reach;
    const py = cy + clampUnit(-pos.gLong) * reach;
    const braking = -pos.gLong >= brakeThresholdG;
    circlePath(ctx, px, py, Math.max(3, d * 0.07));
    ctx.fillStyle = braking ? "#E5102B" : accent;
    ctx.fill();

    // center magnitude readout
    const valPx = Math.round(d * 0.16);
    ctx.font = composeFont("700", valPx, MONO);
    ctx.fillStyle = "#FFFFFF";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    softShadow(ctx, valPx);
    ctx.fillText(`${pos.gMag.toFixed(1)} G`, cx, cy);
    ctx.restore();
}

/** Running speed graph (sparkline) with a now-marker at `pos.progress`. */
export function drawGraph(
    ctx: AnyCtx,
    W: number,
    H: number,
    opts: WidgetPlacement,
    style: OverlayStyleId,
    accent: string,
    pos: FramePos,
    samples: number[],
    units: "metric" | "imperial",
    unitLabel: string,
): void {
    if (samples.length < 2) return;
    const chrome = STYLE_CHROME[style];
    const scale = clamp(opts.scalePct, 50, 200) / 100;
    const minDim = Math.min(W, H);
    const boxW = Math.max(80, Math.round(minDim * 0.54 * scale));
    const boxH = Math.max(28, Math.round(minDim * 0.12 * scale));
    const xLeft = clamp(opts.xPct, 0, 1) * W;
    const yTop = clamp(opts.yPct, 0, 1) * H;
    const x = Math.min(Math.max(0, xLeft), Math.max(0, W - boxW));
    const y = Math.min(Math.max(0, yTop), Math.max(0, H - boxH));

    ctx.save();
    ctx.shadowColor = "transparent";
    // background
    if (chrome.plate) {
        ctx.fillStyle = chrome.plate;
        roundRectPath(ctx, x, y, boxW, boxH, Math.round(boxH * 0.12));
        ctx.fill();
    } else {
        // glass: soft bottom gradient for legibility
        const grad = ctx.createLinearGradient(0, y + boxH, 0, y);
        grad.addColorStop(0, "rgba(0,0,0,0.45)");
        grad.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = grad;
        ctx.fillRect(x, y, boxW, boxH);
    }

    const pad = Math.round(boxH * 0.14);
    const gx0 = x + pad;
    const gy0 = y + pad;
    const gw = boxW - pad * 2;
    const gh = boxH - pad * 2;
    let maxV = 0;
    for (const v of samples) if (v > maxV) maxV = v;
    maxV = Math.max(maxV, 1);

    const sx = (i: number): number => gx0 + (i / (samples.length - 1)) * gw;
    const sy = (v: number): number => gy0 + gh - (v / maxV) * gh;

    // full faint line
    ctx.strokeStyle = accent;
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = Math.max(1, boxH * 0.04);
    ctx.beginPath();
    for (let i = 0; i < samples.length; i++) {
        const px = sx(i);
        const py = sy(samples[i]!);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;

    // done portion + area
    const nowIdx = Math.round(pos.progress * (samples.length - 1));
    const nowX = gx0 + pos.progress * gw;
    ctx.beginPath();
    ctx.moveTo(gx0, gy0 + gh);
    for (let i = 0; i <= nowIdx; i++) ctx.lineTo(sx(i), sy(samples[i]!));
    ctx.lineTo(sx(Math.max(0, nowIdx)), gy0 + gh);
    ctx.closePath();
    ctx.fillStyle = accent;
    ctx.globalAlpha = 0.18;
    ctx.fill();
    ctx.globalAlpha = 1;

    ctx.strokeStyle = accent;
    ctx.lineWidth = Math.max(1.5, boxH * 0.05);
    ctx.beginPath();
    for (let i = 0; i <= nowIdx; i++) {
        const px = sx(i);
        const py = sy(samples[i]!);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
    }
    ctx.stroke();

    // now line + dot
    ctx.strokeStyle = "#FFFFFF";
    ctx.lineWidth = Math.max(1, boxH * 0.03);
    ctx.beginPath();
    ctx.moveTo(nowX, y);
    ctx.lineTo(nowX, y + boxH);
    ctx.stroke();
    const nowY = sy(samples[Math.max(0, Math.min(samples.length - 1, nowIdx))]!);
    circlePath(ctx, nowX, nowY, Math.max(2, boxH * 0.06));
    ctx.fillStyle = "#FFFFFF";
    ctx.fill();

    // current speed readout (top-right). units drives the m/s conversion; the
    // localized suffix comes from unitLabel (see OverlayPipelineArgs.unitSpeed).
    const v = units === "imperial" ? pos.speedMs * 3.6 * 0.621371 : pos.speedMs * 3.6;
    const txtPx = Math.round(boxH * 0.34);
    ctx.font = composeFont("700", txtPx, MONO);
    ctx.fillStyle = "#FFFFFF";
    ctx.textAlign = "right";
    ctx.textBaseline = "top";
    softShadow(ctx, txtPx);
    ctx.fillText(`${Math.round(v)} ${unitLabel}`, x + boxW - pad, y + pad);
    ctx.restore();
}

/** Clamps to [-1, 1] for the G-force dot reach. */
function clampUnit(n: number): number {
    if (!Number.isFinite(n)) return 0;
    return Math.max(-1, Math.min(1, n));
}

/** Applies the glass-style soft shadow for in-dial readouts. */
function softShadow(ctx: AnyCtx, fontPx: number): void {
    ctx.shadowColor = "rgba(0,0,0,0.8)";
    ctx.shadowBlur = Math.max(1, fontPx * 0.12);
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = Math.max(1, Math.round(fontPx * 0.04));
}
