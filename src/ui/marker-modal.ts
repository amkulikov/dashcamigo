// Timeline-marker editor: one text field + delete. Opened right after adding
// a marker and from a pin's contextmenu. The refresh callback arrives via
// init (app.ts) - importing timeline-markers here would cycle.

import { deleteMarker, markerById, updateMarkerText } from "./annotations.js";
import { activateModal, deactivateModal, wireBackdropDismiss } from "./modal-helper.js";

let modal: HTMLElement | null = null;
let textInput: HTMLInputElement | null = null;
let currentMarkerId: string | null = null;
let onChanged: (() => void) | null = null;

export function initMarkerModal(callbacks: { onChanged: () => void }): void {
    onChanged = callbacks.onChanged;
    modal = document.getElementById("marker-modal");
    textInput = document.getElementById("marker-modal-text") as HTMLInputElement | null;
    if (!modal || !textInput) return;

    document.getElementById("marker-modal-cancel")?.addEventListener("click", close);
    document.getElementById("marker-modal-save")?.addEventListener("click", save);
    document.getElementById("marker-modal-delete")?.addEventListener("click", () => {
        if (currentMarkerId) {
            deleteMarker(currentMarkerId);
            onChanged?.();
        }
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

export function openMarkerModal(markerId: string): void {
    if (!modal || !textInput) return;
    const marker = markerById(markerId);
    if (!marker) return;
    currentMarkerId = markerId;
    textInput.value = marker.text;
    modal.hidden = false;
    activateModal(modal, { onClose: close, initialFocus: textInput });
}

function save(): void {
    if (currentMarkerId && textInput) {
        updateMarkerText(currentMarkerId, textInput.value);
        onChanged?.();
    }
    close();
}

function close(): void {
    if (modal) {
        modal.hidden = true;
        deactivateModal(modal);
    }
    currentMarkerId = null;
}
