// Loading overlay with a built-in safety timer. Each show() is guaranteed to
// auto-hide after MAX_OVERLAY_MS if hide() was never called - guards against
// race conditions (remux stalled, events never fired) so the overlay cannot
// freeze; in the worst case the user sees a blank screen for a moment.

import { dom } from "./dom.js";

const MAX_OVERLAY_MS = 3000;
let overlayHideTimer: ReturnType<typeof setTimeout> | null = null;

export function showLoadingOverlay(): void {
    dom.videoLoadingOverlay.hidden = false;
    // aria-busy tells assistive tech the grid is loading - a non-sighted user
    // otherwise gets no "buffering" signal (the spinner is aria-hidden).
    dom.videoGrid.setAttribute("aria-busy", "true");
    if (overlayHideTimer !== null) clearTimeout(overlayHideTimer);
    overlayHideTimer = setTimeout(() => {
        overlayHideTimer = null;
        dom.videoLoadingOverlay.hidden = true;
        dom.videoGrid.setAttribute("aria-busy", "false");
    }, MAX_OVERLAY_MS);
}

export function hideLoadingOverlay(): void {
    if (overlayHideTimer !== null) {
        clearTimeout(overlayHideTimer);
        overlayHideTimer = null;
    }
    dom.videoLoadingOverlay.hidden = true;
    dom.videoGrid.setAttribute("aria-busy", "false");
}
