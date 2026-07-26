// Settings modal. Opened by the gear icon #settings-btn in the header.
// Contains two sections:
//   - Privacy (crash-reports toggle), only wired if crash reporting is built
//     into this bundle (VITE_SENTRY_DSN); the section element is hidden via
//     .hidden when not.
//   - Danger zone (reset all local data), always available - it's
//     primarily a support/QA escape hatch and must work even on forks with
//     no crash reporting.
//
// Lifecycle:
//  - settings-btn icon is always shown (Danger zone is universal).
//  - Crash-reports toggle.checked mirrors the stored opt-out state - synced
//    on open. Flipping it spins Sentry up / tears it down at runtime.
//  - Modal closes on the "Close" button, backdrop click, or Escape.
//  - "Reset everything" opens #reset-confirm-modal; confirmation triggers
//    resetAllAppState() from src/ui/reset.ts, which wipes storage and reloads.

import {
    BRAKE_G_THRESHOLD_MAX,
    BRAKE_G_THRESHOLD_MIN,
    detectEvents,
    getBrakeThresholdG,
    setBrakeThresholdG,
} from "../events.js";
import { t } from "../i18n/index.js";
import { createLogger, downloadLogBuffer } from "../log.js";
import { crashReportingEnabled, isCrashReportingBuilt, setCrashReportingEnabled } from "../sentry.js";
import { groupTrips, setTripGapSec, tripAllCandidates, getTripGapSec, projectEventsOntoTimeline } from "../trips.js";
import { getUnits, setUnits, type Units } from "../units-pref.js";
import { APP_VERSION } from "../version.js";
import { rebuildChartFromTrip } from "./chart.js";
import { formatBytes } from "./format.js";
import { refreshMap } from "./map.js";
import { activateModal, deactivateModal, wireBackdropDismiss } from "./modal-helper.js";
import { notify } from "./notifications.js";
import { resetOnboarding } from "./onboarding.js";
import { clearServiceWorkerAndCaches, resetAllAppState } from "./reset.js";
import {
    DEFAULT_SEEK_STEP_SEC,
    DEFAULT_SEEK_STEP_SHIFT_SEC,
    SEEK_STEP_MAX_SEC,
    SEEK_STEP_MIN_SEC,
    getSeekStepSec,
    getSeekStepShiftSec,
    setSeekStepSec,
    setSeekStepShiftSec,
} from "./seek-step-pref.js";
import { cancelLazyHydration, hasActiveLazySessions, resumeLazyHydrationIfPending } from "./lazy-hydrate.js";
import { clearTripEventCycle, renderTrips, updateTripPreview } from "./sidebar.js";
import { activeCandidate, state } from "./state.js";
import { carryBlurRegions } from "./blur-regions-state.js";
import { carryOverTripPreviews, schedulePopulateTripPreviews } from "./trip-preview.js";

const log = createLogger("settings-modal");

function modalEl(): HTMLElement | null {
    return document.getElementById("settings-modal");
}

function resetModalEl(): HTMLElement | null {
    return document.getElementById("reset-confirm-modal");
}

function crashToggleEl(): HTMLInputElement | null {
    return document.getElementById("settings-crash-toggle") as HTMLInputElement | null;
}

/**
 * Sync the crash-reporting checkbox with the stored opt-out state. Crash
 * reporting is opt-OUT: checked by default, unchecked only when the user
 * explicitly turned it off. Absence of the flag = enabled, so this is a
 * simple synchronous read.
 */
function syncCrashToggleFromState(): void {
    const toggle = crashToggleEl();
    if (!toggle) return;
    toggle.checked = crashReportingEnabled();
}

function isOpen(el: HTMLElement | null): boolean {
    return !!el && !el.hidden;
}

function openSettings(): void {
    const m = modalEl();
    if (!m) return;
    syncCrashToggleFromState();
    syncUnitsSelect();
    syncSeekStepInputs();
    syncEventsThresholdInputs();
    syncTripGapInput();
    syncAboutInfo();
    m.hidden = false;
    // [hidden] preserves the card's scrollTop from the previous open -
    // settings must always start at the top, not where the user left off.
    const card = m.querySelector(".modal-card");
    if (card) card.scrollTop = 0;
    activateModal(m, {
        onClose: closeSettings,
        initialFocus: document.getElementById("settings-modal-close"),
    });
}

function syncSeekStepInputs(): void {
    const arrow = document.getElementById("settings-seek-step-input") as HTMLInputElement | null;
    const shift = document.getElementById("settings-seek-step-shift-input") as HTMLInputElement | null;
    if (arrow) arrow.value = String(getSeekStepSec());
    if (shift) shift.value = String(getSeekStepShiftSec());
}

/**
 * Pre-fills the events-threshold controls. The "off" checkbox mirrors the
 * trip-gap "never" pattern: when checked, the number input is disabled and
 * shows the last finite value (or default) for when the user toggles it back.
 */
function syncEventsThresholdInputs(): void {
    const input = document.getElementById("settings-events-threshold-input") as HTMLInputElement | null;
    const off = document.getElementById("settings-events-threshold-off") as HTMLInputElement | null;
    if (!input || !off) return;
    const g = getBrakeThresholdG();
    if (!Number.isFinite(g)) {
        off.checked = true;
        input.disabled = true;
        // Keep a sensible value visible for when the user toggles it back on.
        if (!input.value) input.value = "0.5";
        return;
    }
    off.checked = false;
    input.disabled = false;
    input.value = String(g);
}

function syncUnitsSelect(): void {
    const sel = document.getElementById("settings-units-select") as HTMLSelectElement | null;
    if (sel) sel.value = getUnits();
}

/**
 * Pre-fills the trip-gap controls from stored state. The "never split"
 * checkbox owns the input's disabled state: when checked, input shows the
 * last finite value (or default) but is grey'd out, so re-enabling restores
 * a sensible number instead of an empty field.
 */
function syncTripGapInput(): void {
    const input = document.getElementById("settings-trip-gap-input") as HTMLInputElement | null;
    const never = document.getElementById("settings-trip-gap-never") as HTMLInputElement | null;
    if (!input || !never) return;
    const sec = getTripGapSec();
    if (!Number.isFinite(sec)) {
        never.checked = true;
        input.disabled = true;
        // Keep something in the field for when the user unchecks. Default
        // is 0.5 min (= the original 30s).
        if (!input.value) input.value = "0.5";
        return;
    }
    never.checked = false;
    input.disabled = false;
    // Display seconds → minutes. Trim trailing zeros so "30 sec" reads as
    // "0.5" not "0.500" but "5 min" stays "5".
    const minutes = sec / 60;
    input.value = String(Number(minutes.toFixed(2)));
}

/** Writes version + storage estimate into the About section. Called on open. */
function syncAboutInfo(): void {
    const v = document.getElementById("settings-version-value");
    if (v) v.textContent = APP_VERSION;

    const s = document.getElementById("settings-storage-value");
    if (!s) return;
    if (!navigator.storage?.estimate) {
        s.textContent = t("settings.about.storage.unknown");
        return;
    }
    s.textContent = "…";
    navigator.storage
        .estimate()
        .then((est) => {
            const used = formatBytes(est.usage ?? 0);
            const total = formatBytes(est.quota ?? 0);
            s.textContent = t("settings.about.storage.value", { used, total });
        })
        .catch((err: unknown) => {
            log.warn("storage estimate failed", err);
            s.textContent = t("settings.about.storage.unknown");
        });
}

/**
 * Re-groups the loaded trips with the new gap threshold. Tries to keep the
 * viewer pointed at the same file: captures the active candidate's File
 * reference, re-groups, then re-locates that File in the new trip/frame
 * indices. If the file is gone (or there was no active selection), resets
 * state.active to null. Re-renders the sidebar.
 *
 * No-op when no trips are loaded yet (the next ingest will use the new value).
 */
function regroupLoadedTrips(): void {
    if (state.trips.length === 0) return;

    // A lazy background fill keys its per-trip sessions by positional trip index
    // and relies on those indices staying stable until its final sweep. Regrouping
    // here renumbers state.trips out from under it (wrong-trip refresh + duplicate
    // hydration). Tear the fill down before the regroup, then resume it for any
    // trip still provisional. Conservative: hasActiveLazySessions can stay true
    // after a fill completes, in which case resume is a cheap no-op.
    const hadLazyFill = hasActiveLazySessions();
    if (hadLazyFill) cancelLazyHydration();

    // Capture identity of the active file BEFORE we mutate state.trips -
    // File references are stable per session (the browser keeps the same
    // File object across our pipeline), so they're a reliable key.
    const pinnedFile = activeCandidate()?.file ?? null;

    const allCandidates = state.trips.flatMap((trip) => tripAllCandidates(trip));
    const oldTrips = state.trips;
    const newTrips = groupTrips(allCandidates);
    // Preserve previews across the regroup. Trips that split inherit the
    // preview only on the half that kept the original first file; the other
    // half re-extracts via schedulePopulateTripPreviews below. No SD content-
    // ion concern here - no ingest/indexer is running.
    carryOverTripPreviews(oldTrips, newTrips);
    // The event-cycle cursor is keyed by positional trip index; this regroup
    // renumbers trips, so a surviving cursor would start cycling from a stale
    // event (G8). Same clear the shared applyRegroup does.
    clearTripEventCycle();
    state.trips = newTrips;
    // After the swap, same rationale as applyRegroup: the carry's notify must
    // read a consistent state.trips/state.active pair.
    carryBlurRegions(oldTrips, newTrips);

    state.active = pinnedFile ? findActiveIndices(pinnedFile) : null;
    // The viewer surfaces hold the OLD Trip object while playback math now reads
    // the new grouping - if the active trip merged/split (exactly what a gap
    // change does), chart/map/timeline desync from the scrubber until re-clicked.
    // Rebuild against the re-resolved trip (same as recomputeEventsForLoadedTrips).
    refreshActiveTripSurfaces();
    schedulePopulateTripPreviews(state.trips, updateTripPreview);

    // Resume the fill on the freshly regrouped (renumbered) trips: it rebuilds
    // its session indices against the new state.trips, so it can no longer write
    // to a stale slot. No-op if nothing is still provisional.
    if (hadLazyFill) resumeLazyHydrationIfPending();
}

/** Re-renders the sidebar and rebuilds the chart + map for the active trip, if
 *  any. Shared by the regroup and event-recompute paths, whose surfaces would
 *  otherwise stay pinned to the previous Trip object and desync from the
 *  scrubber. */
function refreshActiveTripSurfaces(): void {
    renderTrips();
    if (state.active) {
        const trip = state.trips[state.active.trip];
        if (trip) {
            rebuildChartFromTrip(trip);
            refreshMap(trip);
        }
    }
}

/**
 * Re-runs event detection over already-loaded trips. Called when the user
 * changes the brake-threshold setting - lighter than regroupLoadedTrips
 * (no re-grouping, just events). Mutates trip.events in place, then
 * refreshes the surfaces that draw event markers: sidebar chips, and the
 * chart + map for the currently active trip.
 */
function recomputeEventsForLoadedTrips(): void {
    if (state.trips.length === 0) return;
    for (const trip of state.trips) {
        // Project onto the footage axis (chart x-coordinate), same as finalizeTrip.
        trip.events = projectEventsOntoTimeline(detectEvents(trip.records, trip.startUtc), trip.timeline);
    }
    refreshActiveTripSurfaces();
}

/**
 * Linear scan over the freshly grouped trips to find the trip/frame indices
 * that contain `file`. Returns null if no frame holds it. Used after a
 * re-group to keep the viewer pinned to the user's current clip.
 */
function findActiveIndices(file: File): { trip: number; frame: number } | null {
    for (let ti = 0; ti < state.trips.length; ti++) {
        const trip = state.trips[ti]!;
        for (let fi = 0; fi < trip.frames.length; fi++) {
            const frame = trip.frames[fi]!;
            for (const c of Object.values(frame.channels)) {
                if (c && c.file === file) {
                    return { trip: ti, frame: fi };
                }
            }
        }
    }
    return null;
}

function closeSettings(): void {
    const m = modalEl();
    if (!m) return;
    m.hidden = true;
    deactivateModal(m);
}

function openResetConfirm(): void {
    closeSettings();
    const m = resetModalEl();
    if (!m) return;
    m.hidden = false;
    activateModal(m, {
        // Escape must land the user back in settings, same as Cancel and the
        // backdrop click do - reset-confirm REPLACES settings (closeSettings
        // above), it does not stack on top, so a bare close would dump the
        // user out of the settings flow entirely.
        onClose: () => {
            closeResetConfirm();
            openSettings();
        },
        initialFocus: document.getElementById("reset-confirm-cancel"),
    });
}

function closeResetConfirm(): void {
    const m = resetModalEl();
    if (!m) return;
    m.hidden = true;
    deactivateModal(m);
}

/**
 * Initializes the settings modal and reset-confirm modal. Idempotent;
 * must be called exactly once from app.ts.
 */
export function initSettingsModal(): void {
    // settings-btn is always shown - Danger zone is universal. Privacy
    // section is hidden separately when analytics is build-disabled.
    const settingsBtn = document.getElementById("settings-btn");
    if (settingsBtn) settingsBtn.hidden = false;

    const m = modalEl();
    if (!m) {
        log.warn("settings modal element not found");
        return;
    }

    // Privacy section holds the crash-reports toggle (opt-OUT, Sentry build
    // flag). Hidden entirely when crash reporting is not built into this
    // bundle, so a fork without a Sentry DSN sees no dangling Privacy header.
    const crashBuilt = isCrashReportingBuilt();
    if (!crashBuilt) {
        const crashRow = document.getElementById("settings-crash-row");
        if (crashRow) crashRow.hidden = true;
        const privacySection = document.getElementById("settings-privacy-section");
        if (privacySection) privacySection.hidden = true;
        log.debug("privacy section hidden (no crash reporting)");
    }

    settingsBtn?.addEventListener("click", () => {
        if (isOpen(m)) closeSettings();
        else openSettings();
    });

    document.getElementById("settings-modal-close")?.addEventListener("click", closeSettings);

    // Backdrop click closes the active modal; the card stops its own clicks.
    wireBackdropDismiss(m, closeSettings, { cardSelector: ".export-modal-card" });

    // Escape is handled centrally by the modal manager (activateModal). Note
    // reset-confirm does NOT stack on settings - openResetConfirm closes
    // settings first and its onClose reopens them, so Escape walks back one
    // step instead of dropping out of the flow.

    // Crash reporting toggle (opt-OUT). Flipping it persists the choice and
    // spins up / tears down Sentry at runtime - no reload needed.
    crashToggleEl()?.addEventListener("change", (ev) => {
        const target = ev.target as HTMLInputElement;
        setCrashReportingEnabled(target.checked);
    });

    // --- Playback: units select ---

    document.getElementById("settings-units-select")?.addEventListener("change", (ev) => {
        const sel = ev.target as HTMLSelectElement;
        const v = sel.value;
        if (v === "metric" || v === "imperial") {
            setUnits(v as Units);
        }
    });

    // --- Playback: arrow-key seek step ---
    //
    // Two independent inputs. Empty / invalid input restores the default so
    // an accidentally-cleared field doesn't leave the player with NaN as a
    // step (which would seek nowhere). Clamping is done by the pref setter.

    const seekInput = document.getElementById("settings-seek-step-input") as HTMLInputElement | null;
    const seekShiftInput = document.getElementById("settings-seek-step-shift-input") as HTMLInputElement | null;

    function applySeekStep(input: HTMLInputElement | null, fallback: number, write: (sec: number) => void): void {
        if (!input) return;
        const raw = Number.parseFloat(input.value);
        const next = Number.isFinite(raw) && raw > 0 ? raw : fallback;
        const clamped = Math.min(SEEK_STEP_MAX_SEC, Math.max(SEEK_STEP_MIN_SEC, next));
        if (clamped !== raw) input.value = String(clamped);
        write(clamped);
    }

    seekInput?.addEventListener("change", () => applySeekStep(seekInput, DEFAULT_SEEK_STEP_SEC, setSeekStepSec));
    seekShiftInput?.addEventListener("change", () =>
        applySeekStep(seekShiftInput, DEFAULT_SEEK_STEP_SHIFT_SEC, setSeekStepShiftSec),
    );

    // --- Events: brake/impact detection threshold ---
    //
    // Number input + "off" checkbox (mirrors the trip-gap pattern). On any
    // change we recompute trip.events for ALL loaded trips and refresh the
    // surfaces that show event markers: sidebar chip (renderTrips), and -
    // if a trip is currently active - the chart and the map.

    const eventsInput = document.getElementById("settings-events-threshold-input") as HTMLInputElement | null;
    const eventsOff = document.getElementById("settings-events-threshold-off") as HTMLInputElement | null;

    function applyEventsThresholdFromInput(): void {
        if (!eventsInput) return;
        const raw = Number.parseFloat(eventsInput.value);
        if (!Number.isFinite(raw) || raw <= 0) return;
        const clamped = Math.min(BRAKE_G_THRESHOLD_MAX, Math.max(BRAKE_G_THRESHOLD_MIN, raw));
        if (clamped !== raw) eventsInput.value = String(clamped);
        setBrakeThresholdG(clamped);
        recomputeEventsForLoadedTrips();
    }

    eventsInput?.addEventListener("change", applyEventsThresholdFromInput);

    eventsOff?.addEventListener("change", () => {
        if (!eventsOff) return;
        if (eventsOff.checked) {
            if (eventsInput) eventsInput.disabled = true;
            setBrakeThresholdG(Number.POSITIVE_INFINITY);
        } else {
            if (eventsInput) eventsInput.disabled = false;
            applyEventsThresholdFromInput();
            // applyEventsThresholdFromInput is a no-op on empty / invalid input,
            // so it won't write or recompute when the user just unchecks "off"
            // without a value in the field. Guarantee a finite threshold by
            // falling back to the default.
            if (!Number.isFinite(getBrakeThresholdG())) {
                setBrakeThresholdG(0.5);
                if (eventsInput) eventsInput.value = "0.5";
            }
        }
        recomputeEventsForLoadedTrips();
    });

    // --- Ingest: trip grouping threshold ---
    //
    // Two controls sharing state: a minutes-number input and a "never split"
    // checkbox. The checkbox is authoritative on storage (when checked,
    // we persist Infinity); when unchecked, the input value (in minutes,
    // converted to seconds) is persisted. Both trigger regroup of loaded
    // trips so the sidebar reflects the change immediately.

    const tripInput = document.getElementById("settings-trip-gap-input") as HTMLInputElement | null;
    const tripNever = document.getElementById("settings-trip-gap-never") as HTMLInputElement | null;

    // Min/max mirror the HTML input attributes. Native validation surfaces
    // a tooltip on submit but doesn't block the `change` event, so we clamp
    // here too - otherwise a typed "5000" would land 83 hours into storage.
    const TRIP_GAP_MIN_MINUTES = 0.5;
    const TRIP_GAP_MAX_MINUTES = 180;

    function applyTripGapFromInput(): void {
        if (!tripInput) return;
        const raw = Number.parseFloat(tripInput.value);
        if (!Number.isFinite(raw) || raw <= 0) return;
        const minutes = Math.min(TRIP_GAP_MAX_MINUTES, Math.max(TRIP_GAP_MIN_MINUTES, raw));
        // Echo the clamped value back so the user sees what was actually saved.
        if (minutes !== raw) tripInput.value = String(minutes);
        setTripGapSec(minutes * 60);
        regroupLoadedTrips();
    }

    // "input" fires on every keystroke; "change" only on blur. We use "change"
    // so the user can type "12" without intermediate regroups when they hit "1".
    tripInput?.addEventListener("change", applyTripGapFromInput);

    tripNever?.addEventListener("change", () => {
        if (!tripNever) return;
        if (tripNever.checked) {
            if (tripInput) tripInput.disabled = true;
            setTripGapSec(Number.POSITIVE_INFINITY);
        } else {
            if (tripInput) tripInput.disabled = false;
            applyTripGapFromInput();
        }
        regroupLoadedTrips();
    });

    // --- About & diagnostics ---

    document.getElementById("settings-download-log-btn")?.addEventListener("click", () => {
        downloadLogBuffer();
    });

    document.getElementById("settings-clear-cache-btn")?.addEventListener("click", () => {
        const btn = document.getElementById("settings-clear-cache-btn") as HTMLButtonElement | null;
        if (btn) btn.disabled = true;
        // Lighter than the full Danger zone reset: only Cache Storage + SW.
        // Preferences and language remain intact. Reload (success path only)
        // picks up the freshly downloaded shell.
        void clearServiceWorkerAndCaches()
            .then(() => location.reload())
            .catch((err) => {
                // Re-enable on failure: we did NOT reload, so leaving the button
                // disabled would strand the control with no way to retry.
                log.warn("clear offline cache failed", err);
                if (btn) btn.disabled = false;
            });
    });

    // --- Reset / Danger zone ---

    // Replay tips: clear the onboarding-tour seen-state so the tours fire again
    // at their next trigger (ingest / trip open / export open). No reload - the
    // toast confirms, and the tours surface as the user navigates.
    document.getElementById("settings-reset-onboarding-btn")?.addEventListener("click", () => {
        resetOnboarding();
        notify({ severity: "info", messageKey: "settings.danger.onboarding.done" });
    });

    document.getElementById("settings-reset-btn")?.addEventListener("click", openResetConfirm);

    document.getElementById("reset-confirm-cancel")?.addEventListener("click", () => {
        closeResetConfirm();
        // Return the user to settings - they came from there, no point
        // sending them back to an empty viewport.
        openSettings();
    });

    document.getElementById("reset-confirm-go")?.addEventListener("click", () => {
        // Disable the button so the user does not double-click during the
        // ~hundreds-of-ms wipe. The page is about to reload anyway, but a
        // second click could fire a parallel reset on the same caches/idb
        // and surface confusing errors.
        const goBtn = document.getElementById("reset-confirm-go") as HTMLButtonElement | null;
        const cancelBtn = document.getElementById("reset-confirm-cancel") as HTMLButtonElement | null;
        if (goBtn) goBtn.disabled = true;
        if (cancelBtn) cancelBtn.disabled = true;
        // Fire-and-forget: resetAllAppState ends with location.reload(),
        // there is no continuation after it.
        void resetAllAppState().catch((err) => {
            log.warn("reset failed, reloading anyway", err);
            location.reload();
        });
    });

    // Reset-confirm backdrop click cancels (treats it like Cancel).
    const resetEl = resetModalEl();
    if (resetEl) {
        wireBackdropDismiss(
            resetEl,
            () => {
                closeResetConfirm();
                openSettings();
            },
            { cardSelector: ".export-modal-card" },
        );
    }
}
