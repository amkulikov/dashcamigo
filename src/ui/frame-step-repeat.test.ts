import { describe, expect, it } from "vitest";

import { FRAME_STEP_HOLD_DELAY_MS, FRAME_STEP_REPEAT_MS, heldFrameStepCount } from "./frame-step-repeat.js";

describe("heldFrameStepCount", () => {
    it("stays at the immediate step until the first repeat interval", () => {
        expect(heldFrameStepCount(0)).toBe(1);
        expect(heldFrameStepCount(FRAME_STEP_HOLD_DELAY_MS + FRAME_STEP_REPEAT_MS - 1)).toBe(1);
    });

    it("catches up from elapsed hold time when timer callbacks are delayed", () => {
        expect(heldFrameStepCount(FRAME_STEP_HOLD_DELAY_MS + FRAME_STEP_REPEAT_MS)).toBe(2);
        expect(heldFrameStepCount(1_200)).toBe(6);
    });
});
