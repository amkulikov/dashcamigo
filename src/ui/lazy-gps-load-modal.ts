// Blocking progress modal for on-trip-click lazy loading of heavy embedded-GPS
// (see lazy-embedded-gps.ts). User clicked a trip with pending files - the
// modal shows "loading N files", a progress counter, and Cancel. On completion
// or Cancel it closes and playFrame starts.
//
// Separate from embedded-gps-prompt-modal: the prompt asks "should we load?",
// this modal shows that loading is happening, no choice offered.
// Cancel here always means "abort this load, play as-is".

import { t } from "../i18n/index.js";
import { dom } from "./dom.js";
import { activateModal, deactivateModal, wireBackdropDismiss } from "./modal-helper.js";

let cancelHandler: (() => void) | null = null;

// Owner token of the modal. The modal is a process-wide singleton, but two
// foreground hydrations (rapid trip clicks on a slow backend) can be in flight
// at once - each shows/updates/closes the same DOM. Without an owner the first
// to finish would close the modal the second still needs (and null its Cancel
// handler). show() mints a fresh token; update()/close() no-op when handed a
// token that a later show() has already superseded.
let modalOwner = 0;

// Which load this modal is showing: heavy embedded-GPS ("gps", the default) or
// filename-first metadata hydration ("hydrate"). Only the title copy differs;
// progress and Cancel are shared.
type LoadVariant = "gps" | "hydrate";

function titleFor(variant: LoadVariant, total: number): string {
    // hydrateLoad.title is a static string (no {n} placeholder), unlike the
    // pluralized lazyGpsLoad.title - so it takes no count argument.
    return variant === "hydrate" ? t("hydrateLoad.title") : t("lazyGpsLoad.title", { n: total });
}

/**
 * Shows the modal for a given total file count. cancelHandler is called on
 * Cancel click / Esc / backdrop click. variant selects the title copy ("gps"
 * for heavy embedded-GPS, "hydrate" for filename-first metadata hydration).
 * Idempotent: calling again over an open modal replaces the cancelHandler,
 * variant and total. Returns an owner token; pass it to
 * updateLazyGpsLoadModalProgress / closeLazyGpsLoadModal so a superseded caller
 * cannot repaint or tear down a modal a later show() now owns.
 */
export function showLazyGpsLoadModal(total: number, onCancel: () => void, variant: LoadVariant = "gps"): number {
    if (!dom.lazyGpsLoadModal) return ++modalOwner;
    const token = ++modalOwner;
    cancelHandler = onCancel;
    if (dom.lazyGpsLoadModalTitle) {
        dom.lazyGpsLoadModalTitle.textContent = titleFor(variant, total);
    }
    if (dom.lazyGpsLoadModalProgress) {
        dom.lazyGpsLoadModalProgress.textContent = t("lazyGpsLoad.progress", { done: 0, total });
    }
    dom.lazyGpsLoadModal.hidden = false;
    // onClose reads the live cancelHandler (not captured) so Escape always
    // aborts the current session even after a re-show swaps the handler.
    activateModal(dom.lazyGpsLoadModal, {
        onClose: () => cancelHandler?.(),
        initialFocus: dom.lazyGpsLoadModalCancel,
    });
    return token;
}

/**
 * Updates the progress counter. When `token` is given it must match the current
 * modal owner - a superseded caller's progress callback is ignored so it does
 * not overwrite the live modal's text with stale counts.
 */
export function updateLazyGpsLoadModalProgress(done: number, total: number, token?: number): void {
    if (!dom.lazyGpsLoadModalProgress) return;
    if (token !== undefined && token !== modalOwner) return;
    dom.lazyGpsLoadModalProgress.textContent = t("lazyGpsLoad.progress", { done, total });
}

/**
 * Closes the modal (after successful completion or after abort). When `token` is
 * given it must match the current owner - a superseded caller finishing first
 * must not tear down a modal a later show() now owns.
 */
export function closeLazyGpsLoadModal(token?: number): void {
    if (!dom.lazyGpsLoadModal) return;
    if (token !== undefined && token !== modalOwner) return;
    dom.lazyGpsLoadModal.hidden = true;
    deactivateModal(dom.lazyGpsLoadModal);
    cancelHandler = null;
}

export function initLazyGpsLoadModal(): void {
    dom.lazyGpsLoadModalCancel?.addEventListener("click", () => {
        // Do NOT close the modal here - cancelHandler triggers the abort, and the
        // session owner (lazy-embedded-gps) calls closeLazyGpsLoadModal in its
        // finally{}. Closing here would cause a race: modal closed, user pressed
        // Play on another trip and tried to open the load modal, but cancelHandler
        // is null here and the old AbortController is already aborted.
        cancelHandler?.();
    });
    // Backdrop click (outside the card) cancels the pending load.
    if (dom.lazyGpsLoadModal) wireBackdropDismiss(dom.lazyGpsLoadModal, () => cancelHandler?.());
    // Escape is handled centrally by the modal manager (activateModal).
}
