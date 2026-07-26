// GPS metrics shown next to the player: speed, coordinates, local time.
// Driven by timeupdate + lang/unit change subscriptions. Hides when the player
// is outside the GPS window (no nearby record within METRICS_TOLERANCE_SEC) so
// the panel matches the map marker visibility.

import { getDateLocale, t } from "../i18n/index.js";
import { findNearestIndex } from "../parser.js";
import { contentToFrame, contentToWallUtc, type Trip } from "../trips.js";
import type { GpsRecord } from "../parser.js";
import { formatSpeedFromMs, subscribeUnitsChange, toggleUnits } from "../units-pref.js";
import { dom } from "./dom.js";
import { activeFrame } from "./state.js";

// Kept in sync with TOLERANCE_SEC in interpolatePosition (parser.ts) so player
// metrics and map marker hide together when the target is outside the GPS
// window (typical: GPS stopped before the end of the video).
const METRICS_TOLERANCE_SEC = 5;

// timeupdate fires up to ~15 Hz during playback; Intl.DateTimeFormat
// construction (locale-data resolution + ICU pattern compile) is the only
// expensive op in refreshMetrics. Memoize it, keyed by locale - the langchange
// subscription re-runs the refresh after the locale flips, so a new key
// rebuilds naturally with no stale-formatter risk.
let cachedTimeFmt: Intl.DateTimeFormat | null = null;
let cachedTimeFmtLocale: string | null = null;
function localTimeFormatter(): Intl.DateTimeFormat {
    const locale = getDateLocale();
    if (!cachedTimeFmt || cachedTimeFmtLocale !== locale) {
        cachedTimeFmt = new Intl.DateTimeFormat(locale, {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: false,
        });
        cachedTimeFmtLocale = locale;
    }
    return cachedTimeFmt;
}

function refreshMetrics(rec: GpsRecord | null): void {
    if (!rec) {
        const ph = t("player.metrics.placeholder");
        dom.metrics.speed.textContent = ph;
        dom.metrics.coords.textContent = ph;
        dom.metrics.time.textContent = ph;
        // Unit label stays correct even when no GPS record - user can still
        // click to switch the preference; the next record uses the new unit.
        dom.metrics.unit.textContent = t(formatSpeedFromMs(0).unitKey);
        return;
    }
    const speed = formatSpeedFromMs(rec.speedMs);
    dom.metrics.speed.textContent = speed.value.toFixed(1);
    dom.metrics.unit.textContent = t(speed.unitKey);
    // 4 decimal places = ~11m accuracy at mid-latitudes, enough for viewing.
    // Full 5-place accuracy is in tooltip popups.
    dom.metrics.coords.textContent = `${rec.lat.toFixed(4)}, ${rec.lon.toFixed(4)}`;
    // GPS time shown in browser local TZ. Locale from i18n so 24h/12h follows
    // the UI language.
    dom.metrics.time.textContent = localTimeFormatter().format(new Date(rec.unixSeconds * 1000));
    // Map marker updates via rAF-loop with GPS interpolation - it moves
    // smoothly without us setting position here.
}

/**
 * Re-runs the metrics pipeline at the player's current position. timeupdate,
 * langchange, unitschange share this - all want "show metrics for where the
 * player is right now, using current language and units". The tolerance check
 * matches interpolatePosition (parser.ts) so player numbers and map marker
 * hide together when the GPS window ends before the video.
 *
 * `tripCurrentSec` is trip-relative seconds (getTripCurrentTime). Passed in
 * so this module does not pull in the playback module.
 */
export function refreshMetricsFromActiveFrame(tripCurrentSec: number): void {
    const af = activeFrame();
    if (!af || af.trip.records.length === 0) {
        refreshMetrics(null);
        // Clear on EVERY bail-out: state.active can go null outside playFrame
        // (a regroup that fails to relocate the active file), and a stale
        // marker would sit on the placeholder clock forever.
        markTimelapseClock(false);
        return;
    }
    // tripCurrentSec is footage-axis; map to wall-clock to find the GPS record.
    const targetUnix = contentToWallUtc(af.trip.timeline, tripCurrentSec);
    const idx = findNearestIndex(af.trip.records, targetUnix);
    if (idx < 0) {
        refreshMetrics(null);
        markTimelapseClock(false);
        return;
    }
    const nearest = af.trip.records[idx]!;
    if (Math.abs(nearest.unixSeconds - targetUnix) > METRICS_TOLERANCE_SEC) {
        refreshMetrics(null);
        markTimelapseClock(false);
        return;
    }
    refreshMetrics(nearest);
    markTimelapseClock(currentClipIsTimelapse(af.trip, tripCurrentSec));
}

// Trips overwhelmingly contain no time-lapse clips; remember that per Trip so
// the per-timeupdate segment lookup below runs only on trips that need it.
// Trip objects are rebuilt on every regroup/refresh, so the map self-invalidates.
const tripHasTimelapse = new WeakMap<Trip, boolean>();

/** Whether the clip under the current footage position is a time-lapse. The
 *  frame's channels are all the same clip, so any one answers. */
function currentClipIsTimelapse(trip: Trip, tripCurrentSec: number): boolean {
    let has = tripHasTimelapse.get(trip);
    if (has === undefined) {
        has = trip.frames.some((f) => Object.values(f.channels).some((c) => c?.isTimelapse));
        tripHasTimelapse.set(trip, has);
    }
    if (!has) return false;
    const frame = trip.frames[contentToFrame(trip.timeline, tripCurrentSec).index];
    if (!frame) return false;
    return Object.values(frame.channels).some((c) => c?.isTimelapse);
}

// Last-applied flag: timeupdate calls this up to ~15 Hz - skip the DOM writes
// and the t() lookup when nothing changed. No one else touches the class/title.
let timelapseClockShown = false;

/** Flags the metrics clock as time-lapse: its time runs at playback speed, not
 *  real elapsed time. Tooltip + a dotted-underline style (see player-bar.css). */
function markTimelapseClock(isTimelapse: boolean): void {
    if (isTimelapse === timelapseClockShown) return;
    timelapseClockShown = isTimelapse;
    dom.metrics.time.classList.toggle("is-timelapse", isTimelapse);
    if (isTimelapse) dom.metrics.time.title = t("trip.fileChip.timelapseHint");
    else dom.metrics.time.removeAttribute("title");
}

/** Resets metric labels to placeholders. Used on trip change. */
export function resetMetrics(): void {
    refreshMetrics(null);
    markTimelapseClock(false);
}

/**
 * Wires the inline units toggle (speed pill click) and subscribes the metrics
 * panel to unit changes. The timeupdate-driven refresh stays in player.ts (it
 * shares the listener with progress UI updates). Language is fixed for the page
 * lifetime, so there is no lang-change subscription.
 */
export function initPlayerMetrics(getTripCurrentSec: () => number): void {
    dom.metrics.speedToggle.addEventListener("click", () => {
        toggleUnits();
    });
    subscribeUnitsChange(() => {
        refreshMetricsFromActiveFrame(getTripCurrentSec());
    });
}
