// Per-trip GPS/video calibration dialog. Edits are persisted immediately and
// rebuild every GPS-derived surface from immutable candidate records, so the
// user can safely try several offsets without accumulating shifts or losing
// points hidden by an earlier trim.

import {
    applyStoredGpsSyncToTrip,
    applyStoredGpsSyncToTrips,
    getDefaultGpsOffsetSec,
    gpsOutsideVideoSec,
    normalizeGpsOffsetSec,
    rawGpsStartUnix,
    resolvedGpsSyncForTrip,
    setDefaultGpsOffsetSec,
    setTripGpsOffsetSec,
    setTripGpsTrimToVideo,
    tripHasRawGps,
} from "../gps-sync.js";
import { t } from "../i18n/index.js";
import { contentToWallUtc, type Trip } from "../trips.js";

import { dom } from "./dom.js";
import { initGpsSyncLaunchers } from "./gps-sync-controls.js";
import { requestGpsSyncSurfaceRefresh } from "./gps-sync-refresh.js";
import { activateModal, deactivateModal, wireBackdropDismiss } from "./modal-helper.js";
import { notify } from "./notifications.js";
import { activeTrip, state } from "./state.js";

let getTripCurrentTime: () => number = () => 0;
let initialized = false;

function closeGpsSync(): void {
    dom.gpsSyncModal.hidden = true;
    deactivateModal(dom.gpsSyncModal);
}

/** Refreshes surfaces whose data is snapshotted on trip activation. */
function refreshGpsSyncSurfaces(): void {
    requestGpsSyncSurfaceRefresh();
}

/** Re-resolves the player default for all trips without an explicit override. */
export function applyGpsSyncPreferencesToLoadedTrips(): void {
    applyStoredGpsSyncToTrips(state.trips);
    refreshGpsSyncSurfaces();
}

function syncDialog(trip: Trip | null): void {
    const hasGps = tripHasRawGps(trip);
    dom.gpsSyncNoTrack.hidden = hasGps;
    dom.gpsSyncControls.hidden = !hasGps;
    if (!trip || !hasGps) return;

    const resolved = resolvedGpsSyncForTrip(trip);
    dom.gpsSyncOffsetInput.value = String(resolved.offsetSec);
    dom.gpsSyncTrimToggle.checked = resolved.trimToVideo;
    dom.gpsSyncUseDefault.disabled = !resolved.hasOffsetOverride;

    const outsideSec = gpsOutsideVideoSec(trip, resolved.offsetSec);
    dom.gpsSyncOutsideStatus.hidden = outsideSec < 0.5;
    if (outsideSec >= 0.5) {
        dom.gpsSyncOutsideStatus.textContent = t(
            resolved.trimToVideo ? "gpsSync.outside.hidden" : "gpsSync.outside.shown",
            { duration: formatOutsideDuration(outsideSec) },
        );
    } else {
        dom.gpsSyncOutsideStatus.textContent = "";
    }
}

function formatOutsideDuration(seconds: number): string {
    const total = Math.max(0, Math.round(seconds));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const remainder = total % 60;
    if (hours > 0) return `${hours}${t("units.h")} ${minutes}${t("units.m")}`;
    if (minutes > 0) return `${minutes}${t("units.m")} ${remainder}${t("units.s")}`;
    return `${remainder}${t("units.s")}`;
}

function applyOffset(trip: Trip, value: number): void {
    const normalized = normalizeGpsOffsetSec(value);
    setTripGpsOffsetSec(trip, normalized);
    applyStoredGpsSyncToTrip(trip);
    refreshGpsSyncSurfaces();
    syncDialog(trip);
}

function commitOffsetInput(): void {
    const trip = activeTrip();
    if (!trip || !tripHasRawGps(trip)) return;
    const parsed = Number.parseFloat(dom.gpsSyncOffsetInput.value);
    if (!Number.isFinite(parsed)) {
        syncDialog(trip);
        return;
    }
    applyOffset(trip, parsed);
}

export function openGpsSync(): void {
    const trip = activeTrip();
    if (!trip) return;
    // Freeze the reference frame: "track start at playhead" must use the frame
    // that was visible when the user opened calibration, not one several
    // seconds later after reading the explanation.
    dom.player.pause();
    syncDialog(trip);
    dom.gpsSyncModal.hidden = false;
    activateModal(dom.gpsSyncModal, {
        onClose: closeGpsSync,
        initialFocus: tripHasRawGps(trip) ? dom.gpsSyncOffsetInput : dom.gpsSyncClose,
    });
}

export function initGpsSyncModal(opts: { getTripCurrentTime: () => number }): void {
    if (initialized) return;
    initialized = true;
    getTripCurrentTime = opts.getTripCurrentTime;
    initGpsSyncLaunchers(openGpsSync);
    dom.gpsSyncClose.addEventListener("click", closeGpsSync);
    wireBackdropDismiss(dom.gpsSyncModal, closeGpsSync, { cardSelector: ".gps-sync-card" });

    dom.gpsSyncOffsetInput.addEventListener("change", commitOffsetInput);
    dom.gpsSyncOffsetInput.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        commitOffsetInput();
    });

    for (const button of dom.gpsSyncModal.querySelectorAll<HTMLButtonElement>("[data-gps-delta]")) {
        button.addEventListener("click", () => {
            const trip = activeTrip();
            if (!trip || !tripHasRawGps(trip)) return;
            const delta = Number(button.dataset.gpsDelta);
            if (!Number.isFinite(delta)) return;
            applyOffset(trip, (trip.gpsOffsetSec ?? 0) + delta);
        });
    }

    dom.gpsSyncAlignPlayhead.addEventListener("click", () => {
        const trip = activeTrip();
        if (!trip || !tripHasRawGps(trip)) return;
        const gpsStart = rawGpsStartUnix(trip);
        if (gpsStart === null) return;
        const playheadWall = contentToWallUtc(trip.timeline, getTripCurrentTime());
        applyOffset(trip, playheadWall - gpsStart);
    });

    dom.gpsSyncTrimToggle.addEventListener("change", () => {
        const trip = activeTrip();
        if (!trip || !tripHasRawGps(trip)) return;
        setTripGpsTrimToVideo(trip, dom.gpsSyncTrimToggle.checked);
        applyStoredGpsSyncToTrip(trip);
        refreshGpsSyncSurfaces();
        syncDialog(trip);
    });

    dom.gpsSyncUseDefault.addEventListener("click", () => {
        const trip = activeTrip();
        if (!trip || !tripHasRawGps(trip)) return;
        setTripGpsOffsetSec(trip, null);
        applyStoredGpsSyncToTrip(trip);
        refreshGpsSyncSurfaces();
        syncDialog(trip);
    });

    dom.gpsSyncSaveDefault.addEventListener("click", () => {
        const trip = activeTrip();
        if (!trip || !tripHasRawGps(trip)) return;
        setDefaultGpsOffsetSec(trip.gpsOffsetSec ?? getDefaultGpsOffsetSec());
        applyGpsSyncPreferencesToLoadedTrips();
        syncDialog(trip);
        notify({ severity: "info", messageKey: "status.gpsDefaultSaved" });
    });
}
