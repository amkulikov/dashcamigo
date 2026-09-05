import { t } from "../i18n/index.js";
import { dom } from "./dom.js";
import { buildEventList } from "./event-list.js";
import { activeTrip, state } from "./state.js";

let onEventSelect: (index: number, saveClip: boolean) => void = () => {};
let renderedTrip = activeTrip();
let renderedEventCount = -1;
let renderedEvents = renderedTrip?.events;

export function initMobileViewNav(selectEvent: (index: number, saveClip: boolean) => void): void {
    onEventSelect = selectEvent;
    document.getElementById("mobile-view-video")?.addEventListener("click", () => {
        closeEvents();
        if (state.mapExpanded) dom.playerMapBtn.click();
        dom.playerWrap.scrollIntoView({ block: "start", behavior: "instant" });
    });
    document.getElementById("mobile-view-map")?.addEventListener("click", () => {
        closeEvents();
        if (!state.mapExpanded) dom.playerMapBtn.click();
        dom.playerWrap.scrollIntoView({ block: "start", behavior: "instant" });
    });
    document.getElementById("mobile-view-events")?.addEventListener("click", () => {
        const list = document.getElementById("mobile-events-list");
        if (!list) return;
        list.hidden = !list.hidden;
        document.getElementById("mobile-view-events")?.setAttribute("aria-expanded", String(!list.hidden));
    });
}

function closeEvents(): void {
    const list = document.getElementById("mobile-events-list");
    if (list) {
        if (list.contains(document.activeElement)) document.getElementById("mobile-view-events")?.focus();
        list.hidden = true;
    }
    document.getElementById("mobile-view-events")?.setAttribute("aria-expanded", "false");
}

export function syncMobileViewNav(): void {
    const trip = activeTrip();
    const nav = document.getElementById("mobile-view-nav");
    if (nav) nav.hidden = !trip || state.exportModeOpen;
    const map = document.querySelector<HTMLButtonElement>("#mobile-view-map");
    if (map) {
        map.disabled = !state.hasTrack;
        map.setAttribute("aria-pressed", String(state.hasTrack && state.mapExpanded));
    }
    document
        .getElementById("mobile-view-video")
        ?.setAttribute("aria-pressed", String(!state.hasTrack || !state.mapExpanded));
    const events = document.querySelector<HTMLButtonElement>("#mobile-view-events");
    if (events) {
        events.disabled = !trip?.events.length;
        events.textContent = `${t("player.nav.events")}${trip?.events.length ? ` · ${trip.events.length}` : ""}`;
    }
    if (trip !== renderedTrip || state.exportModeOpen) closeEvents();
    if (trip === renderedTrip && renderedEvents === trip?.events && renderedEventCount === (trip?.events.length ?? 0))
        return;
    renderedTrip = trip;
    renderedEvents = trip?.events;
    renderedEventCount = trip?.events.length ?? 0;
    const list = document.getElementById("mobile-events-list");
    if (!list) return;
    list.replaceChildren();
    if (trip)
        list.appendChild(
            buildEventList(trip, (index, saveClip) => {
                closeEvents();
                onEventSelect(index, saveClip);
            }),
        );
}
