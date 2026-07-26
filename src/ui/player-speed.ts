// Playback rate cycling, dropdown menu and toolbar sync.
// Owns: SPEED_PRESETS, the open/close state of the speed menu, the menu click
// delegation, the click-outside-to-close listener, the speed-button label.
// cyclePlaybackRate is exported for the < / > hotkeys.

import { t } from "../i18n/index.js";
import { dom } from "./dom.js";
import { state } from "./state.js";

// Speed values for "<" / ">" hotkeys and the dropdown menu. Must match
// data-rate in the speed-menu HTML.
const SPEED_PRESETS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 4, 8];

/** Cycles playback rate one step through SPEED_PRESETS. */
export function cyclePlaybackRate(dir: 1 | -1): void {
    const cur = state.preferredPlaybackRate;
    // Find the closest preset to the current rate (the user could have set
    // 1.25 via direct input in the future) and step from there.
    let idx = SPEED_PRESETS.indexOf(cur);
    if (idx < 0) {
        let bestDiff = Infinity;
        for (let i = 0; i < SPEED_PRESETS.length; i++) {
            const d = Math.abs(SPEED_PRESETS[i]! - cur);
            if (d < bestDiff) {
                bestDiff = d;
                idx = i;
            }
        }
    }
    const next = Math.max(0, Math.min(SPEED_PRESETS.length - 1, idx + dir));
    const rate = SPEED_PRESETS[next]!;
    state.preferredPlaybackRate = rate;
    dom.player.playbackRate = rate;
}

function toggleSpeedMenu(): void {
    if (dom.playerBar.speedMenu.hidden) openSpeedMenu();
    else closeSpeedMenu();
}

function openSpeedMenu(): void {
    dom.playerBar.speedMenu.hidden = false;
    dom.playerBar.speed.setAttribute("aria-expanded", "true");
}

export function closeSpeedMenu(): void {
    dom.playerBar.speedMenu.hidden = true;
    dom.playerBar.speed.setAttribute("aria-expanded", "false");
}

/** True iff the speed dropdown is currently open. */
export function isSpeedMenuOpen(): boolean {
    return !dom.playerBar.speedMenu.hidden;
}

/** Move focus back to the speed-button (used on Escape close). */
export function focusSpeedButton(): void {
    dom.playerBar.speed.focus();
}

export function syncSpeedButton(): void {
    const r = dom.player.playbackRate;
    // Integers show without a decimal ("2x"), non-integers with ("0.5x").
    dom.playerBar.speed.textContent = `${Number.isInteger(r) ? r : r.toString()}x`;
    // title is set explicitly: aria-label "Playback speed" is in HTML and doesn't change.
    // title is needed so hover shows a tooltip - a bare "1x" is meaningless without context.
    dom.playerBar.speed.title = t("player.speed.title");
    // Highlight the current item in the menu.
    for (const item of dom.playerBar.speedMenu.querySelectorAll("[data-rate]")) {
        item.classList.toggle("active", Number(item.getAttribute("data-rate")) === r);
    }
}

/**
 * Wires up the speed button and menu. The hotkeys for cycling speed live in
 * the central hotkeys handler (player.ts) - it just calls cyclePlaybackRate.
 */
export function initPlayerSpeed(): void {
    dom.playerBar.speed.addEventListener("click", (e) => {
        e.stopPropagation();
        toggleSpeedMenu();
    });

    dom.playerBar.speedMenu.addEventListener("click", (e) => {
        const target = e.target;
        if (!(target instanceof HTMLElement)) return;
        const item = target.closest("[data-rate]");
        if (!item) return;
        const rate = Number(item.getAttribute("data-rate"));
        if (Number.isFinite(rate) && rate > 0) {
            // Persist the user's choice - <video>.playbackRate resets to 1 on
            // every src change and must be restored in loadedmetadata.
            state.preferredPlaybackRate = rate;
            dom.player.playbackRate = rate;
        }
        closeSpeedMenu();
    });

    // Close the menu on click outside - standard dropdown UX.
    document.addEventListener("click", (e) => {
        if (dom.playerBar.speedMenu.hidden) return;
        const target = e.target instanceof Node ? e.target : null;
        if (!target) {
            closeSpeedMenu();
            return;
        }
        // Click is "inside" if the target is the menu, the speed button, or a
        // descendant of either. Element.contains(self) is true, so clicks on
        // the menu/button itself are handled. The old `target.contains(menu)`
        // check (target as ancestor of menu) was always true for body/root
        // clicks and kept the menu open when it should have closed.
        const inside = dom.playerBar.speedMenu.contains(target) || dom.playerBar.speed.contains(target);
        if (!inside) closeSpeedMenu();
    });
}
