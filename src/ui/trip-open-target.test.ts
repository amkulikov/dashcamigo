import { describe, expect, it } from "vitest";

import type { Trip, VideoCandidate } from "../trips.js";

import { captureTripOpenTarget, closestEventIndex, resolveTripOpenTarget } from "./trip-open-target.js";

function candidate(file: File, relativePath: string, sourceKey = "card-a"): VideoCandidate {
    return { file, relativePath, sourceKey } as VideoCandidate;
}

function trip(
    candidates: VideoCandidate[],
    options: { startUtc?: number; endUtc?: number; eventUtc?: number } = {},
): Trip {
    return {
        startUtc: options.startUtc ?? 100,
        endUtc: options.endUtc ?? 200,
        events: options.eventUtc === undefined ? [] : [{ unixSeconds: options.eventUtc }],
        frames: candidates.map((item) => ({ channels: { front: item } })),
    } as unknown as Trip;
}

describe("trip-open target identity", () => {
    it("follows a recording after container repair replaces its File object", () => {
        const original = new File(["abc"], "clip.mp4", { lastModified: 42 });
        const clicked = trip([candidate(original, "Normal/clip.mp4")]);
        const target = captureTripOpenTarget([clicked], 0);
        expect(target).not.toBeNull();

        // Container repair makes a new File with the same source metadata, then
        // the closing regroup can move it to another positional trip index.
        const repaired = new File(["xyz"], "clip.mp4", { lastModified: 42 });
        const unrelated = new File(["abc"], "clip.mp4", { lastModified: 42 });
        const regrouped = [
            trip([candidate(unrelated, "Normal/clip.mp4", "card-b")]),
            trip([candidate(repaired, "Normal/clip.mp4")]),
        ];

        expect(resolveTripOpenTarget(regrouped, target!)).toEqual({ tripIdx: 1, frameIdx: 0 });
    });

    it("keeps an exact clip row exact while carrying the whole-trip join identity", () => {
        const first = candidate(new File(["a"], "a.mp4"), "a.mp4");
        const second = candidate(new File(["b"], "b.mp4"), "b.mp4");
        const target = captureTripOpenTarget([trip([first, second])], 0, 1);

        expect(target?.exactFrame).toBe(true);
        expect(target?.keys).toHaveLength(1);
        expect(target?.tripKeys).toHaveLength(2);
    });

    it("resolves a rebuilt event to the surviving trip nearest its original UTC", () => {
        const first = candidate(new File(["a"], "a.mp4"), "a.mp4");
        const second = candidate(new File(["b"], "b.mp4"), "b.mp4");
        const target = captureTripOpenTarget([trip([first, second], { eventUtc: 1_050 })], 0, undefined, 0);
        expect(target).not.toBeNull();

        const split = [
            trip([first], { startUtc: 100, endUtc: 200 }),
            trip([second], { startUtc: 1_000, endUtc: 1_100 }),
        ];
        expect(resolveTripOpenTarget(split, target!)).toEqual({ tripIdx: 1, frameIdx: 0 });
    });

    it("finds the closest rebuilt event", () => {
        expect(closestEventIndex([{ unixSeconds: 10 }, { unixSeconds: 30 }, { unixSeconds: 80 }], 27)).toBe(1);
        expect(closestEventIndex([], 27)).toBe(-1);
    });
});
