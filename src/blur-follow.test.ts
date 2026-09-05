import { describe, expect, it } from "vitest";

import { applyTrackResult, followSeed } from "./blur-follow.js";
import { createBlurRegion, regionRectAt, upsertKeyframe } from "./blur-regions.js";
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

describe("followSeed", () => {
    it("tracks from the marked frame when coverage starts later", () => {
        const value = region();
        value.startSec = 4;
        expect(followSeed(value)?.contentSec).toBe(2);
        expect(followSeed(value)?.rect).toEqual(value.keyframes[0]!.rect);
    });

    it("uses the latest correction before the cover ends", () => {
        const value = region();
        const corrected = { xPct: 0.3, yPct: 0.2, wPct: 0.1, hPct: 0.1 };
        upsertKeyframe(value, 3, corrected, true);
        upsertKeyframe(value, 4, { ...corrected, xPct: 0.4 }, false);
        upsertKeyframe(value, 6, { ...corrected, xPct: 0.6 }, true);
        expect(followSeed(value)).toEqual({ contentSec: 3, rect: corrected });
    });
});

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

    it("holds a manually shortened tail instead of interpolating toward stale future tracking", () => {
        const value = region();
        value.autoEnd = false;
        const stale = { xPct: 0.8, yPct: 0.8, wPct: 0.1, hPct: 0.1 };
        upsertKeyframe(value, 8, stale, false);
        applyTrackResult(value, 2, 5, 10, result("lost", 4));

        expect(value.endSec).toBe(5);
        expect(regionRectAt(value, 4.5)).toEqual({ xPct: 0.4, yPct: 0.2, wPct: 0.2, hPct: 0.2 });
        expect(regionRectAt(value, 5)).toEqual({ xPct: 0.4, yPct: 0.2, wPct: 0.2, hPct: 0.2 });
        expect(value.keyframes.find((keyframe) => keyframe.contentSec === 8)?.rect).toEqual(stale);
    });

    it("holds the seed through an undecodable manual span while preserving a later user pin", () => {
        const value = region();
        value.autoEnd = false;
        const seedRect = { ...value.keyframes[0]!.rect };
        const laterPin = { xPct: 0.8, yPct: 0.8, wPct: 0.1, hPct: 0.1 };
        upsertKeyframe(value, 8, laterPin, true);
        applyTrackResult(value, 2, 5, 10, { endReason: "lost", trackedUntilSec: 2, keyframes: [] });

        expect(regionRectAt(value, 4.5)).toEqual(seedRect);
        expect(value.keyframes.find((keyframe) => keyframe.contentSec === 8)).toEqual({
            contentSec: 8,
            rect: laterPin,
            pinned: true,
        });
    });

    it("keeps the terminal hold distinct from a user pin just after the active end", () => {
        const value = region();
        value.autoEnd = false;
        const laterPin = { xPct: 0.8, yPct: 0.8, wPct: 0.1, hPct: 0.1 };
        upsertKeyframe(value, 5.001, laterPin, true);
        applyTrackResult(value, 2, 5, 10, result("lost", 4));

        expect(regionRectAt(value, 4.5)).toEqual({ xPct: 0.4, yPct: 0.2, wPct: 0.2, hPct: 0.2 });
        expect(regionRectAt(value, 5)).toEqual({ xPct: 0.4, yPct: 0.2, wPct: 0.2, hPct: 0.2 });
        expect(value.keyframes.find((keyframe) => keyframe.contentSec === 5.001)).toEqual({
            contentSec: 5.001,
            rect: laterPin,
            pinned: true,
        });
    });
});
