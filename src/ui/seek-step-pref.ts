// User-configurable arrow-key seek step.
//
// Two values: plain Arrow (default 5s) and Shift+Arrow (default 30s).
// Read by src/ui/player-hotkeys.ts on every keydown, written by the settings
// modal. No subscribers - hotkeys read fresh each time, change applies on
// the next keypress without any wiring.

const STORAGE_KEY_ARROW = "dashcamigo:hotkeys:seekStepSec";
const STORAGE_KEY_SHIFT_ARROW = "dashcamigo:hotkeys:seekStepShiftSec";

/** Defaults match the original hardcoded values in player-hotkeys.ts. */
export const DEFAULT_SEEK_STEP_SEC = 5;
export const DEFAULT_SEEK_STEP_SHIFT_SEC = 30;

/** Min / max accepted by the settings UI. 0.1s is a frame-step floor; 600s = 10min ceiling. */
export const SEEK_STEP_MIN_SEC = 0.1;
export const SEEK_STEP_MAX_SEC = 600;

function readPositive(key: string, fallback: number): number {
    try {
        const raw = localStorage.getItem(key);
        if (raw === null) return fallback;
        const n = Number(raw);
        if (Number.isFinite(n) && n > 0) return n;
    } catch {
        // private mode - fall through.
    }
    return fallback;
}

function writePositive(key: string, sec: number): void {
    if (!Number.isFinite(sec) || sec <= 0) return;
    const clamped = Math.min(SEEK_STEP_MAX_SEC, Math.max(SEEK_STEP_MIN_SEC, sec));
    try {
        localStorage.setItem(key, String(clamped));
    } catch {
        // private mode - won't survive reload but works in this session.
    }
}

/** Seek step for ArrowLeft / ArrowRight without Shift, in seconds. */
export function getSeekStepSec(): number {
    return readPositive(STORAGE_KEY_ARROW, DEFAULT_SEEK_STEP_SEC);
}

/** Seek step for Shift+ArrowLeft / Shift+ArrowRight, in seconds. */
export function getSeekStepShiftSec(): number {
    return readPositive(STORAGE_KEY_SHIFT_ARROW, DEFAULT_SEEK_STEP_SHIFT_SEC);
}

export function setSeekStepSec(sec: number): void {
    writePositive(STORAGE_KEY_ARROW, sec);
}

export function setSeekStepShiftSec(sec: number): void {
    writePositive(STORAGE_KEY_SHIFT_ARROW, sec);
}
