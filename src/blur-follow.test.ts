import { describe, expect, it } from "vitest";

import { applyTrackResult } from "./blur-follow.js";
import { createBlurRegion, regionRectAt } from "./blur-regions.js";
import type { TrackResult } from "./workers/tracker-protocol.js";

function region() {
    const value = createBlurRegion("front", "pixelate", 2, 5, 2, { xPct: 0.1, yPct: 0.1, wPct: 0.2, hPct: 0.2 });
    value.autoEnd = true;
    return value;
}

function result(endReason: TrackResult["endReason"], trackedUntilSec: number): TrackResult {
    return {
        endReason,
        trackedUntilSec,
        keyframes: [
            {
                contentSec: 4,
                rect: { xPct: 0.4, yPct: 0.2, wPct: 0.2, hPct: 0.2 },
            },
        ],
    };
}

describe("applyTrackResult", () => {
    it("keeps a completed Follow active through the footage end", () => {
        const value = region();
        applyTrackResult(value, 2, 10, 10, result("completed", 10));
        expect(value.endSec).toBe(10);
        expect(value.lastTrackLost).toBe(false);
    });

    it("ends only a confidently exited target at its last covered position", () => {
        const value = region();
        applyTrackResult(value, 2, 10, 10, result("exited", 6));
        expect(value.endSec).toBe(6);
        expect(value.lastTrackLost).toBe(true);
        expect(regionRectAt(value, 7)).toBeNull();
    });

    it("fails closed on target loss by holding the last cover to the end", () => {
        const value = region();
        applyTrackResult(value, 2, 10, 10, result("lost", 4));
        expect(value.endSec).toBe(10);
        expect(value.lastTrackLost).toBe(true);
        expect(regionRectAt(value, 9)).toEqual({ xPct: 0.4, yPct: 0.2, wPct: 0.2, hPct: 0.2 });
    });
});
