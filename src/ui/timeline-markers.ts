// Timeline marker pins: UTC-anchored annotations rendered as flags over the
// shared timeline host (#player-chart), positioned by the same geometry as
// the playhead (timelineSecToFrac). Refreshed by the chart's overlay-sync
// hook (trip change / zoom / pan / resize) and explicitly after edits.
//
// Interactions: the player-bar button drops a marker at the playhead and
// opens the editor; a pin click seeks; contextmenu (long-press on Android)
// opens the editor. TODO: an edit affordance for iOS touch (no contextmenu).

import { t } from "../i18n/index.js";
import { contentToWallUtc, wallToContentSec } from "../trips.js";
import { addMarker, markersForTrip } from "./annotations.js";
import { getTimelineView, timelineSecToFrac } from "./chart.js";
import { openMarkerModal } from "./marker-modal.js";
import { getTripCurrentTime, seekTripTime } from "./player.js";
import { activeTrip } from "./state.js";

let layer: HTMLElement | null = null;

export function initTimelineMarkers(): void {
    layer = document.getElementById("player-chart-markers");
    document.getElementById("player-add-marker")?.addEventListener("click", () => {
        const trip = activeTrip();
        if (!trip) return;
        const contentSec = getTripCurrentTime();
        const utcMs = contentToWallUtc(trip.timeline, contentSec) * 1000;
        const marker = addMarker(trip, utcMs, "");
        refreshTimelineMarkers();
        // Straight into the text editor - an unlabeled pin is rarely the goal,
        // and cancel-with-empty-text simply leaves a bare pin.
        openMarkerModal(marker.id);
    });
}

/** Rebuilds the pins for the active trip and the current zoom window. Cheap
 *  (a handful of DOM nodes); out-of-window markers are skipped, not clamped -
 *  a pile-up at the window edge reads as pins that are not there. */
export function refreshTimelineMarkers(): void {
    if (!layer) return;
    layer.replaceChildren();
    const trip = activeTrip();
    if (!trip) return;
    const view = getTimelineView();
    if (!view) return;
    for (const marker of markersForTrip(trip)) {
        const contentSec = wallToContentSec(trip.timeline, marker.utc / 1000);
        if (contentSec < view.startSec || contentSec > view.endSec) continue;
        const frac = timelineSecToFrac(contentSec);
        if (frac == null) continue;
        const pin = document.createElement("button");
        pin.type = "button";
        pin.className = "timeline-marker";
        pin.style.left = `${(frac * 100).toFixed(3)}%`;
        const label = marker.text || t("marker.untitled");
        pin.title = label;
        pin.setAttribute("aria-label", label);
        pin.addEventListener("click", () => seekTripTime(contentSec));
        pin.addEventListener("contextmenu", (ev) => {
            ev.preventDefault();
            openMarkerModal(marker.id);
        });
        layer.appendChild(pin);
    }
}
