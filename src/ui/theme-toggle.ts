// UX-24: theme toggle in the header - a segmented control with 3 buttons
// (auto/light/dark). On startup reads the stored choice from localStorage and
// applies it. Persist + apply logic lives in src/ui/theme.ts.

import { applyTheme, getThemeChoice, loadStoredTheme, type ThemeChoice } from "./theme.js";

function isThemeChoice(s: string): s is ThemeChoice {
    return s === "auto" || s === "light" || s === "dark";
}

function syncToggleState(): void {
    const buttons = document.querySelectorAll<HTMLButtonElement>(".theme-toggle .theme-toggle-btn");
    const active = getThemeChoice();
    for (const btn of buttons) {
        const choice = btn.dataset.theme;
        if (!choice || !isThemeChoice(choice)) continue;
        btn.setAttribute("aria-pressed", choice === active ? "true" : "false");
    }
}

/**
 * Initializes the theme toggle: applies the stored theme and attaches a
 * click listener to the segmented control. Any additional work triggered by
 * a theme change (e.g. refreshMap) is done by the caller via the onThemeChange
 * callback - the toggle itself has no knowledge of the map.
 */
export function initThemeToggle(opts: { onThemeChange?: () => void } = {}): void {
    // Apply the stored choice IMMEDIATELY - before the toggle listener is attached.
    // This ensures the first paint for a user who has light system preference but
    // a saved dark choice uses dark CSS variables, avoiding a flash.
    const stored = loadStoredTheme();
    applyTheme(stored);
    syncToggleState();

    const wrap = document.querySelector<HTMLElement>(".theme-toggle");
    if (!wrap) return;
    wrap.addEventListener("click", (e) => {
        const target = e.target;
        if (!(target instanceof Element)) return;
        const btn = target.closest<HTMLButtonElement>(".theme-toggle-btn");
        if (!btn) return;
        const choice = btn.dataset.theme;
        if (!choice || !isThemeChoice(choice)) return;
        const from = getThemeChoice();
        if (choice === from) return;
        applyTheme(choice);
        syncToggleState();
        opts.onThemeChange?.();
    });
}
