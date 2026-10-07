import { haversineKm } from "../../parser.js";
import type { GpsRecord } from "../types.js";

// Sparse fixes describe a route, not the instantaneous speed shown beside video.
const MAX_INTERVAL_SEC = 30;
const MAX_SPEED_MS = 100;

export interface SpeedEstimationPoint {
    record: GpsRecord;
    /** Opt in for absent/invalid source speed, never for an explicit unavailable export. */
    canEstimateSpeed: boolean;
}

/** Accepts validated points in source order. An interval belongs to its ending point; the first
 * point uses the first interval. Invalid points, reversed clocks and teleports split the track.
 * No low-speed cutoff: displacement alone cannot distinguish walking from jitter. */
export function estimateSpeedSegments(points: readonly (SpeedEstimationPoint | null)[]): GpsRecord[][] {
    const segments: GpsRecord[][] = [];
    let segment: GpsRecord[] | null = null;
    let previous: SpeedEstimationPoint | null = null;
    let firstCanEstimate = false;
    for (const point of points) {
        if (!point) {
            previous = null;
            segment = null;
            continue;
        }
        const record = { ...point.record };
        const speed = previous ? intervalSpeed(previous.record, record) : null;
        if (speed === null || !segment) {
            segment = [record];
            segments.push(segment);
            firstCanEstimate = point.canEstimateSpeed;
        } else {
            const canEstimateInterval =
                previous !== null && record.unixSeconds - previous.record.unixSeconds <= MAX_INTERVAL_SEC;
            if (canEstimateInterval) {
                if (segment.length === 1 && firstCanEstimate) {
                    segment[0]!.speedMs = speed;
                    segment[0]!.speedSource = "estimated";
                }
                if (point.canEstimateSpeed) {
                    record.speedMs = speed;
                    record.speedSource = "estimated";
                }
            }
            segment.push(record);
        }
        previous = point;
    }
    return segments;
}

function intervalSpeed(a: GpsRecord, b: GpsRecord): number | null {
    const seconds = b.unixSeconds - a.unixSeconds;
    if (seconds <= 0) return null;
    const speed = (haversineKm(a.lat, a.lon, b.lat, b.lon) * 1000) / seconds;
    return Number.isFinite(speed) && speed <= MAX_SPEED_MS ? speed : null;
}
