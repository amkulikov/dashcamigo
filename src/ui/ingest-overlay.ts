// Blocking overlay over the full viewport during ingest. Shows the current
// stage (classify/parsing/indexing/embeddedGps), queue of additional drops,
// and a Cancel button that aborts state.ingestController.

import type { I18nKey } from "../i18n/keys.js";
import { t } from "../i18n/index.js";

import { dom } from "./dom.js";
import { state } from "./state.js";

// Tracked label key for the cancel button. Switches to "continueWithoutGps"
// during the embedded-GPS stage (where the user-visible behaviour really is
// "skip GPS, keep already-loaded videos" - state.trips was committed
// progressively during the prior indexing stage). Resets to "cancel" on
// every showIngestOverlay() so a fresh ingest does not inherit stale label.
let cancelLabelKey: I18nKey = "ingestOverlay.cancel";

// Pre-ingest "reading" phase ownership, as a REFCOUNT (not a bool). The overlay
// is raised the instant the user commits to a folder (picker click / folder
// drop) - before the real ingest starts, and for a drop even before the dropped
// tree is walked - so the page never sits blank while the browser enumerates a
// large card (which fires no JS callback until the change event). Two gestures
// can overlap (a second folder dropped while the first is still being walked),
// each holding its own claim; the overlay hides only when the LAST claim is
// released, so an early-finishing gesture cannot yank it out from under another
// still-running one. A real ingest taking over zeroes the count
// (showIngestOverlay).
let preIngestOwners = 0;

/**
 * Shows the overlay and re-enables the Cancel button - important when re-launching
 * ingest from the queue (a previous ingest may have ended via Cancel and left
 * the button disabled).
 */
export function showIngestOverlay(): void {
    // A real ingest is taking over the overlay (it now owns the hide via its
    // finally{}). Release ALL pre-ingest claims so a late endPreIngestReading()
    // from an overlapping gesture cannot pull the overlay out mid-ingest.
    preIngestOwners = 0;
    dom.ingestOverlay.hidden = false;
    dom.ingestOverlayCancel.disabled = false;
    cancelLabelKey = "ingestOverlay.cancel";
    dom.ingestOverlayCancel.textContent = t(cancelLabelKey);
}

/**
 * Raises the overlay for the pre-ingest "reading" phase (folder picker open /
 * browser enumeration / dropped-tree walk) and returns whether this call now
 * owns it.
 *
 * No-op returning false when an ingest is already running: that overlay belongs
 * to the in-flight ingest and its live stage text must not be clobbered (a
 * second drop during ingest just queues - see ingestFiles).
 *
 * Cancel stays ENABLED and, in this phase, just dismisses the waiting overlay
 * (see initIngestOverlay). The picker "cancel" event is the seamless auto-retract
 * on modern browsers, but Chrome/Edge 94-112 are within our support floor
 * (Chrome 94, docs/browser-support.md) and never fire it - a working button is
 * the guaranteed escape so a dismissed picker is never a reload-only dead end.
 * There is no AbortController yet, so the button cannot abort real work; the real
 * ingest re-points it at the controller via showIngestOverlay.
 */
export function beginPreIngestReading(): boolean {
    if (state.ingestInProgress) return false;
    preIngestOwners++;
    dom.ingestOverlay.hidden = false;
    dom.ingestOverlayCancel.disabled = false;
    cancelLabelKey = "ingestOverlay.cancel";
    dom.ingestOverlayCancel.textContent = t(cancelLabelKey);
    setIngestStage(t("ingestOverlay.stage.preparing"));
    // Indeterminate: the file count is unknown until classify/indexing.
    setIngestProgress({ mode: "indeterminate" });
    // A queue may carry over from a previous run - keep the indicator honest.
    syncIngestQueueIndicator();
    return true;
}

/**
 * Releases one pre-ingest claim and hides the overlay once the last one is gone.
 * A no-op once the count is zero: a real ingest that started in the meantime
 * zeroed it (showIngestOverlay), so a late call from a still-walking overlapping
 * gesture must not yank the overlay out from under the running ingest. Safe on
 * any pre-ingest exit path (picker dismissed, empty selection, dropped-tree read
 * failure, the in-phase Cancel click).
 */
export function endPreIngestReading(): void {
    if (preIngestOwners === 0) return; // already handed off to a real ingest
    preIngestOwners = Math.max(0, preIngestOwners - 1);
    if (preIngestOwners > 0) return; // another overlapping gesture still needs it
    hideIngestOverlay();
    hideIngestProgress();
}

/**
 * Switches the cancel button label between "Cancel" (default) and
 * "Continue without GPS" (used during the embedded-GPS stage where
 * cancelling just stops GPS extraction; loaded videos stay).
 */
export function setIngestCancelLabel(continueWithoutGps: boolean): void {
    cancelLabelKey = continueWithoutGps ? "ingestOverlay.continueWithoutGps" : "ingestOverlay.cancel";
    if (!dom.ingestOverlay.hidden && !dom.ingestOverlayCancel.disabled) {
        dom.ingestOverlayCancel.textContent = t(cancelLabelKey);
    }
}

export function hideIngestOverlay(): void {
    dom.ingestOverlay.hidden = true;
    dom.ingestOverlayStatus.textContent = "";
    dom.ingestOverlayQueue.hidden = true;
}

// === UX-02: progress bar above the header =============================
// A thin 2px strip at the top of the viewport. Shows "not hung" even when
// the user has scrolled past the ingest overlay.
//
// States:
//  - hidden:        strip invisible (opacity 0).
//  - indeterminate: running cursor (classify phase, before totalFiles is known).
//  - determinate:   width = (done / total) * 100%.
//
// API: setIngestProgress({mode: "indeterminate"} | {done, total}) and
//      hideIngestProgress() (instant hide). showIngestOverlay/hideIngestOverlay
//      do not touch the strip - they are independent UI entities (overlay is
//      blocking, strip is not; the strip remains visible when the overlay is
//      hidden before the embedded-GPS prompt).

const ingestProgressBar = (): HTMLElement | null => document.getElementById("ingest-progress-bar");
const ingestProgressFill = (): HTMLElement | null =>
    ingestProgressBar()?.querySelector<HTMLElement>(".ingest-progress-bar-fill") ?? null;

type IngestProgressInput = { mode: "indeterminate" } | { done: number; total: number };

// Handle for the deferred hide in hideIngestProgress(activeFinish). Kept so a
// subsequent ingest (a queued drop starts synchronously after the previous one
// finishes) can cancel a pending blank before it overwrites the new ingest's bar.
let hideTimer: ReturnType<typeof setTimeout> | undefined;

export function setIngestProgress(input: IngestProgressInput): void {
    const bar = ingestProgressBar();
    const fill = ingestProgressFill();
    if (!bar || !fill) return;
    // Any new progress update cancels a pending hide from a previous ingest.
    clearTimeout(hideTimer);
    hideTimer = undefined;
    if ("mode" in input) {
        bar.dataset.state = "indeterminate";
        // Width is controlled by CSS animation for the running cursor - clear inline style.
        fill.style.width = "";
        return;
    }
    const { done, total } = input;
    if (!Number.isFinite(total) || total <= 0) {
        bar.dataset.state = "indeterminate";
        fill.style.width = "";
        return;
    }
    bar.dataset.state = "determinate";
    const pct = Math.max(0, Math.min(100, (done / total) * 100));
    fill.style.width = `${pct}%`;
}

/**
 * Hides the progress bar. If activeFinish=true, first smoothly advances to 100%
 * (200ms easing), then hides; on cancel it hides immediately.
 */
export function hideIngestProgress(activeFinish = false): void {
    const bar = ingestProgressBar();
    const fill = ingestProgressFill();
    if (!bar || !fill) return;
    clearTimeout(hideTimer);
    hideTimer = undefined;
    if (activeFinish && bar.dataset.state === "determinate") {
        fill.style.width = "100%";
        hideTimer = setTimeout(() => {
            bar.dataset.state = "hidden";
            fill.style.width = "";
            hideTimer = undefined;
        }, 240);
        return;
    }
    bar.dataset.state = "hidden";
    fill.style.width = "";
}

export function setIngestStage(text: string): void {
    dom.ingestOverlayStatus.textContent = text;
}

/**
 * Updates the queue indicator ("N more folders waiting"). Called:
 *  - from ingestFiles when a new drop arrived during an active ingest and was
 *    queued (update the UI immediately so the user sees confirmation).
 *  - at the start of each new ingest (if the queue is non-empty from the previous
 *    run - shows the decremented count correctly).
 */
export function syncIngestQueueIndicator(): void {
    const n = state.ingestQueue.length;
    if (n === 0) {
        dom.ingestOverlayQueue.hidden = true;
        return;
    }
    dom.ingestOverlayQueue.hidden = false;
    dom.ingestOverlayQueue.textContent = t("ingestOverlay.queued", { n });
}

/**
 * Attaches the Cancel handler. Call once on startup.
 */
export function initIngestOverlay(): void {
    dom.ingestOverlayCancel.addEventListener("click", () => {
        if (!state.ingestController) {
            // Pre-ingest "preparing" phase: no AbortController yet, so the click
            // just dismisses the waiting overlay (the user backed out of the file
            // picker on a browser that did not fire the cancel event, or wants to
            // bail on a slow dropped-folder read). If a folder was actually
            // selected, the change event re-raises the overlay via ingestFiles.
            endPreIngestReading();
            return;
        }
        state.ingestController.abort();
        // Guard against double-click and give "stopping" feedback. The ingestFiles
        // wrapper will hide the overlay in its finally{} block within 0-N ms (at most
        // 1 ms, depending on which stage was aborted).
        dom.ingestOverlayCancel.disabled = true;
        setIngestStage(t("ingestOverlay.stage.canceling"));
    });
}
