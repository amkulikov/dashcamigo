import { iouOf, type RawDetection } from "./detect-common.js";
import type { TrackBox } from "./track-guards.js";

const WEAK_ANCHOR_MIN_IOU = 0.5;
const WEAK_ANCHOR_MAX_SIZE_RATIO = 1.5;

/** A below-seed detection may maintain a close match, but cannot authorize a
 *  large scale correction or a move onto a neighboring object. Strong evidence
 *  can instead start a separate trajectory when the original budget expires. */
export function weakDetectionCanReanchor(detection: RawDetection, current: TrackBox): boolean {
    if (iouOf(detection, { ...current, score: 0 }) < WEAK_ANCHOR_MIN_IOU) return false;
    const widthRatio = detection.w / current.w;
    const heightRatio = detection.h / current.h;
    return (
        widthRatio >= 1 / WEAK_ANCHOR_MAX_SIZE_RATIO &&
        widthRatio <= WEAK_ANCHOR_MAX_SIZE_RATIO &&
        heightRatio >= 1 / WEAK_ANCHOR_MAX_SIZE_RATIO &&
        heightRatio <= WEAK_ANCHOR_MAX_SIZE_RATIO
    );
}
