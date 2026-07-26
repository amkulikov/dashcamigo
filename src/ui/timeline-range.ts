// Timeline range overlay: pull-tabs + masks that span the WHOLE timeline stack
// (chart + event strip + overview + the always-on progress bar) and let the
// user pick the export clip range. Visible only in export-mode.
//
// Coordinate basis. The overlay lives inside #player-chart (spanning every
// row), so the masks dim the out-of-range portion across all of them at once,
// the same way the playhead crosses them. Trip-seconds <-> x goes through
// getTimelineView() (the shared window + gutter), so it tracks chart zoom AND
// keeps working when the chart canvas is hidden (gutter 0 -> full width). This
// is what makes range selection available even with the chart toggled off.
//
// Drag model. Pointer-events on the tab elements; pointermove/up are captured
// on the tab so the user can drag past the edge without losing the grab. A drag
// funnels through setRangeEdge (export-state), the same clamp the trim bar's
// numeric range inputs use, so both controls enforce identical bounds +
// MIN_RANGE_SEC and never diverge; the rest of the system reads the resulting
// exportPanelState.range (trim bar, Save logic).

import { getTimelineView, timelineFracToSec, timelineSecToFrac } from "./chart.js";
import { t } from "../i18n/index.js";
import { dom } from "./dom.js";
import { exportPanelState, setRangeEdge, subscribeExportState } from "./export-state.js";
import { formatTime } from "./format.js";
import { suppressEdgeSwipeNav } from "./pointer-drag.js";
import { state } from "./state.js";

/** Slack (sec) before a range boundary counts as outside the zoom window.
 *  Big enough to absorb float drift when the window was derived FROM the range
 *  ("Preview clip"), far below anything a zoom gesture produces. */
const OFFSCREEN_EPSILON_SEC = 0.05;

let container: HTMLDivElement | null = null;
let tabStart: HTMLButtonElement | null = null;
let tabEnd: HTMLButtonElement | null = null;
let maskLeft: HTMLDivElement | null = null;
let maskRight: HTMLDivElement | null = null;
// Floating timecode readout above the dragged/hovered tab. Body-attached and
// position:fixed so the timeline stack's overflow never clips it (same reason
// the scrubber tooltip re-parents to body).
let bubble: HTMLDivElement | null = null;
let bubbleHideTimer: ReturnType<typeof setTimeout> | null = null;

export function initTimelineRange(): void {
    const wrap = dom.playerChartEl;
    if (!wrap) return;

    container = document.createElement("div");
    container.id = "timeline-range";
    container.className = "timeline-range";
    container.hidden = true;

    maskLeft = document.createElement("div");
    maskLeft.className = "timeline-range__mask timeline-range__mask--left";
    container.appendChild(maskLeft);

    maskRight = document.createElement("div");
    maskRight.className = "timeline-range__mask timeline-range__mask--right";
    container.appendChild(maskRight);

    tabStart = document.createElement("button");
    tabStart.type = "button";
    tabStart.className = "timeline-range__tab timeline-range__tab--start";
    tabStart.setAttribute("aria-label", t("export.range.tabStart"));
    container.appendChild(tabStart);

    tabEnd = document.createElement("button");
    tabEnd.type = "button";
    tabEnd.className = "timeline-range__tab timeline-range__tab--end";
    tabEnd.setAttribute("aria-label", t("export.range.tabEnd"));
    container.appendChild(tabEnd);

    wrap.appendChild(container);

    bubble = document.createElement("div");
    bubble.className = "timeline-range__bubble mono";
    bubble.hidden = true;
    document.body.appendChild(bubble);

    attachTabDrag(tabStart, "start");
    attachTabDrag(tabEnd, "end");
    attachTabHoverBubble(tabStart, "start");
    attachTabHoverBubble(tabEnd, "end");

    subscribeExportState(syncTimelineRange);
    // The pixel anchor for each tab moves with the visible window. Two sources
    // keep it in sync: chart zoom/pan/reset re-anchors via chart's onViewChanged
    // -> syncTimelineRange (wired in trip-ui-init), and this ResizeObserver
    // covers viewport resize. The export-state subscription above handles range
    // edits from the tabs themselves.
    if (typeof ResizeObserver !== "undefined") {
        const ro = new ResizeObserver(() => syncTimelineRange());
        ro.observe(wrap);
    }

    syncTimelineRange();
}

/**
 * Re-positions the pull-tabs and mask div widths from the current
 * exportPanelState.range. Hides the overlay outside of export-mode and
 * when chart isn't ready. Cheap and idempotent.
 */
export function syncTimelineRange(): void {
    if (!container) return;
    const range = exportPanelState.range;
    const host = dom.playerChartEl;
    const startFrac = range ? timelineSecToFrac(range.startTripSec) : null;
    const endFrac = range ? timelineSecToFrac(range.endTripSec) : null;
    if (!state.exportModeOpen || !range || !host || startFrac === null || endFrac === null) {
        container.hidden = true;
        hideBubble();
        return;
    }
    const w = host.clientWidth;
    if (w <= 0) {
        container.hidden = true;
        return;
    }
    const startX = startFrac * w;
    const endX = endFrac * w;

    container.hidden = false;
    // Center each tab on its boundary using its ACTUAL rendered width (16px on
    // desktop, 36px on touch - see player-composition.css). offsetWidth is valid
    // now that container.hidden=false above; reading it keeps the visible spine
    // exactly on the boundary regardless of the touch-widened hit area.
    if (tabStart) tabStart.style.left = `${startX - tabStart.offsetWidth / 2}px`;
    if (tabEnd) tabEnd.style.left = `${endX - tabEnd.offsetWidth / 2}px`;
    // A boundary outside the zoom window clamps to the viewport edge
    // (timelineSecToFrac) - visually identical to a boundary sitting ON the
    // edge, which read as "zooming moved my range". Flag the pinned state so
    // CSS can restyle the tab as an off-screen pointer. The epsilon keeps the
    // exact window==range case (the "Preview clip" zoom) in the normal style.
    const view = getTimelineView();
    if (view) {
        tabStart?.classList.toggle("is-offscreen", range.startTripSec < view.startSec - OFFSCREEN_EPSILON_SEC);
        tabEnd?.classList.toggle("is-offscreen", range.endTripSec > view.endSec + OFFSCREEN_EPSILON_SEC);
    }
    // Masks dim everything left/right of the range (incl. the axis gutters)
    // across the full stacked height.
    if (maskLeft) {
        maskLeft.style.left = "0";
        maskLeft.style.width = `${Math.max(0, startX)}px`;
    }
    if (maskRight) {
        maskRight.style.left = `${endX}px`;
        maskRight.style.width = `${Math.max(0, w - endX)}px`;
    }
}

function attachTabDrag(tab: HTMLButtonElement, which: "start" | "end"): void {
    // The tabs park at the timeline gutter, which is close to the screen edge
    // when the range covers the whole trip - exactly where iOS arms swipe-back.
    suppressEdgeSwipeNav(tab);
    tab.addEventListener("pointerdown", (ev) => {
        ev.preventDefault();
        tab.setPointerCapture(ev.pointerId);
        showBubbleFor(tab, which);

        const onMove = (mv: PointerEvent) => {
            updateRangeFromPointer(mv.clientX, which);
            // Re-anchor AFTER the range edit: setRangeEdge notified
            // synchronously, so the tab's left already reflects the clamped
            // value - the bubble reads the committed truth, and freezing at
            // the 1s floor is visible as the number simply stopping.
            showBubbleFor(tab, which);
        };
        const onUp = (up: PointerEvent) => {
            try {
                tab.releasePointerCapture(up.pointerId);
            } catch {
                // pointer already released by browser - ignore.
            }
            tab.removeEventListener("pointermove", onMove);
            tab.removeEventListener("pointerup", onUp);
            tab.removeEventListener("pointercancel", onUp);
            // Short linger so the final value is readable after the finger lifts.
            hideBubbleSoon();
        };
        tab.addEventListener("pointermove", onMove);
        tab.addEventListener("pointerup", onUp);
        tab.addEventListener("pointercancel", onUp);
    });
}

/** Desktop affordance: hovering a tab shows its current timecode without
 *  starting a drag. Mouse only - on touch the bubble appears with the drag. */
function attachTabHoverBubble(tab: HTMLButtonElement, which: "start" | "end"): void {
    tab.addEventListener("pointerenter", (ev) => {
        if (ev.pointerType !== "mouse") return;
        showBubbleFor(tab, which);
    });
    tab.addEventListener("pointerleave", (ev) => {
        if (ev.pointerType !== "mouse") return;
        // No linger on hover-out; an active drag re-shows on every move anyway.
        if (ev.buttons === 0) hideBubble();
    });
}

/** Positions the bubble over `tab` showing the current committed value of the
 *  edge. Viewport-clamped; no-op when there is no range. */
function showBubbleFor(tab: HTMLButtonElement, which: "start" | "end"): void {
    const range = exportPanelState.range;
    if (!bubble || !range) return;
    if (bubbleHideTimer) {
        clearTimeout(bubbleHideTimer);
        bubbleHideTimer = null;
    }
    bubble.textContent = formatTime(which === "start" ? range.startTripSec : range.endTripSec);
    bubble.hidden = false;
    const rect = tab.getBoundingClientRect();
    // offsetWidth is valid now that hidden=false. Clamp inside the viewport so
    // the start bubble is not cut at the left edge (nor end at the right).
    const w = bubble.offsetWidth;
    const left = Math.max(4, Math.min(rect.left + rect.width / 2 - w / 2, window.innerWidth - w - 4));
    bubble.style.left = `${left}px`;
    bubble.style.top = `${rect.top - bubble.offsetHeight - 6}px`;
}

function hideBubble(): void {
    if (!bubble) return;
    if (bubbleHideTimer) {
        clearTimeout(bubbleHideTimer);
        bubbleHideTimer = null;
    }
    bubble.hidden = true;
}

function hideBubbleSoon(): void {
    if (bubbleHideTimer) clearTimeout(bubbleHideTimer);
    bubbleHideTimer = setTimeout(hideBubble, 600);
}

/** Pending flash-removal timers, one per tab. */
const flashTimers: Record<"start" | "end", ReturnType<typeof setTimeout> | null> = { start: null, end: null };

/**
 * One-shot highlight of a pull-tab. Feedback for indirect range edits (the
 * I/O set-to-playhead actions), whose only other trace is the mask jumping.
 * No-op while the overlay is hidden.
 *
 * Cleanup is a timer, not animationend: under prefers-reduced-motion the CSS
 * disables the animation, animationend never fires, and a once-listener would
 * leak (and leave the class stuck) on every call.
 */
export function flashRangeTab(which: "start" | "end"): void {
    const tab = which === "start" ? tabStart : tabEnd;
    if (!tab || container?.hidden) return;
    tab.classList.remove("is-flash");
    // Force a reflow so re-adding the class restarts the animation on rapid repeats.
    void tab.offsetWidth;
    tab.classList.add("is-flash");
    const prev = flashTimers[which];
    if (prev) clearTimeout(prev);
    // Slightly past the 0.6s animation so removal never truncates it.
    flashTimers[which] = setTimeout(() => {
        tab.classList.remove("is-flash");
        flashTimers[which] = null;
    }, 700);
}

function updateRangeFromPointer(clientX: number, which: "start" | "end"): void {
    const host = dom.playerChartEl;
    if (!exportPanelState.range || !host) return;
    const rect = host.getBoundingClientRect();
    if (rect.width <= 0) return;
    const tripSec = timelineFracToSec((clientX - rect.left) / rect.width);
    if (tripSec === null) return;
    // Shared clamp (bounds + MIN_RANGE_SEC) + notify - identical to the panel's
    // numeric inputs, so drag and type never produce different results.
    setRangeEdge(which, tripSec);
}
