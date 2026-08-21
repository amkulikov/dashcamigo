// Frame-by-frame stepping: one shared helper behind the , / . hotkeys and the
// step buttons in the player bar. Catching a sharp frame of a passing plate by
// hammering pause is nearly impossible - the user pauses roughly at the moment
// and creeps up on the exact frame from there.

import { activeCandidate, state } from "./state.js";
import { dom } from "./dom.js";
import { FRAME_STEP_HOLD_DELAY_MS, FRAME_STEP_REPEAT_MS, heldFrameStepCount } from "./frame-step-repeat.js";

interface FrameStepDeps {
    getTripCurrentTime: () => number;
    seekTripTime: (sec: number) => void;
}

// Fallback when the active clip's probed fps is unknown: 30 fps is the typical
// dashcam rate; more precision would require decoding.
const FALLBACK_FPS = 30;

// Hold-to-repeat pacing. 150ms ≈ 6-7 steps/s - fast enough to walk a second of
// footage in a short hold without flooding the seek path. The target is derived
// from total elapsed time, so delayed timer callbacks still catch up exactly.
/** Seconds of one frame step for a clip probed at `fps`. The clamp guards a
 *  garbage probe (VFR spike, broken header) from turning a "frame" into a
 *  microscopic or multi-second jump; null/absent fps falls back to 1/30. */
function frameStepSeconds(fps: number | null): number {
    if (!fps || !Number.isFinite(fps) || fps <= 0) return 1 / FALLBACK_FPS;
    return 1 / Math.min(120, Math.max(5, fps));
}

let deps: FrameStepDeps | null = null;

/** Steps the player one frame back (-1) / forward (1). Pauses first when
 *  playing - a frame being hunted is by definition not one flying past - so
 *  the control is meaningful in both states (mpv semantics, not YouTube's
 *  paused-only). No-op before initFrameStep or with no active trip. */
export function stepFrame(direction: 1 | -1): void {
    if (!deps || !state.active) return;
    if (!dom.player.paused) dom.player.pause();
    deps.seekTripTime(deps.getTripCurrentTime() + direction * frameStepSeconds(activeCandidate()?.fps ?? null));
}

function wireStepButton(btn: HTMLButtonElement, direction: 1 | -1): void {
    let delayTimer: number | null = null;
    let repeatTimer: number | null = null;
    let hold: { startedAt: number; baseTime: number; stepSeconds: number; appliedSteps: number } | null = null;

    const clearTimers = (): void => {
        if (delayTimer !== null) clearTimeout(delayTimer);
        if (repeatTimer !== null) clearInterval(repeatTimer);
        delayTimer = repeatTimer = null;
    };

    const applyHeldProgress = (): void => {
        if (!hold || !deps || !state.active) return;
        const requestedSteps = heldFrameStepCount(performance.now() - hold.startedAt);
        if (requestedSteps <= hold.appliedSteps) return;
        if (!dom.player.paused) dom.player.pause();
        deps.seekTripTime(hold.baseTime + direction * requestedSteps * hold.stepSeconds);
        hold.appliedSteps = requestedSteps;
    };

    const stopRepeat = (): void => {
        // Derive the final target from total hold duration. Even if a busy main
        // thread coalesced interval callbacks/seeks, pointerup lands on the same
        // frame count instead of degrading to one or two steps.
        applyHeldProgress();
        clearTimers();
        hold = null;
    };

    // Pointer path: first step on pointerdown, auto-repeat while held. No
    // pointer capture on purpose - dragging off the button stops the repeat,
    // which is the expected escape hatch for a stuck-feeling hold.
    btn.addEventListener("pointerdown", (event) => {
        if (event.button !== 0) return;
        clearTimers();
        hold = null;
        if (!deps || !state.active) return;
        if (!dom.player.paused) dom.player.pause();
        const baseTime = deps.getTripCurrentTime();
        const stepSeconds = frameStepSeconds(activeCandidate()?.fps ?? null);
        hold = { startedAt: performance.now(), baseTime, stepSeconds, appliedSteps: 1 };
        deps.seekTripTime(baseTime + direction * stepSeconds);
        delayTimer = window.setTimeout(() => {
            repeatTimer = window.setInterval(applyHeldProgress, FRAME_STEP_REPEAT_MS);
        }, FRAME_STEP_HOLD_DELAY_MS);
    });
    for (const eventName of ["pointerup", "pointercancel", "pointerleave"] as const) {
        btn.addEventListener(eventName, stopRepeat);
    }
    // Keyboard activation (Enter/Space on the focused button) arrives as a
    // click with detail 0 and no pointerdown; pointer clicks already stepped
    // on pointerdown and must not double-step here.
    btn.addEventListener("click", (event) => {
        if (event.detail === 0) stepFrame(direction);
    });
    // A touch long-press must keep stepping, not summon the context menu.
    btn.addEventListener("contextmenu", (event) => event.preventDefault());
}

/** Wires the player-bar step buttons and arms stepFrame for the hotkeys.
 *  Called once from initPlayer. */
export function initFrameStep(frameStepDeps: FrameStepDeps): void {
    deps = frameStepDeps;
    wireStepButton(dom.playerBar.stepBack, -1);
    wireStepButton(dom.playerBar.stepFwd, 1);
}
