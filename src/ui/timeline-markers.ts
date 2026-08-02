// Timeline marker pins: UTC-anchored annotations rendered as flags over the
// shared timeline host (#player-chart), positioned by the same geometry as
// the playhead (timelineSecToFrac). Refreshed by the chart's overlay-sync
// hook (trip change / zoom / pan / resize) and explicitly after edits.
//
// Interactions: the player-bar button drops a marker at the playhead and
// opens the editor; a pin click seeks; contextmenu (long-press on Android)
// opens the editor. iOS touch has no contextmenu - there the marker list
// (marker-list-modal.ts) is the way to rename and delete.

import { t } from "../i18n/index.js";
import { contentToWallUtc, wallToContentSec } from "../trips.js";
import { addMarker, markersForTrip } from "./annotations.js";
import { getTimelineView, timelineSecToFrac } from "./chart.js";
import { syncMarkerListButton } from "./marker-list-modal.js";
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
        // Straight into the text editor - an unlabeled pin is rarely the goal.
        // createdNow: dismissing the editor drops the pin again, so a stray
        // click on this button is undone by Escape like any other dialog.
        openMarkerModal(marker.id, { createdNow: true });
    });
}

// Snapshot of what the layer currently renders. The overlay-sync hook fires
// per pointermove during an overview drag - identical content must not churn
// the DOM (and must not kill :hover on a pin mid-interaction).
let renderedSignature = "";

/** Rebuilds the pins for the active trip and the current zoom window. Cheap
 *  (a handful of DOM nodes); out-of-window markers are skipped, not clamped -
 *  a pile-up at the window edge reads as pins that are not there. */
export function refreshTimelineMarkers(): void {
    const trip = activeTrip();
    const markers = trip ? markersForTrip(trip) : [];
    // Ahead of the layer guard and the signature short-circuit below: the bar
    // button tracks the trip's whole marker set, not the zoom window's slice.
    syncMarkerListButton(markers.length);
    if (!layer) return;
    const view = trip ? getTimelineView() : null;
    const visible: Array<{ id: string; text: string; contentSec: number; frac: number }> = [];
    if (trip && view) {
        for (const marker of markers) {
            const contentSec = wallToContentSec(trip.timeline, marker.utc / 1000);
            if (contentSec < view.startSec || contentSec > view.endSec) continue;
            const frac = timelineSecToFrac(contentSec);
            if (frac == null) continue;
            visible.push({ id: marker.id, text: marker.text, contentSec, frac });
        }
    }
    const signature = visible.map((v) => `${v.id}${v.text}${v.frac.toFixed(4)}`).join("");
    if (signature === renderedSignature) return;
    renderedSignature = signature;
    layer.replaceChildren();
    for (const v of visible) {
        // Wrapper (full height, inert): the hairline. Hit button (flag head
        // only): a full-height interactive column would sit over the seek
        // strip and the pan overview and steal their pointerdowns.
        const pin = document.createElement("span");
        pin.className = "timeline-marker";
        pin.style.left = `${(v.frac * 100).toFixed(3)}%`;
        const hit = document.createElement("button");
        hit.type = "button";
        hit.className = "timeline-marker-hit";
        const label = v.text || t("marker.untitled");
        hit.title = label;
        hit.setAttribute("aria-label", label);
        hit.addEventListener("click", () => seekTripTime(v.contentSec));
        hit.addEventListener("contextmenu", (ev) => {
            ev.preventDefault();
            openMarkerModal(v.id);
        });
        pin.appendChild(hit);
        layer.appendChild(pin);
    }
}
