// Pure UI formatters - time/distance/channel/event strings, export clip name, sort comparators.
// Depends only on i18n and domain types. No DOM, no state.

import type { EventKind, TripEvent } from "../events.js";
import { getDateLocale, t } from "../i18n/index.js";
import { totalDistanceKm } from "../parser.js";
import type { Channel, RecordingMode } from "../parsers/types.js";
import { tripChannels, contentToWallUtc, type Trip, type VideoCandidate } from "../trips.js";
import { formatDistanceFromKm } from "../units-pref.js";

import type { TripSortKey } from "./state.js";

/** True when both dates fall on the same calendar day in local time. */
function isSameLocalDay(a: Date, b: Date): boolean {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/**
 * Trip title in the browser's local timezone.
 * "Apr 29, 18:26 → 18:42" for same-day trips, "Apr 29 18:26 → Apr 30 02:15" for overnight.
 * Year is shown only when the trip year differs from the current year.
 *
 * `now` defaults to the wall clock; injectable so the "hide the current year"
 * branch is deterministically testable (and mockable) without freezing time.
 */
export function formatTripTitle(trip: Trip, now: Date = new Date()): string {
    const start = new Date(trip.startUtc * 1000);
    const end = new Date(trip.endUtc * 1000);
    const sameDay = isSameLocalDay(start, end);
    // hour12:false forces 24-hour format regardless of system locale (en-US otherwise gives "04:43 PM").
    // Explicit locale from i18n (ru-RU or en-US) keeps date language in sync with UI language.
    const locale = getDateLocale();
    const currentYear = now.getFullYear();
    // Show year if EITHER edge is in a different year - covers the rare Dec 31 crossing: both edges show the year for consistency.
    const includeYear = start.getFullYear() !== currentYear || end.getFullYear() !== currentYear;
    const dateOpts: Intl.DateTimeFormatOptions = includeYear
        ? { day: "numeric", month: "short", year: "numeric" }
        : { day: "numeric", month: "short" };
    const dateFmt = new Intl.DateTimeFormat(locale, dateOpts);
    const timeFmt = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", hour12: false });
    if (sameDay) {
        return `${dateFmt.format(start)}, ${timeFmt.format(start)} → ${timeFmt.format(end)}`;
    }
    return `${dateFmt.format(start)} ${timeFmt.format(start)} → ${dateFmt.format(end)} ${timeFmt.format(end)}`;
}

/**
 * Maps a trip's startUtc to a date bucket label for the sidebar separator.
 * Comparison in browser local TZ. `now` is injectable so bucket boundaries
 * (today/yesterday/week/month/future) are deterministically testable.
 */
export function dateBucketLabel(unixTs: number, now: Date = new Date()): string {
    const d = new Date(unixTs * 1000);
    const ds = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const ns = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const dayDiff = Math.round((ns.getTime() - ds.getTime()) / 86400000);
    if (dayDiff === 0) return t("buckets.today");
    if (dayDiff === 1) return t("buckets.yesterday");
    if (dayDiff > 1 && dayDiff < 7) return t("buckets.thisWeek");
    if (dayDiff >= 7 && dayDiff < 30) return t("buckets.thisMonth");
    if (dayDiff < 0) return t("buckets.future"); // guard for timestamps in the future
    return t("buckets.earlier");
}

/**
 * State of the heavy embedded-GPS loading tracker for a trip.
 *  - "loaded": all files loaded or the trip has no heavy files.
 *  - "pending": at least one file is waiting for a click trigger.
 *  - "inflight": at least one file is being parsed in the background.
 *
 * "pending" and "inflight" render differently: pending shows a solid skeleton placeholder,
 * inflight adds a unicode spinner to the same placeholder.
 */
export type TripLazyHeavyState = "loaded" | "pending" | "inflight";

export function formatTripMeta(trip: Trip, lazy: TripLazyHeavyState = "loaded"): string {
    // Footage duration (recording pauses removed) - the wall-clock span would
    // inflate a parking-stitched trip's apparent length. Pauses are surfaced
    // separately below so a stitched trip is recognizable.
    const dur = formatDuration(trip.timeline.contentDurationSec);
    const sizeMb = (trip.totalBytes / (1024 * 1024)).toFixed(0);
    // Distance is pre-computed by finalizeTrip. When lazy is "pending"/"inflight" we substitute "…" because
    // the actual distance is unknown until those files are parsed. Showing 0 or a partial value
    // that jumps after the click is more confusing than a visible placeholder.
    let distStr = "";
    if (lazy === "loaded") {
        if (trip.distanceKm > 0) {
            const d = formatDistanceFromKm(trip.distanceKm);
            distStr = ` · ${Math.round(d.value)} ${t(d.unitKey)}`;
        }
    } else if (lazy === "pending") {
        distStr = ` · …`;
    } else {
        // inflight spinner via ASCII glyph - avoids depending on a CSS keyframe animation.
        distStr = ` · ⟳`;
    }
    // On multi-channel models one frame = a synchronized F/B/I set; the user sees this as one clip. Count frames, not individual files.
    const filesPart = t("plurals.file", { n: trip.frames.length });
    // A stitched trip (recording paused below the gap threshold) shows its pause
    // count so the user knows the footage is not one continuous run.
    const pausesPart =
        trip.timeline.gaps.length > 0 ? ` · ${t("plurals.pause", { n: trip.timeline.gaps.length })}` : "";
    return `${dur} · ${filesPart}${pausesPart} · ${sizeMb} ${t("units.mb")}${distStr}`;
}

export function formatFileMeta(video: VideoCandidate, tripStartUtc: number): string {
    const offsetSec = Math.max(0, video.startUtc - tripStartUtc);
    const offsetStr = formatTime(offsetSec); // mm:ss or h:mm:ss - same format as the player scrubber
    const dur = formatDuration(video.durationSec);
    const sizeMb = (video.file.size / (1024 * 1024)).toFixed(1);
    const distKm = totalDistanceKm(video.records);
    let distStr = "";
    if (distKm > 0) {
        const d = formatDistanceFromKm(distKm);
        distStr = ` · ${d.value.toFixed(1)} ${t(d.unitKey)}`;
    }
    // "GPS: N" is not useful - omit. Explicitly signal when there are no records at all (video without a track).
    const noGps = video.records.length === 0 ? t("trip.fileMeta.noGps") : "";
    return `+${offsetStr} · ${dur} · ${sizeMb} ${t("units.mb")}${distStr}${noGps}`;
}

/** Localized full channel name ("Задняя камера" / "Rear camera") for tooltips and selectors. */
export function channelLabel(ch: Channel): string {
    switch (ch) {
        case "front":
            return t("channel.front");
        case "rear":
            return t("channel.rear");
        case "interior":
            return t("channel.interior");
        case "side":
            return t("channel.side");
    }
}

/**
 * Localized label for a sidebar file-row chip on a clip whose recording mode
 * isn't the default loop recording ("normal" is the default and gets no chip -
 * see the call site in sidebar.ts).
 */
export function recordingModeLabel(mode: Exclude<RecordingMode, "normal">): string {
    switch (mode) {
        case "event":
            return t("trip.fileChip.mode.event");
        case "parking":
            return t("trip.fileChip.mode.parking");
        case "manual":
            return t("trip.fileChip.mode.manual");
    }
}

/** Short single-character channel badge ("З" / "R") for sidebar clip name chips where full labels don't fit. */
export function channelShortLabel(ch: Channel): string {
    switch (ch) {
        case "front":
            return t("channel.front.short");
        case "rear":
            return t("channel.rear.short");
        case "interior":
            return t("channel.interior.short");
        case "side":
            return t("channel.side.short");
    }
}

/** 1-based position of a channel within a trip's channels, in canonical order. Used to number un-trusted channels. */
function channelNumber(ch: Channel, trip: Trip): number {
    const idx = tripChannels(trip).indexOf(ch);
    return idx >= 0 ? idx + 1 : 1;
}

/**
 * Channel label as shown to the user. When the trip trusts this channel's mount
 * (see Trip.confidentChannels) it returns the semantic name ("Rear camera");
 * otherwise the mount was guessed from an index letter and we show a positional
 * "Channel N" so we never assert a mount we can't verify.
 */
export function channelDisplayLabel(ch: Channel, trip: Trip): string {
    if (trip.confidentChannels.has(ch)) return channelLabel(ch);
    return t("channel.numbered", { n: channelNumber(ch, trip) });
}

/** Short channel badge for sidebar chips: mnemonic letter ("R") when trusted, channel number otherwise. */
export function channelDisplayShortLabel(ch: Channel, trip: Trip): string {
    if (trip.confidentChannels.has(ch)) return channelShortLabel(ch);
    return String(channelNumber(ch, trip));
}

export function formatDuration(seconds: number): string {
    if (!Number.isFinite(seconds) || seconds < 0) return "?";
    const total = Math.round(seconds);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    // Units are localized via t() (RU "ч"/"м"/"с", EN "h"/"min"/"s").
    if (h > 0) return `${h}${t("units.h")} ${m}${t("units.m")}`;
    if (m > 0) return `${m}${t("units.m")} ${s}${t("units.s")}`;
    return `${s}${t("units.s")}`;
}

/**
 * mm:ss or h:mm:ss depending on duration. padMinutes forces two-digit minutes
 * even below an hour (mm:ss for export progress timecodes vs m:ss for the
 * player scrubber).
 */
export function formatTime(seconds: number, padMinutes = false): string {
    if (!Number.isFinite(seconds) || seconds < 0) return padMinutes ? "00:00" : "0:00";
    const total = Math.floor(seconds);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const pad = (n: number): string => String(n).padStart(2, "0");
    if (h > 0) return `${h}:${pad(m)}:${pad(s)}`;
    return `${padMinutes ? pad(m) : m}:${pad(s)}`;
}

/** Human-readable file size: bytes → KB/MB/GB via localized unit keys. */
export function formatBytes(b: number): string {
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} ${t("units.kb")}`;
    if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(0)} ${t("units.mb")}`;
    return `${(b / 1024 / 1024 / 1024).toFixed(2)} ${t("units.gb")}`;
}

/**
 * Base filename for the exported clip.
 *
 * Format:
 *   - same calendar day (typical): dashcamigo_YYYYMMDD_HHMMSS-HHMMSS
 *   - clip crossing midnight:       dashcamigo_YYYYMMDD_HHMMSS-YYYYMMDD_HHMMSS
 *
 * Date/time in browser local TZ. Single source of truth for both the FSA picker suggestedName and the export done summary.
 */
export function clipBasename(trip: Trip, startTripSec: number, endTripSec: number): string {
    // start/end are footage-axis seconds; map to wall-clock for the filename's
    // real timestamps (so a clip across a pause shows its true end time).
    const start = new Date(contentToWallUtc(trip.timeline, startTripSec) * 1000);
    const end = new Date(contentToWallUtc(trip.timeline, endTripSec) * 1000);
    const sameDay = isSameLocalDay(start, end);
    const startStr = formatLocalForFilename(start, true);
    const endStr = formatLocalForFilename(end, !sameDay);
    return `dashcamigo_${startStr}-${endStr}`;
}

/**
 * Random 4-character suffix [A-Za-z0-9] appended to export filenames.
 * Prevents a second export of the same range from suggesting the same name as an already-saved file
 * (FSA Replace on an open writable gives "TypeError: network error" and silently overwrites the previous clip).
 * 62^4 ≈ 14.7 M combinations - collision probability is negligible within one session.
 */
const FILENAME_SUFFIX_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
export function randomFilenameSuffix(length = 4): string {
    const alphabet = FILENAME_SUFFIX_ALPHABET;
    const n = alphabet.length;
    // 256 = 4 * 62 + 8: bytes 0..247 are uniformly distributable across 62
    // buckets, bytes 248..255 are dropped to avoid modulo bias.
    const maxAcceptable = Math.floor(256 / n) * n;
    let out = "";
    const buf = new Uint8Array(length * 2);
    while (out.length < length) {
        crypto.getRandomValues(buf);
        for (let i = 0; i < buf.length && out.length < length; i++) {
            const b = buf[i]!;
            if (b < maxAcceptable) out += alphabet[b % n];
        }
    }
    return out;
}

/** Timestamp for a filename: YYYYMMDD_HHMMSS when withDate=true, HHMMSS otherwise (for same-day end timestamps). */
function formatLocalForFilename(d: Date, withDate: boolean): string {
    const pad = (n: number): string => String(n).padStart(2, "0");
    const time = `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    if (!withDate) return time;
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${time}`;
}

// Labels are re-localized on each call (cheap, one Map lookup) to stay in sync with the current language.
export function eventLabel(kind: EventKind): string {
    if (kind === "brake") return t("event.brake.label");
    return kind;
}

/** Formats event severity for a tooltip ("0.42 g"). Currently only "brake"; switch is kept for future kinds. */
export function formatEventSeverity(ev: TripEvent): string {
    if (ev.kind === "brake") return `${ev.severity.toFixed(2)} g`;
    return "";
}

/** Returns a comparator for the given sort key. Distance, duration, and size are pre-computed by finalizeTrip, so comparison is O(1). */
export function comparatorFor(key: TripSortKey): (a: Trip, b: Trip) => number {
    switch (key) {
        case "distance":
            return (a, b) => a.distanceKm - b.distanceKm;
        case "duration":
            return (a, b) => a.durationSec - b.durationSec;
        case "size":
            return (a, b) => a.totalBytes - b.totalBytes;
        default:
            return (a, b) => a.startUtc - b.startUtc;
    }
}
