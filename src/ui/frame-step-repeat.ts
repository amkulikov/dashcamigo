// Pure timing model for the player frame-step button's hold-to-repeat gesture.

export const FRAME_STEP_HOLD_DELAY_MS = 400;
export const FRAME_STEP_REPEAT_MS = 150;

/** Total requested frame steps after a pointer has been held for `elapsedMs`. */
export function heldFrameStepCount(elapsedMs: number): number {
    if (!Number.isFinite(elapsedMs) || elapsedMs < FRAME_STEP_HOLD_DELAY_MS + FRAME_STEP_REPEAT_MS) return 1;
    return 1 + Math.floor((elapsedMs - FRAME_STEP_HOLD_DELAY_MS) / FRAME_STEP_REPEAT_MS);
}
