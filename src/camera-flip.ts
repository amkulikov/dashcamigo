import type { CropRect, PxRect } from "./transcode/compose.js";

export interface CameraFlip {
    horizontal: boolean;
    vertical: boolean;
}

export const NO_CAMERA_FLIP: Readonly<CameraFlip> = { horizontal: false, vertical: false };

export function hasCameraFlip(flip?: Readonly<CameraFlip>): boolean {
    return !!(flip?.horizontal || flip?.vertical);
}

/** Reflection is its own inverse: converts source coordinates to/from the visible image. */
export function flipCropRect(rect: CropRect, flip?: Readonly<CameraFlip>): CropRect {
    return {
        ...rect,
        xPct: flip?.horizontal ? 1 - rect.xPct - rect.wPct : rect.xPct,
        yPct: flip?.vertical ? 1 - rect.yPct - rect.hPct : rect.yPct,
    };
}

export function flipPixelRect(rect: PxRect, bounds: PxRect, flip?: Readonly<CameraFlip>): PxRect {
    return {
        ...rect,
        x: flip?.horizontal ? 2 * bounds.x + bounds.w - rect.x - rect.w : rect.x,
        y: flip?.vertical ? 2 * bounds.y + bounds.h - rect.y - rect.h : rect.y,
    };
}

/** The caller owns save/restore so overlays never inherit the camera transform. */
export function applyCanvasFlip(
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    bounds: PxRect,
    flip?: Readonly<CameraFlip>,
): void {
    if (!hasCameraFlip(flip)) return;
    ctx.translate(flip?.horizontal ? 2 * bounds.x + bounds.w : 0, flip?.vertical ? 2 * bounds.y + bounds.h : 0);
    ctx.scale(flip?.horizontal ? -1 : 1, flip?.vertical ? -1 : 1);
}
