// Watermark "dashcamigo.app" - URL wordmark + camera SVG (the camera icon from
// the site-header .dc-mark). Applied to every transcoded frame in pipeline.ts. Not
// applied to the "original" preset (stream-copy via exportClip) - pipeline.ts
// is not called at all in that path.
//
// Draws directly onto ctx (the shared frame canvas) instead of via an
// OffscreenCanvas + pre-rastered bitmap cache: in FF/Safari an OffscreenCanvas
// on the main thread does not always see fonts loaded via @font-face in the
// DOM, so a cached bitmap can come out blank or system-fallback. The
// main-thread canvas API guarantees font visibility.
//
// Watermark size is 3.3% of the OUTPUT frame height. If the user cropped a
// 1080x1080 square the watermark is 3.3% of 1080; if 720p output, 3.3% of
// 720. This keeps the watermark visually proportional regardless of preset or
// crop.

import { createLogger } from "../log.js";
import { roundRectPath } from "./canvas-draw.js";
import { type FontSpec, loadFontsIntoScope } from "./worker-fonts.js";

const log = createLogger("transcode:watermark");

const FONT_FAMILY = `"Space Grotesk", "Inter", system-ui, sans-serif`;
const FONT_WEIGHT = "700";
// Matches the header .dc-mark / .player-watermark tracking so the burned-in mark
// reads the same as the on-screen preview (preview == export).
const LETTER_SPACING = "-0.02em";
const TEXT = "dashcamigo.app";
const TEXT_COLOR = "#FFFFFF";
const LENS_COLOR = "#FF9000"; // --dc-orange
const LENS_INNER_COLOR = "#000000";
const HIGHLIGHT_COLOR = "rgba(255, 255, 255, 0.5)";
const SHADOW_COLOR = "rgba(0, 0, 0, 0.6)";
const SHADOW_BLUR_RATIO = 0.06;
// Icon is 1.1em tall and follows the text with a 0.22em gap - matching
// .dc-mark in src/styles/components/topbar.css (align-items: center).
const ICON_SIZE_RATIO = 1.1;
const ICON_GAP_RATIO = 0.22;
const HEIGHT_RATIO = 0.033;
const ALPHA = 0.5;

/** Corner of the output frame where the watermark is placed. */
export type WatermarkAnchor = "tl" | "tr" | "bl" | "br";

/**
 * Draws the watermark in one of 4 corners with a margin of 4% of the SMALLEST
 * axis - so on portrait presets the watermark does not drift too far from the
 * edge.
 */
export function drawWatermark(
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    frameWidth: number,
    frameHeight: number,
    anchor: WatermarkAnchor = "br",
): void {
    const fontSize = Math.max(10, Math.round(frameHeight * HEIGHT_RATIO));
    const margin = Math.max(8, Math.round(Math.min(frameWidth, frameHeight) * 0.04));
    const iconSize = fontSize * ICON_SIZE_RATIO;
    const gap = fontSize * ICON_GAP_RATIO;

    ctx.save();
    ctx.font = `${FONT_WEIGHT} ${fontSize}px ${FONT_FAMILY}`;
    // Set before measureText so the measured width accounts for the tracking.
    ctx.letterSpacing = LETTER_SPACING;
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    const textWidth = ctx.measureText(TEXT).width;
    const totalW = textWidth + gap + iconSize;
    // Composition height = icon height (taller than font-size).
    const totalH = iconSize;

    let x: number;
    let centerY: number;
    if (anchor === "tl" || anchor === "bl") {
        x = margin;
    } else {
        x = frameWidth - totalW - margin;
    }
    if (anchor === "tl" || anchor === "tr") {
        centerY = margin + totalH / 2;
    } else {
        centerY = frameHeight - margin - totalH / 2;
    }

    ctx.globalAlpha = ALPHA;
    // Subtle shadow - the watermark often lands on a bright background (sky,
    // white car); without it the white text and camera body wash out. The
    // header logo has no shadow, but it sits on a fixed dark/bone background -
    // exported frames cannot rely on that.
    ctx.shadowColor = SHADOW_COLOR;
    ctx.shadowBlur = fontSize * SHADOW_BLUR_RATIO;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = Math.max(1, Math.round(fontSize * 0.03));

    // Text (baseline=middle, line center = centerY).
    ctx.fillStyle = TEXT_COLOR;
    ctx.fillText(TEXT, x, centerY);

    // Icon follows the text - same order as .dc-mark.
    drawCameraIcon(ctx, x + textWidth + gap, centerY - iconSize / 2, iconSize);

    ctx.restore();
}

/**
 * Draws the camera SVG icon from the site header onto a canvas. Original
 * viewBox 0 0 32 32; scaled to `size`. Geometry copied from index.html
 * .dc-mark__icon - body white (currentColor), lens orange, inner circle
 * black, highlight dot semi-transparent.
 */
function drawCameraIcon(
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    originX: number,
    originY: number,
    size: number,
): void {
    const s = size / 32;
    const px = (n: number) => originX + n * s;
    const py = (n: number) => originY + n * s;

    // Camera body (rounded rect 3,7 26x20 rx=3).
    ctx.fillStyle = TEXT_COLOR;
    roundRectPath(ctx, px(3), py(7), 26 * s, 20 * s, 3 * s);
    ctx.fill();

    // Top bump (rect 14,4 4x3 rx=0.6).
    roundRectPath(ctx, px(14), py(4), 4 * s, 3 * s, 0.6 * s);
    ctx.fill();

    // Lens - orange circle (cx=16, cy=17, r=7).
    ctx.fillStyle = LENS_COLOR;
    ctx.beginPath();
    ctx.arc(px(16), py(17), 7 * s, 0, Math.PI * 2);
    ctx.fill();

    // Inner black circle (cx=16, cy=17, r=4).
    ctx.fillStyle = LENS_INNER_COLOR;
    ctx.beginPath();
    ctx.arc(px(16), py(17), 4 * s, 0, Math.PI * 2);
    ctx.fill();

    // Highlight dot (cx=14, cy=15, r=1.4, semi-transparent white).
    ctx.fillStyle = HIGHLIGHT_COLOR;
    ctx.beginPath();
    ctx.arc(px(14), py(15), 1.4 * s, 0, Math.PI * 2);
    ctx.fill();
}

// Space Grotesk 700 for the wordmark. Stable public/ URL (Vite serves public/ at
// origin root, unhashed). The watermark text is Latin-only ("dashcamigo.app"), so
// the latin subset covers it - no latin-ext/vietnamese needed.
const WATERMARK_FONT: FontSpec = {
    family: "Space Grotesk",
    weight: FONT_WEIGHT,
    url: "/fonts/space-grotesk-700-latin.woff2",
};

let fontReadyPromise: Promise<void> | null = null;

/**
 * Registers Space Grotesk 700 into the current scope's FontFaceSet and waits for
 * it to load, so the first (and thus font-cached) export frame draws the wordmark
 * in the brand face instead of a system fallback.
 *
 * Runs in the transcode WORKER as well as the main thread: a worker has no
 * document and the main thread's @font-face does NOT apply there, so
 * loadFontsIntoScope builds the FontFace from the self-hosted woff2 and adds it
 * to self.fonts (mirrors ensureOverlayFontsReady). Idempotent (cached promise);
 * never throws - a load failure degrades to the ctx.font fallback chain.
 */
export function ensureWatermarkFontReady(): Promise<void> {
    if (fontReadyPromise) return fontReadyPromise;
    fontReadyPromise = (async () => {
        await loadFontsIntoScope([WATERMARK_FONT]);
        log.debug("watermark font ready");
    })();
    return fontReadyPromise;
}
