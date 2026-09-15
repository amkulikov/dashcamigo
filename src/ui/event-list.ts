import { t } from "../i18n/index.js";
import type { Trip } from "../trips.js";
import { eventLabel, formatTime } from "./format.js";

export function buildEventList(trip: Trip, select: (index: number, saveClip: boolean) => void): HTMLElement {
    const list = document.createElement("div");
    list.className = "trip-event-actions";
    trip.events.forEach((event, index) => {
        const row = document.createElement("div");
        row.className = "trip-event-row";
        const jump = document.createElement("button");
        jump.type = "button";
        jump.className = "trip-event-jump";
        jump.textContent = `${formatTime(event.relSec)} · ${eventLabel(event.kind)}`;
        jump.addEventListener("click", () => select(index, false));
        const save = document.createElement("button");
        save.type = "button";
        save.className = "trip-event-save";
        const saveLabel = t("event.popup.export");
        save.title = saveLabel;
        save.setAttribute("aria-label", saveLabel);
        save.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5M12 15V3"/></svg>`;
        const label = document.createElement("span");
        label.className = "trip-event-save__label";
        label.textContent = saveLabel;
        save.append(label);
        save.addEventListener("click", () => select(index, true));
        row.append(jump, save);
        list.appendChild(row);
    });
    return list;
}
