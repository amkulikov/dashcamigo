import { describe, expect, it } from "vitest";

import { isPreloadReadyForPromotion } from "./player-preload.js";

describe("isPreloadReadyForPromotion", () => {
    it.each([
        ["HAVE_NOTHING", 0, false],
        ["HAVE_METADATA", 1, false],
        ["HAVE_CURRENT_DATA", 2, false],
        ["HAVE_FUTURE_DATA", 3, true],
        ["HAVE_ENOUGH_DATA", 4, true],
    ])("treats %s (readyState %i) as promotable=%s", (_name, readyState, expected) => {
        expect(isPreloadReadyForPromotion(readyState)).toBe(expected);
    });
});
