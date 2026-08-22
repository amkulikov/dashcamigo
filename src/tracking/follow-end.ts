import type { TrackResult } from "../workers/tracker-protocol.js";

/** Final fail-closed classification after the decode loop. A pending low-score
 *  or edge-exit ride-out at EOF is uncertainty, not a completed follow; a
 *  materially short decode is treated the same way. */
export function finalizeFollowEndReason(
    current: TrackResult["endReason"],
    opts: {
        initialized: boolean;
        lossPending: boolean;
        exitPending: boolean;
        requestedEndSec: number;
        lastAnalyzedSec: number;
        analysisIntervalSec: number;
    },
): TrackResult["endReason"] {
    if (current !== "completed") return current;
    if (!opts.initialized) return "lost";
    const decodeEndedEarly = opts.requestedEndSec - opts.lastAnalyzedSec > Math.max(1, opts.analysisIntervalSec * 2);
    return opts.lossPending || opts.exitPending || decodeEndedEarly ? "lost" : "completed";
}
