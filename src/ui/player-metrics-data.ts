import {
    cumulativeDistanceKm,
    findNearestIndex,
    findNearestPositionIndex,
    GPS_POSITION_TOLERANCE_SEC,
    interpolatePosition,
    type GpsRecord,
} from "../parser.js";

export type FixState = "ok" | "lost" | "none";

export interface PlayerMetricsData {
    record: GpsRecord | null;
    fix: FixState;
    distanceKm: number | null;
}

let distanceCache = new WeakMap<GpsRecord[], Float64Array>();

/** Readout values stay sample-based while fix visibility follows the map marker. */
export function resolvePlayerMetrics(records: GpsRecord[], targetUnix: number): PlayerMetricsData {
    if (!Number.isFinite(targetUnix)) return { record: null, fix: "none", distanceKm: null };
    const nearestIndex = findNearestIndex(records, targetUnix);
    if (nearestIndex < 0) return { record: null, fix: "none", distanceKm: null };
    const nearest = records[nearestIndex]!;
    if (!interpolatePosition(records, targetUnix)) {
        const isNear = Math.abs(nearest.unixSeconds - targetUnix) <= GPS_POSITION_TOLERANCE_SEC;
        return { record: isNear ? nearest : null, fix: isNear ? "lost" : "none", distanceKm: null };
    }
    const positionIndex = findNearestPositionIndex(records, targetUnix);
    const record = records[positionIndex];
    if (!record) return { record: nearest, fix: "lost", distanceKm: null };
    let cumulative = distanceCache.get(records);
    if (!cumulative) {
        cumulative = cumulativeDistanceKm(records);
        distanceCache.set(records, cumulative);
    }
    return { record, fix: "ok", distanceKm: cumulative[positionIndex] ?? 0 };
}

export function _resetForTests(): void {
    distanceCache = new WeakMap();
}
