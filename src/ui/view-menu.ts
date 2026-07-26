// "View" dropdown - toggle visibility of three panels (chart / strip / map).
// Per design handoff (spec/04-view-menu.md): button in player toolbar + popover
// with 3 checkboxes, state persisted via localStorage["dc.viewer.panels"],
// global hotkeys C / T / M.
//
// Toggling a panel sets the `hidden` attribute on its host element; layout
// reflows via existing CSS grid/flex rules (no JS layout math here).
//
// Mini-map standalone close-X is replaced by the "Mini-map" checkbox row -
// see src/ui/map.ts where the legacy button is now hidden via this module.

import { createLogger } from "../log.js";

import { isAnyModalOpen } from "./modal-helper.js";

const STORAGE_KEY = "dc.viewer.panels";
const HOTKEY_BY_PANEL = { chart: "KeyC", strip: "KeyT", map: "KeyM" } as const;
const PANELS = ["chart", "strip", "map"] as const;
export type Panel = (typeof PANELS)[number];

const log = createLogger("view-menu");

/** Visibility state of the three view-menu panels. Default: all visible. */
export interface ViewPanels {
    chart: boolean;
    strip: boolean;
    map: boolean;
}

const DEFAULT_PANELS: ViewPanels = { chart: true, strip: true, map: true };

/** In-memory mirror of the persisted state. */
let currentPanels: ViewPanels = { ...DEFAULT_PANELS };

/** Listeners for visibility changes. Map.ts uses this to suppress mini-map
 *  visibility logic when the user hid it via the menu. */
type Listener = (panels: ViewPanels) => void;
const listeners = new Set<Listener>();

export function subscribeViewPanels(handler: Listener): () => void {
    listeners.add(handler);
    return () => listeners.delete(handler);
}

export function getViewPanels(): ViewPanels {
    return { ...currentPanels };
}

function loadFromStorage(): ViewPanels {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return { ...DEFAULT_PANELS };
        const parsed = JSON.parse(raw) as Partial<ViewPanels>;
        return {
            chart: parsed.chart !== false,
            strip: parsed.strip !== false,
            map: parsed.map !== false,
        };
    } catch {
        // private mode / malformed JSON - fall back to defaults
        return { ...DEFAULT_PANELS };
    }
}

function saveToStorage(panels: ViewPanels): void {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(panels));
    } catch {
        // private mode - silent
    }
}

export interface ViewMenuOptions {
    button: HTMLElement;
    popover: HTMLElement;
    panels: {
        chart: HTMLElement | null;
        strip: HTMLElement | null;
        map: HTMLElement | null;
    };
}

/** Per-panel availability. A disabled panel cannot be toggled by the user
 *  (row dimmed, click no-op, hotkey ignored) - used to prevent "show
 *  mini-map" when there's no GPS track. The stored visibility preference
 *  is preserved so toggling availability back on restores the user's last
 *  choice. */
const availability: Record<Panel, boolean> = { chart: true, strip: true, map: true };

/** Module-level options ref set by initViewMenu. setPanelAvailable needs it
 *  to re-apply visibility on availability change (no need to wait for the
 *  next user action). null before init - setPanelAvailable still updates
 *  the availability map; applyPanels will read the up-to-date value on
 *  next call. */
let currentOpts: ViewMenuOptions | null = null;

/** Sets a panel's visibility from outside the menu (e.g. mini-map close-X
 *  click) and syncs the checkbox + persisted state. No-op if unavailable. */
export function setPanelVisible(panel: Panel, visible: boolean): void {
    if (!availability[panel]) return;
    if (currentPanels[panel] === visible) return;
    currentPanels[panel] = visible;
    saveToStorage(currentPanels);
    if (currentOpts) applyPanels(currentOpts);
    for (const l of listeners) {
        try {
            l({ ...currentPanels });
        } catch (err) {
            log.warn("view-panels listener threw", { err: String(err) });
        }
    }
}

/** Marks a panel as available/unavailable. The row gets aria-disabled +
 *  data-disabled, click handlers skip it, hotkey is ignored. Visibility is
 *  also forced off when made unavailable so the underlying DOM element is
 *  hidden (e.g. no-GPS trip -> mini-map node truly hidden, not just
 *  user-toggled-off). */
export function setPanelAvailable(panel: Panel, available: boolean): void {
    if (availability[panel] === available) return;
    availability[panel] = available;
    const row = document.querySelector<HTMLElement>(`.view-menu-row[data-panel="${panel}"]`);
    if (row) {
        if (available) {
            row.removeAttribute("aria-disabled");
            row.removeAttribute("data-disabled");
        } else {
            row.setAttribute("aria-disabled", "true");
            row.setAttribute("data-disabled", "true");
        }
    }
    if (currentOpts) applyPanels(currentOpts);
}

/**
 * Wires the dropdown button + popover to localStorage + DOM visibility.
 * Idempotent only at module-scope: caller should call once at startup.
 * Returns a dispose() function for tests.
 */
export function initViewMenu(opts: ViewMenuOptions): () => void {
    currentOpts = opts;
    currentPanels = loadFromStorage();
    applyPanels(opts);

    function togglePopover(force?: boolean): void {
        // hidden is boolean | "until-found"; only an explicit false is visible.
        const willOpen = force ?? opts.popover.hidden !== false;
        opts.popover.hidden = !willOpen;
        opts.button.setAttribute("aria-expanded", willOpen ? "true" : "false");
        opts.button.classList.toggle("is-open", willOpen);
    }

    // Toggle delegates to setPanelVisible (module-level) - single source of
    // truth for write+persist+notify. The availability check happens inside
    // setPanelVisible too; the explicit guard here is for early exit before
    // computing the new value (no DOM lookup, no microtask churn).
    function toggle(panel: Panel): void {
        if (!availability[panel]) return;
        setPanelVisible(panel, !currentPanels[panel]);
    }

    opts.button.addEventListener("click", (e) => {
        e.stopPropagation();
        togglePopover();
    });

    // Row clicks toggle the corresponding panel without closing the popover -
    // the user often switches several panels in one trip.
    opts.popover.querySelectorAll<HTMLButtonElement>(".view-menu-row").forEach((row) => {
        row.addEventListener("click", () => {
            const panel = row.dataset.panel as Panel | undefined;
            if (!panel) return;
            toggle(panel);
        });
    });

    // Outside-click dismisses. Escape closes.
    function onDocClick(e: MouseEvent): void {
        if (opts.popover.hidden) return;
        const target = e.target;
        if (!(target instanceof Element)) return;
        if (target.closest(".view-menu-popover")) return;
        if (target.closest("#player-view-menu")) return;
        togglePopover(false);
    }
    document.addEventListener("click", onDocClick);

    function onKeyDown(e: KeyboardEvent): void {
        // A modal owns the keyboard while open - C/T/M must not toggle panels
        // behind the backdrop (modal-helper's trap only swallows Escape/Tab).
        if (isAnyModalOpen()) return;
        // Skip when typing in an input.
        if (e.target instanceof HTMLElement) {
            const tag = e.target.tagName;
            if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || e.target.isContentEditable) return;
        }
        if (e.key === "Escape" && !opts.popover.hidden) {
            e.preventDefault();
            togglePopover(false);
            return;
        }
        // Modifier keys are reserved for browser/system shortcuts - skip rebinds.
        if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
        // No-trips state = landing page. C/E/M would silently mutate the
        // localStorage preference for invisible panels; the user later opens
        // the first trip and sees panels arbitrarily disabled.
        if (document.body.classList.contains("no-trips")) return;
        for (const panel of PANELS) {
            if (e.code === HOTKEY_BY_PANEL[panel]) {
                e.preventDefault();
                toggle(panel);
                return;
            }
        }
    }
    document.addEventListener("keydown", onKeyDown);

    return () => {
        document.removeEventListener("click", onDocClick);
        document.removeEventListener("keydown", onKeyDown);
    };
}

function applyPanels(opts: ViewMenuOptions): void {
    // Final visibility = user preference AND availability. Unavailable panels
    // are forced hidden regardless of the user's stored preference (no-GPS
    // trip -> mini-map node hidden even if user previously toggled it on).
    if (opts.panels.chart) opts.panels.chart.hidden = !(currentPanels.chart && availability.chart);
    if (opts.panels.strip) opts.panels.strip.hidden = !(currentPanels.strip && availability.strip);
    if (opts.panels.map) opts.panels.map.hidden = !(currentPanels.map && availability.map);
    // Sync checkboxes in the popover (aria-checked + visual tick via CSS).
    opts.popover.querySelectorAll<HTMLButtonElement>(".view-menu-row").forEach((row) => {
        const panel = row.dataset.panel as Panel | undefined;
        if (!panel) return;
        row.setAttribute("aria-checked", currentPanels[panel] ? "true" : "false");
    });
}
