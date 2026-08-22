// Blocking progress modal for recording metadata or deferred GPS reads.
// (see deferred-gps.ts). User clicked a trip with pending files - the
// modal shows the file count, progress, and Cancel. The owning workflow decides
// whether playback can proceed after it closes.
//
// This modal reports work already in progress. Cancel closes a pending recording
// open; Skip stops optional GPS extraction while leaving video playback intact.

import { t } from "../i18n/index.js";
import { dom } from "./dom.js";
import { activateModal, deactivateModal, wireBackdropDismiss } from "./modal-helper.js";

let cancelHandler: (() => void) | null = null;

// Owner token of the modal. The modal is a process-wide singleton, but two
// foreground recording reads from rapid trip clicks can overlap
// at once - each shows/updates/closes the same DOM. Without an owner the first
// to finish would close the modal the second still needs (and null its Cancel
// handler). show() mints a fresh token; update()/close() no-op when handed a
// token that a later show() has already superseded.
let modalOwner = 0;

// Which load this modal is showing. Title and Cancel copy differ; progress is shared.
type LoadVariant = "gps" | "recordings";

function titleFor(variant: LoadVariant, total: number): string {
    // recordingLoad.title is a static string (no {n} placeholder), unlike the
    // pluralized gpsLoad.title - so it takes no count argument.
    return variant === "recordings" ? t("recordingLoad.title") : t("gpsLoad.title", { n: total });
}

/**
 * Shows the modal for a given total file count. cancelHandler is called on
 * Cancel click / Esc / backdrop click. variant selects the title copy ("gps"
 * for heavy embedded GPS, "recordings" for mandatory recording metadata).
 * Idempotent: calling again over an open modal replaces the cancelHandler,
 * variant and total. Returns an owner token; pass it to
 * updateRecordingLoadModalProgress / closeRecordingLoadModal so a superseded caller
 * cannot repaint or tear down a modal a later show() now owns.
 */
export function showRecordingLoadModal(total: number, onCancel: () => void, variant: LoadVariant = "gps"): number {
    if (!dom.recordingLoadModal) return ++modalOwner;
    const token = ++modalOwner;
    cancelHandler = onCancel;
    if (dom.recordingLoadModalTitle) {
        dom.recordingLoadModalTitle.textContent = titleFor(variant, total);
    }
    if (dom.recordingLoadModalCancel) {
        dom.recordingLoadModalCancel.textContent =
            variant === "recordings" ? t("recordingLoad.cancel") : t("gpsLoad.cancel");
    }
    if (dom.recordingLoadModalProgress) {
        dom.recordingLoadModalProgress.textContent = t("gpsLoad.progress", { done: 0, total });
    }
    dom.recordingLoadModal.hidden = false;
    // onClose reads the live cancelHandler (not captured) so Escape always
    // aborts the current session even after a re-show swaps the handler.
    activateModal(dom.recordingLoadModal, {
        onClose: () => cancelHandler?.(),
        initialFocus: dom.recordingLoadModalCancel,
    });
    return token;
}

/**
 * Updates the progress counter. When `token` is given it must match the current
 * modal owner - a superseded caller's progress callback is ignored so it does
 * not overwrite the live modal's text with stale counts.
 */
export function updateRecordingLoadModalProgress(done: number, total: number, token?: number): void {
    if (!dom.recordingLoadModalProgress) return;
    if (token !== undefined && token !== modalOwner) return;
    dom.recordingLoadModalProgress.textContent = t("gpsLoad.progress", { done, total });
}

/**
 * Closes the modal (after successful completion or after abort). When `token` is
 * given it must match the current owner - a superseded caller finishing first
 * must not tear down a modal a later show() now owns.
 */
export function closeRecordingLoadModal(token?: number): void {
    if (!dom.recordingLoadModal) return;
    if (token !== undefined && token !== modalOwner) return;
    dom.recordingLoadModal.hidden = true;
    deactivateModal(dom.recordingLoadModal);
    cancelHandler = null;
}

export function initRecordingLoadModal(): void {
    dom.recordingLoadModalCancel?.addEventListener("click", () => {
        // Do NOT close the modal here - cancelHandler triggers the abort, and the
        // session owner (deferred-gps) calls closeRecordingLoadModal in its
        // finally{}. Closing here would cause a race: modal closed, user pressed
        // Play on another trip and tried to open the load modal, but cancelHandler
        // is null here and the superseded AbortController is already aborted.
        cancelHandler?.();
    });
    // Backdrop click (outside the card) cancels the pending load.
    if (dom.recordingLoadModal) wireBackdropDismiss(dom.recordingLoadModal, () => cancelHandler?.());
    // Escape is handled centrally by the modal manager (activateModal).
}
