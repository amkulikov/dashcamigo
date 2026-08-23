// Generic utilities for GpsRecord arrays: distance, binary search for the
// nearest record, position interpolation. Vendor-agnostic.
//
// Vendor-specific parsing lives in src/parsers/<vendor>.ts (see registry).
// Domain types (GpsRecord, ParsedLog, SkippedLine) are defined in
// src/parsers/types.ts; this module re-exports them so existing
// imports `from "./parser.js"` continue to work.

export type { GpsRecord, ParsedLog, SkippedLine } from "./parsers/types.js";

import { mai70NameCore } from "./parsers/filename/_patterns.js";
import { blackvueChannelCloneGroup } from "./parsers/primitives/clone-groups.js";
import type { GpsRecord, InterpolatedPosition, ParsedLog, SkippedLine, VendorFile } from "./parsers/types.js";
import { vendorFileKey } from "./vendor-file-key.js";

/**
 * Dynamic-acceleration magnitude from a gravity-removed accel triple. Single
 * definition for the max-|G|-wins transplant the merge/dedup layer performs in
 * four places (dedupRecords and thinDenseRecords here, finalizeTrip
 * cross-channel dedup, and registry.mergeAccelSamples), so a
 * collision/downsample never silently drops the strongest impact sample before
 * detectEvents runs. Component form (not a
 * GpsRecord) because mergeAccelSamples compares raw AccelSamples after
 * subtracting the per-file gravity offset. Mirrors events.gMagnitude, but lives
 * here because events.ts imports from this module (importing back would cycle).
 */
export function accelMagnitude(xg: number, yg: number, zg: number): number {
    return Math.hypot(xg, yg, zg);
}

/**
 * Deduplicates records by composite key (unixSeconds, lat, lon, video owner).
 * Needed on merge from multiple sources / repeated drag-drops: a re-dropped
 * GPSData file would double brake events, distance, and chart density.
 *
 * Including position and concrete owner allows two files with the same raw
 * basename and timestamp to coexist (equal trees or multi-channel models).
 *
 * On a key collision the first-seen record wins its identity, but the stronger
 * accel triple is transplanted onto it (max-|G| wins). Reason: a parking-mode /
 * cold-start clip keeps identical lat/lon across every row, so all its records
 * share one position key and would collapse to the first - taking the impact
 * spike (which rides a LATER row) with it, and detectEvents would see no brake.
 * The kept record is cloned rather than mutated: these records are aliased by
 * state.gpsLog buckets and candidate.records, and the raw parser output must
 * stay untouched. Same policy dropTeleportOutliers already applies on drop.
 */
export function dedupRecords(records: GpsRecord[]): GpsRecord[] {
    const indexByKey = new Map<string, number>();
    const out: GpsRecord[] = [];
    for (const r of records) {
        // Unsynced (cold-start) records key on position only, not time: their
        // unixSeconds is a placeholder that the time layer later rewrites to the
        // video window, so a re-drop of the same log would otherwise compare a
        // reanchored copy (real time) against a fresh placeholder (~1970) and
        // fail to dedup. Position + filename identify them uniquely enough.
        const owner = r.videoKey ?? r.mp4Filename;
        const key = r.timeUnsynced ? `u|${r.lat}|${r.lon}|${owner}` : `${r.unixSeconds}|${r.lat}|${r.lon}|${owner}`;
        const existingIdx = indexByKey.get(key);
        if (existingIdx === undefined) {
            indexByKey.set(key, out.length);
            out.push(r);
            continue;
        }
        const kept = out[existingIdx]!;
        if (
            accelMagnitude(r.accelXg, r.accelYg, r.accelZg) > accelMagnitude(kept.accelXg, kept.accelYg, kept.accelZg)
        ) {
            out[existingIdx] = { ...kept, accelXg: r.accelXg, accelYg: r.accelYg, accelZg: r.accelZg };
        }
    }
    return out;
}

/**
 * Cap on stored GPS record density. 5 Hz keeps enough sub-second shape for the
 * exported gpmd/GPX tracks and near-exact event timing while still cutting the
 * densest sources (Vueroid ~20 Hz, GoPro ~18 Hz) to a quarter of the memory
 * and index-cache footprint. Thinning only collapses - a source at or below
 * this rate passes through unchanged, nothing is ever interpolated up.
 */
export const GPS_THIN_HZ = 5;

/**
 * Thins records to at most GPS_THIN_HZ per second per file. Denser GPS
 * (Nextbase fmt1 10 Hz, Vueroid ~20 Hz, GoPro ~18 Hz) buys nothing on a
 * map/chart sampled at 1 Hz everywhere else, but multiplies session memory and
 * the IndexedDB index cache by the rate factor - so the merge funnel drops the
 * extras and keeps the one signal that genuinely lives between samples: the
 * strongest gravity-removed accel triple of the bucket is transplanted onto
 * the survivor (max-|G| wins, same policy as dedupRecords), so detectEvents
 * still sees every braking peak.
 *
 * The survivor is the bucket's first record with a valid fix (first record at
 * all when none has one) - a fix acquired mid-bucket must not lose its
 * coordinates to a no-fix placeholder. Records are bucketed by
 * floor(unixSeconds * GPS_THIN_HZ); unsynced records bucket by
 * floor(relStartSeconds * GPS_THIN_HZ) instead (their unixSeconds is a
 * placeholder the time layer rewrites later), and an unsynced record without
 * relStartSeconds passes through untouched - there is no per-record clock to
 * bucket it by, and every such source is 1 Hz anyway.
 *
 * Kept records are referenced, never mutated (they are aliased by state.gpsLog
 * buckets and candidate.records); a transplant clones. Idempotent, so re-merging
 * an already-thinned bucket is a no-op.
 */
export function thinDenseRecords(records: GpsRecord[]): GpsRecord[] {
    const indexByKey = new Map<string, number>();
    const out: GpsRecord[] = [];
    for (const r of records) {
        let bucketKey: string;
        if (r.timeUnsynced) {
            if (r.relStartSeconds === undefined) {
                out.push(r);
                continue;
            }
            // "r|" keeps the relative-offset axis from colliding with a synced
            // record's wall-clock axis in the same bucket.
            bucketKey = `r|${Math.floor(r.relStartSeconds * GPS_THIN_HZ)}`;
        } else {
            bucketKey = String(Math.floor(r.unixSeconds * GPS_THIN_HZ));
        }
        const key = `${bucketKey}|${r.videoKey ?? r.mp4Filename}`;
        const existingIdx = indexByKey.get(key);
        if (existingIdx === undefined) {
            indexByKey.set(key, out.length);
            out.push(r);
            continue;
        }
        const kept = out[existingIdx]!;
        const keptIsStrongest =
            accelMagnitude(kept.accelXg, kept.accelYg, kept.accelZg) >= accelMagnitude(r.accelXg, r.accelYg, r.accelZg);
        if (!kept.active && r.active) {
            // Fix acquired mid-bucket: this record's coordinates win, but the
            // strongest accel seen so far must ride along (kept already holds
            // the max of every earlier record in this bucket).
            out[existingIdx] = keptIsStrongest
                ? { ...r, accelXg: kept.accelXg, accelYg: kept.accelYg, accelZg: kept.accelZg }
                : r;
        } else if (!keptIsStrongest) {
            out[existingIdx] = { ...kept, accelXg: r.accelXg, accelYg: r.accelYg, accelZg: r.accelZg };
        }
    }
    return out;
}

/**
 * First record whose GPS clock was synced (a real wall-clock time). Cold-start
 * records (`timeUnsynced`) carry a near-epoch placeholder written before the
 * chip decoded satellite time; manually attached external tracks carry another
 * device's clock. Neither may be used as a source for video start / camera-TZ
 * derivation. Returns null when every record is in either category.
 */
export function firstSyncedRecord(records: GpsRecord[] | null | undefined): GpsRecord | null {
    if (!records) return null;
    for (const r of records) {
        if (!r.timeUnsynced && !r.externalTrack) return r;
    }
    return null;
}

/** Last record whose GPS clock may anchor the video. Counterpart to
 *  firstSyncedRecord; null when no record may anchor the video. */
export function lastSyncedRecord(records: GpsRecord[] | null | undefined): GpsRecord | null {
    if (!records) return null;
    for (let i = records.length - 1; i >= 0; i--) {
        if (!records[i]!.timeUnsynced && !records[i]!.externalTrack) return records[i]!;
    }
    return null;
}

/**
 * Total trip distance via haversine over all active GPS records.
 * Only `active === true` records are counted - lost-fix points produce
 * coordinate jumps that inflate distance.
 *
 * Accuracy is ~5-15% at 1 Hz with good sky visibility - sufficient for
 * the "distance driven" display, not for precise measurement.
 *
 * Returns distance in km, 0 if fewer than two records.
 */
export function totalDistanceKm(records: GpsRecord[] | null | undefined): number {
    if (!records || records.length < 2) return 0;
    let prev: GpsRecord | null = null;
    let sum = 0;
    for (const r of records) {
        if (!r.active) continue;
        if (prev !== null) {
            sum += haversineKm(prev.lat, prev.lon, r.lat, r.lon);
        }
        prev = r;
    }
    return sum;
}

/**
 * Running distance in km from the first record to each one, aligned
 * index-for-index with `records`. Same rule as totalDistanceKm - only
 * `active === true` records advance the total, so a lost-fix jump does not
 * inflate it, and the last element equals totalDistanceKm(records).
 *
 * Precomputed per trip on purpose: the readout row wants "distance so far" at
 * every playhead position, and re-summing haversine over the whole track at
 * timeupdate rate is not something a playback path can afford.
 *
 * Empty input returns an empty array.
 */
export function cumulativeDistanceKm(records: GpsRecord[] | null | undefined): Float64Array {
    if (!records || records.length === 0) return new Float64Array(0);
    const out = new Float64Array(records.length);
    let prev: GpsRecord | null = null;
    let sum = 0;
    for (let i = 0; i < records.length; i++) {
        const r = records[i]!;
        if (r.active) {
            if (prev !== null) sum += haversineKm(prev.lat, prev.lon, r.lat, r.lon);
            prev = r;
        }
        out[i] = sum;
    }
    return out;
}

/**
 * True iff the records carry at least one valid GPS fix. "active" = a valid
 * lat/lon fix (see GpsRecord); lost-fix points do not count. This is the single
 * gate for every GPS-dependent export option - the GPS-track-only mode, the
 * embedded telemetry track, the .gpx sidecar, and the speed/coords/map overlays
 * - none of which produce anything without a fix. The export panel disables the
 * matching controls and the export pipeline ignores them on a trip that fails
 * this check.
 */
export function recordsHaveGps(records: GpsRecord[] | null | undefined): boolean {
    return !!records && records.some((r) => r.active);
}

/**
 * Fills bearingDeg in-place using initial bearing toward the next
 * sufficiently distant point. Use ONLY for formats that do not carry course
 * (GoPro GPMF GPS5/GPS9). NMEA-based vendors (70mai, Novatek, BlackVue,
 * Thinkware) carry bearing from RMC - do not overwrite.
 *
 * Look-ahead is needed because GoPro writes 18 Hz sub-points: at 1.5 m/s
 * adjacent points are ~8 cm apart and atan2 on that noise gives a random angle.
 * Scans forward to the first point at distance >= MIN_BEARING_DIST_DEG (~1 m),
 * computes bearing to it, copy-forwards to all intermediate points.
 *
 * Stationary points (speedMs < MIN_BEARING_SPEED_MS) inherit the last valid
 * bearing so the marker does not jitter on coordinate noise.
 *
 * Mutates input array in place.
 */
export function fillForwardBearings(records: GpsRecord[]): void {
    const MIN_BEARING_DIST_DEG = 1e-5; // ~1.1 m in latitude
    const MIN_BEARING_SPEED_MS = 0.5;
    // Look-ahead cap. Without it, slow movement or GPS noise on a stationary
    // car turns the inner loop into O(n^2): at GoPro 18 Hz for a 1-hour clip
    // (~65k records) a long stall scans tens of millions of pairs per record.
    // 120 samples = ~6.7 s at 18 Hz / ~120 s at 1 Hz - enough to clear 1 m of
    // displacement at any reasonable bearing-bearing speed. Beyond the cap,
    // we treat the segment as stationary noise and inherit lastValid.
    const LOOKAHEAD_CAP = 120;
    let lastValid = 0;
    for (let i = 0; i < records.length; i++) {
        const cur = records[i]!;
        if (cur.speedMs < MIN_BEARING_SPEED_MS) {
            cur.bearingDeg = lastValid;
            continue;
        }
        // Scan forward for enough displacement.
        let next: GpsRecord | null = null;
        const jEnd = Math.min(records.length, i + 1 + LOOKAHEAD_CAP);
        for (let j = i + 1; j < jEnd; j++) {
            const cand = records[j]!;
            const dLat = cand.lat - cur.lat;
            const dLon = cand.lon - cur.lon;
            if (Math.hypot(dLat, dLon) >= MIN_BEARING_DIST_DEG) {
                next = cand;
                break;
            }
        }
        if (!next) {
            cur.bearingDeg = lastValid;
            continue;
        }
        // Initial bearing (forward azimuth).
        const lat1 = (cur.lat * Math.PI) / 180;
        const lat2 = (next.lat * Math.PI) / 180;
        const dLonRad = ((next.lon - cur.lon) * Math.PI) / 180;
        const y = Math.sin(dLonRad) * Math.cos(lat2);
        const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLonRad);
        let bearing = (Math.atan2(y, x) * 180) / Math.PI;
        if (bearing < 0) bearing += 360;
        cur.bearingDeg = bearing;
        lastValid = bearing;
    }
}

/**
 * Threshold below which a record is treated as stationary for bearing
 * purposes. 1.0 m/s (~3.6 km/h) covers GPS coordinate drift on a parked car
 * and slow rollback while still letting parking-lot maneuvers (5+ km/h) keep
 * their real heading. Exported so map-layer logic (display dead-band) shares
 * the same constant.
 */
export const STATIONARY_SPEED_MS = 1.0;

/**
 * Forces bearingDeg to inherit the last "moving" bearing for every record
 * with speedMs < STATIONARY_SPEED_MS. Reason: NMEA-RMC and similar native
 * course fields are noise on a stopped car (the GPS chip emits random
 * directions when the velocity vector is below its own threshold), which
 * makes the map arrow spin in place. Coordinates stay untouched - only
 * the displayed heading is stabilized.
 *
 * Records expected pre-sorted by unixSeconds. Idempotent.
 *
 * Initial lastValid is the first record's bearingDeg, so a trip that starts
 * stationary at least holds one stable angle until the first movement
 * arrives and overwrites lastValid with real data.
 *
 * Mutates input in place.
 */
export function freezeStationaryBearings(records: GpsRecord[]): void {
    if (records.length === 0) return;
    let lastValid = records[0]!.bearingDeg;
    for (const r of records) {
        if (r.speedMs < STATIONARY_SPEED_MS) {
            r.bearingDeg = lastValid;
        } else {
            lastValid = r.bearingDeg;
        }
    }
}

/** Applies bearing stabilization independently to each concrete video owner. */
function freezeStationaryBearingsByOwner(records: GpsRecord[]): void {
    if (records.length < 2) {
        freezeStationaryBearings(records);
        return;
    }
    const firstOwner = records[0]!.videoKey;
    if (records.every((record) => record.videoKey === firstOwner)) {
        freezeStationaryBearings(records);
        return;
    }
    const recordsByOwner = new Map<string, GpsRecord[]>();
    for (const record of records) {
        // All records in this caller already share mp4Filename. Unowned rows
        // therefore form one safe legacy bucket; concrete owners stay isolated.
        const owner = record.videoKey ?? "";
        let owned = recordsByOwner.get(owner);
        if (!owned) {
            owned = [];
            recordsByOwner.set(owner, owned);
        }
        owned.push(record);
    }
    for (const owned of recordsByOwner.values()) freezeStationaryBearings(owned);
}

/**
 * Calls fillForwardBearings on a per-file batch only when no record carries
 * a non-zero bearing - i.e. the parser does not extract course at all.
 *
 * Used as a centralized normalization step in the dispatcher so individual
 * parsers do not need to remember to forward-fill (PNDM, Navitel gps0,
 * LigoGPS, GPX without <course>, etc.). A parser that does write course
 * (NMEA RMC, 70mai CSV, freeGPS, RVMI) keeps its values untouched because
 * at least one record will have bearingDeg != 0.
 *
 * Edge case: a real track strictly heading north (bearingDeg == 0 on every
 * sample) would also trigger the fill, but the forward-fill result there is
 * the same answer geometrically - no harm done.
 *
 * Must run per-file before records are merged across files; cross-file
 * forward-fill would use one file's last coordinate to bearing into the next
 * file's first coordinate, which is meaningless across recording gaps.
 */
export function forwardFillBearingsIfAllZero(records: GpsRecord[]): void {
    if (records.length < 2) return;
    for (const r of records) {
        if (r.bearingDeg !== 0) return;
    }
    fillForwardBearings(records);
}

/** Tuning knobs for dropTeleportOutliers. */
export interface TeleportFilterOptions {
    /** Implied-speed gate, m/s. 100 m/s = 360 km/h - no dashcam-bearing vehicle reaches it. */
    maxImpliedSpeedMs: number;
    /**
     * Distance floor, metres. Protects high-rate noisy data: at 18 Hz GoPro
     * with ±10 m urban-canyon jitter the implied speed alone is ~180 m/s
     * (10 m / 0.055 s) - jitter never reaches 200 m of displacement, so the
     * floor is what keeps those samples. Do NOT lower it without re-deriving
     * this bound.
     */
    minJumpMeters: number;
}

const DEFAULT_TELEPORT_FILTER: TeleportFilterOptions = { maxImpliedSpeedMs: 100, minJumpMeters: 200 };

/**
 * Trip-level teleport/spike filter: drops records whose position jump from the
 * last kept fix is physically impossible. Generalization of the navitel gps0
 * Pass-B continuity check (src/parsers/internal/navitel-gps0.ts
 * dropPositionOutliers, battle-tested on real iBOX data) with a distance floor
 * for rate-independence; navitel keeps its own in-primitive pass (it needs raw
 * row order + SkippedLine reporting), and this filter is idempotent on its
 * output.
 *
 * Input must be sorted by unixSeconds (finalizeTrip sorts right before the
 * call). Returns a NEW array - the input is never mutated, so candidate-level
 * records and state.gpsLog keep the raw parser output and re-grouping stays
 * reversible.
 *
 * Algorithm - anchor chain walk:
 *   - Only active, time-synced records participate. active === false rows
 *     (escort-map void fixes - the only active:false emitter) and timeUnsynced
 *     rows (cold-start placeholders re-anchored onto the video window later)
 *     are ALWAYS kept, never become anchors, and are skipped by the lookahead.
 *     Consequence: fully-timeUnsynced formats (70mai freegps / gps-box,
 *     Wolfbox variant A) are entirely exempt from this filter.
 *   - A record is a drop candidate only when BOTH gates trip: displacement
 *     from the anchor > minJumpMeters AND implied speed > maxImpliedSpeedMs.
 *     Legit driving cannot trip both (>200 m jump AND >360 km/h); a recording
 *     resumed far away has a large dt, so its implied speed stays low.
 *   - dt <= 0 (cross-channel same-second merge) -> kept unconditionally, but
 *     such records do NOT replace the anchor: a same-second teleported
 *     duplicate that became anchor could wrongly drop a legitimate LAST
 *     record through the trailing-spike branch below.
 *   - Candidate confirmation via the next ELIGIBLE record (not literally
 *     records[i+1] - an escort-map or unsynced row adjacent to a spike must
 *     not corrupt the decision): drop only if skipping the candidate restores
 *     continuity anchor -> next, or there is no next (trailing spike). If the
 *     next eligible record also disagrees with the anchor, the candidate is a
 *     genuine new anchor (recording resumed elsewhere, constant
 *     super-threshold motion) and is kept.
 *   - Trailing-spike exception: when the anchor itself was accepted through
 *     the new-anchor branch, motion is already in a super-threshold regime
 *     (e.g. constant 250 m/s synthetic), so a follower-less candidate
 *     continues that motion and is kept - only a candidate that breaks a
 *     NORMAL regime with no follower to confirm it is a trailing spike.
 *   - Accel transplant on drop: accel lives ON the GpsRecord, and a hard
 *     impact can plausibly coincide with the very GPS glitch this filter
 *     drops - deleting the record whole would erase the auto-detected impact
 *     marker and the chart G spike (detectEvents runs AFTER this filter).
 *     When the dropped record's |G| exceeds the nearest kept eligible
 *     neighbor's, that neighbor is replaced by a clone carrying the dropped
 *     accel triple (max-|G|-wins; position/time of the neighbor untouched,
 *     input array never mutated).
 *
 * Known accepted limitation: a 2-point spike cluster survives (the continuity
 * check anchors on the first spike point). viofosync's median-of-5 window
 * would catch it but was rejected as a heavier policy.
 *
 * Diagnostics: trip-level drops intentionally bypass SkippedLine reporting -
 * the caller logs a debug count instead (finalizeTrip in trips.ts). The
 * asymmetry with navitel's in-primitive SkippedLine reporting is deliberate:
 * this filter re-runs on every regroup, and its drops are reversible
 * presentation-level cleanup, not parse-time data loss.
 */
export function dropTeleportOutliers(
    records: GpsRecord[],
    opts: TeleportFilterOptions = DEFAULT_TELEPORT_FILTER,
): GpsRecord[] {
    const isEligible = (r: GpsRecord): boolean => r.active && !r.timeUnsynced;
    // Thin record-shaped adapter over the shared accelMagnitude helper.
    const accelMag = (r: GpsRecord): number => accelMagnitude(r.accelXg, r.accelYg, r.accelZg);
    const out: GpsRecord[] = [];
    let anchor: GpsRecord | null = null;
    // Index of the current anchor inside `out` - the accel transplant
    // replaces it with a clone in place.
    let anchorOutIndex = -1;
    // True when the current anchor was accepted via the new-anchor branch -
    // i.e. motion is already super-threshold (see the trailing-spike exception).
    let anchorWasCandidate = false;
    // Accel transplant deferred onto a not-yet-pushed record (the dropped
    // spike's nearest kept neighbor is the upcoming confirmer). Applied when
    // that record is pushed; max-|G| donor wins across multiple drops.
    type PendingTransplant = { target: GpsRecord; donor: GpsRecord } | null;
    let pendingTransplant: PendingTransplant = null;

    const nextEligibleAfter = (idx: number): GpsRecord | null => {
        for (let j = idx + 1; j < records.length; j++) {
            if (isEligible(records[j]!)) return records[j]!;
        }
        return null;
    };

    // True when `rec` trips BOTH gates relative to `from` - the only
    // combination treated as a teleport. Requires dt > 0 to be judgeable.
    const isTeleportFrom = (from: GpsRecord, rec: GpsRecord, dt: number): boolean => {
        if (dt <= 0) return false;
        const jumpMeters = haversineKm(from.lat, from.lon, rec.lat, rec.lon) * 1000;
        return jumpMeters > opts.minJumpMeters && jumpMeters / dt > opts.maxImpliedSpeedMs;
    };

    // Keep-max-|G| transplant for a dropped record (see the contract above).
    // `next` is the upcoming confirmer (eligible, kept when it confirms
    // continuity) or null for a trailing spike. Returns the new pending
    // transplant (assigned at the call site - TS does not track narrowing
    // through closure assignments).
    const transplantAccelOfDropped = (
        dropped: GpsRecord,
        theAnchor: GpsRecord,
        next: GpsRecord | null,
        pending: PendingTransplant,
    ): PendingTransplant => {
        const donorG = accelMag(dropped);
        if (donorG === 0) return pending; // nothing to preserve
        const anchorDt = dropped.unixSeconds - theAnchor.unixSeconds;
        const nextDt = next ? next.unixSeconds - dropped.unixSeconds : Number.POSITIVE_INFINITY;
        if (next !== null && nextDt < anchorDt) {
            // Nearest kept neighbor is ahead - defer until it is pushed.
            if (donorG <= accelMag(next)) return pending;
            if (pending && pending.target === next && accelMag(pending.donor) >= donorG) return pending;
            return { target: next, donor: dropped };
        }
        if (donorG > accelMag(theAnchor)) {
            anchor = {
                ...theAnchor,
                accelXg: dropped.accelXg,
                accelYg: dropped.accelYg,
                accelZg: dropped.accelZg,
            };
            out[anchorOutIndex] = anchor;
        }
        return pending;
    };

    for (let i = 0; i < records.length; i++) {
        const rec = records[i]!;
        if (!isEligible(rec)) {
            out.push(rec);
            continue;
        }
        if (anchor === null) {
            out.push(rec);
            anchor = rec;
            anchorOutIndex = out.length - 1;
            continue;
        }
        const dt = rec.unixSeconds - anchor.unixSeconds;
        if (dt <= 0) {
            out.push(rec); // kept, but never an anchor (see contract)
            continue;
        }
        const isCandidate = isTeleportFrom(anchor, rec, dt);
        if (isCandidate) {
            const next = nextEligibleAfter(i);
            const nextDt = next ? next.unixSeconds - anchor.unixSeconds : 0;
            const nextContinuous = next !== null && nextDt > 0 && !isTeleportFrom(anchor, next, nextDt);
            const isTrailingSpike = next === null && !anchorWasCandidate;
            if (nextContinuous || isTrailingSpike) {
                // drop: skipping restores continuity / trailing spike. The
                // dropped position is garbage but its accel sample is real -
                // keep the max |G| on the nearest surviving neighbor.
                pendingTransplant = transplantAccelOfDropped(rec, anchor, next, pendingTransplant);
                continue;
            }
            // Both this record and the next eligible disagree with the anchor
            // (or super-threshold motion continues past the last record) -
            // a genuine new reality; fall through and accept as the new anchor.
        }
        let kept = rec;
        if (pendingTransplant && pendingTransplant.target === rec) {
            const donor = pendingTransplant.donor;
            kept = { ...rec, accelXg: donor.accelXg, accelYg: donor.accelYg, accelZg: donor.accelZg };
            pendingTransplant = null;
        }
        out.push(kept);
        anchor = kept;
        anchorOutIndex = out.length - 1;
        anchorWasCandidate = isCandidate;
    }
    return out;
}

/**
 * Haversine great-circle distance in km. Mean Earth radius 6371 km.
 * Ellipsoidal model is unnecessary given GPS fix accuracy.
 */
export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R_KM = 6371;
    const toRad = (deg: number): number => (deg * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 2 * R_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Binary search for the record nearest to targetUnixSeconds in a sorted array.
 * The player calls this on every timeupdate; linear scan over thousands of
 * points would be measurable.
 *
 * Returns the index of the nearest record (by absolute timestamp delta),
 * or -1 for an empty array.
 */
export function findNearestIndex(sortedRecords: GpsRecord[], targetUnixSeconds: number): number {
    if (sortedRecords.length === 0) return -1;

    let lo = 0;
    let hi = sortedRecords.length - 1;
    while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (sortedRecords[mid]!.unixSeconds < targetUnixSeconds) {
            lo = mid + 1;
        } else {
            hi = mid;
        }
    }
    // lo is the first index with timestamp >= target; compare with previous to pick the nearest.
    if (lo > 0) {
        const prev = sortedRecords[lo - 1]!;
        const cur = sortedRecords[lo]!;
        if (Math.abs(prev.unixSeconds - targetUnixSeconds) <= Math.abs(cur.unixSeconds - targetUnixSeconds)) {
            return lo - 1;
        }
    }
    return lo;
}

/**
 * Linearly interpolated position between adjacent GPS samples.
 * GPS runs at ~1 Hz; the map marker needs to move at 60 fps.
 *
 * Linear coordinate interpolation over short segments (tens to hundreds of
 * meters) is visually indistinguishable from geodesic. Bearing interpolation
 * takes the shortest arc through 360 (e.g. 350°→10° crosses 0°, not 180°).
 *
 * Returns null if targetUnix is more than 5 s outside the record range,
 * to avoid dragging the marker far past the track on a clock error.
 */
export function interpolatePosition(
    sortedRecords: GpsRecord[],
    targetUnixSeconds: number,
): InterpolatedPosition | null {
    if (sortedRecords.length === 0) return null;
    if (sortedRecords.length === 1) {
        const r = sortedRecords[0]!;
        return { lat: r.lat, lon: r.lon, bearingDeg: r.bearingDeg, speedMs: r.speedMs };
    }

    // Binary search for the first index with unixSeconds >= target.
    let lo = 0;
    let hi = sortedRecords.length - 1;
    while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (sortedRecords[mid]!.unixSeconds < targetUnixSeconds) lo = mid + 1;
        else hi = mid;
    }

    const TOLERANCE_SEC = 5;

    // target is before the first record - return first only if within tolerance.
    if (lo === 0) {
        const first = sortedRecords[0]!;
        if (first.unixSeconds - targetUnixSeconds > TOLERANCE_SEC) return null;
        return { lat: first.lat, lon: first.lon, bearingDeg: first.bearingDeg, speedMs: first.speedMs };
    }

    const next = sortedRecords[lo]!;
    const prev = sortedRecords[lo - 1]!;

    // target is past the last record - return last only if within tolerance.
    if (targetUnixSeconds > next.unixSeconds && lo === sortedRecords.length - 1) {
        if (targetUnixSeconds - next.unixSeconds > TOLERANCE_SEC) return null;
        return { lat: next.lat, lon: next.lon, bearingDeg: next.bearingDeg, speedMs: next.speedMs };
    }

    const span = next.unixSeconds - prev.unixSeconds;
    if (span <= 0) {
        return { lat: prev.lat, lon: prev.lon, bearingDeg: prev.bearingDeg, speedMs: prev.speedMs };
    }
    const t = Math.max(0, Math.min(1, (targetUnixSeconds - prev.unixSeconds) / span));

    const lat = prev.lat + (next.lat - prev.lat) * t;
    const lon = prev.lon + (next.lon - prev.lon) * t;
    const speedMs = prev.speedMs + (next.speedMs - prev.speedMs) * t;

    // Bearing: take the shortest arc through 360 to avoid spinning the wrong way.
    let dBearing = next.bearingDeg - prev.bearingDeg;
    if (dBearing > 180) dBearing -= 360;
    else if (dBearing < -180) dBearing += 360;
    let bearingDeg = prev.bearingDeg + dBearing * t;
    if (bearingDeg < 0) bearingDeg += 360;
    if (bearingDeg >= 360) bearingDeg -= 360;

    return { lat, lon, bearingDeg, speedMs };
}

/**
 * Re-keys log records whose mp4Filename matches NO loaded video onto the one
 * loaded video that shares the same 70mai name core (see mai70NameCore: the
 * firmware renames locked clips across mode prefixes and can append garbage
 * after ".MP4" in the log row, so the exact-name byFilename join misses them
 * and event clips silently lose their GPS). Mutates the records in place and
 * returns how many were re-keyed; on a non-zero result the caller must
 * rebuild the log (the byFilename buckets are stale). A core shared by more
 * than one loaded video (hand-renamed copies) is ambiguous - skipped rather
 * than guessed. Non-70mai names have no core and are never touched.
 */
export function rebindOrphanLogRecords(log: ParsedLog, loadedVideoNames: Iterable<string>): number {
    const loaded = new Set(loadedVideoNames);
    // Core -> the unique loaded video carrying it; null marks an ambiguous core.
    const coreToName = new Map<string, string | null>();
    for (const name of loaded) {
        const core = mai70NameCore(name);
        if (core === null) continue;
        coreToName.set(core, coreToName.has(core) ? null : name);
    }
    if (coreToName.size === 0) return 0;

    let rebound = 0;
    for (const [bucketName, bucket] of log.byFilename) {
        if (loaded.has(bucketName)) continue;
        const core = mai70NameCore(bucketName);
        if (core === null) continue;
        const target = coreToName.get(core);
        if (target === undefined || target === null) continue;
        for (const rec of bucket) rec.mp4Filename = target;
        rebound += bucket.length;
    }
    return rebound;
}

/**
 * Clones GPS records across the channels of a multi-channel recording so all of
 * them anchor identically.
 *
 * A BlackVue `.gps` sidecar is shared by the front/rear/interior clips of one
 * recording but classifies against a single clip (matchBlackvueSidecarBasename).
 * Left alone, only that clip carries GPS: the other channels fall back to a
 * filename anchor with NO measured clock offset, so their startUtc diverges from
 * the GPS-anchored clip by the camera's clock error and frame grouping (the 30 s
 * snap in groupTrips) splits front from rear into separate frames. Copying the
 * records onto the sibling clips makes the per-fingerprint clock-offset
 * measurement and the resulting startUtc symmetric across channels; the
 * duplicate track is collapsed later by Trip.records' (unixSeconds, lat, lon)
 * dedup, which keeps the max-|G| accel copy.
 *
 * Channels sharing a recording are keyed by source-local path plus
 * `date_time_mode` (channel dropped). Only clones onto siblings that carry NO
 * records, so it never overwrites a channel with its own embedded GPS and is
 * idempotent across re-ingest. Mutates `log.records`; the caller must rebuild
 * the byFilename buckets (they are now stale). Returns the number of cloned
 * records.
 */
export function cloneRecordsAcrossChannels(log: ParsedLog, loadedVideos: Iterable<VendorFile>): number {
    // Source + normalized parent path isolate equal BlackVue names from another
    // folder/card; the channel-group key then joins only one recording's F/R/I.
    const groups = new Map<string, VendorFile[]>();
    const nameCounts = new Map<string, number>();
    for (const video of loadedVideos) {
        nameCounts.set(video.file.name, (nameCounts.get(video.file.name) ?? 0) + 1);
        const recordingKey = blackvueChannelCloneGroup(video);
        if (recordingKey === null) continue;
        const key = `${video.sourceKey ?? ""}\0${recordingKey}`;
        let arr = groups.get(key);
        if (!arr) {
            arr = [];
            groups.set(key, arr);
        }
        arr.push(video);
    }

    let cloned = 0;
    for (const siblings of groups.values()) {
        if (siblings.length < 2) continue;
        // Source: the first channel that actually carries records (the clip the
        // sidecar classified against). A recording with no GPS on any channel
        // has no source and is skipped.
        const source = siblings.find((video) => {
            const owned = log.byVideoKey.get(vendorFileKey(video));
            if (owned && owned.length > 0) return true;
            return nameCounts.get(video.file.name) === 1 && (log.byFilename.get(video.file.name)?.length ?? 0) > 0;
        });
        if (source === undefined) continue;
        const sourceRecords =
            log.byVideoKey.get(vendorFileKey(source)) ??
            (nameCounts.get(source.file.name) === 1 ? log.byFilename.get(source.file.name) : undefined);
        if (!sourceRecords) continue;
        for (const sibling of siblings) {
            if (sibling === source) continue;
            const siblingKey = vendorFileKey(sibling);
            const hasOwnRecords =
                (log.byVideoKey.get(siblingKey)?.length ?? 0) > 0 ||
                (nameCounts.get(sibling.file.name) === 1 && (log.byFilename.get(sibling.file.name)?.length ?? 0) > 0);
            if (hasOwnRecords) continue;
            for (const rec of sourceRecords) {
                log.records.push({ ...rec, mp4Filename: sibling.file.name, videoKey: siblingKey });
                cloned++;
            }
        }
    }
    return cloned;
}

/**
 * Rebuilds a ParsedLog after manually merging records (e.g. dedupe across
 * ingest sources). Groups by mp4Filename and sorts each bucket by unixSeconds
 * so the player can binary-search a file's records in O(log n).
 *
 * Idempotent: calling it on an already-sorted/grouped log returns an
 * equivalent log with freshly built byFilename buckets.
 */
export function rebuildLog(appliedExtractors: string[], records: GpsRecord[], skipped: SkippedLine[]): ParsedLog {
    const byFilename = new Map<string, GpsRecord[]>();
    const byVideoKey = new Map<string, GpsRecord[]>();
    for (const rec of records) {
        let bucket = byFilename.get(rec.mp4Filename);
        if (!bucket) {
            bucket = [];
            byFilename.set(rec.mp4Filename, bucket);
        }
        bucket.push(rec);
    }
    for (const arr of byFilename.values()) {
        arr.sort((a, b) => a.unixSeconds - b.unixSeconds);
        // Per-bucket so the freeze never leaks bearing across recording gaps
        // or between channels of a multi-channel camera.
        freezeStationaryBearingsByOwner(arr);
        for (const rec of arr) {
            if (rec.videoKey === undefined) continue;
            let owned = byVideoKey.get(rec.videoKey);
            if (!owned) {
                owned = [];
                byVideoKey.set(rec.videoKey, owned);
            }
            owned.push(rec);
        }
    }
    return { appliedExtractors, records, byFilename, byVideoKey, skipped };
}

/**
 * Union of two string arrays without duplicates, preserving first-occurrence
 * order. Used to merge ParsedLog.appliedExtractors when records from
 * multiple extraction passes (log + sidecar + embedded) land in one log.
 */
export function unionStringArrays(a: string[], b: string[]): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const s of a) {
        if (!seen.has(s)) {
            seen.add(s);
            out.push(s);
        }
    }
    for (const s of b) {
        if (!seen.has(s)) {
            seen.add(s);
            out.push(s);
        }
    }
    return out;
}

/**
 * Merges a freshly parsed batch of GPS records into an existing ParsedLog, or
 * builds the first one when `existing` is null. Centralizes the merge every
 * ingest source uses (logs, sidecars and embedded tracks): dedupe
 * the combined records, union the applied-extractor labels, and concatenate
 * skipped-line diagnostics. Callers without extractor labels or skipped lines
 * (sidecars) pass empty arrays.
 */
export function mergeIntoGpsLog(
    existing: ParsedLog | null,
    batch: { records: GpsRecord[]; appliedExtractors: string[]; skipped: SkippedLine[] },
): ParsedLog {
    if (!existing) {
        return rebuildLog(batch.appliedExtractors, thinDenseRecords(dedupRecords(batch.records)), batch.skipped);
    }

    // Incremental merge. The dedup key carries videoKey when known (and the raw
    // filename otherwise), so concrete files never collide. Dedup is effectively
    // per basename bucket, with ownership isolation inside it. That lets
    // us re-dedup/sort/freeze ONLY the byFilename buckets this batch touches and
    // reuse every untouched bucket by reference. This keeps each progressive
    // batch proportional to the files it changed instead of the full log.
    const batchByFile = new Map<string, GpsRecord[]>();
    for (const rec of batch.records) {
        let arr = batchByFile.get(rec.mp4Filename);
        if (!arr) {
            arr = [];
            batchByFile.set(rec.mp4Filename, arr);
        }
        arr.push(rec);
    }

    const byFilename = new Map<string, GpsRecord[]>(existing.byFilename);
    for (const [filename, batchRecs] of batchByFile) {
        const existingBucket = byFilename.get(filename);
        // dedupRecords over just this file's existing + incoming records yields
        // the same survivors (first-seen identity + max-|G| transplant) the
        // global dedup would, since no cross-file key can collide. Sort + freeze
        // only this one bucket. Bearing stabilization is applied independently
        // per concrete video owner, so equal basenames cannot leak headings.
        // Thin AFTER dedup: dedup keys on exact (time, position), thinning on
        // coarser time buckets - the wider net must see the deduped survivors so
        // its max-|G| transplant compounds instead of racing. Existing bucket
        // goes first, so an already-thinned survivor keeps its identity across
        // re-merges of the same source.
        const mergedBucket = thinDenseRecords(
            existingBucket ? dedupRecords(existingBucket.concat(batchRecs)) : dedupRecords(batchRecs),
        );
        mergedBucket.sort((a, b) => a.unixSeconds - b.unixSeconds);
        freezeStationaryBearingsByOwner(mergedBucket);
        byFilename.set(filename, mergedBucket);
    }

    // Flat records[] view. Order is not part of the contract (consumers read it
    // by length or through byFilename), so concatenating the buckets is
    // stable for consumers and keeps record identity shared
    // with the buckets - mergeAccelSamples mutates these same objects in place.
    const records: GpsRecord[] = [];
    const byVideoKey = new Map<string, GpsRecord[]>();
    for (const bucket of byFilename.values()) {
        for (const rec of bucket) {
            records.push(rec);
            if (rec.videoKey === undefined) continue;
            let owned = byVideoKey.get(rec.videoKey);
            if (!owned) {
                owned = [];
                byVideoKey.set(rec.videoKey, owned);
            }
            owned.push(rec);
        }
    }

    return {
        appliedExtractors: unionStringArrays(existing.appliedExtractors, batch.appliedExtractors),
        records,
        byFilename,
        byVideoKey,
        skipped: existing.skipped.concat(batch.skipped),
    };
}
