// Frame composition: draw main video (with optional crop) + optional PiP /
// split-screen + watermark on an OffscreenCanvas. Pure functions - no internal
// state, everything through arguments. This is what makes the code testable
// and reusable (the Simple Modal crop/split preview calls the same drawMain/
// drawSplitScreen on a live canvas).
//
// Coordinate system: everything in output pixels (outputW × outputH). Crop
// rect is in normalized source coordinates [0..1]; PiP rect and split-layout
// slots are in normalized output coordinates [0..1].

import type { VideoSample } from "mediabunny";

import type { ResolvedRegionBlur } from "../blur-regions.js";

import { roundRectPath } from "./canvas-draw.js";

/**
 * Source for the blur backdrop - anything `drawImage` can handle, or a
 * VideoSample (uses its own draw API). The pipeline passes VideoSample;
 * the UI preview passes ImageBitmap.
 */
export type BlurSource = VideoSample | ImageBitmap | HTMLCanvasElement | HTMLVideoElement | OffscreenCanvas;

/**
 * Pre-allocated canvases for the downscale-blur-upscale pipeline. Created
 * once per pipeline and reused across frames - new OffscreenCanvas is
 * non-trivially expensive; allocating one per frame is unacceptable.
 */
export interface BlurHelper {
    smallCanvas: OffscreenCanvas;
    smallCtx: OffscreenCanvasRenderingContext2D;
    blurCanvas: OffscreenCanvas;
    blurCtx: OffscreenCanvasRenderingContext2D;
}

/** Max downscale canvas size (along the larger source dimension). */
const BLUR_DOWNSCALE_MAX = 480;
/** Blur radius on the downscaled canvas. Visually ~32px at 1080p (factor ×4). */
const BLUR_RADIUS_PX = 8;

export function createBlurHelper(): BlurHelper {
    const smallCanvas = new OffscreenCanvas(BLUR_DOWNSCALE_MAX, BLUR_DOWNSCALE_MAX);
    const smallCtx = smallCanvas.getContext("2d", { alpha: false });
    if (!smallCtx) throw new Error("createBlurHelper: small canvas ctx unavailable");
    const blurCanvas = new OffscreenCanvas(BLUR_DOWNSCALE_MAX, BLUR_DOWNSCALE_MAX);
    const blurCtx = blurCanvas.getContext("2d", { alpha: false });
    if (!blurCtx) throw new Error("createBlurHelper: blur canvas ctx unavailable");
    return { smallCanvas, smallCtx, blurCanvas, blurCtx };
}

function drawBlurSource(
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    source: BlurSource,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
): void {
    // VideoSample has its own draw API (handles rotation/PAR).
    // ImageBitmap / Canvas go through the standard drawImage.
    if (typeof (source as VideoSample).draw === "function" && "displayWidth" in (source as object)) {
        (source as VideoSample).draw(ctx, sx, sy, sw, sh, dx, dy, dw, dh);
    } else {
        ctx.drawImage(source as Exclude<BlurSource, VideoSample>, sx, sy, sw, sh, dx, dy, dw, dh);
    }
}

/**
 * Fills a dest rect with a blurred cover-fit version of the source.
 * Pipeline: downscale (max 480 on the larger dimension) → blur via ctx.filter
 * → upscale into dest. At 1080p+ this costs <1ms per frame (vs 10ms+ for
 * a full-resolution blur).
 */
export function fillBlurredCover(
    destCtx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    source: BlurSource,
    sourceW: number,
    sourceH: number,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
    helper: BlurHelper,
    censorRegions?: readonly ResolvedRegionBlur[] | null,
): void {
    if (sourceW <= 0 || sourceH <= 0) return;
    // 1. Downscale source into smallCanvas.
    const ratio = sourceW / sourceH;
    let dsW: number;
    let dsH: number;
    if (sourceW >= sourceH) {
        dsW = BLUR_DOWNSCALE_MAX;
        dsH = Math.max(2, Math.round(BLUR_DOWNSCALE_MAX / ratio));
    } else {
        dsH = BLUR_DOWNSCALE_MAX;
        dsW = Math.max(2, Math.round(BLUR_DOWNSCALE_MAX * ratio));
    }
    if (helper.smallCanvas.width !== dsW) helper.smallCanvas.width = dsW;
    if (helper.smallCanvas.height !== dsH) helper.smallCanvas.height = dsH;
    drawBlurSource(helper.smallCtx, source, 0, 0, sourceW, sourceH, 0, 0, dsW, dsH);
    // 1b. Black out privacy regions BEFORE the blur: the backdrop is a copy of
    // the whole frame, so without this the region content ships in the bars -
    // and on engines where ctx.filter is a silent no-op (Safari
    // OffscreenCanvas) it would ship nearly sharp. smallCanvas holds the full
    // frame, so normalized rects scale straight to its dimensions.
    if (censorRegions?.length) {
        helper.smallCtx.fillStyle = "#000";
        for (const region of censorRegions) {
            const patch = mapRegionRectToDest(region.rect, sourceW, sourceH, 0, 0, sourceW, sourceH, 0, 0, dsW, dsH);
            if (patch) helper.smallCtx.fillRect(patch.x, patch.y, patch.w, patch.h);
        }
    }
    // 2. Blur via ctx.filter onto a separate canvas (filter applies to the
    //    draw operation - cannot be applied in-place).
    if (helper.blurCanvas.width !== dsW) helper.blurCanvas.width = dsW;
    if (helper.blurCanvas.height !== dsH) helper.blurCanvas.height = dsH;
    // Resizing used to clear this backing store every frame. Keep that pixel
    // invariant when dimensions are unchanged so filtered transparent edges
    // cannot retain data from the previous source frame.
    helper.blurCtx.clearRect(0, 0, dsW, dsH);
    helper.blurCtx.filter = `blur(${BLUR_RADIUS_PX}px)`;
    helper.blurCtx.drawImage(helper.smallCanvas, 0, 0);
    helper.blurCtx.filter = "none";
    // 3. Upscale cover-fit into dest. Clip is required - cover can extend
    //    beyond dest boundaries (negative dx/dy).
    const cover = fitKeepAspectCover(dsW, dsH, dw, dh);
    destCtx.save();
    destCtx.beginPath();
    destCtx.rect(dx, dy, dw, dh);
    destCtx.clip();
    destCtx.drawImage(helper.blurCanvas, 0, 0, dsW, dsH, dx + cover.dx, dy + cover.dy, cover.dw, cover.dh);
    destCtx.restore();
}

/** Rectangle in normalized source coordinates (0..1). */
export interface CropRect {
    xPct: number;
    yPct: number;
    wPct: number;
    hPct: number;
}

// AspectId source of truth is in src/transcode/types.ts; re-exported here
// for convenience at compose call sites.
import { aspectRatio, ensureEven, type AspectId, type LetterboxFill } from "./types.js";
export type { AspectId };

/**
 * Center-crops the source to a target aspect: the largest centered CropRect of
 * `targetAspect` that fits inside sourceW×sourceH (full frame when the aspects
 * already match). The default render path letterboxes instead (crop=null), so
 * this serves the explicit "snap crop to a preset aspect" control in the crop
 * editor - see applyAspectPreset in src/ui/player-crop.ts.
 */
export function computeAutoCrop(sourceW: number, sourceH: number, targetAspect: AspectId): CropRect {
    const outAspectRatio = aspectRatio(targetAspect);
    const sourceRatio = sourceW / sourceH;
    if (Math.abs(outAspectRatio - sourceRatio) < 0.001) {
        return { xPct: 0, yPct: 0, wPct: 1, hPct: 1 };
    }
    if (sourceRatio > outAspectRatio) {
        // source wider than output - crop horizontally, center.
        const cropW = sourceH * outAspectRatio;
        const cropX = (sourceW - cropW) / 2;
        return { xPct: cropX / sourceW, yPct: 0, wPct: cropW / sourceW, hPct: 1 };
    }
    // source narrower than output - crop vertically.
    const cropH = sourceW / outAspectRatio;
    const cropY = (sourceH - cropH) / 2;
    return { xPct: 0, yPct: cropY / sourceH, wPct: 1, hPct: cropH / sourceH };
}

/**
 * Computes output dimensions: height is given, width derived from aspect ratio.
 * Both are rounded to even values (H.264 requirement).
 */
export function computeOutputSize(targetHeight: number, aspect: AspectId): { width: number; height: number } {
    const ratio = aspectRatio(aspect);
    const height = ensureEven(targetHeight);
    const width = ensureEven(Math.round(height * ratio));
    return { width, height };
}

/**
 * Cover-fit: dest is filled completely, src proportions are preserved, excess
 * is cropped on the opposite axis. Used for the blur backdrop (fill a slot
 * completely with a blurred frame, no bars). dx/dy may be negative (extends
 * beyond dst boundaries).
 */
export function fitKeepAspectCover(
    srcW: number,
    srcH: number,
    dstW: number,
    dstH: number,
): { dx: number; dy: number; dw: number; dh: number } {
    if (srcW <= 0 || srcH <= 0) return { dx: 0, dy: 0, dw: dstW, dh: dstH };
    const srcRatio = srcW / srcH;
    const dstRatio = dstW / dstH;
    if (srcRatio > dstRatio) {
        // src wider than dst - fit to height, excess on the sides is cropped.
        const dh = dstH;
        const dw = Math.round(dh * srcRatio);
        return { dx: Math.round((dstW - dw) / 2), dy: 0, dw, dh };
    }
    const dw = dstW;
    const dh = Math.round(dw / srcRatio);
    return { dx: 0, dy: Math.round((dstH - dh) / 2), dw, dh };
}

/**
 * Fits a source rect inside a dst rect with keep-aspect (letterbox or
 * pillarbox as needed). Returns the dest sub-rect that has the same aspect
 * as src. The caller is responsible for filling the bars between this rect
 * and the dst boundary with black or a blur backdrop.
 */
export function fitKeepAspect(
    srcW: number,
    srcH: number,
    dstW: number,
    dstH: number,
): { dx: number; dy: number; dw: number; dh: number } {
    if (srcW <= 0 || srcH <= 0 || dstW <= 0 || dstH <= 0) {
        return { dx: 0, dy: 0, dw: dstW, dh: dstH };
    }
    const srcRatio = srcW / srcH;
    const dstRatio = dstW / dstH;
    if (srcRatio > dstRatio) {
        // src wider than dst - fit to width, letterbox top/bottom.
        const dw = dstW;
        const dh = Math.round(dstW / srcRatio);
        return { dx: 0, dy: Math.round((dstH - dh) / 2), dw, dh };
    }
    // src narrower than dst (or equal) - fit to height, pillarbox on the sides.
    const dh = dstH;
    const dw = Math.round(dstH * srcRatio);
    return { dx: Math.round((dstW - dw) / 2), dy: 0, dw, dh };
}

/**
 * Render options for drawMain/drawSplitScreen. fill controls what fills the
 * letterbox bars (or empty slots): "black" (default) - plain fillRect;
 * "blur" + blurHelper - blurred cover copy of the source as backdrop.
 * If fill="blur" but no helper is provided, falls back to "black".
 * regionBlurHelper is required for painting privacy region blurs (pixelate /
 * soft-blur styles need a scratch canvas); without it regions fall back to
 * solid fill so a missing helper can never leak unredacted pixels.
 */
export interface RenderFillOpts {
    fill?: LetterboxFill;
    blurHelper?: BlurHelper | null;
    regionBlurHelper?: RegionBlurHelper | null;
}

// === Privacy region blurs (see src/blur-regions.ts for the track model) ===

interface RegionBlurSurface {
    canvas: OffscreenCanvas;
    ctx: OffscreenCanvasRenderingContext2D;
}

/** Exact-size scratch canvases retain sampling boundaries while avoiding a
 *  backing-store resize whenever consecutive masks use different grids. */
export interface RegionBlurHelper {
    surfaces: Map<string, RegionBlurSurface>;
    activeKey: string | null;
}

export function createRegionBlurHelper(): RegionBlurHelper {
    return { surfaces: new Map(), activeKey: null };
}

const REGION_BLUR_SURFACE_LIMIT = 64;

function regionBlurSurface(helper: RegionBlurHelper, cols: number, rows: number): RegionBlurSurface {
    const key = `${cols}x${rows}`;
    let surface = helper.surfaces.get(key);
    if (surface) {
        // Switching grids clears the old single-canvas backing store. Preserve
        // that behavior for transparent input without reallocating its pixels.
        if (key !== helper.activeKey) surface.ctx.clearRect(0, 0, cols, rows);
        helper.surfaces.delete(key);
    } else {
        if (helper.surfaces.size >= REGION_BLUR_SURFACE_LIMIT) {
            const oldest = helper.surfaces.keys().next().value!;
            surface = helper.surfaces.get(oldest)!;
            helper.surfaces.delete(oldest);
            surface.canvas.width = cols;
            surface.canvas.height = rows;
        } else {
            const canvas = new OffscreenCanvas(cols, rows);
            const ctx = canvas.getContext("2d", { alpha: false });
            if (!ctx) throw new Error("createRegionBlurHelper: scratch canvas ctx unavailable");
            surface = { canvas, ctx };
        }
        surface.ctx.imageSmoothingEnabled = true;
        surface.ctx.imageSmoothingQuality = "high";
    }
    helper.surfaces.set(key, surface);
    helper.activeKey = key;
    return surface;
}

/** Axis-aligned rect in destination pixels. */
export interface PxRect {
    x: number;
    y: number;
    w: number;
    h: number;
}

/**
 * Maps a region rect (normalized source coords) into destination pixels, given
 * the visible source view (sx/sy/sw/sh, source px - the crop window drawMain /
 * drawSplitScreen computed) and the dest rect that view was fitted into.
 * Returns null when the region does not intersect the visible view (fully
 * cropped away). The returned rect is clipped to the dest rect and rounded
 * OUTWARD (floor origin, ceil far edge) - a privacy patch must never undercover
 * the region by a rounding pixel.
 */
export function mapRegionRectToDest(
    region: CropRect,
    sourceW: number,
    sourceH: number,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
): PxRect | null {
    if (sw <= 0 || sh <= 0 || dw <= 0 || dh <= 0) return null;
    const rx = region.xPct * sourceW;
    const ry = region.yPct * sourceH;
    const rw = region.wPct * sourceW;
    const rh = region.hPct * sourceH;
    // Region -> dest via the same linear map the video content took.
    const px = dx + ((rx - sx) / sw) * dw;
    const py = dy + ((ry - sy) / sh) * dh;
    const pw = (rw / sw) * dw;
    const ph = (rh / sh) * dh;
    // Clip to the dest rect (the part of the region outside the crop window is
    // not painted as video, so there is nothing to cover there).
    const x1 = Math.max(px, dx);
    const y1 = Math.max(py, dy);
    const x2 = Math.min(px + pw, dx + dw);
    const y2 = Math.min(py + ph, dy + dh);
    // Null only for an EMPTY intersection. A sub-pixel sliver still falls
    // through to floor/ceil and gets a >=1px cover - dropping it would ship
    // one anti-aliased column of the marked content unredacted.
    if (x2 <= x1 || y2 <= y1) return null;
    const x = Math.floor(x1);
    const y = Math.floor(y1);
    return { x, y, w: Math.ceil(x2) - x, h: Math.ceil(y2) - y };
}

/** Pixelate target: ~this many mosaic blocks along the region's smaller side.
 *  Coarse blocks are the point: a plate should span 2-3 blocks, a face a
 *  handful. NOT a cryptographic guarantee - published attacks recover finely
 *  pixelated text - which is why "fill" exists as the maximum-privacy option. */
const PIXELATE_BLOCKS_MIN_DIM = 6;

/**
 * Snaps a region rect OUTWARD to a mosaic grid anchored at the source frame
 * origin, then clips it to the visible view window [vx..vx+vw]x[vy..vy+vh]
 * (source px) and returns the VISIBLE rect plus the block-grid dims of that
 * visible part. Anchoring to the scene (not the box) matters: a grid glued to
 * a lerping box re-samples sub-block phases every frame - the classic
 * multi-frame reconstruction lever. Deriving cols/rows from the VISIBLE part
 * matters just as much: a grid sized for the full rect but painted over a
 * crop-clipped sliver collapses the block size toward 1px (near-identity
 * "mosaic") exactly where a plate slides past the crop edge. Returns null
 * when nothing of the region is visible.
 */
export function snapRegionToMosaicGrid(
    rect: CropRect,
    sourceW: number,
    sourceH: number,
    vx: number,
    vy: number,
    vw: number,
    vh: number,
): { rect: CropRect; cols: number; rows: number } | null {
    const rw = rect.wPct * sourceW;
    const rh = rect.hPct * sourceH;
    if (rw <= 0 || rh <= 0 || vw <= 0 || vh <= 0) return null;
    const block = Math.max(4, Math.min(rw, rh) / PIXELATE_BLOCKS_MIN_DIM);
    const x0 = Math.max(Math.floor((rect.xPct * sourceW) / block) * block, vx);
    const y0 = Math.max(Math.floor((rect.yPct * sourceH) / block) * block, vy);
    const x1 = Math.min(Math.ceil((rect.xPct * sourceW + rw) / block) * block, vx + vw);
    const y1 = Math.min(Math.ceil((rect.yPct * sourceH + rh) / block) * block, vy + vh);
    if (x1 <= x0 || y1 <= y0) return null;
    return {
        rect: { xPct: x0 / sourceW, yPct: y0 / sourceH, wPct: (x1 - x0) / sourceW, hPct: (y1 - y0) / sourceH },
        cols: Math.max(1, Math.round((x1 - x0) / block)),
        rows: Math.max(1, Math.round((y1 - y0) / block)),
    };
}
/** Soft blur retains more samples than mosaic, then smooths their edges. */
const SOFT_BLUR_SAMPLES_MIN_DIM = 12;

/** Source-relative sampling keeps soft blur equally strong in preview and
 *  export. Crop clipping retains the original block size, so a narrow visible
 *  sliver cannot become a finely sampled strip. */
export function softBlurRegionGrid(
    rect: CropRect,
    sourceW: number,
    sourceH: number,
    vx: number,
    vy: number,
    vw: number,
    vh: number,
): { rect: CropRect; cols: number; rows: number } | null {
    const rw = rect.wPct * sourceW;
    const rh = rect.hPct * sourceH;
    if (rw <= 0 || rh <= 0 || vw <= 0 || vh <= 0) return null;
    const block = Math.max(2, Math.min(rw, rh) / SOFT_BLUR_SAMPLES_MIN_DIM);
    const x0 = Math.max(rect.xPct * sourceW, vx);
    const y0 = Math.max(rect.yPct * sourceH, vy);
    const x1 = Math.min(rect.xPct * sourceW + rw, vx + vw);
    const y1 = Math.min(rect.yPct * sourceH + rh, vy + vh);
    if (x1 <= x0 || y1 <= y0) return null;
    return {
        rect: { xPct: x0 / sourceW, yPct: y0 / sourceH, wPct: (x1 - x0) / sourceW, hPct: (y1 - y0) / sourceH },
        cols: Math.max(1, Math.round((x1 - x0) / block)),
        rows: Math.max(1, Math.round((y1 - y0) / block)),
    };
}

/**
 * Paints one region patch onto destCtx. `source` provides the pixels to
 * pixelate/soft-blur and `srcRect` locates the patch inside it - the export
 * pipeline passes the composed output canvas itself (srcRect === destRect),
 * the live preview passes the <video> element with a video-pixel rect.
 * "fill" ignores the source entirely. Restores ctx smoothing state.
 * grid (optional) - source-relative sampling dims from snapRegionToMosaicGrid
 * or softBlurRegionGrid; without it the grid derives from destRect.
 */
export function paintRegionBlur(
    destCtx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    source: CanvasImageSource,
    srcRect: PxRect,
    destRect: PxRect,
    style: ResolvedRegionBlur["style"],
    helper: RegionBlurHelper | null,
    grid?: { cols: number; rows: number },
): void {
    if (destRect.w < 1 || destRect.h < 1) return;
    if (style === "fill" || !helper) {
        destCtx.fillStyle = "#000";
        destCtx.fillRect(destRect.x, destRect.y, destRect.w, destRect.h);
        return;
    }
    let cols: number;
    let rows: number;
    if (grid) {
        cols = grid.cols;
        rows = grid.rows;
    } else if (style === "pixelate") {
        const blockPx = Math.max(4, Math.min(destRect.w, destRect.h) / PIXELATE_BLOCKS_MIN_DIM);
        cols = Math.max(1, Math.round(destRect.w / blockPx));
        rows = Math.max(1, Math.round(destRect.h / blockPx));
    } else {
        const blockPx = Math.min(destRect.w, destRect.h) / SOFT_BLUR_SAMPLES_MIN_DIM;
        cols = Math.max(1, Math.round(destRect.w / blockPx));
        rows = Math.max(1, Math.round(destRect.h / blockPx));
    }
    const { canvas: scratchCanvas, ctx: scratchCtx } = regionBlurSurface(helper, cols, rows);
    // Downscale with smoothing ON: each scratch pixel box-averages its block.
    scratchCtx.drawImage(source, srcRect.x, srcRect.y, srcRect.w, srcRect.h, 0, 0, cols, rows);
    const prevSmoothing = destCtx.imageSmoothingEnabled;
    // Upscale: pixelate keeps hard block edges (smoothing off); soft-blur
    // re-smooths for the blurred look.
    destCtx.imageSmoothingEnabled = style !== "pixelate";
    destCtx.drawImage(scratchCanvas, 0, 0, cols, rows, destRect.x, destRect.y, destRect.w, destRect.h);
    destCtx.imageSmoothingEnabled = prevSmoothing;
}

/**
 * Maps + paints resolved region blurs for one drawn view. Samples pixels from
 * the destination canvas itself (the video layer was just drawn there), so it
 * must run right after the sample draw and before overlays/watermark.
 * Exported for the frame-capture path (player-capture), which draws the raw
 * source frame onto its own canvas and paints the same patches with an
 * identity view (full frame -> full canvas).
 */
export function paintRegionBlursForView(
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    regionBlurs: readonly ResolvedRegionBlur[],
    sourceW: number,
    sourceH: number,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
    helper: RegionBlurHelper | null,
): void {
    for (const rb of regionBlurs) {
        if (rb.style !== "fill") {
            const snapped =
                rb.style === "pixelate"
                    ? snapRegionToMosaicGrid(rb.rect, sourceW, sourceH, sx, sy, sw, sh)
                    : softBlurRegionGrid(rb.rect, sourceW, sourceH, sx, sy, sw, sh);
            if (!snapped) continue;
            const patch = mapRegionRectToDest(snapped.rect, sourceW, sourceH, sx, sy, sw, sh, dx, dy, dw, dh);
            if (!patch) continue;
            paintRegionBlur(ctx, ctx.canvas, patch, patch, rb.style, helper, {
                cols: snapped.cols,
                rows: snapped.rows,
            });
            continue;
        }
        const patch = mapRegionRectToDest(rb.rect, sourceW, sourceH, sx, sy, sw, sh, dx, dy, dw, dh);
        if (!patch) continue;
        paintRegionBlur(ctx, ctx.canvas, patch, patch, rb.style, helper);
    }
}

/**
 * Fills a dest rect per opts: blurs the source if fill="blur" and helper is
 * available, otherwise fills with black. Called by both drawMain and
 * drawSplitScreen before the fit draw.
 */
function fillBackdrop(
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    source: BlurSource | null,
    sourceW: number,
    sourceH: number,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
    opts: RenderFillOpts | undefined,
    censorRegions?: readonly ResolvedRegionBlur[] | null,
): void {
    if (opts?.fill === "blur" && opts.blurHelper && source) {
        fillBlurredCover(ctx, source, sourceW, sourceH, dx, dy, dw, dh, opts.blurHelper, censorRegions);
        return;
    }
    ctx.fillStyle = "#000";
    ctx.fillRect(dx, dy, dw, dh);
}

/**
 * True when the fitted draw is guaranteed to overpaint every pixel of the
 * output, so the backdrop underneath it can never show through: the fit rect
 * covers the frame exactly AND the source pixels are opaque. `sampleFormat` is
 * the VideoSample pixel format - one carrying alpha ("...A") would blend with
 * whatever the previous frame left on the reused canvas, so it keeps the
 * backdrop; an unknown (null) format is treated as possibly-transparent for the
 * same reason.
 */
export function fitHidesBackdrop(
    fit: { dx: number; dy: number; dw: number; dh: number },
    outputW: number,
    outputH: number,
    sampleFormat: string | null,
): boolean {
    if (fit.dx !== 0 || fit.dy !== 0 || fit.dw !== outputW || fit.dh !== outputH) return false;
    return sampleFormat !== null && !sampleFormat.includes("A");
}

/**
 * Draws the main sample onto ctx. crop=null - fits the full source frame into
 * output; crop set - fits the selected zone. Both cases use keep-aspect-fit:
 * if the selected zone's aspect differs from the output aspect, letterbox bars
 * are filled via fillBackdrop according to opts.fill.
 *
 * regionBlurs (optional) - privacy patches painted over the video layer right
 * after the sample draw, before the caller's overlays/watermark.
 *
 * VideoSample.draw handles rotation/pixelAspectRatio metadata internally.
 */
export function drawMain(
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    sample: VideoSample,
    crop: CropRect | null,
    outputW: number,
    outputH: number,
    opts?: RenderFillOpts,
    regionBlurs?: readonly ResolvedRegionBlur[] | null,
): void {
    const sourceW = sample.displayWidth;
    const sourceH = sample.displayHeight;
    let sx: number;
    let sy: number;
    let sw: number;
    let sh: number;
    if (crop) {
        sx = Math.max(0, Math.round(crop.xPct * sourceW));
        sy = Math.max(0, Math.round(crop.yPct * sourceH));
        sw = Math.min(sourceW - sx, Math.round(crop.wPct * sourceW));
        sh = Math.min(sourceH - sy, Math.round(crop.hPct * sourceH));
    } else {
        sx = 0;
        sy = 0;
        sw = sourceW;
        sh = sourceH;
    }
    const fit = fitKeepAspect(sw, sh, outputW, outputH);
    // The backdrop exists for the letterbox bars only. On a same-aspect export
    // (the common 16:9 source -> 16:9 output) the fit covers the frame, so both
    // the full-canvas black fill and the far pricier blurred cover would be
    // overpainted whole - on every frame of the run.
    if (!fitHidesBackdrop(fit, outputW, outputH, sample.format)) {
        fillBackdrop(ctx, sample, sourceW, sourceH, 0, 0, outputW, outputH, opts, regionBlurs);
    }
    sample.draw(ctx, sx, sy, sw, sh, fit.dx, fit.dy, fit.dw, fit.dh);
    if (regionBlurs?.length) {
        paintRegionBlursForView(
            ctx,
            regionBlurs,
            sourceW,
            sourceH,
            sx,
            sy,
            sw,
            sh,
            fit.dx,
            fit.dy,
            fit.dw,
            fit.dh,
            opts?.regionBlurHelper ?? null,
        );
    }
}

// drawPip / PipDrawSettings removed - PiP is now a split-layout (pip2/pip3/pip4)
// with rounded slots. See drawSplitScreen + getSplitSlots.

/**
 * One slot in a split-screen layout, in normalized output coordinates (0..1).
 * `rounded`: if true, the content is clipped with roundRect (PiP-style
 * overlay on top of the main slot).
 */
export interface SplitSlot {
    x: number;
    y: number;
    w: number;
    h: number;
    rounded?: boolean;
}

/**
 * Composition layout identifier.
 * - single - one slot covering the full frame (single-channel export).
 * - h2 / v2 / left1right2 / left2right1 / grid2x2 - tiled layouts (equal slots).
 * - pip2 / pip3 / pip4 - PiP-style: slot 0 covers the full frame, the rest
 *   are small rounded overlays on top (right column, stacked bottom to top).
 *
 * The name "SplitLayout" is historical; it now covers all composition modes
 * including single, so one render path handles everything
 * (single = layout with 1 full-frame slot).
 */
export type SplitLayout = "single" | "h2" | "v2" | "left1right2" | "left2right1" | "grid2x2" | "pip2" | "pip3" | "pip4";

/**
 * Characteristic size of a PiP overlay as a fraction of output_h (28%).
 * Real dimensions are derived from it: height = PIP_OVERLAY_CHAR_SIZE × output_h,
 * width = height × effective_aspect. This gives all overlays the same visual
 * "weight" regardless of their own aspect ratio.
 */
export const PIP_OVERLAY_CHAR_SIZE = 0.28;
const PIP_OVERLAY_MARGIN = 0.02;
/** Max overlay width as a fraction of output_w (guard for wide aspects on a narrow output). */
export const PIP_OVERLAY_MAX_W = 0.4;

/**
 * Context for getSplitSlots - controls the dimensions and positions of
 * dynamic-aspect overlays in pip-layouts. Has no effect on tile layouts
 * (h2/v2/grid2x2/left1right2/left2right1).
 */
export interface SplitSlotsContext {
    /** Output aspect (output_w/output_h). Needed to convert dynamic overlay dimensions into normalized output coords. */
    outputAspect: number;
    /**
     * Effective aspect of each slot (W/H after applying crop).
     * Slot 0 (main) is ignored - it fills the full frame. If absent or null
     * for an overlay, defaults to 1:1.
     */
    slotEffectiveAspects?: ReadonlyArray<number | null | undefined>;
    /**
     * Custom overlay positions in output coords (fractions). Only for overlay
     * slots (slotIdx >= 1 in pip-layouts). null/undefined = default position
     * (RB stack, bottom to top).
     */
    overlayPositions?: ReadonlyArray<{ xPct: number; yPct: number } | null | undefined>;
    /**
     * Per-slot user-controlled scale for PiP overlays (multiplier on the default).
     * 1.0 = base size from PIP_OVERLAY_CHAR_SIZE. Range ~[0.3, 2.0]. null/undefined
     * = 1.0. Applies only to pip-* layouts, slotIdx >= 1.
     */
    slotPipScales?: ReadonlyArray<number | null | undefined>;
}

/**
 * Effective aspect of a slot's content after applying crop. Without crop -
 * source aspect. With crop - aspect of the selected zone in source pixels:
 * (cropW / cropH) = (cropPct.w * srcW) / (cropPct.h * srcH) =
 * (cropPct.w / cropPct.h) * srcAspect.
 */
export function computeEffectiveAspect(sourceAspect: number, crop: CropRect | null): number {
    if (!crop || crop.hPct <= 0) return sourceAspect;
    return (crop.wPct / crop.hPct) * sourceAspect;
}

/**
 * Computes PiP overlay dimensions in normalized output coords from effective
 * aspect and output aspect. Height is fixed (28% of output_h); width is
 * derived from the aspect. If widthPct exceeds PIP_OVERLAY_MAX_W, both axes
 * are scaled down proportionally (aspect preserved).
 */
export function computeOverlayDims(
    effectiveAspect: number,
    outputAspect: number,
    userScale = 1,
): { wPct: number; hPct: number } {
    const hPct = PIP_OVERLAY_CHAR_SIZE * Math.max(0.3, Math.min(2.0, userScale));
    const wPct = (hPct * effectiveAspect) / outputAspect;
    if (wPct > PIP_OVERLAY_MAX_W) {
        const scale = PIP_OVERLAY_MAX_W / wPct;
        return { wPct: PIP_OVERLAY_MAX_W, hPct: hPct * scale };
    }
    return { wPct, hPct };
}

/**
 * Returns slots for a layout. Order is fixed: slot 0 is the "primary" (for
 * layouts with unequal parts), then left-to-right, top-to-bottom. For
 * pip-layouts: slot 0 = main full frame; the rest are rounded overlays
 * (default: bottom-right corner stack from bottom to top;
 * ctx.overlayPositions[i] overrides the default).
 *
 * ctx is required only for pip-* layouts (tile layouts can omit it). Without
 * ctx pip overlays default to 16:9 aspect and 16:9 output aspect - compatible
 * with behavior before dynamic-aspect.
 */
export function getSplitSlots(layout: SplitLayout, ctx?: SplitSlotsContext): SplitSlot[] {
    switch (layout) {
        case "single":
            return [{ x: 0, y: 0, w: 1, h: 1 }];
        case "h2":
            return [
                { x: 0, y: 0, w: 0.5, h: 1 },
                { x: 0.5, y: 0, w: 0.5, h: 1 },
            ];
        case "v2":
            return [
                { x: 0, y: 0, w: 1, h: 0.5 },
                { x: 0, y: 0.5, w: 1, h: 0.5 },
            ];
        case "left1right2":
            return [
                { x: 0, y: 0, w: 0.5, h: 1 },
                { x: 0.5, y: 0, w: 0.5, h: 0.5 },
                { x: 0.5, y: 0.5, w: 0.5, h: 0.5 },
            ];
        case "left2right1":
            return [
                { x: 0, y: 0, w: 0.5, h: 0.5 },
                { x: 0, y: 0.5, w: 0.5, h: 0.5 },
                { x: 0.5, y: 0, w: 0.5, h: 1 },
            ];
        case "grid2x2":
            return [
                { x: 0, y: 0, w: 0.5, h: 0.5 },
                { x: 0.5, y: 0, w: 0.5, h: 0.5 },
                { x: 0, y: 0.5, w: 0.5, h: 0.5 },
                { x: 0.5, y: 0.5, w: 0.5, h: 0.5 },
            ];
        case "pip2":
        case "pip3":
        case "pip4": {
            // Slot 0 - main covering the full frame.
            const slots: SplitSlot[] = [{ x: 0, y: 0, w: 1, h: 1 }];
            const overlayCount = layout === "pip2" ? 1 : layout === "pip3" ? 2 : 3;
            const outputAspect = ctx?.outputAspect ?? 16 / 9;
            // Cumulative height of already-added overlays for the default RB stack.
            let cumStackH = 0;
            for (let i = 0; i < overlayCount; i++) {
                const slotIdx = i + 1;
                const effAspect = ctx?.slotEffectiveAspects?.[slotIdx] ?? 1;
                const userScale = ctx?.slotPipScales?.[slotIdx] ?? 1;
                const { wPct, hPct } = computeOverlayDims(effAspect, outputAspect, userScale);
                let x: number;
                let y: number;
                const userPos = ctx?.overlayPositions?.[slotIdx];
                if (userPos) {
                    x = userPos.xPct;
                    y = userPos.yPct;
                } else {
                    // Default RB stack: right edge with margin, bottom + sum
                    // of previous overlay heights (with margin between).
                    x = 1 - wPct - PIP_OVERLAY_MARGIN;
                    y = 1 - PIP_OVERLAY_MARGIN - hPct - cumStackH - i * PIP_OVERLAY_MARGIN;
                }
                slots.push({ x, y, w: wPct, h: hPct, rounded: true });
                cumStackH += hPct;
            }
            return slots;
        }
    }
}

/** Number of slots in a layout (for channel count validation). */
export function getSplitSlotCount(layout: SplitLayout): 1 | 2 | 3 | 4 {
    switch (layout) {
        case "single":
            return 1;
        case "h2":
        case "v2":
        case "pip2":
            return 2;
        case "left1right2":
        case "left2right1":
        case "pip3":
            return 3;
        case "grid2x2":
        case "pip4":
            return 4;
    }
}

/**
 * Draws one split-screen frame: each sample goes into its slot.
 *
 * samples.length must match the layout slot count; null in samples[i] means
 * "empty slot, black fill".
 *
 * slotCrops (optional) - per-slot crop in normalized source coordinates.
 * If slotCrops[i] is null/absent - fits the full frame (no crop); keep-aspect
 * below will letterbox if the slot and source aspect differ. If set - used
 * as-is and fitted into the slot with keep-aspect ("aspect-fit" bars appear
 * if the slot and crop aspect differ).
 *
 * slotRegionBlurs (optional) - per-slot privacy patches, painted over each
 * slot's video layer (inside the roundRect clip for PiP overlays, so patches
 * respect the rounded corners).
 */
export function drawSplitScreen(
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    samples: ReadonlyArray<VideoSample | null>,
    slots: ReadonlyArray<SplitSlot>,
    outputW: number,
    outputH: number,
    slotCrops?: ReadonlyArray<CropRect | null>,
    opts?: RenderFillOpts,
    slotRegionBlurs?: ReadonlyArray<readonly ResolvedRegionBlur[] | null>,
): void {
    if (samples.length !== slots.length) {
        throw new Error(`split-screen: expected ${slots.length} samples, got ${samples.length}`);
    }
    // Overall black background. Covers the areas between slots in irregular
    // layouts. Per-slot blur backdrop is done separately below (so each slot
    // gets a backdrop from its own channel, not a shared one).
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, outputW, outputH);
    for (let i = 0; i < slots.length; i++) {
        const sample = samples[i];
        const slot = slots[i]!;
        const dx = Math.round(slot.x * outputW);
        const dy = Math.round(slot.y * outputH);
        const dw = Math.max(2, Math.round(slot.w * outputW));
        const dh = Math.max(2, Math.round(slot.h * outputH));
        if (!sample) continue;
        const sourceW = sample.displayWidth;
        const sourceH = sample.displayHeight;
        const customCrop = slotCrops?.[i] ?? null;
        let sx: number;
        let sy: number;
        let sw: number;
        let sh: number;
        if (customCrop) {
            sx = Math.max(0, Math.round(customCrop.xPct * sourceW));
            sy = Math.max(0, Math.round(customCrop.yPct * sourceH));
            sw = Math.min(sourceW - sx, Math.round(customCrop.wPct * sourceW));
            sh = Math.min(sourceH - sy, Math.round(customCrop.hPct * sourceH));
        } else {
            // Default - fit the full frame (no crop); keep-aspect below will
            // letterbox if the slot aspect differs from the source.
            sx = 0;
            sy = 0;
            sw = sourceW;
            sh = sourceH;
        }
        // Letterbox-fit the cropped zone into the slot. fit.dx/dy are relative
        // to the slot origin; add dx/dy to get absolute canvas coordinates.
        const fit = fitKeepAspect(sw, sh, dw, dh);
        const drawX = dx + fit.dx;
        const drawY = dy + fit.dy;
        const regionBlurs = slotRegionBlurs?.[i];
        const paintSlotRegionBlurs = (): void => {
            if (!regionBlurs?.length) return;
            paintRegionBlursForView(
                ctx,
                regionBlurs,
                sourceW,
                sourceH,
                sx,
                sy,
                sw,
                sh,
                drawX,
                drawY,
                fit.dw,
                fit.dh,
                opts?.regionBlurHelper ?? null,
            );
        };
        if (slot.rounded) {
            // PiP-style overlay - clip with roundRect before drawing, restore
            // ctx after. Radius ~8% of the smaller dimension.
            const radius = Math.round(Math.min(dw, dh) * 0.08);
            ctx.save();
            // Use the shared polyfill (canvas-draw.ts) - native ctx.roundRect is
            // absent before Chromium 99, which is inside the re-encode floor
            // (WebCodecs encode = Chromium 94). roundRectPath calls beginPath.
            roundRectPath(ctx, dx, dy, dw, dh, radius);
            ctx.clip();
            fillBackdrop(ctx, sample, sourceW, sourceH, dx, dy, dw, dh, opts, regionBlurs);
            sample.draw(ctx, sx, sy, sw, sh, drawX, drawY, fit.dw, fit.dh);
            // Inside the clip: a patch on a rounded corner keeps the corner.
            paintSlotRegionBlurs();
            ctx.restore();
        } else {
            if (!fitHidesBackdrop(fit, dw, dh, sample.format)) {
                fillBackdrop(ctx, sample, sourceW, sourceH, dx, dy, dw, dh, opts, regionBlurs);
            }
            sample.draw(ctx, sx, sy, sw, sh, drawX, drawY, fit.dw, fit.dh);
            paintSlotRegionBlurs();
        }
    }
}
