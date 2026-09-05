// Shared GPS-overlay preparation for the single-channel and split-screen pipelines.

import { interpolatePosition } from "../parser.js";
import type { GpsRecord } from "../parsers/types.js";
import { contentToWallUtc, type TripTimeline } from "../trips.js";
import { type FramePos, interpScalar, resolveFramePos, resolveNoFixFramePos } from "./frame-pos.js";
import type { OverlayPipelineArgs } from "./types.js";

/** True if at least one widget is configured (any of the 8). */
export function hasAnyOverlay(overlays: OverlayPipelineArgs): boolean {
    return !!(
        overlays.speed ||
        overlays.coords ||
        overlays.map ||
        overlays.clock ||
        overlays.compass ||
        overlays.gforce ||
        overlays.distance ||
        overlays.graph
    );
}

/**
 * GPS records with active=false (lost-fix) can carry NaN coordinates from some
 * parsers. We do not draw overlays for those frames - "NaN km/h" text looks
 * broken, and zoomForDiameterKm(NaN) breaks the map snapshotter's jumpTo.
 */
export function isFinitePosition(pos: { lat: number; lon: number; bearingDeg: number; speedMs: number }): boolean {
    return (
        Number.isFinite(pos.lat) &&
        Number.isFinite(pos.lon) &&
        Number.isFinite(pos.bearingDeg) &&
        Number.isFinite(pos.speedMs)
    );
}

/**
 * Maps footage time onto the wall-clock axis shared by GPS and the speed graph.
 * Distance starts at the export range's first frame; frames without a usable
 * fix retain their clock and graph position for the widget placeholders.
 */
export function createOverlayFrameResolver(
    overlays: Pick<OverlayPipelineArgs, "gpsRecords" | "cumulativeDistanceM">,
    timeline: TripTimeline,
    startTripSec: number,
    endTripSec: number,
): (contentSec: number) => FramePos {
    const rangeStartUtc = contentToWallUtc(timeline, startTripSec);
    const rangeEndUtc = contentToWallUtc(timeline, endTripSec);
    const span = rangeEndUtc - rangeStartUtc;
    const distanceBaseM = overlays.cumulativeDistanceM
        ? interpScalar(overlays.gpsRecords, overlays.cumulativeDistanceM, rangeStartUtc)
        : 0;

    return (contentSec) => {
        const frameUtc = contentToWallUtc(timeline, contentSec);
        const progress = span > 0 ? (frameUtc - rangeStartUtc) / span : 0;
        const base = interpolatePosition(overlays.gpsRecords, frameUtc);
        if (!base || !isFinitePosition(base)) return resolveNoFixFramePos(frameUtc, progress);
        return resolveFramePos({
            records: overlays.gpsRecords,
            base,
            cumulative: overlays.cumulativeDistanceM,
            distanceBaseM,
            frameUtc,
            progress,
        });
    };
}

/**
 * Records whose wall time falls within [startUtcSec - marginSec, endUtcSec +
 * marginSec]. Used to limit the map-snapshotter prewarm walk to the exported
 * range: the export only ever snapshots positions inside the range, so tiles
 * beyond it (plus a margin for the viewport around the range edges) are wasted
 * fetches. Order is preserved; the margin also absorbs the 1-second resolution
 * of filename-derived timestamps.
 */
export function recordsInWallWindow(
    records: GpsRecord[],
    startUtcSec: number,
    endUtcSec: number,
    marginSec: number,
): GpsRecord[] {
    const lo = startUtcSec - marginSec;
    const hi = endUtcSec + marginSec;
    return records.filter((r) => r.unixSeconds >= lo && r.unixSeconds <= hi);
}
