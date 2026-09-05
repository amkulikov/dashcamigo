import { t } from "../i18n/index.js";
import type { Trip } from "../trips.js";
import { eventLabel, formatTime } from "./format.js";

export function buildEventList(trip: Trip, select: (index: number, saveClip: boolean) => void): HTMLElement {
    const list = document.createElement("div");
    list.className = "trip-event-actions";
    trip.events.forEach((event, index) => {
        const row = document.createElement("div");
        const jump = document.createElement("button");
        jump.type = "button";
        jump.className = "dc-btn dc-btn--secondary";
        jump.textContent = `${formatTime(event.relSec)} · ${eventLabel(event.kind)}`;
        jump.addEventListener("click", () => select(index, false));
        const save = document.createElement("button");
        save.type = "button";
        save.className = "dc-btn dc-btn--secondary";
        save.textContent = t("event.popup.export");
        save.addEventListener("click", () => select(index, true));
        row.append(jump, save);
        list.appendChild(row);
    });
    return list;
}
