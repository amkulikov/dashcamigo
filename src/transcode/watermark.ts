// Watermark "everydashcam.app" - URL wordmark + compact drum mark.
// Applied to every transcoded frame in pipeline.ts. Not
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
import { measureTextWidth, roundRectPath } from "./canvas-draw.js";
import { type FontSpec, loadFontsIntoScope } from "./worker-fonts.js";

const log = createLogger("transcode:watermark");

const FONT_FAMILY = `"Chakra Petch", "Inter", system-ui, sans-serif`;
const FONT_WEIGHT = "700";
// Matches .player-watermark so preview and export have the same proportions.
const LETTER_SPACING = "-0.02em";
const TEXT = "everydashcam.app";
const TEXT_COLOR = "#FFFFFF";
const MARK_BACKGROUND = "#14120F";
const DRUM_COLOR = "#2A2621";
const ACCENT_COLOR = "#FF9000";
const SHADOW_COLOR = "rgba(0, 0, 0, 0.6)";
const SHADOW_BLUR_RATIO = 0.06;
// Icon is 1.1em tall and follows the text with a 0.22em gap - matching
// .player-watermark in src/styles/components/player-composition.css.
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
    const textWidth = measureTextWidth(ctx, TEXT);
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
    // white car); without it the white text washes out. The
    // header logo has no shadow, but it sits on a fixed dark/bone background -
    // exported frames cannot rely on that.
    ctx.shadowColor = SHADOW_COLOR;
    ctx.shadowBlur = fontSize * SHADOW_BLUR_RATIO;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = Math.max(1, Math.round(fontSize * 0.03));

    // Text (baseline=middle, line center = centerY).
    ctx.fillStyle = TEXT_COLOR;
    ctx.fillText(TEXT, x, centerY);

    // Icon follows the text, matching the preview.
    drawBrandIcon(ctx, x + textWidth + gap, centerY - iconSize / 2, iconSize);

    ctx.restore();
}

/** Draws the compact mark from public/assets/mark-small.svg. */
function drawBrandIcon(
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    originX: number,
    originY: number,
    size: number,
): void {
    const s = size / 100;
    ctx.fillStyle = MARK_BACKGROUND;
    roundRectPath(ctx, originX, originY, size, size, 22 * s);
    ctx.fill();
    for (let index = 0; index < 3; index++) {
        ctx.fillStyle = index === 2 ? ACCENT_COLOR : DRUM_COLOR;
        roundRectPath(ctx, originX + (12 + index * 27) * s, originY + 28 * s, 22 * s, 44 * s, 6 * s);
        ctx.fill();
    }
}

// Chakra Petch 700 for the wordmark. Stable public/ URL (Vite serves public/ at
// origin root, unhashed). The watermark text is Latin-only ("everydashcam.app"), so
// the latin subset covers it - no latin-ext/vietnamese needed.
const WATERMARK_FONT: FontSpec = {
    family: "Chakra Petch",
    weight: FONT_WEIGHT,
    url: "/fonts/chakra-petch-700-latin.woff2",
};

let fontReadyPromise: Promise<void> | null = null;

/**
 * Registers Chakra Petch 700 into the current scope's FontFaceSet and waits for
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
