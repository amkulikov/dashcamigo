import { t } from "../i18n/index.js";
import { dom } from "./dom.js";
import { initButtonRepeat } from "./player-button-repeat.js";
import { getSeekStepSec } from "./seek-step-pref.js";
import { state } from "./state.js";

interface SeekButtonDeps {
    getTripCurrentTime: () => number;
    seekTripTime: (sec: number) => void;
}

const SEEK_REPEAT_MS = 1_000;

export function initSeekButtons(deps: SeekButtonDeps): void {
    const buttons = [
        { button: dom.playerBar.seekBack, direction: -1, key: "player.seekBack" },
        { button: dom.playerBar.seekFwd, direction: 1, key: "player.seekFwd" },
    ] as const;

    const syncLabels = (): void => {
        const seconds = getSeekStepSec();
        for (const { button, key } of buttons) {
            const label = t(key, { seconds });
            button.title = label;
            button.setAttribute("aria-label", label);
            const amount = button.querySelector(".player-seek-amount");
            if (amount) amount.textContent = String(seconds);
        }
    };
    syncLabels();
    document.addEventListener("seekstepchange", syncLabels);

    for (const { button, direction } of buttons) {
        const seek = (): void => {
            if (!state.active) return;
            deps.seekTripTime(deps.getTripCurrentTime() + direction * getSeekStepSec());
        };
        initButtonRepeat(button, {
            delayMs: SEEK_REPEAT_MS,
            repeatMs: SEEK_REPEAT_MS,
            activate: seek,
            start: () => {
                if (!state.active) return null;
                const trip = state.trips[state.active.trip];
                const step = getSeekStepSec();
                let appliedRepeats = 0;
                seek();
                return (elapsedMs) => {
                    if (!state.active || state.trips[state.active.trip] !== trip) return false;
                    const repeats = Math.floor(elapsedMs / SEEK_REPEAT_MS);
                    if (repeats <= appliedRepeats) return;
                    deps.seekTripTime(deps.getTripCurrentTime() + direction * step * (repeats - appliedRepeats));
                    appliedRepeats = repeats;
                };
            },
        });
    }
}
