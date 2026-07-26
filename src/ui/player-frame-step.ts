// Frame-by-frame stepping: one shared helper behind the , / . hotkeys and the
// step buttons in the player bar. Catching a sharp frame of a passing plate by
// hammering pause is nearly impossible - the user pauses roughly at the moment
// and creeps up on the exact frame from there.

import { activeCandidate, state } from "./state.js";
import { dom } from "./dom.js";

interface FrameStepDeps {
    getTripCurrentTime: () => number;
    seekTripTime: (sec: number) => void;
}

// Fallback when the active clip's probed fps is unknown: 30 fps is the typical
// dashcam rate; more precision would require decoding.
const FALLBACK_FPS = 30;

// Hold-to-repeat pacing. 150ms ≈ 6-7 steps/s - fast enough to walk a second of
// footage in a short hold, slow enough that each paused same-file step (a plain
// currentTime write) settles before the next; a cross-file step is rarer and
// slower, and the pace keeps a hold from stacking those loads.
const HOLD_DELAY_MS = 400;
const REPEAT_MS = 150;

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

    const stopRepeat = (): void => {
        if (delayTimer !== null) clearTimeout(delayTimer);
        if (repeatTimer !== null) clearInterval(repeatTimer);
        delayTimer = repeatTimer = null;
    };

    // Pointer path: first step on pointerdown, auto-repeat while held. No
    // pointer capture on purpose - dragging off the button stops the repeat,
    // which is the expected escape hatch for a stuck-feeling hold.
    btn.addEventListener("pointerdown", (event) => {
        if (event.button !== 0) return;
        stepFrame(direction);
        stopRepeat();
        delayTimer = window.setTimeout(() => {
            repeatTimer = window.setInterval(() => stepFrame(direction), REPEAT_MS);
        }, HOLD_DELAY_MS);
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
