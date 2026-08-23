// GPS-to-video synchronization preferences and Trip hydration.
//
// The parser-owned record clocks stay untouched. Per-trip overrides live in
// localStorage, anchored to a recording's stable file identity; a global player
// default fills trips without an override. The resolved preference is applied
// to each freshly-derived Trip at the regroup boundary.

import { recordsHaveGps } from "./parser.js";
import { fileIdentityKey } from "./persist/identity.js";
import {
    applyGpsSyncToTrip,
    automaticGpsBaseOffsetSec,
    rawTripGpsRecords,
    type Trip,
    tripAllCandidates,
} from "./trips.js";

const DEFAULT_OFFSET_STORAGE_KEY = "dashcamigo:player:gpsOffsetSec";
const TRIP_SYNC_STORAGE_KEY = "dashcamigo:trips:gpsSync";
const MAX_STORED_TRIPS = 200;

// External tracks get their own automatic start baseline, so this is the
// user's fine-offset ceiling. One year still covers badly configured native
// camera clocks while bounding corrupt storage.
const GPS_OFFSET_MAX_SEC = 365 * 24 * 60 * 60;

interface StoredTripGpsSync {
    anchorKey: string;
    offsetSec?: number;
    trimToVideo?: boolean;
    updatedAt: number;
}

export interface ResolvedGpsSync {
    offsetSec: number;
    trimToVideo: boolean;
    hasOffsetOverride: boolean;
}

let memoryDefaultOffsetSec = 0;
let memoryEntries: StoredTripGpsSync[] = [];

export function normalizeGpsOffsetSec(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.min(GPS_OFFSET_MAX_SEC, Math.max(-GPS_OFFSET_MAX_SEC, Math.round(value * 1000) / 1000));
}

export function getDefaultGpsOffsetSec(): number {
    try {
        const raw = localStorage.getItem(DEFAULT_OFFSET_STORAGE_KEY);
        if (raw !== null) {
            const parsed = Number(raw);
            if (Number.isFinite(parsed) && Math.abs(parsed) <= GPS_OFFSET_MAX_SEC) {
                memoryDefaultOffsetSec = normalizeGpsOffsetSec(parsed);
            }
        }
    } catch {
        // Storage blocked: the in-memory value still works for this session.
    }
    return memoryDefaultOffsetSec;
}

export function setDefaultGpsOffsetSec(value: number): number {
    const normalized = normalizeGpsOffsetSec(value);
    memoryDefaultOffsetSec = normalized;
    try {
        localStorage.setItem(DEFAULT_OFFSET_STORAGE_KEY, String(normalized));
    } catch {
        // Storage blocked: the in-memory value still works for this session.
    }
    return normalized;
}

function isStoredEntry(value: unknown): value is StoredTripGpsSync {
    if (typeof value !== "object" || value === null) return false;
    const entry = value as Record<string, unknown>;
    if (typeof entry.anchorKey !== "string" || entry.anchorKey === "") return false;
    if (typeof entry.updatedAt !== "number" || !Number.isFinite(entry.updatedAt) || entry.updatedAt < 0) return false;
    if (
        entry.offsetSec !== undefined &&
        (typeof entry.offsetSec !== "number" ||
            !Number.isFinite(entry.offsetSec) ||
            Math.abs(entry.offsetSec) > GPS_OFFSET_MAX_SEC)
    ) {
        return false;
    }
    return entry.trimToVideo === undefined || typeof entry.trimToVideo === "boolean";
}

function loadEntries(): StoredTripGpsSync[] {
    try {
        const raw = localStorage.getItem(TRIP_SYNC_STORAGE_KEY);
        if (raw === null) return memoryEntries;
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed)) return memoryEntries;
        memoryEntries = parsed.filter(isStoredEntry).map((entry) => ({
            ...entry,
            ...(entry.offsetSec !== undefined ? { offsetSec: normalizeGpsOffsetSec(entry.offsetSec) } : {}),
        }));
    } catch {
        // Corrupt/blocked storage falls back to the last valid session copy.
    }
    return memoryEntries;
}

function saveEntries(entries: StoredTripGpsSync[]): void {
    memoryEntries = [...entries].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_STORED_TRIPS);
    try {
        localStorage.setItem(TRIP_SYNC_STORAGE_KEY, JSON.stringify(memoryEntries));
    } catch {
        // Storage blocked: preferences remain in memory for this session.
    }
}

function candidateIdentityKey(trip: Trip): string[] {
    return tripAllCandidates(trip).map((candidate) =>
        fileIdentityKey({
            relativePath: candidate.relativePath,
            size: candidate.file.size,
            lastModified: candidate.file.lastModified,
        }),
    );
}

function storedEntryForTrip(entries: readonly StoredTripGpsSync[], trip: Trip): StoredTripGpsSync | null {
    const keys = new Set(candidateIdentityKey(trip));
    let best: StoredTripGpsSync | null = null;
    for (const entry of entries) {
        if (!keys.has(entry.anchorKey)) continue;
        if (best === null || entry.updatedAt > best.updatedAt) best = entry;
    }
    return best;
}

export function resolvedGpsSyncForTrip(trip: Trip): ResolvedGpsSync {
    const entry = storedEntryForTrip(loadEntries(), trip);
    return {
        offsetSec: entry?.offsetSec ?? getDefaultGpsOffsetSec(),
        trimToVideo: entry?.trimToVideo ?? true,
        hasOffsetOverride: entry?.offsetSec !== undefined,
    };
}

function upsertTripEntry(trip: Trip, patch: (entry: StoredTripGpsSync) => void): void {
    const entries = [...loadEntries()];
    const existing = storedEntryForTrip(entries, trip);
    const anchorKey = existing?.anchorKey ?? candidateIdentityKey(trip)[0];
    if (!anchorKey) return;
    const entry: StoredTripGpsSync = existing ? { ...existing } : { anchorKey, updatedAt: 0 };
    patch(entry);
    entry.updatedAt = Math.max(Date.now(), (existing?.updatedAt ?? 0) + 1);
    const without = entries.filter((item) => item !== existing);
    if (entry.offsetSec === undefined && entry.trimToVideo === undefined) saveEntries(without);
    else saveEntries([entry, ...without]);
}

/** Stores an explicit offset, including zero (zero must override a non-zero
 *  player default). Passing null clears only this trip's offset override. */
export function setTripGpsOffsetSec(trip: Trip, value: number | null): void {
    upsertTripEntry(trip, (entry) => {
        if (value === null) delete entry.offsetSec;
        else entry.offsetSec = normalizeGpsOffsetSec(value);
    });
}

/** Trimming is on by default, so storing true removes the redundant override. */
export function setTripGpsTrimToVideo(trip: Trip, trimToVideo: boolean): void {
    upsertTripEntry(trip, (entry) => {
        if (trimToVideo) delete entry.trimToVideo;
        else entry.trimToVideo = false;
    });
}

export function applyStoredGpsSyncToTrip(trip: Trip): void {
    const sync = resolvedGpsSyncForTrip(trip);
    applyGpsSyncToTrip(trip, sync.offsetSec, sync.trimToVideo);
}

export function applyStoredGpsSyncToTrips(trips: readonly Trip[]): void {
    for (const trip of trips) applyStoredGpsSyncToTrip(trip);
}

/** Raw-GPS predicate for launch controls. Unlike trip.records it stays true
 *  when a bad offset plus trimming temporarily moves every point off-video. */
export function tripHasRawGps(trip: Trip | null): boolean {
    return trip !== null && recordsHaveGps(rawTripGpsRecords(trip));
}

export function rawGpsStartUnix(trip: Trip): number | null {
    return rawTripGpsRecords(trip).find((record) => record.active)?.unixSeconds ?? null;
}

/** Edge overhang after applying an offset. It intentionally measures only the
 *  track prefix/suffix; recording pauses inside a trip are explained separately
 *  by the timeline and do not read as an accidentally long GPX. */
export function gpsOutsideVideoSec(trip: Trip, offsetSec: number): number {
    const active = rawTripGpsRecords(trip).filter((record) => record.active);
    const first = active[0];
    const last = active[active.length - 1];
    const firstSegment = trip.timeline.segments[0];
    const lastSegment = trip.timeline.segments[trip.timeline.segments.length - 1];
    if (!first || !last || !firstSegment || !lastSegment) return 0;
    const videoStart = firstSegment.wallStart;
    const videoEnd = lastSegment.wallStart + lastSegment.wallDurationSec;
    const effectiveOffsetSec = (trip.gpsBaseOffsetSec ?? automaticGpsBaseOffsetSec(trip)) + offsetSec;
    const before = Math.max(0, videoStart - (first.unixSeconds + effectiveOffsetSec));
    const after = Math.max(0, last.unixSeconds + effectiveOffsetSec - videoEnd);
    return before + after;
}

/** Clears module-level fallbacks between deterministic unit tests. */
export function _resetForTests(): void {
    memoryDefaultOffsetSec = 0;
    memoryEntries = [];
}
