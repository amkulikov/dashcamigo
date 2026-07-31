// Per-frame telemetry derivation for the burned-in overlays. The base
// (lat/lon/speed/heading) comes from interpolatePosition; this module adds the
// derived quantities the new widgets need - longitudinal/lateral G, trip
// distance, frame epoch, and range progress - from the GPS records alone.
//
// Why derived, not read: the primary camera (70mai x800) writes no usable
// accelerometer (accelXg/Yg/Zg are zero), and even cameras that do write accel
// give no standard axis mapping, so a 2-D G dial cannot trust the raw axes.
// Deriving from GPS (dv/dt for longitudinal, v*yaw-rate for lateral) is
// orientation-independent and works for every format. Cameras that DO record a
// real accelerometer still contribute: their lateral magnitude lifts gMag when
// GPS smoothing misses a sharp event. All formulas are pure and unit-tested.

import type { GpsRecord } from "../parsers/types.js";

/** Standard gravity (m/s^2) - converts m/s^2 to g. */
const G = 9.80665;

/** Earth mean radius (m) for haversine. */
const EARTH_R = 6_371_000;

/** Half-window (seconds) for the centered finite differences. ~1.5 s smooths
 *  the 1 Hz GPS sampling without lagging a real brake noticeably. */
const DERIV_HALF_WINDOW_SEC = 1.5;

/** Expanded per-frame position handed to the widget drawing code. */
export interface FramePos {
    lat: number;
    lon: number;
    speedMs: number;
    /** Course over ground, degrees [0..360). */
    headingDeg: number;
    /** Longitudinal g: negative = braking, positive = accelerating. */
    gLong: number;
    /** Lateral g: sign follows turn direction. */
    gLat: number;
    /** Combined g magnitude (for the dial readout / brake gate). */
    gMag: number;
    /** Distance travelled since the export range start, meters. */
    distanceM: number;
    /** Frame wall-clock, unix seconds. */
    epochSec: number;
    /** Position within the export range, 0..1 (for the speed graph). */
    progress: number;
    /** False = no usable fix near this frame (receiver warming up, long
     *  dropout): GPS-fed widgets render their no-fix placeholder instead of a
     *  reading. The clock and the range-level graph ignore it. */
    hasFix: boolean;
}

/** How far (seconds) the nearest usable record may be for a frame to count as
 *  having a fix. Matches interpolatePosition's edge tolerance; applied inside
 *  interior gaps too, so a dropout longer than twice this shows the no-fix
 *  placeholder in its middle instead of a fabricated straight line, while
 *  short gaps keep the smooth interpolation. */
export const FIX_TOLERANCE_SEC = 5;

/** Great-circle distance between two lat/lon points, meters. */
export function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const toRad = Math.PI / 180;
    const dLat = (lat2 - lat1) * toRad;
    const dLon = (lon2 - lon1) * toRad;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
    return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Cumulative travelled distance (meters) at each record. Same length as
 * `records`; index 0 = 0. Segments where either endpoint is a non-finite or
 * lost-fix (active=false) position contribute 0 - those carry NaN coordinates
 * in some parsers and would poison the running sum.
 */
export function computeCumulativeDistanceM(records: GpsRecord[]): number[] {
    const out = new Array<number>(records.length);
    let acc = 0;
    for (let i = 0; i < records.length; i++) {
        if (i > 0) {
            const a = records[i - 1]!;
            const b = records[i]!;
            if (drawable(a) && drawable(b)) acc += haversineMeters(a.lat, a.lon, b.lat, b.lon);
        }
        out[i] = acc;
    }
    return out;
}

/** A record usable for geometry: valid fix and finite coordinates. */
function drawable(r: GpsRecord): boolean {
    return r.active && Number.isFinite(r.lat) && Number.isFinite(r.lon);
}

/** Index of the last record with unixSeconds <= target (binary search). -1 if
 *  target precedes the first record. */
function lastLeq(records: GpsRecord[], target: number): number {
    let lo = 0;
    let hi = records.length - 1;
    let ans = -1;
    while (lo <= hi) {
        const mid = (lo + hi) >>> 1;
        if (records[mid]!.unixSeconds <= target) {
            ans = mid;
            lo = mid + 1;
        } else {
            hi = mid - 1;
        }
    }
    return ans;
}

/**
 * True when a usable (active, finite-coordinate) record lies within
 * FIX_TOLERANCE_SEC of `target`. Records flagged active=false are the
 * receiver's own "no fix" markers, so they do not count as coverage; the scan
 * walks outward from the binary-search neighbors and is O(1) on healthy data.
 */
export function hasFixAt(records: GpsRecord[], target: number): boolean {
    const n = records.length;
    if (n === 0) return false;
    const i = lastLeq(records, target);
    for (let k = i; k >= 0; k--) {
        const r = records[k]!;
        if (target - r.unixSeconds > FIX_TOLERANCE_SEC) break;
        if (drawable(r)) return true;
    }
    for (let k = i + 1; k < n; k++) {
        const r = records[k]!;
        if (r.unixSeconds - target > FIX_TOLERANCE_SEC) break;
        if (drawable(r)) return true;
    }
    return false;
}

/**
 * Linearly interpolates a per-record scalar at `target` unix seconds, clamped
 * to the array ends (no tolerance cutoff - callers want a usable value at every
 * frame, including just past the last fix). `values[i]` must align to
 * `records[i]`. Empty input -> 0.
 */
export function interpScalar(records: GpsRecord[], values: number[], target: number): number {
    const n = records.length;
    if (n === 0) return 0;
    if (n === 1) return values[0] ?? 0;
    const i = lastLeq(records, target);
    if (i < 0) return values[0] ?? 0;
    if (i >= n - 1) return values[n - 1] ?? 0;
    const a = records[i]!;
    const b = records[i + 1]!;
    const span = b.unixSeconds - a.unixSeconds;
    if (span <= 0) return values[i] ?? 0;
    const t = Math.max(0, Math.min(1, (target - a.unixSeconds) / span));
    return (values[i] ?? 0) + ((values[i + 1] ?? 0) - (values[i] ?? 0)) * t;
}

/** Interpolated speed (m/s) at target, clamped to ends. */
function interpSpeed(records: GpsRecord[], target: number): number {
    const n = records.length;
    if (n === 0) return 0;
    if (n === 1) return records[0]!.speedMs;
    const i = lastLeq(records, target);
    if (i < 0) return records[0]!.speedMs;
    if (i >= n - 1) return records[n - 1]!.speedMs;
    const a = records[i]!;
    const b = records[i + 1]!;
    const span = b.unixSeconds - a.unixSeconds;
    if (span <= 0) return a.speedMs;
    const t = (target - a.unixSeconds) / span;
    return a.speedMs + (b.speedMs - a.speedMs) * t;
}

/** Interpolated heading (deg) at target via shortest-arc, clamped to ends. */
function interpHeading(records: GpsRecord[], target: number): number {
    const n = records.length;
    if (n === 0) return 0;
    if (n === 1) return records[0]!.bearingDeg;
    const i = lastLeq(records, target);
    if (i < 0) return records[0]!.bearingDeg;
    if (i >= n - 1) return records[n - 1]!.bearingDeg;
    const a = records[i]!;
    const b = records[i + 1]!;
    const span = b.unixSeconds - a.unixSeconds;
    if (span <= 0) return a.bearingDeg;
    const t = (target - a.unixSeconds) / span;
    let d = b.bearingDeg - a.bearingDeg;
    if (d > 180) d -= 360;
    else if (d < -180) d += 360;
    let h = a.bearingDeg + d * t;
    if (h < 0) h += 360;
    if (h >= 360) h -= 360;
    return h;
}

/** Longitudinal g from the speed slope across a centered window. Negative =
 *  braking. */
export function deriveGLong(records: GpsRecord[], target: number): number {
    if (records.length < 2) return 0;
    const before = interpSpeed(records, target - DERIV_HALF_WINDOW_SEC);
    const after = interpSpeed(records, target + DERIV_HALF_WINDOW_SEC);
    const dvdt = (after - before) / (2 * DERIV_HALF_WINDOW_SEC);
    const g = dvdt / G;
    return Number.isFinite(g) ? g : 0;
}

/** Lateral g from yaw rate * speed across a centered window. */
export function deriveGLat(records: GpsRecord[], target: number): number {
    if (records.length < 2) return 0;
    const hBefore = interpHeading(records, target - DERIV_HALF_WINDOW_SEC);
    const hAfter = interpHeading(records, target + DERIV_HALF_WINDOW_SEC);
    let dh = hAfter - hBefore;
    if (dh > 180) dh -= 360;
    else if (dh < -180) dh += 360;
    const omega = (dh * (Math.PI / 180)) / (2 * DERIV_HALF_WINDOW_SEC); // rad/s
    const v = interpSpeed(records, target);
    const g = (v * omega) / G;
    return Number.isFinite(g) ? g : 0;
}

/** Lateral plane magnitude from a recorded accelerometer (g), interpolated.
 *  Z (vertical road bumps) is excluded. Zero for formats without accel. */
function interpRecordedPlaneMag(records: GpsRecord[], target: number): number {
    const n = records.length;
    if (n === 0) return 0;
    const i = Math.max(0, Math.min(n - 1, lastLeq(records, target)));
    const r = records[i]!;
    const m = Math.hypot(r.accelXg || 0, r.accelYg || 0);
    return Number.isFinite(m) ? m : 0;
}

/**
 * Evenly samples speed (m/s) across [startUnix, endUnix] for the graph
 * sparkline. `count` >= 2. Values are clamped to record ends so a range
 * extending slightly past the last fix still produces a flat tail rather than
 * a gap.
 */
export function sampleSpeedAcross(records: GpsRecord[], startUnix: number, endUnix: number, count: number): number[] {
    const n = Math.max(2, Math.floor(count));
    const out = new Array<number>(n);
    const span = endUnix - startUnix;
    for (let i = 0; i < n; i++) {
        const t = startUnix + (span * i) / (n - 1);
        const v = interpSpeed(records, t);
        out[i] = Number.isFinite(v) && v > 0 ? v : 0;
    }
    return out;
}

/**
 * Assembles the expanded FramePos. `base` is the interpolatePosition result
 * (already finite-checked by the caller). `cumulative` is the precomputed
 * cumulative-distance array (null = distance widget off). `distanceBaseM` is the
 * cumulative distance at the export range start, so the widget shows distance
 * within the exported clip, not from the trip origin.
 */
export function resolveFramePos(opts: {
    records: GpsRecord[];
    base: { lat: number; lon: number; speedMs: number; bearingDeg: number };
    cumulative: number[] | null;
    distanceBaseM: number;
    frameUtc: number;
    progress: number;
}): FramePos {
    const { records, base, cumulative, distanceBaseM, frameUtc, progress } = opts;
    const gLong = deriveGLong(records, frameUtc);
    const gLat = deriveGLat(records, frameUtc);
    const gMag = Math.max(Math.hypot(gLong, gLat), interpRecordedPlaneMag(records, frameUtc));
    const distanceM = cumulative ? Math.max(0, interpScalar(records, cumulative, frameUtc) - distanceBaseM) : 0;
    return {
        lat: base.lat,
        lon: base.lon,
        speedMs: base.speedMs,
        headingDeg: base.bearingDeg,
        gLong,
        gLat,
        gMag,
        distanceM,
        epochSec: frameUtc,
        progress: Math.max(0, Math.min(1, progress)),
        // Base may interpolate finite values across a long interior dropout -
        // a fabricated straight line. Coverage, not finiteness, decides.
        hasFix: hasFixAt(records, frameUtc),
    };
}

/**
 * FramePos for a frame with no usable fix (interpolatePosition returned null,
 * or the frame sits outside record coverage). The clock and graph fields stay
 * real - both work off the timeline, not the receiver; everything GPS-fed is
 * NaN so any widget that forgets to check hasFix draws an obvious blank, not a
 * plausible zero.
 */
export function resolveNoFixFramePos(frameUtc: number, progress: number): FramePos {
    return {
        lat: Number.NaN,
        lon: Number.NaN,
        speedMs: Number.NaN,
        headingDeg: Number.NaN,
        gLong: Number.NaN,
        gLat: Number.NaN,
        gMag: Number.NaN,
        distanceM: Number.NaN,
        epochSec: frameUtc,
        progress: Math.max(0, Math.min(1, progress)),
        hasFix: false,
    };
}

/** True if any record carries a non-zero accelerometer reading (for diagnostics:
 *  distinguishes "recorded" vs "derived" G in the export log). */
export function recordsHaveAccel(records: GpsRecord[]): boolean {
    for (const r of records) {
        if ((r.accelXg || 0) !== 0 || (r.accelYg || 0) !== 0 || (r.accelZg || 0) !== 0) return true;
    }
    return false;
}
