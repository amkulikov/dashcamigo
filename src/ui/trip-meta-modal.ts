// Trip name & note editor. Opened from the pencil on a trip card (wired via
// initSidebar's onEditTripMeta callback in app.ts - sidebar cannot import this
// module without a cycle, since saving re-renders the sidebar).

import { setTripMeta, tripMetaFor } from "./annotations.js";
import { renderTrips } from "./sidebar.js";
import { state } from "./state.js";

let modal: HTMLElement | null = null;
let nameInput: HTMLInputElement | null = null;
let noteInput: HTMLTextAreaElement | null = null;
let currentTripIdx = -1;

export function initTripMetaModal(): void {
    modal = document.getElementById("trip-meta-modal");
    nameInput = document.getElementById("trip-meta-name") as HTMLInputElement | null;
    noteInput = document.getElementById("trip-meta-note") as HTMLTextAreaElement | null;
    if (!modal || !nameInput || !noteInput) return;

    document.getElementById("trip-meta-cancel")?.addEventListener("click", close);
    document.getElementById("trip-meta-save")?.addEventListener("click", save);
    // Backdrop click closes without saving; clicks inside the card stay put.
    modal.addEventListener("click", (ev) => {
        if (ev.target === modal) close();
    });
    modal.addEventListener("keydown", (ev) => {
        if (ev.key === "Escape") {
            ev.preventDefault();
            close();
        }
        // Enter in the single-line name field saves; the textarea keeps Enter
        // for newlines.
        if (ev.key === "Enter" && ev.target === nameInput) {
            ev.preventDefault();
            save();
        }
    });
}

export function openTripMetaModal(tripIdx: number): void {
    if (!modal || !nameInput || !noteInput) return;
    const trip = state.trips[tripIdx];
    if (!trip) return;
    currentTripIdx = tripIdx;
    const meta = tripMetaFor(trip);
    nameInput.value = meta?.name ?? "";
    noteInput.value = meta?.note ?? "";
    modal.hidden = false;
    nameInput.focus();
}

function save(): void {
    const trip = state.trips[currentTripIdx];
    if (trip && nameInput && noteInput) {
        setTripMeta(trip, { name: nameInput.value, note: noteInput.value });
        renderTrips();
    }
    close();
}

function close(): void {
    if (modal) modal.hidden = true;
    currentTripIdx = -1;
}
