import { inflateRect } from "../blur-regions.js";
import type { CropRect } from "../transcode/compose.js";
import { boxVisibleFraction, type TrackBox } from "./track-guards.js";

/** Preserve off-frame coordinates for association and tracker state. */
export function boxToRect(box: TrackBox, frameW: number, frameH: number): CropRect {
    return {
        xPct: box.x / frameW,
        yPct: box.y / frameH,
        wPct: box.w / frameW,
        hPct: box.h / frameH,
    };
}

/** Pad the original box before intersecting the frame; invisible objects must
 *  not become fresh covers merely because their padding reaches the edge. */
export function visibleBoxRect(box: TrackBox, frameW: number, frameH: number, margin: number): CropRect | null {
    if (
        !(frameW > 0) ||
        !(frameH > 0) ||
        ![box.x, box.y, box.w, box.h].every(Number.isFinite) ||
        !(box.w > 0) ||
        !(box.h > 0) ||
        !(boxVisibleFraction(box, frameW, frameH) > 0)
    )
        return null;
    return inflateRect(boxToRect(box, frameW, frameH), margin);
}
