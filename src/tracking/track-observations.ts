import type { CropRect } from "../transcode/compose.js";
import { appendTrackKeyframe, type TrackKeyframe } from "./detect-track.js";

/** Holds become keyframes only on recovery, so an unresolved loss does not
 *  extend the track's last confirmed timestamp or its final forward hold. */
export interface PendingTrackHold {
    previousSec: number | null;
    latestSec: number | null;
}

export function recordTrackHold(pending: PendingTrackHold, contentSec: number): void {
    if (pending.latestSec === contentSec) return;
    pending.previousSec = pending.latestSec;
    pending.latestSec = contentSec;
}

export function appendTrackObservation(
    keyframes: TrackKeyframe[],
    pending: PendingTrackHold,
    contentSec: number,
    rect: CropRect,
): void {
    // A detector can recover on the same frame the tracker rejected. Preserve
    // the preceding hold; a hold at this timestamp would be overwritten below.
    const holdSec =
        pending.latestSec !== null && pending.latestSec < contentSec ? pending.latestSec : pending.previousSec;
    const last = keyframes[keyframes.length - 1];
    if (last && holdSec !== null && holdSec > last.contentSec && holdSec < contentSec) {
        appendTrackKeyframe(keyframes, holdSec, last.rect);
    }
    appendTrackKeyframe(keyframes, contentSec, rect);
    pending.previousSec = null;
    pending.latestSec = null;
}
