import { cumulativeDistanceKm, haversineKm } from "../../parser.js";
import type { GpsRecord } from "../types.js";

// Sparse fixes describe a route, not the instantaneous speed shown beside video.
const MAX_INTERVAL_SEC = 30;
const MAX_SPEED_MS = 100;
const FIT_POINT_COUNT = 5;
const MAX_FIT_SPAN_SEC = 8;

export interface SpeedEstimationPoint {
    record: GpsRecord;
    /** Opt in for absent/invalid source speed, never for an explicit unavailable export. */
    canEstimateSpeed: boolean;
}

/** Accepts validated points in source order. Invalid points, reversed clocks and teleports split
 * the track. Short or sparse runs use interval speeds; dense runs estimate a local derivative.
 * No low-speed cutoff: displacement alone cannot distinguish walking from jitter. */
export function estimateSpeedSegments(points: readonly (SpeedEstimationPoint | null)[]): GpsRecord[][] {
    const segments: SpeedEstimationPoint[][] = [];
    let segment: SpeedEstimationPoint[] | null = null;
    for (const point of points) {
        if (!point) {
            segment = null;
            continue;
        }
        if (!segment || intervalSpeed(segment[segment.length - 1]!.record, point.record) === null) {
            segment = [];
            segments.push(segment);
        }
        segment.push({ ...point, record: { ...point.record } });
    }
    return segments.map(estimateSegment);
}

function estimateSegment(points: readonly SpeedEstimationPoint[]): GpsRecord[] {
    const records = points.map((point) => point.record);
    if (records.length < 2) return records;
    const distances = cumulativeDistanceKm(records);
    for (let i = 0; i < records.length; i++) {
        if (!points[i]!.canEstimateSpeed) continue;
        // Keep sparse fixes unavailable even when a dense run follows them.
        const end = Math.max(1, i);
        const seconds = records[end]!.unixSeconds - records[end - 1]!.unixSeconds;
        if (seconds > MAX_INTERVAL_SEC) continue;
        const interval = ((distances[end]! - distances[end - 1]!) * 1000) / seconds;
        const fitted = localSpeed(records, distances, i);
        records[i]!.speedMs = fitted ?? interval;
        records[i]!.speedSource = "estimated";
    }
    return records;
}

/** Differentiate travelled distance, not a chord across a bend. A quadratic preserves constant
 * acceleration; L1 loss limits the influence of a fix with an inaccurate acquisition time. */
function localSpeed(records: readonly GpsRecord[], distances: Float64Array, index: number): number | null {
    if (records.length < FIT_POINT_COUNT) return null;
    const start = Math.max(0, Math.min(index - Math.floor(FIT_POINT_COUNT / 2), records.length - FIT_POINT_COUNT));
    const end = start + FIT_POINT_COUNT - 1;
    const span = records[end]!.unixSeconds - records[start]!.unixSeconds;
    if (span > MAX_FIT_SPAN_SEC) return null;
    const times: number[] = [];
    const positions: number[] = [];
    const intervals: number[] = [];
    for (let i = start; i <= end; i++) {
        // Center and scale before fitting to avoid epoch-sized polynomial coefficients.
        times.push((records[i]!.unixSeconds - records[index]!.unixSeconds) / span);
        positions.push((distances[i]! - distances[index]!) * 1000);
        if (i > start) intervals.push((records[i]!.unixSeconds - records[i - 1]!.unixSeconds) / span);
    }
    intervals.sort((a, b) => a - b);
    const cadence = (intervals[1]! + intervals[2]!) / 2;
    const bandwidth = Math.max(...times.map(Math.abs)) + cadence;
    const weights = times.map((t) => (1 - (Math.abs(t) / bandwidth) ** 3) ** 3);
    const speed = quadraticDerivative(times, positions, weights) / span;
    // An edge fit can overshoot during braking. Do not turn that into a false stop.
    return Number.isFinite(speed) && speed >= 0 && speed <= MAX_SPEED_MS ? speed : null;
}

/** A weighted L1 quadratic has an optimum passing through three observations. Enumerating
 * these vertices gives a deterministic bounded fit without an iterative solver or dependency. */
function quadraticDerivative(
    times: readonly number[],
    positions: readonly number[],
    weights: readonly number[],
): number {
    let bestLoss = Infinity;
    let velocity = Number.NaN;
    for (let a = 0; a < times.length - 2; a++) {
        for (let b = a + 1; b < times.length - 1; b++) {
            for (let c = b + 1; c < times.length; c++) {
                const ta = times[a]!;
                const tb = times[b]!;
                const tc = times[c]!;
                const ab = (positions[b]! - positions[a]!) / (tb - ta);
                const bc = (positions[c]! - positions[b]!) / (tc - tb);
                const curvature = (bc - ab) / (tc - ta);
                const slope = ab - curvature * (ta + tb);
                const intercept = positions[a]! - ab * ta + curvature * ta * tb;
                let loss = 0;
                for (let j = 0; j < times.length; j++) {
                    const t = times[j]!;
                    loss += weights[j]! * Math.abs(positions[j]! - (intercept + slope * t + curvature * t * t));
                }
                if (loss < bestLoss) {
                    bestLoss = loss;
                    velocity = slope;
                }
            }
        }
    }
    return velocity;
}

function intervalSpeed(a: GpsRecord, b: GpsRecord): number | null {
    const seconds = b.unixSeconds - a.unixSeconds;
    if (seconds <= 0) return null;
    const speed = (haversineKm(a.lat, a.lon, b.lat, b.lon) * 1000) / seconds;
    return Number.isFinite(speed) && speed <= MAX_SPEED_MS ? speed : null;
}
