// Small helpers shared between the single-channel and split-screen transcode
// pipelines for the GPS-overlay path. Both call sites need to ask the same
// questions ("is any overlay enabled?", "is this interpolated GPS sample
// drawable?") so one place owns the logic.

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
