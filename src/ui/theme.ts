// Theme colors: single place that reads --dc-* CSS variables for consumers that do not
// understand CSS (canvas, MapLibre paint, Chart.js dataset colors, inline SVG).
// Cache is invalidated via refreshThemeColors() on prefers-color-scheme change.
//
// state.chart is touched here intentionally - refreshThemeColors rewrites scale/dataset colors
// of the live chart. When chart moves to its own module, replace direct access with a callback or event.

import type { EventKind } from "../events.js";

import { state } from "./state.js";

export type MapTheme = "light" | "dark";

/**
 * Which base-map style.json to load. Superset of MapTheme: the live app map only
 * ever uses light/dark (tied to the UI theme), but the export "map overlay" lets
 * the user pick "neon" too - a semi-transparent black slot with orange-glowing
 * roads/buildings/cities, independent of the app theme. Kept separate from
 * MapTheme so currentMapTheme()'s contract (it returns the effective UI theme,
 * never "neon") stays honest.
 */
export type MapStyleId = MapTheme | "neon";

/** UX-24: user theme choice. "auto" follows OS (default), "light"/"dark" is an explicit override. */
export type ThemeChoice = "auto" | "light" | "dark";

const THEME_STORAGE_KEY = "dc-theme";
let userThemeChoice: ThemeChoice = "auto";

function isThemeChoice(s: string | null): s is ThemeChoice {
    return s === "auto" || s === "light" || s === "dark";
}

/** Reads the stored theme choice from localStorage. Returns "auto" when nothing is stored or localStorage is unavailable. */
export function loadStoredTheme(): ThemeChoice {
    try {
        const v = localStorage.getItem(THEME_STORAGE_KEY);
        if (isThemeChoice(v)) return v;
    } catch {
        // localStorage blocked (incognito) - use default.
    }
    return "auto";
}

/**
 * Applies the chosen theme: sets the class on <html>, persists to localStorage,
 * invalidates the theme cache. Does not reload the map style - that is the caller's
 * responsibility (see app.ts) because the map may not exist yet on first init.
 */
export function applyTheme(choice: ThemeChoice): void {
    userThemeChoice = choice;
    try {
        localStorage.setItem(THEME_STORAGE_KEY, choice);
    } catch {
        // localStorage blocked - theme works for the current session but won't survive reload.
    }
    if (typeof document !== "undefined") {
        const root = document.documentElement;
        root.classList.remove("dc-light", "dc-dark");
        if (choice === "light") root.classList.add("dc-light");
        else if (choice === "dark") root.classList.add("dc-dark");
        // auto - both classes removed; media-queries take over.
    }
    refreshThemeColors();
}

/** Current user theme choice (auto/light/dark) - not the effective theme. The effective theme is given by currentMapTheme(). */
export function getThemeChoice(): ThemeChoice {
    return userThemeChoice;
}

/**
 * Effective map theme = same signal as the UI theme.
 *  - "light" / "dark" choice: explicit override.
 *  - "auto": follow OS via prefers-color-scheme. matchMedia is the same source
 *    of truth used by the global listener in app.ts and the CSS media queries -
 *    so all three (CSS palette, themeColors() cache, map style) flip together.
 */
export function currentMapTheme(): MapTheme {
    if (userThemeChoice === "dark") return "dark";
    if (userThemeChoice === "light") return "light";
    if (typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches) {
        return "dark";
    }
    return "light";
}

/** Reads a CSS variable value (--fg-dim, --border, etc.) from :root computed style. CSS variable values may include leading spaces. */
export function getCssVar(name: string): string {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/**
 * Appends an 8-bit hex alpha to a hex color, producing a valid #rrggbbaa.
 *
 * Robust to the production CSS minifier shortening #rrggbb -> #rgb (e.g.
 * #000000 -> #000): a naive `${color}b8` on a shortened #000 yields the invalid
 * 5-digit #000b8, which maplibre rejects with a hard error (breaking the trail
 * overlay on every dark-theme trip load) and chart.js silently renders wrong.
 * A 3-digit shorthand is expanded to 6 digits first; anything else (already
 * 6-digit, rgb(), etc.) passes through unchanged.
 */
export function withAlpha(color: string, alphaHex: string): string {
    const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(color.trim());
    const base = short ? `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}` : color.trim();
    return `${base}${alphaHex}`;
}

/**
 * Color cache for consumers that need concrete hex strings (canvas, inline SVG, MapLibre paint, Chart.js datasets).
 * These consumers do not understand CSS variables. Tokens are read once on first access and
 * invalidated on prefers-color-scheme change via refreshThemeColors().
 */
interface ThemeColors {
    track: [string, string, string, string, string]; // --dc-track-1..5 (slow → fast gradient)
    chartSpeed: string; // --dc-blue
    chartAccel: string; // --dc-orange
    chartCursor: string; // --dc-red
    chartGrid: string; // --border (axis-grid + zoom-overlay border)
    chartTickText: string; // --fg-dim
    eventBrake: string; // --dc-red
    markerStart: string; // --dc-green
    markerEnd: string; // --dc-red
    markerStroke: string; // --dc-marker-stroke (#fff on dark / #0E0E0E on light)
    // Semi-transparent veil drawn over the not-yet-driven portion of the
    // track ("trail" overlay in map.ts): --bg with alpha, so it dims toward
    // whichever map background the active theme uses.
    trackVeil: string;
    // Inferred event strip bars (under the chart). Match canonical signal
    // colors used elsewhere - red for brake, yellow for turn (caution),
    // green for accel (go), dim fg for stop.
    inferredStop: string;
    inferredBrake: string;
    inferredTurn: string;
    inferredAccel: string;
    // Recording-mode timeline bands (chart.ts): low-alpha full-height tints
    // behind the plot marking non-normal footage. event = red/danger,
    // parking = cool blue, manual = neutral grey. Alpha is baked in at ~10% so
    // the speed curve, gridlines, hover cursor and event markers stay readable
    // on top. Composed from the same --dc-* tokens as the rest, so both palettes
    // flip automatically on theme change (no new CSS tokens needed).
    bandEvent: string;
    bandParking: string;
    bandManual: string;
}

let _themeColors: ThemeColors | null = null;

/** Listeners notified after the cache is invalidated and Chart.js scales
 *  are updated. Used by canvas-based renderers that need to redraw with
 *  fresh colors on theme change - they cannot watch a CSS variable directly. */
type ThemeChangeListener = () => void;
const themeChangeListeners = new Set<ThemeChangeListener>();

export function subscribeThemeChange(handler: ThemeChangeListener): () => void {
    themeChangeListeners.add(handler);
    return () => themeChangeListeners.delete(handler);
}

export function themeColors(): ThemeColors {
    if (_themeColors) return _themeColors;
    const border = getCssVar("--border");
    _themeColors = {
        track: [
            getCssVar("--dc-track-1"),
            getCssVar("--dc-track-2"),
            getCssVar("--dc-track-3"),
            getCssVar("--dc-track-4"),
            getCssVar("--dc-track-5"),
        ],
        chartSpeed: getCssVar("--dc-blue"),
        chartAccel: getCssVar("--dc-orange"),
        chartCursor: getCssVar("--dc-red"),
        chartGrid: border,
        chartTickText: getCssVar("--fg-dim"),
        eventBrake: getCssVar("--dc-red"),
        markerStart: getCssVar("--dc-green"),
        markerEnd: getCssVar("--dc-red"),
        markerStroke: getCssVar("--dc-marker-stroke"),
        // Veil = background color at ~45% alpha, one semantic ("blend toward
        // the map background") for both palettes. Strength is a tradeoff: at
        // 72% the un-driven track was near-invisible against the base map in
        // both themes; 45% keeps it clearly readable while the driven part
        // still pops with the full-strength speed gradient.
        trackVeil: withAlpha(getCssVar("--bg"), "73"),
        // Read through the semantic --ev-* aliases so the light-theme override
        // (--ev-stop = --dc-stone-3) flows through automatically. Direct
        // physical tokens would freeze the strip on the dark palette.
        inferredStop: getCssVar("--ev-stop"),
        inferredBrake: getCssVar("--ev-brake"),
        inferredTurn: getCssVar("--ev-turn"),
        inferredAccel: getCssVar("--ev-accel"),
        // ~10% alpha (0x1a = 26/255): a full-height wash that reads as a tint,
        // not a fill. Reuses the danger red / info blue / dim-fg grey so the
        // bands sit in the existing palette and follow the theme flip.
        bandEvent: withAlpha(getCssVar("--dc-red"), "1a"),
        bandParking: withAlpha(getCssVar("--dc-blue"), "1a"),
        bandManual: withAlpha(getCssVar("--fg-dim"), "1a"),
    };
    return _themeColors;
}

/**
 * Clears the cache and pushes new colors to the live chart.
 * Triggered by the matchMedia listener on prefers-color-scheme change.
 * Map markers update naturally on the next refreshMap (trip change) - no ad-hoc SVG DOM traversal here.
 */
export function refreshThemeColors(): void {
    _themeColors = null;
    const tc = themeColors();
    if (state.chart) {
        const opts = state.chart.options as unknown as {
            scales: Record<
                string,
                { ticks?: { color?: string }; grid?: { color?: string }; title?: { color?: string } }
            >;
        };
        const xScale = opts.scales.x;
        if (xScale?.ticks) xScale.ticks.color = tc.chartTickText;
        if (xScale?.grid) xScale.grid.color = withAlpha(tc.chartGrid, "55");
        const ySpeed = opts.scales.ySpeed;
        if (ySpeed?.ticks) ySpeed.ticks.color = tc.chartSpeed;
        if (ySpeed?.grid) ySpeed.grid.color = withAlpha(tc.chartGrid, "33");
        if (ySpeed?.title) ySpeed.title.color = tc.chartSpeed;
        const yAccel = opts.scales.yAccel;
        if (yAccel?.ticks) yAccel.ticks.color = tc.chartAccel;
        if (yAccel?.title) yAccel.title.color = tc.chartAccel;
        // Dataset borderColor / backgroundColor from the same cache.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const datasets = (state.chart.data as any).datasets as Array<{
            borderColor?: string;
            backgroundColor?: string;
        }>;
        if (datasets[0]) {
            datasets[0].borderColor = tc.chartSpeed;
            datasets[0].backgroundColor = withAlpha(tc.chartSpeed, "33");
        }
        if (datasets[1]) {
            datasets[1].borderColor = tc.chartAccel;
        }
        state.chart.update("none");
    }
    // Notify canvas-based renderers (inferred event strip, etc.) that
    // cached colors changed. Chart.js gets fresh colors via the block above;
    // standalone canvases redraw themselves from themeColors().
    for (const listener of themeChangeListeners) {
        try {
            listener();
        } catch {
            // listener errors are not actionable here - swallow.
        }
    }
}

/** Map polyline segment color by speed (km/h). Hotter color = faster, familiar from heat maps. */
export function speedKmhToColor(kmh: number): string {
    const t = themeColors().track;
    // 5-stop gradient --dc-track-1..5.
    if (kmh < 20) return t[0]; // blue: standstill/traffic jam
    if (kmh < 50) return t[1]; // green: yard/slow urban
    if (kmh < 80) return t[2]; // yellow: normal urban
    if (kmh < 110) return t[3]; // orange: highway
    return t[4]; // red: very fast
}

/** Event marker colors for the chart canvas. Mirrors --ev-* CSS variables (canvas cannot read CSS vars). Palette must stay in sync with tooltip styles that use those variables. */
export function eventColors(): Record<EventKind, string> {
    return { brake: themeColors().eventBrake };
}
