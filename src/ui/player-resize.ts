// Resizable proportions inside the player. One drag handle remains:
//   - .player-col-resize (vertical) between video and map - controls --map-pct,
//     the video-vs-map width ratio (expanded mode only).
//
// Chart panel height used to be user-resizable (--chart-height), but inferred
// strip + chart + ruler + overview have specific designed proportions. A
// resizable handle would let users squish the chart canvas under the strip,
// breaking legibility. We freeze the panel at a sensible default in CSS
// instead (see --chart-height in viewer.css). Legacy localStorage key
// "dashcamigo:chart-height" is no longer read - migration is trivial since
// the value just stops applying; nothing to clean up.

import { dom } from "./dom.js";
import { attachPointerDrag } from "./pointer-drag.js";
import { state } from "./state.js";

const MAP_PCT_KEY = "dashcamigo:map-pct";
// Map width as a percentage of player width. fr units with calc on CSS variables
// break in Chrome (track sizing does not work), so percentage is used.
const MAP_PCT_MIN = 15;
const MAP_PCT_MAX = 70;
// Keyboard step on the divider (Arrow = fine, Shift+Arrow = coarse), mirroring
// the sidebar-resize handle so the two splitters behave the same.
const MAP_PCT_STEP = 2;
const MAP_PCT_STEP_SHIFT = 5;

// The divider lives only in the expanded desktop layout; on mobile the map is a
// full-screen toggle and --map-pct is unused, so keyboard resize is a no-op there.
const isMobileLayout = (): boolean => typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches;

/** Reads the live --map-pct as a number, falling back to a sane mid value when
 *  the variable is unset (CSS default) or unparseable. */
function currentMapPct(): number {
    const raw = getComputedStyle(dom.playerWrapEl).getPropertyValue("--map-pct").trim();
    const cur = parseFloat(raw);
    return Number.isFinite(cur) ? cur : 35;
}

function setMapPct(pct: number): number {
    const clamped = Math.max(MAP_PCT_MIN, Math.min(MAP_PCT_MAX, pct));
    dom.playerWrapEl.style.setProperty("--map-pct", `${clamped}%`);
    // Keep the separator's announced value in sync with the visual ratio so a
    // screen reader reads the real position, not a stale one.
    dom.videoMapResize.setAttribute("aria-valuenow", String(Math.round(clamped)));
    return clamped;
}

function restoreResizeState(): void {
    // try/catch like every other localStorage round-trip (player-volume etc.):
    // blocked storage (incognito quota) must not break player init.
    let raw: string | null = null;
    try {
        raw = localStorage.getItem(MAP_PCT_KEY);
    } catch {
        /* storage blocked - default proportions */
    }
    const savedMapPct = parseFloat(raw || "");
    if (Number.isFinite(savedMapPct) && savedMapPct >= MAP_PCT_MIN && savedMapPct <= MAP_PCT_MAX) {
        dom.playerWrapEl.style.setProperty("--map-pct", `${savedMapPct}%`);
    }
}

export function initPlayerResize(): void {
    restoreResizeState();

    // The handle advertises role=separator + tabindex=0 in the HTML, so it must
    // be operable from the keyboard - otherwise it is a focus stop that traps the
    // user with no action. Seed the slider-range semantics once.
    dom.videoMapResize.setAttribute("aria-valuemin", String(MAP_PCT_MIN));
    dom.videoMapResize.setAttribute("aria-valuemax", String(MAP_PCT_MAX));
    dom.videoMapResize.setAttribute("aria-valuenow", String(Math.round(currentMapPct())));

    /** Currently dragged handle (only "map" remains; "chart" was removed). */
    let resizeDragging: "map" | null = null;

    // rAF throttle: set a pending flag on each mousemove; the actual
    // MapLibre/Chart resize happens once per frame. Without this MapLibre
    // canvas keeps the pixel dimensions of the old container, producing
    // stretched bitmap artifacts.
    // Resize every live surface (chart strip + map + mini-map) once. Guarded so
    // it is safe before any of them exist; order is irrelevant (no cross-dep).
    function resizeSurfaces(): void {
        if (state.chart) state.chart.resize();
        if (state.map) state.map.resize();
        if (state.miniMap && !dom.miniMap.hidden) state.miniMap.resize();
    }
    let liveResizePending = false;
    function scheduleLiveResize(): void {
        if (liveResizePending) return;
        liveResizePending = true;
        requestAnimationFrame(() => {
            liveResizePending = false;
            resizeSurfaces();
        });
    }

    // Pointer events (not mouse) for touch parity - every other drag in the
    // player works by touch, and the divider is reachable on wide touch
    // layouts (iPad landscape). The shared helper adds pointer capture, so
    // the document-level move/up listeners are gone too.
    attachPointerDrag(dom.videoMapResize, {
        onStart: (e) => {
            e.preventDefault();
            resizeDragging = "map";
            dom.videoMapResize.classList.add("dragging");
            document.body.classList.add("col-resizing");
            return true;
        },
        onMove: (e) => {
            if (!resizeDragging) return;
            // Map-pct = map width as a percentage of player-wrap total width.
            // The cursor is between video and map, so everything to the right
            // of the cursor is the map. Compute percentage from the right edge.
            const wrapRect = dom.playerWrapEl.getBoundingClientRect();
            const x = e.clientX - wrapRect.left;
            const mapW = wrapRect.width - x;
            setMapPct((mapW / wrapRect.width) * 100);
            scheduleLiveResize();
        },
        onEnd: () => {
            if (!resizeDragging) return;
            // Store as a number (without "%") - restore adds "%" back.
            const raw = getComputedStyle(dom.playerWrapEl).getPropertyValue("--map-pct").trim();
            const cur = parseFloat(raw);
            if (Number.isFinite(cur)) {
                try {
                    localStorage.setItem(MAP_PCT_KEY, String(cur));
                } catch {
                    /* storage blocked - proportions survive the session only */
                }
            }
            resizeDragging = null;
            dom.videoMapResize.classList.remove("dragging");
            document.body.classList.remove("col-resizing");
            requestAnimationFrame(resizeSurfaces);
        },
    });

    // Arrow keys when the handle is focused nudge the ratio (Shift = coarse),
    // Home/End jump to the extremes. Persist on each keydown - keyboard gives no
    // pointer onEnd, and the pointer onEnd is gated on resizeDragging which the
    // keyboard path never sets (same shape as sidebar-resize.ts).
    dom.videoMapResize.addEventListener("keydown", (e) => {
        if (isMobileLayout()) return;
        const isLeft = e.key === "ArrowLeft";
        const isRight = e.key === "ArrowRight";
        const isHome = e.key === "Home";
        const isEnd = e.key === "End";
        if (!isLeft && !isRight && !isHome && !isEnd) return;
        e.preventDefault();
        // Own the keypress: the global document keydown (player-hotkeys) also seeks
        // on Arrow, and a focused separator is neither editable nor a native-
        // activation target, so without this an arrow both resizes AND seeks.
        e.stopPropagation();
        let next: number;
        if (isHome)
            next = MAP_PCT_MAX; // Home = widest map (separator far left)
        else if (isEnd) next = MAP_PCT_MIN;
        else {
            const step = e.shiftKey ? MAP_PCT_STEP_SHIFT : MAP_PCT_STEP;
            // ArrowRight shrinks the map (separator moves right), ArrowLeft grows it.
            next = currentMapPct() + (isRight ? -step : step);
        }
        const applied = setMapPct(next);
        try {
            localStorage.setItem(MAP_PCT_KEY, String(applied));
        } catch {
            /* storage blocked - proportions survive the session only */
        }
        scheduleLiveResize();
    });

    // Also trigger on window resize - the chart strip has a fixed height but the
    // map changes with the viewport. ResizeObserver would be more precise, but
    // window.resize is sufficient for minimal support.
    window.addEventListener("resize", () => {
        requestAnimationFrame(resizeSurfaces);
    });
}
