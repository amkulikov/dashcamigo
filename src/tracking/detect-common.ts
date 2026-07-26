// Shared plumbing for the frame detectors (plate-detector.ts, face-detector.ts):
// tile geometry, letterboxing into a fixed square model input, and IoU-greedy
// suppression of overlapping boxes. Pure canvas/math, no ort - unit-testable.
//
// Why tiles: a dashcam frame letterboxed whole into a 512/640 input destroys
// small objects (a readable 86 px plate on 4K becomes 11 px - invisible to the
// model; measured in private/research/plate-detector-spike). Each tile
// is letterboxed separately, detections are remapped to frame pixels and then
// deduped across the overlap seams.

/** One detection in FRAME pixels (not model-input pixels). */
export interface RawDetection {
    x: number;
    y: number;
    w: number;
    h: number;
    /** Model confidence 0..1. */
    score: number;
}

/** Tile side that keeps small-object detectability: ~2.5x downscale into a 512
 *  input matched the measured detection floor (~31-62 px native on 4K, below
 *  the ~60-80 px readability threshold). 4K -> 3x3, 2.5K/1080p -> 2x2, SD -> 1. */
const TILE_NATIVE_SPAN_PX = 1280;

/** Neighbor tiles overlap by this fraction of their span so an object sitting
 *  on a seam is fully inside at least one tile. */
export const TILE_OVERLAP_FRAC = 0.1;

/** Tiles per axis for a frame this wide. */
export function tileGridSize(frameW: number): number {
    if (!(frameW > 0)) return 1;
    return Math.max(1, Math.ceil(frameW / TILE_NATIVE_SPAN_PX));
}

export interface TileRect {
    sx: number;
    sy: number;
    sw: number;
    sh: number;
}

/** Overlapping n x n tile rects covering the frame (n = tileGridSize). */
export function tileRects(frameW: number, frameH: number): TileRect[] {
    const n = tileGridSize(frameW);
    const tw = frameW / n;
    const th = frameH / n;
    const ox = Math.round(tw * TILE_OVERLAP_FRAC);
    const oy = Math.round(th * TILE_OVERLAP_FRAC);
    const out: TileRect[] = [];
    for (let ty = 0; ty < n; ty++) {
        for (let tx = 0; tx < n; tx++) {
            const sx = Math.max(0, tx * tw - ox);
            const sy = Math.max(0, ty * th - oy);
            out.push({
                sx,
                sy,
                sw: Math.min(frameW - sx, tw + 2 * ox),
                sh: Math.min(frameH - sy, th + 2 * oy),
            });
        }
    }
    return out;
}

export interface LetterboxMap {
    /** source px -> input px scale. */
    scale: number;
    /** Content offset inside the input (0 when top-left anchored). */
    dx: number;
    dy: number;
}

/**
 * Draws source rect (sx,sy,sw,sh) into the square `size` canvas `scratch`,
 * aspect-preserving, padded with `fill`. `centered` matches each model's
 * training-time letterbox (YOLO centers on 114-gray; YuNet/OpenCV anchors
 * top-left on black). Returns the remap of input px back to source px.
 */
export function letterboxInto(
    scratch: OffscreenCanvas,
    source: CanvasImageSource,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    size: number,
    fill: string,
    centered: boolean,
): LetterboxMap {
    scratch.width = size;
    scratch.height = size;
    const ctx = scratch.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("detect: letterbox canvas ctx unavailable");
    ctx.fillStyle = fill;
    ctx.fillRect(0, 0, size, size);
    const scale = Math.min(size / sw, size / sh);
    const dw = Math.round(sw * scale);
    const dh = Math.round(sh * scale);
    const dx = centered ? Math.trunc((size - dw) / 2) : 0;
    const dy = centered ? Math.trunc((size - dh) / 2) : 0;
    ctx.drawImage(source, sx, sy, sw, sh, dx, dy, dw, dh);
    return { scale, dx, dy };
}

/** Intersection-over-union of two frame-pixel boxes. */
export function iouOf(a: RawDetection, b: RawDetection): number {
    const x1 = Math.max(a.x, b.x);
    const y1 = Math.max(a.y, b.y);
    const x2 = Math.min(a.x + a.w, b.x + b.w);
    const y2 = Math.min(a.y + a.h, b.y + b.h);
    const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
    const union = a.w * a.h + b.w * b.h - inter;
    return union > 0 ? inter / union : 0;
}

/** Greedy highest-score-first suppression: drops any box overlapping an
 *  already-kept one above `iouThreshold`. Handles both cross-tile duplicates
 *  (same object seen in two overlapping tiles) and in-model NMS leftovers. */
export function suppressOverlaps(detections: readonly RawDetection[], iouThreshold: number): RawDetection[] {
    const sorted = [...detections].sort((a, b) => b.score - a.score);
    const kept: RawDetection[] = [];
    for (const d of sorted) {
        if (!kept.some((k) => iouOf(k, d) > iouThreshold)) kept.push(d);
    }
    return kept;
}
