// Trip name/note editor. Opened from the pencil on a trip card via
// initSidebar's onEditTripMeta callback in app.ts - sidebar cannot import this
// module (it imports sidebar's renderTrips back).

import { t } from "../i18n/index.js";
import type { Trip } from "../trips.js";
import { annotationStorageHintKey } from "./annotations-sidecar.js";
import { setTripMeta, tripFolderId, tripMetaFor } from "./annotations.js";
import { activateModal, deactivateModal, wireBackdropDismiss } from "./modal-helper.js";
import { renderTrips } from "./sidebar.js";

let modal: HTMLElement | null = null;
let nameInput: HTMLInputElement | null = null;
let noteInput: HTMLTextAreaElement | null = null;
let storageHint: HTMLElement | null = null;
// The Trip object, not an index: state.trips is rebuilt/reordered by
// regrouping (a second folder dropped while the modal is open), and a stale
// index would save the edit onto whichever trip now sits at that position.
// The captured object still anchors to the files the user was editing.
let currentTrip: Trip | null = null;

export function initTripMetaModal(): void {
    modal = document.getElementById("trip-meta-modal");
    nameInput = document.getElementById("trip-meta-name") as HTMLInputElement | null;
    noteInput = document.getElementById("trip-meta-note") as HTMLTextAreaElement | null;
    storageHint = document.getElementById("trip-meta-storage-hint");
    if (!modal || !nameInput || !noteInput) return;

    document.getElementById("trip-meta-cancel")?.addEventListener("click", close);
    document.getElementById("trip-meta-save")?.addEventListener("click", save);
    wireBackdropDismiss(modal, close);
    // Escape/Tab live in modal-helper (activateModal); only Enter-to-save in
    // the single-line name field is ours. The textarea keeps Enter for
    // newlines.
    modal.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" && ev.target === nameInput) {
            ev.preventDefault();
            save();
        }
    });
}

export function openTripMetaModal(trip: Trip): void {
    if (!modal || !nameInput || !noteInput) return;
    currentTrip = trip;
    const meta = tripMetaFor(trip);
    nameInput.value = meta?.name ?? "";
    noteInput.value = meta?.note ?? "";
    syncStorageHint(trip);
    modal.hidden = false;
    activateModal(modal, { onClose: close, initialFocus: nameInput });
}

/** Repaints the where-it-lives line for this trip's folder. The folder store
 *  answers async - a stale answer for a modal reopened on another trip must
 *  not land, hence the currentTrip guard. */
function syncStorageHint(trip: Trip): void {
    const hint = storageHint;
    if (!hint) return;
    hint.textContent = t("annotations.storageHint");
    void annotationStorageHintKey(tripFolderId(trip)).then((key) => {
        if (currentTrip === trip) hint.textContent = t(key);
    });
}

function save(): void {
    if (!currentTrip || !nameInput || !noteInput) {
        close();
        return;
    }
    setTripMeta(currentTrip, { name: nameInput.value, note: noteInput.value });
    // Close BEFORE the re-render: closing hands focus back to the pencil that
    // opened the modal, and renderTrips then carries that focus onto the
    // rebuilt card (its own capture/restore pass). The other order restores
    // focus onto a card the re-render has already thrown away, stranding the
    // keyboard on <body>.
    close();
    renderTrips();
}

function close(): void {
    if (modal) {
        modal.hidden = true;
        deactivateModal(modal);
    }
    currentTrip = null;
}
