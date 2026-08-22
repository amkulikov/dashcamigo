// Pure folding of a tracker result into a mutable blur region. Kept outside the
// UI/worker modules so the privacy-sensitive end-of-pass policy is directly
// testable: uncertain tails fail closed and hold the last known cover.

import { MIN_ZONE_SPAN_SEC, replaceGeneratedKeyframes, type BlurRegion } from "./blur-regions.js";
import type { TrackResult } from "./workers/tracker-protocol.js";

export function applyTrackResult(
    region: BlurRegion,
    fromSec: number,
    toSec: number,
    contentDurationSec: number,
    result: TrackResult,
): void {
    replaceGeneratedKeyframes(region, fromSec, toSec, result.keyframes);
    if (region.autoEnd) {
        region.endSec =
            result.endReason === "exited"
                ? Math.min(contentDurationSec, Math.max(result.trackedUntilSec, region.startSec + MIN_ZONE_SPAN_SEC))
                : contentDurationSec;
    }
    region.lastTrackLost = result.endReason !== "completed";
}
