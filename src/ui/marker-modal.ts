// Timeline-marker editor: one text field + delete. Opened right after adding
// a marker and from a pin's contextmenu. The refresh callback arrives via
// init (app.ts) - importing timeline-markers here would cycle.

import { t } from "../i18n/index.js";
import { annotationStorageHintKey } from "./annotations-sidecar.js";
import { deleteMarker, markerById, updateMarkerText } from "./annotations.js";
import { activateModal, deactivateModal, wireBackdropDismiss } from "./modal-helper.js";

let modal: HTMLElement | null = null;
let textInput: HTMLInputElement | null = null;
let storageHint: HTMLElement | null = null;
let currentMarkerId: string | null = null;
// True while the editor is showing a marker the SAME click just created. The
// pin exists before the dialog does (so it previews live while the user types),
// which would otherwise make Cancel, Escape and a backdrop click all mean
// "keep it" - three of the four ways out of a dialog whose fourth is Save.
let createdNow = false;
let onChanged: (() => void) | null = null;
// Per-open callback of the code that opened the editor, fired on every way out.
// The add gesture uses it to hand playback back; a nested open would clobber it,
// but the editor is modal, so there is no second opener while one is showing.
let onDismissed: (() => void) | null = null;

export function initMarkerModal(callbacks: { onChanged: () => void }): void {
    onChanged = callbacks.onChanged;
    modal = document.getElementById("marker-modal");
    textInput = document.getElementById("marker-modal-text") as HTMLInputElement | null;
    storageHint = document.getElementById("marker-modal-storage-hint");
    if (!modal || !textInput) return;

    document.getElementById("marker-modal-cancel")?.addEventListener("click", close);
    document.getElementById("marker-modal-save")?.addEventListener("click", save);
    document.getElementById("marker-modal-delete")?.addEventListener("click", () => {
        if (currentMarkerId) {
            deleteMarker(currentMarkerId);
            onChanged?.();
        }
        // Explicit delete already did it - leaving the flag set would make the
        // dismissal below tombstone and re-render the same marker a second time.
        createdNow = false;
        close();
    });
    wireBackdropDismiss(modal, close);
    // Escape/Tab live in modal-helper (activateModal); only Enter-to-save is
    // ours.
    modal.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" && ev.target === textInput) {
            ev.preventDefault();
            save();
        }
    });
}

/** Shows the editor for one marker. createdNow marks a marker this same gesture
 *  dropped, so any dismissal removes it again. onClose runs once the editor is
 *  gone, whichever way it went - including the paths that never showed it, so an
 *  opener that prepared something (paused the player) always gets to undo it. */
export function openMarkerModal(markerId: string, opts: { createdNow?: boolean; onClose?: () => void } = {}): void {
    const marker = modal && textInput ? markerById(markerId) : null;
    if (!marker || !modal || !textInput) {
        opts.onClose?.();
        return;
    }
    currentMarkerId = markerId;
    createdNow = opts.createdNow === true;
    onDismissed = opts.onClose ?? null;
    textInput.value = marker.text;
    syncStorageHint(markerId, marker.folderId);
    modal.hidden = false;
    activateModal(modal, { onClose: close, initialFocus: textInput });
}

/** Repaints the where-it-lives line for the marker's folder. The folder store
 *  answers async - guard against the editor moving to another marker. */
function syncStorageHint(markerId: string, folderId: string): void {
    const hint = storageHint;
    if (!hint) return;
    hint.textContent = t("annotations.storageHint");
    void annotationStorageHintKey(folderId).then((key) => {
        if (currentMarkerId === markerId) hint.textContent = t(key);
    });
}

function save(): void {
    if (currentMarkerId && textInput) {
        updateMarkerText(currentMarkerId, textInput.value);
        onChanged?.();
    }
    // Saving is what keeps a freshly dropped marker.
    createdNow = false;
    close();
}

function close(): void {
    // Dismissing the editor of a marker this very click dropped means "never
    // mind" - it takes the pin with it. An existing marker is never removed by
    // a dismissal; only its own Delete button does that.
    if (createdNow && currentMarkerId) {
        deleteMarker(currentMarkerId);
        onChanged?.();
    }
    createdNow = false;
    if (modal) {
        modal.hidden = true;
        deactivateModal(modal);
    }
    currentMarkerId = null;
    // Last, and cleared first: the opener may reopen the editor from here.
    const dismissed = onDismissed;
    onDismissed = null;
    dismissed?.();
}
