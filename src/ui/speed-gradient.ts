// Shared builder for the speed-gradient line-gradient paint expression, used by
// both the live map (map.ts) and the export snapshotter (export-map-snapshot.ts)
// so the stop-emission / monotonic-nudge / degenerate-track logic has one source
// of truth instead of two forks.
//
// The distance metric lives here too (buildMercatorCumulativeDistances) and is
// deliberately Web Mercator: it must match how MapLibre measures line-progress,
// or every consumer of these fractions lands at the wrong spot on the line.

import type { GpsRecord } from "../parser.js";
import { speedKmhToColor, themeColors } from "./theme.js";

// Web-Mercator latitude limit (~85.051°). Clamp before projecting: mercatorY
// diverges toward the poles and lat=±90 would produce ±Infinity, poisoning
// every cumulative distance after it.
const MERCATOR_MAX_LAT_DEG = 85.051129;

/** Web-Mercator Y for a latitude, in the same degree-equivalent scale as
 *  longitude (mercator X is linear in longitude, so lon deltas are used as-is
 *  and only Y needs projecting). Same formula as MapLibre's
 *  MercatorCoordinate.fromLngLat, times 360. Exported for the follow-camera
 *  teleport guard, which needs an orientation-independent ground distance
 *  (screen projection saturates/mirrors under a pitched camera). */
export function mercatorY(latDeg: number): number {
    const lat = Math.max(-MERCATOR_MAX_LAT_DEG, Math.min(MERCATOR_MAX_LAT_DEG, latDeg));
    return 180 - (180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
}

/**
 * Cumulative distances along `recs` in Web-Mercator space - the SAME metric
 * MapLibre uses for line-progress (line vertices are measured in projected
 * tile units). Any other metric (planar degrees, haversine meters) shifts
 * gradient stops and the trail boundary along the route: mercator weighs a N-S
 * degree 1/cos(lat) heavier than an E-W one (~1.7x at 55°N), so on a mixed
 * route the fractions desync by whole percents of track length - the trail
 * veil visibly ran ahead of (or behind) the car marker.
 *
 * Only the relative distribution matters, not absolute units. Returns
 * cumDist[i] = distance from recs[0] to recs[i] and total = the last cumulative
 * value (0 for empty or single-record input).
 */
export function buildMercatorCumulativeDistances(recs: GpsRecord[]): { cumDist: number[]; total: number } {
    const cumDist: number[] = new Array(recs.length);
    if (recs.length === 0) return { cumDist, total: 0 };
    cumDist[0] = 0;
    let prevY = mercatorY(recs[0]!.lat);
    for (let i = 1; i < recs.length; i++) {
        const y = mercatorY(recs[i]!.lat);
        const dX = recs[i]!.lon - recs[i - 1]!.lon;
        const dY = y - prevY;
        cumDist[i] = cumDist[i - 1]! + Math.sqrt(dX * dX + dY * dY);
        prevY = y;
    }
    return { cumDist, total: cumDist[cumDist.length - 1] ?? 0 };
}

/**
 * Builds the MapLibre line-gradient paint expression: each record maps to a
 * normalized line-progress (0..1) by `cumDist[i]/total` and to a color by speed.
 *
 * Precondition: `cumDist` and `total` are built from the SAME `recs` list (so
 * stops align with line vertices); `total` is the last cumulative value.
 *
 * Returns `unknown[]`: line-gradient wants ExpressionSpecification but TS cannot
 * infer it from a mixed-literal array - callers cast (e.g. `as never`).
 */
export function buildSpeedGradient(recs: GpsRecord[], cumDist: number[], total: number): unknown[] {
    // line-gradient requires at least two stops. Fewer points - return a flat
    // color (no line will be drawn anyway, but MapLibre still validates the
    // expression).
    if (recs.length < 2) {
        const c = recs.length === 1 ? speedKmhToColor(recs[0]!.speedMs * 3.6) : themeColors().chartSpeed;
        return ["interpolate", ["linear"], ["line-progress"], 0, c, 1, c];
    }
    if (total === 0) {
        // All points coincide - theoretically impossible after dedup, but
        // guard for numerical stability.
        const c = speedKmhToColor(recs[0]!.speedMs * 3.6);
        return ["interpolate", ["linear"], ["line-progress"], 0, c, 1, c];
    }

    // Strictly monotonically increasing stops. Guard against rare float
    // collisions from very close points by nudging progress forward.
    const stops: unknown[] = ["interpolate", ["linear"], ["line-progress"]];
    let lastProgress = -1;
    for (let i = 0; i < recs.length; i++) {
        let progress = i === recs.length - 1 ? 1 : cumDist[i]! / total;
        if (progress <= lastProgress) progress = lastProgress + 1e-9;
        lastProgress = progress;
        stops.push(progress, speedKmhToColor(recs[i]!.speedMs * 3.6));
    }
    return stops;
}
