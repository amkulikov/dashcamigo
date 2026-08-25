// In-player progress for the complete selected-trip read. The player stays
// absent until recording metadata and GPS are both ready; Cancel aborts the
// owning workflow without trapping focus in a modal.

import { t } from "../i18n/index.js";
import { dom } from "./dom.js";
import { setDrawerOpen, syncDrawerA11y } from "./mobile-drawer.js";

let cancelHandler: (() => void) | null = null;
let preparationOwner = 0;
let focusBeforePreparation: HTMLElement | null = null;
let browseRestoreRaf = 0;

function paintProgress(done: number, total: number): void {
    const safeTotal = Math.max(1, total);
    const safeDone = Math.min(Math.max(0, done), safeTotal);
    const isFinalizing = total > 0 && safeDone >= safeTotal;
    if (dom.tripPreparationProgress) {
        dom.tripPreparationProgress.textContent = t("gpsLoad.progress", { done: safeDone, total: safeTotal });
    }
    if (dom.tripPreparationProgressbar) {
        dom.tripPreparationProgressbar.setAttribute("aria-valuemax", String(safeTotal));
        dom.tripPreparationProgressbar.classList.toggle("is-finalizing", isFinalizing);
        if (isFinalizing) dom.tripPreparationProgressbar.removeAttribute("aria-valuenow");
        else dom.tripPreparationProgressbar.setAttribute("aria-valuenow", String(safeDone));
    }
    if (dom.tripPreparationProgressFill) {
        dom.tripPreparationProgressFill.style.transform = isFinalizing ? "" : `scaleX(${safeDone / safeTotal})`;
    }
}

/** Shows selected-trip preparation and returns its singleton owner token. */
export function showTripPreparation(total: number, onCancel: () => void): number {
    const token = ++preparationOwner;
    cancelHandler = onCancel;
    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLElement && !dom.tripPreparation?.contains(activeElement)) {
        focusBeforePreparation = activeElement;
    }
    if (browseRestoreRaf) {
        cancelAnimationFrame(browseRestoreRaf);
        browseRestoreRaf = 0;
    }
    if (dom.tripPreparationTitle) dom.tripPreparationTitle.textContent = t("recordingLoad.title");
    if (dom.tripPreparationCancel) {
        dom.tripPreparationCancel.textContent = t("recordingLoad.cancel");
        dom.tripPreparationCancel.disabled = false;
    }
    paintProgress(0, total);
    if (dom.tripPreparation) dom.tripPreparation.hidden = false;
    dom.viewer?.classList.add("preparing");
    document.body.classList.add("preparing-trip");
    if (dom.sidebar.dataset.drawerOpen === "true") setDrawerOpen(false);
    else syncDrawerA11y();
    dom.tripPreparationCancel?.focus({ preventScroll: true });
    return token;
}

/** Updates progress only while `token` still owns the shared viewer state. */
export function updateTripPreparationProgress(done: number, total: number, token?: number): void {
    if (token !== undefined && token !== preparationOwner) return;
    paintProgress(done, total);
}

/** Hides preparation only when the finishing workflow still owns it. */
export function hideTripPreparation(token?: number): void {
    if (token !== undefined && token !== preparationOwner) return;
    if (dom.tripPreparation) dom.tripPreparation.hidden = true;
    dom.viewer?.classList.remove("preparing");
    cancelHandler = null;
    // Keep the mobile browse surface parked through a same-turn handoff from
    // metadata to deferred GPS, and through the final handoff to playFrame.
    // On cancellation there is no replacement owner/active trip, so the next
    // frame restores the list and the control the user originally activated.
    browseRestoreRaf = requestAnimationFrame(() => {
        browseRestoreRaf = 0;
        if (dom.viewer?.classList.contains("preparing")) return;
        document.body.classList.remove("preparing-trip");
        syncDrawerA11y();
        if (
            document.body.classList.contains("browsing") &&
            focusBeforePreparation?.isConnected &&
            !focusBeforePreparation.closest("[inert]")
        ) {
            focusBeforePreparation.focus({ preventScroll: true });
        }
        focusBeforePreparation = null;
    });
}

export function initTripPreparation(): void {
    const cancel = dom.tripPreparationCancel;
    cancel?.addEventListener("click", () => {
        if (!cancelHandler) return;
        cancel.disabled = true;
        cancelHandler();
    });
}
