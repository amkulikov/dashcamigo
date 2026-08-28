// Mini-progress scrubber (top row of the timeline stack): fill, thumb,
// hover-tooltip with a frame preview, drag-to-seek, keyboard arrows. Also owns
// updatePlayerProgressUi (the per-timeupdate UI sync) because it writes to the
// same DOM nodes.
//
// Depends on the playback core only through two callables passed at init:
// getTripCurrentTime() and seekTripTime(sec). Keeps the cycle one-directional
// (scrubber -> player), so the player module never has to know about scrubber
// internals.

import { t } from "../i18n/index.js";
import { contentToFrame, pickFrameChannel } from "../trips.js";
import {
    getTimelineView,
    setPlayerCursorRelSec,
    timelineFracToSec,
    timelineSecToFracInView,
    type TimelineView,
} from "./chart.js";
import { dom } from "./dom.js";
import { formatTime } from "./format.js";
import { extractFrameAt } from "./frame-extract.js";
import { suppressEdgeSwipeNav } from "./pointer-drag.js";
import { getSeekStepSec, getSeekStepShiftSec } from "./seek-step-pref.js";
import { activeTrip, mainChannel, state } from "./state.js";

// Init-time injected callables. The scrubber needs them in DOM event handlers
// installed during initPlayerScrubber; instead of importing from player.ts
// (cycle) we ask the host to provide them once.
//
// Stubs throw rather than silently return 0: if updatePlayerProgressUi or a
// scrubber event handler ever fires before initPlayerScrubber, we want a loud
// failure in the log, not a UI quietly stuck at "0:00" with a chart cursor at
// the trip start.
let getTripCurrentTimeFn: () => number = () => {
    throw new Error("player-scrubber: initPlayerScrubber not called before use");
};
let seekTripTimeFn: (sec: number) => void = () => {
    throw new Error("player-scrubber: initPlayerScrubber not called before use");
};

/**
 * Updates the progress bar text and chart cursor. Called on every timeupdate
 * (up to 30 Hz). chart.draw() repaints the canvas without recomputing
 * scales/axes/decimation (~1-2ms on decimated datasets). Previously
 * chart.update("none") was used here - that runs the full lifecycle
 * (~50-100ms on long trips). The cursor line is drawn by cursorPlugin inside
 * afterDatasetsDraw which fires on draw() - no update needed while data is
 * unchanged. No throttle: chart.draw() is cheap enough at 30 Hz.
 */
export function updatePlayerProgressUi(): void {
    if (!state.active) {
        dom.playerBar.current.textContent = "0:00";
        dom.playerBar.total.textContent = "0:00";
        setPlayerCursorRelSec(null, null);
        updateMiniProgress(null, null);
        return;
    }
    const cur = getTripCurrentTimeFn();
    const view = getTimelineView();
    dom.playerBar.current.textContent = formatTime(cur);
    // Single playhead DOM overlay spans chart canvas + ruler + strip; one
    // visual element, no risk of misalignment between chart-drawn line and
    // strip DOM line.
    setPlayerCursorRelSec(cur, view);
    updateMiniProgress(cur, view);
}

/**
 * Updates the seek thumb position. null resets to 0. The bar maps the current
 * timeline window (chart zoom) onto its own width, inset by the timeline gutter
 * (chart plot area, or the synthetic edge gutter when the chart is hidden - see
 * getTimelineView) so the thumb lines up with the playhead and ruler above it.
 * Cheap - one style write, no computed-style read.
 *
 * The horizontal progress fill was dropped: it duplicated the vertical playhead
 * (the single position indicator) and the two drifted on each timeupdate. The
 * thumb sits exactly on the playhead via the shared timelineSecToFrac mapping.
 */
function updateMiniProgress(curSec: number | null, view: TimelineView | null = getTimelineView()): void {
    if (!dom.miniProgress) return;
    const curFrac = curSec === null || !view ? null : timelineSecToFracInView(curSec, view);
    if (!view || curFrac === null) {
        dom.miniProgressThumb.style.left = "0";
        dom.miniProgress.setAttribute("aria-valuenow", "0");
        dom.miniProgress.removeAttribute("aria-valuetext");
        return;
    }
    const content = 1 - view.leftFrac - view.rightFrac;
    dom.miniProgressThumb.style.left = `${curFrac * 100}%`;
    const posPct = content > 0 ? Math.round(((curFrac - view.leftFrac) / content) * 100) : 0;
    dom.miniProgress.setAttribute("aria-valuenow", String(posPct));
    // The bare percentage is meaningless to a screen reader; announce a human
    // time instead ("4:03 of 12:40"). Built from CONTENT time (curSec is already
    // content seconds), so it stays correct even when the chart is zoomed and
    // valuenow is window-relative. Recomputed every tick, so it re-localizes on
    // the next update after a language switch - no extra subscription needed.
    const trip = activeTrip();
    if (trip && curSec !== null) {
        dom.miniProgress.setAttribute(
            "aria-valuetext",
            t("player.progress.position", {
                cur: formatTime(curSec),
                total: formatTime(trip.timeline.contentDurationSec),
            }),
        );
    }
}

/**
 * Wires click/drag-to-seek + keyboard arrows on the mini-progress scrubber.
 * Listeners are registered once - they no-op when state.active is null.
 *
 * `deps` carries the playback callables; saved into module-level slots so
 * updatePlayerProgressUi (called from outside the closure) can reach
 * getTripCurrentTime without re-importing.
 */
export function initPlayerScrubber(deps: {
    getTripCurrentTime: () => number;
    seekTripTime: (sec: number) => void;
}): void {
    getTripCurrentTimeFn = deps.getTripCurrentTime;
    seekTripTimeFn = deps.seekTripTime;

    const bar = dom.miniProgress;
    if (!bar) return;
    const tooltip = dom.miniProgressTooltip;
    // Re-parent the tooltip to <body> so .player-chart's overflow:hidden cannot
    // clip it when the timeline stack is compact (chart/strip hidden). It is
    // position:fixed; showTooltipAt sets its viewport coords.
    if (tooltip) document.body.appendChild(tooltip);

    /** Trip-relative seconds for a given clientX via the shared mapping, so a
     *  click on the (possibly zoomed) bar seeks inside the visible window.
     *  Null when no trip is active. */
    function relSecAtClientX(clientX: number): number | null {
        const rect = bar.getBoundingClientRect();
        if (rect.width <= 0) return null;
        return timelineFracToSec((clientX - rect.left) / rect.width);
    }

    // Frame preview in the tooltip canvas. Idle-debounced 180ms so a fast
    // scrub does not spawn N synchronous decoders. Race-token guards against
    // out-of-order resolves (a slow extract finishing after a fast one).
    let thumbExtractToken = 0;
    let thumbExtractTimer: ReturnType<typeof setTimeout> | null = null;
    let lastThumbSec = -1;

    function cancelPendingThumb(): void {
        if (thumbExtractTimer) {
            clearTimeout(thumbExtractTimer);
            thumbExtractTimer = null;
        }
        // Invalidate any in-flight extract too: one that is past its debounce and
        // awaiting the worker would otherwise pass its token guard and draw onto
        // the canvas after hideTooltip. scheduleThumbExtract re-bumps the token
        // right after calling this, so a freshly scheduled extract stays valid.
        thumbExtractToken++;
    }

    function clearThumbCanvas(): void {
        const cv = dom.miniProgressThumbCanvas;
        if (cv) {
            const c = cv.getContext("2d");
            if (c) c.clearRect(0, 0, cv.width, cv.height);
        }
        if (tooltip) tooltip.classList.remove("has-thumb");
    }

    function scheduleThumbExtract(sec: number): void {
        cancelPendingThumb();
        const myToken = ++thumbExtractToken;
        thumbExtractTimer = setTimeout(() => {
            thumbExtractTimer = null;
            void extractAndDraw(sec, myToken);
        }, 180);
    }

    async function extractAndDraw(sec: number, token: number): Promise<void> {
        if (!state.active) return;
        const trip = state.trips[state.active.trip];
        if (!trip) return;
        // Frame containing sec + offset inside it (footage-axis resolver).
        const at = contentToFrame(trip.timeline, sec);
        const picked = pickFrameChannel(trip.frames[at.index]!, mainChannel());
        if (!picked) return;
        const fileSec = at.offsetInFrame;
        try {
            const bitmap = await extractFrameAt(picked.candidate.file, fileSec);
            if (!bitmap || token !== thumbExtractToken) {
                bitmap?.close?.();
                return;
            }
            const cv = dom.miniProgressThumbCanvas;
            if (!cv) {
                bitmap.close?.();
                return;
            }
            const ctx = cv.getContext("2d");
            if (!ctx) {
                bitmap.close?.();
                return;
            }
            ctx.clearRect(0, 0, cv.width, cv.height);
            // Cover-fit: keep aspect, fill canvas.
            const aspectCanvas = cv.width / cv.height;
            const aspectBitmap = bitmap.width / bitmap.height;
            let sx = 0;
            let sy = 0;
            let sw = bitmap.width;
            let sh = bitmap.height;
            if (aspectBitmap > aspectCanvas) {
                sw = bitmap.height * aspectCanvas;
                sx = (bitmap.width - sw) / 2;
            } else {
                sh = bitmap.width / aspectCanvas;
                sy = (bitmap.height - sh) / 2;
            }
            ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, cv.width, cv.height);
            bitmap.close?.();
            tooltip?.classList.add("has-thumb");
            lastThumbSec = sec;
        } catch {
            /* decoder fail - leave placeholder background; non-critical */
        }
    }

    /** Tooltip position + label. clientX clamped to bar; horizontal position
     *  clamped so it doesn't fly off the edge on a short bar. */
    function showTooltipAt(clientX: number): void {
        if (!tooltip) return;
        const sec = relSecAtClientX(clientX);
        if (sec === null) {
            tooltip.hidden = true;
            return;
        }
        if (dom.miniProgressTime) dom.miniProgressTime.textContent = formatTime(sec);
        tooltip.hidden = false;
        // Fixed-positioned in viewport coords (the tooltip lives on <body>).
        // Center on the cursor, clamp to the viewport, sit just above the bar.
        const barRect = bar.getBoundingClientRect();
        const ttHalf = tooltip.offsetWidth / 2;
        const clampedX = Math.max(ttHalf + 4, Math.min(window.innerWidth - ttHalf - 4, clientX));
        tooltip.style.left = `${clampedX}px`;
        tooltip.style.top = `${barRect.top - tooltip.offsetHeight - 8}px`;
        // Schedule thumb extract only on significant movement (>0.2s). Micro
        // cursor movements should not re-decode the same frame.
        if (Math.abs(sec - lastThumbSec) > 0.2) {
            scheduleThumbExtract(sec);
        }
    }

    function hideTooltip(): void {
        if (tooltip) tooltip.hidden = true;
        cancelPendingThumb();
        clearThumbCanvas();
        lastThumbSec = -1;
    }

    let dragging = false;
    // The bar spans the full row width, so a scrub started at the screen edge
    // is also an iOS swipe-back candidate. Seek runs on pointerdown (below),
    // not on click, so cancelling the edge touchstart loses nothing.
    suppressEdgeSwipeNav(bar);
    bar.addEventListener("pointerdown", (e) => {
        if (e.button !== 0) return;
        dragging = true;
        bar.classList.add("is-dragging");
        bar.setPointerCapture(e.pointerId);
        const sec = relSecAtClientX(e.clientX);
        if (sec !== null) seekTripTimeFn(sec);
        showTooltipAt(e.clientX);
    });
    bar.addEventListener("pointermove", (e) => {
        // Tooltip follows the cursor even without drag (hover preview);
        // drag additionally seeks.
        showTooltipAt(e.clientX);
        if (!dragging) return;
        const sec = relSecAtClientX(e.clientX);
        if (sec !== null) seekTripTimeFn(sec);
    });
    bar.addEventListener("pointerenter", (e) => {
        // Touch events give pointerdown without enter, but on mouse enter the
        // tooltip should pre-appear.
        if (e.pointerType === "mouse") showTooltipAt(e.clientX);
    });
    bar.addEventListener("pointerleave", () => {
        if (!dragging) hideTooltip();
    });
    const endDrag = (e: PointerEvent): void => {
        if (!dragging) return;
        dragging = false;
        bar.classList.remove("is-dragging");
        try {
            bar.releasePointerCapture(e.pointerId);
        } catch {
            /* pointer already released */
        }
        // Hide tooltip on touch end (mouse keeps hover); pointerType="touch"
        // does not receive pointerleave automatically.
        if (e.pointerType !== "mouse") hideTooltip();
    };
    bar.addEventListener("pointerup", endDrag);
    bar.addEventListener("pointercancel", endDrag);

    // Keyboard accessibility. Arrows seek by the user's configured step (Shift =
    // long step), PageUp/PageDown = long step, Home/End jump to trip ends - the
    // same step model as the global hotkeys, so focus state no longer silently
    // changes the seek granularity (was a fixed 5% before).
    //
    // stopPropagation is the real fix for the toolbar-vs-slider conflict: the
    // global document keydown ALSO seeks on Arrow (the scrubber is a div, not an
    // editable target, so it isn't skipped there), which double-seeked when the
    // scrubber had focus. Owning the keypress here prevents the second seek.
    bar.addEventListener("keydown", (e) => {
        if (!state.active) return;
        const trip = state.trips[state.active.trip];
        if (!trip || trip.timeline.contentDurationSec <= 0) return;
        const cur = getTripCurrentTimeFn();
        const step = e.shiftKey ? getSeekStepShiftSec() : getSeekStepSec();
        if (e.key === "ArrowLeft") {
            seekTripTimeFn(cur - step);
        } else if (e.key === "ArrowRight") {
            seekTripTimeFn(cur + step);
        } else if (e.key === "PageDown") {
            seekTripTimeFn(cur - getSeekStepShiftSec());
        } else if (e.key === "PageUp") {
            seekTripTimeFn(cur + getSeekStepShiftSec());
        } else if (e.key === "Home") {
            seekTripTimeFn(0);
        } else if (e.key === "End") {
            seekTripTimeFn(trip.timeline.contentDurationSec);
        } else {
            return;
        }
        e.preventDefault();
        e.stopPropagation();
    });
}
