// Dedicated MapLibre instance for the export "map overlay" feature. Lives in a
// hidden DOM container on the main thread because MapLibre requires window /
// document / WebGL - none of which exist in a worker.
//
// Lifecycle: created on demand when the user starts an export with the map
// overlay enabled, destroyed right after the export resolves. We never keep it
// alive between exports because the WebGL canvas eats GPU even when invisible
// (same reason transcode-shim hides the main maplibre canvas during export).
//
// Snapshot timing trade-off:
//  - jumpTo() is synchronous, but tile fetch + paint takes 50-500 ms on a cold
//    tile. To avoid pause-the-loop stalls we pre-warm: walk the trip track on
//    the target zoom, jumpTo each pre-warm waypoint, wait for `idle`. After
//    pre-warm every needed tile is in the maplibre tile cache; hot-loop
//    snapshots are then jumpTo + a SYNCHRONOUS redraw() (no rAF wait) + readback.
//  - The selected position marker is painted directly onto the composite 2D
//    canvas - centered, rotated by the per-snapshot bearing.
//    It is NOT a DOM/SVG element and NOT an OffscreenCanvas. The snapshot then
//    ships as a single self-contained ImageBitmap that already includes the
//    marker, so the result "looks like the player mini-map" without the
//    consumer (pipeline) needing a separate compositor pass for the marker.
//
// We deliberately do not write the LICENSE/attribution text on the snapshot -
// the export modal already shows a watermark + the user owns the source video.
// The OpenFreeMap attribution lives on the main map.

// Type-only: the runtime namespace is loaded lazily via loadMaplibre (shared
// with the viewer map module), so maplibre-gl stays out of the eager graph.
import type * as maplibregl from "maplibre-gl";

import { probeWebGL } from "../capabilities.js";
import { createLogger } from "../log.js";
import { isValidGpsFix } from "../parser.js";
import type { GpsRecord } from "../parsers/types.js";
import type { MapStyleId } from "./theme.js";
import { buildMercatorCumulativeDistances, buildSpeedGradient } from "./speed-gradient.js";
import {
    addBuildings3dLayer,
    EMPTY_MAP_STYLE,
    loadMaplibre,
    loadMapStyle,
    type MapLoadSource,
    removeBuildings3dLayer,
} from "./map.js";
import { applyStreetLabelDensity, scaleStyleTextSizes, type StreetLabelDensity } from "./map-label-scale.js";
import { DEFAULT_MAP_MARKER_APPEARANCE, type MapMarkerAppearance, mapMarkerSizeScale } from "./map-marker-pref.js";
import { drawMapMarker } from "./map-marker-renderer.js";
import {
    getMapProvider,
    mapProviderErrorKey,
    reportMapProviderTileError,
    subscribeMapProvider,
} from "./map-provider.js";
import { transformMapTileRequest } from "./map-tile-cache.js";
import { waitForMapEvent } from "./map-events.js";
import { addSpeedTrack } from "./map-track.js";

const log = createLogger("export-map-snapshot");

/** Source-of-truth size of the off-screen snapshot canvas (px). Picked so a
 * 25%-of-1080p slot (~480 px) and a 200% slot (~960 px) both look crisp. */
const SNAPSHOT_WIDTH = 640;
const SNAPSHOT_HEIGHT = 480; // 4:3 to match the on-screen preview overlay
// Clamp for the snapshot's device-pixel ratio. The snapshot renders at
// SNAPSHOT_WIDTH logical px and is then scaled into a small overlay slot, so the
// GL buffer only needs enough device px to fill that slot crisply. The export
// derives the ratio from the actual slot width (createExportMapSnapshotter's
// targetSlotWidthPx) instead of inheriting devicePixelRatio - which on a typical
// 1080p / default-scale overlay over-renders ~2.7x (480px slot vs a 1280px Retina
// buffer), paying it on every one of thousands of per-frame GL fill + readback +
// createImageBitmap round-trips. Floor keeps the burned-in map legible; ceiling
// caps the per-frame cost (2 x SNAPSHOT_WIDTH = 1280px, today's Retina render).
const MIN_SNAPSHOT_PIXEL_RATIO = 0.75;
const MAX_SNAPSHOT_PIXEL_RATIO = 2;
const TRACK_SOURCE_ID = "export-track";
const TRACK_LAYER_ID = "export-track-line";

/** Earth radius for zoom-from-distance math (meters). */
const EARTH_R = 6378137;

// --- Chase camera (export map overlay) ---
// Tilt ceiling - mirrors the live map's CHASE_MAX_PITCH_DEG. Past ~70 the
// renderer pulls in far too many tiles near the horizon for little gain.
const EXPORT_CHASE_MAX_PITCH = 70;
// Speed-adaptive zoom: zoom out by up to this many levels as speed rises so the
// road ahead stays in view. Unlike the live chase (fixed 16.8..15.4, always
// above maxzoom), the export base zoom comes from the user's km-scale slider, so
// at wider zoomKm (or the default 1 km at highway speed) the display zoom CAN
// sink below the source maxzoom 14. The 3D building layer (minzoom 14, opacity
// ramp already 0 at z14 - see addBuildings3dLayer) then renders nothing, so
// buildings fade out on wide/highway shots by design.
const EXPORT_ADAPTIVE_MAX_OUT = 1.3;
const EXPORT_ADAPTIVE_FULL_SPEED_MS = 33; // ~120 km/h -> full zoom-out
// Top camera padding (fraction of viewport height) so the car sits in the lower
// third under tilt, opening up the road ahead. North-up keeps zero padding.
const CHASE_TOP_PADDING_FRAC = 0.34;

// Hard elapsed-time cap for the prewarm walk. Prewarm is an optimization (a
// missing tile is a bounded gray-fill that back-fills as the run proceeds), so
// on a slow network we stop walking and let the export start rather than risk
// the worker-side first-snapshot timeout - the budget must stay comfortably
// below that ceiling (FIRST_SNAPSHOT_TIMEOUT_MS in map-snapshot-worker-client)
// minus MapLibre init + style load.
const PREWARM_BUDGET_MS = 60_000;

function clampExportPitch(deg: number | undefined): number {
    if (deg === undefined || !Number.isFinite(deg)) return 0;
    return Math.max(0, Math.min(EXPORT_CHASE_MAX_PITCH, deg));
}

/** Speed-adaptive zoom delta (<= 0): 0 at rest, -EXPORT_ADAPTIVE_MAX_OUT at the
 *  full-speed end. Added to the base display zoom. */
function exportAdaptiveZoomDelta(speedMs: number | undefined): number {
    const f = Math.max(0, Math.min(1, (speedMs ?? 0) / EXPORT_ADAPTIVE_FULL_SPEED_MS));
    return -EXPORT_ADAPTIVE_MAX_OUT * f;
}

/** Computes a maplibre zoom level so the visible diameter (across viewportWidthPx)
 *  is ~diameterKm. Uses 78271.5, the meters-per-pixel-at-zoom-0 for MapLibre's
 *  512 px tiles - NOT the 256-tile 156543.03. With the 256 constant the zoom came
 *  out one level too high (2x too zoomed in), so a "100 m" slot actually showed
 *  ~50 m. */
function zoomForDiameterKm(lat: number, diameterKm: number, viewportWidthPx: number): number {
    // Floor the DIAMETER at 1 metre (not 1 km). The old `Math.max(1, diameterKm)`
    // clamped the kilometre value, collapsing the entire 100 m..1 km slider range
    // to a single 1 km zoom - "the scale never changes below 1 km".
    const diameterM = Math.max(1, diameterKm * 1000);
    const cosLat = Math.max(Math.cos((lat * Math.PI) / 180), 0.01);
    const metersPerPx = diameterM / viewportWidthPx;
    return Math.log2((78271.5 * cosLat) / metersPerPx);
}

/** Coarse haversine in meters; enough for "have we moved a viewport-width yet". */
function distanceM(aLat: number, aLon: number, bLat: number, bLon: number): number {
    const dLat = ((bLat - aLat) * Math.PI) / 180;
    const dLon = ((bLon - aLon) * Math.PI) / 180;
    const lat1 = (aLat * Math.PI) / 180;
    const lat2 = (bLat * Math.PI) / 180;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface SnapshotRequest {
    lat: number;
    lon: number;
    bearingDeg: number;
    zoomKm: number;
    /** Car speed (m/s); drives the chase camera's speed-adaptive zoom. */
    speedMs?: number;
    /** Chase camera: heading-up + tilted. When false/absent the snapshot is
     *  north-up (the legacy look). */
    headingUp?: boolean;
    /** Chase tilt in degrees (0..70). Applied only when headingUp. */
    pitchDeg?: number;
    /** Chase: zoom out as speed rises (the range stays above the source
     *  maxzoom, so it never refetches tiles). Applied only when headingUp. */
    adaptiveZoom?: boolean;
}

/** Chase-camera knobs for prewarm, so the cached tiles cover the tilted frustum
 *  rather than just a top-down square. */
export interface ChasePrewarmOpts {
    headingUp?: boolean;
    pitchDeg?: number;
    adaptiveZoom?: boolean;
}

export interface ExportMapSnapshotter {
    /** Pre-warm tiles along the trip path at the target zoom. For chase mode the
     *  camera (tilt + per-waypoint heading + the widest adaptive zoom) is
     *  replayed at each waypoint so the cache covers the tilted frustum. */
    prewarm(records: GpsRecord[], zoomKm: number, signal: AbortSignal, opts?: ChasePrewarmOpts): Promise<void>;
    /** Single snapshot; resolves with an ImageBitmap (transferable). `waitForIdle`
     *  waits for full tile load instead of the hot-loop's brief render wait - used
     *  by the preview, which (unlike the export) does not prewarm, so its first
     *  snapshot would otherwise capture a blank base layer before tiles arrive. */
    snapshot(req: SnapshotRequest, opts?: { waitForIdle?: boolean }): Promise<ImageBitmap>;
    /** Updates only the marker compositor; the MapLibre style stays intact. */
    setMarkerAppearance(appearance: MapMarkerAppearance): void;
    /** Tear down the maplibre instance and remove the host div. Idempotent. */
    dispose(): void;
}

/**
 * Builds a hidden maplibre instance, adds the trip track + car marker, returns
 * the snapshotter interface. Initialization waits for style parsing so the
 * local track never depends on remote tiles reaching idle.
 * `source` labels the caller in analytics (export modal preview vs the actual
 * transcode) so map_load_failed events can be sliced per surface. `theme`
 * selects the base-layer style (default "light"); the user picks it per export
 * via the overlay constructor.
 *
 * `targetSlotWidthPx` is the device-pixel width the snapshot will be drawn into
 * (the overlay slot). When given (export hot loop), the instance's pixelRatio is
 * derived from it - clamped - so a 640-logical-px render fills the slot without
 * over-rendering at the inherited devicePixelRatio. Omit it (preview, a one-shot
 * render) to keep devicePixelRatio for on-screen crispness.
 *
 * `labelScalePct` scales the style's street/place-name sizes and
 * `labelDensity` makes road names repeat denser / turn on earlier (the user's
 * per-export picks), both applied to a clone so the shared style cache stays
 * pristine. The instance renders one style for its lifetime - a changed value
 * needs a rebuild, same as `theme`.
 */
export interface ExportMapRenderOptions {
    labelScalePct?: number;
    labelDensity?: StreetLabelDensity;
    markerAppearance?: MapMarkerAppearance;
}

export async function createExportMapSnapshotter(
    records: GpsRecord[],
    source: MapLoadSource = "export",
    theme: MapStyleId = "light",
    targetSlotWidthPx?: number,
    renderOptions: ExportMapRenderOptions = {},
): Promise<ExportMapSnapshotter> {
    const {
        labelScalePct = 100,
        labelDensity = "standard",
        markerAppearance = DEFAULT_MAP_MARKER_APPEARANCE,
    } = renderOptions;
    let activeMarkerAppearance = { ...markerAppearance };
    // Resolution policy: derive pixelRatio from the slot the snapshot lands in,
    // not the device. Undefined (no slot hint) leaves the maplibre default
    // (devicePixelRatio), preserving the preview's on-screen sharpness. The zoom
    // math (zoomForDiameterKm) keys off SNAPSHOT_WIDTH in LOGICAL px, so changing
    // pixelRatio only changes buffer density, never the geographic framing.
    const snapshotPixelRatio =
        targetSlotWidthPx && targetSlotWidthPx > 0
            ? Math.min(MAX_SNAPSHOT_PIXEL_RATIO, Math.max(MIN_SNAPSHOT_PIXEL_RATIO, targetSlotWidthPx / SNAPSHOT_WIDTH))
            : undefined;

    // Preflight the WebGL context. Without it `new mlg.Map` below would never
    // parse its style and the export/preview would stall until waitForStyleLoad's
    // timeout. Callers guard the map-overlay option on !isMapAvailable(), but
    // fail fast here too so a stray call rejects cleanly and immediately.
    if (!probeWebGL()) throw new Error("webgl context unavailable for map snapshot");

    const host = document.createElement("div");
    // Off-screen via fixed-position + large negative left offset (no opacity and
    // no visibility:hidden are set). display:none would cancel WebGL context
    // creation entirely, so we keep the element renderable but push it out of
    // view; the user never sees it, and off-screen positioning avoids the rare
    // composer bugs that briefly flash visibility:hidden elements.
    host.style.position = "fixed";
    host.style.left = "-9999px";
    host.style.top = "0";
    host.style.width = `${SNAPSHOT_WIDTH}px`;
    host.style.height = `${SNAPSHOT_HEIGHT}px`;
    host.style.pointerEvents = "none";
    host.setAttribute("aria-hidden", "true");
    host.id = "export-map-snapshot-host";
    document.body.appendChild(host);

    // User-selected base layer (default "light" - higher contrast against the
    // orange car marker and the typical daytime recording). ensureMap prefetches
    // both themes at startup, so either is usually a cache hit.
    let activeProvider = getMapProvider();
    const styleFromCache = await loadMapStyle(theme, false, source, activeProvider);
    const style = applyStreetLabelDensity(
        scaleStyleTextSizes(styleFromCache ?? EMPTY_MAP_STYLE, labelScalePct / 100),
        labelDensity,
    );

    // Seed the camera from a finite ACTIVE record, not records[0]: a leading
    // inactive/lost-fix entry can carry NaN coords, and a NaN center throws in
    // LngLat.convert / destabilizes the instance (the same hazard prewarm and
    // addTrackLayer filter against). prewarm re-centers on the first real point
    // anyway, so [0,0] is a harmless fallback when there is no usable fix.
    const seed = finiteActiveRecords(records)[0];
    // Load maplibre-gl lazily (shared chunk with the viewer map). See T9 / map.ts.
    let map: maplibregl.Map;
    try {
        const mlg = await loadMaplibre();
        map = new mlg.Map({
            container: host,
            style,
            center: seed ? [seed.lon, seed.lat] : [0, 0],
            zoom: 14,
            bearing: 0,
            pitch: 0,
            interactive: false,
            attributionControl: false,
            // Performance: identical recipe to ensureMiniMap - we render snapshots
            // back-to-back at 5-30 Hz; we cannot afford tile fade animations,
            // collisions, or expiration revalidation in that loop.
            fadeDuration: 0,
            refreshExpiredTiles: false,
            crossSourceCollisions: false,
            // 256, not the mini-map's 128: a tilted chase frustum touches more tiles
            // than a top-down square, and prewarm caches a wider corridor. The
            // instance is short-lived (one export/preview), so the memory is fine.
            maxTileCacheSize: 256,
            // Raise the ceiling above MapLibre's default 60 so the chase tilt slider
            // (0..70) reaches its full range here too. Without this the export/preview
            // silently clamps pitch at 60 while the live map (maxPitch 70) does not -
            // the WYSIWYG preview and the exported frame would not match a 61-70 tilt.
            maxPitch: EXPORT_CHASE_MAX_PITCH,
            // Required so map.getCanvas() returns a buffer that survives until our
            // composite read - without it the WebGL buffer is invalidated right
            // after the present and createImageBitmap captures a blank texture.
            canvasContextAttributes: { preserveDrawingBuffer: true },
            // Slot-derived buffer density (see snapshotPixelRatio). undefined =
            // maplibre's devicePixelRatio default (preview path). preserveDrawingBuffer
            // survives this: it is a context-creation attribute and setPixelRatio/this
            // option only resize the canvas, never re-create the GL context.
            pixelRatio: snapshotPixelRatio,
            // Skip runtime style validation: unlike the interactive maps (which boot
            // on EMPTY_STYLE), this constructor receives the full heavy style, so it
            // is the single biggest validation cost. The style is static, self-hosted
            // and gated at build time by scripts/validate-map-styles.mjs.
            validateStyle: false,
            transformRequest: transformMapTileRequest,
        });
    } catch (err) {
        host.remove();
        throw err;
    }

    // Route maplibre error events through the logger - with NO listener,
    // MapLibre's Evented console.errors the raw event itself, bypassing the
    // central-logger invariant (and tripping the e2e fail-loud console gate).
    // warn, not error: failures here are dominated by tile/sprite fetches,
    // which are EXPECTED degradation (tile server down -> blank base layer,
    // the overlay still renders the track per the offline invariant).
    const seenErrors = new Set<string>();
    map.on("error", (ev) => {
        const cause = (ev as { error?: unknown }).error;
        reportMapProviderTileError(cause);
        const errorKey = mapProviderErrorKey(cause);
        if (seenErrors.has(errorKey)) return;
        seenErrors.add(errorKey);
        log.warn("maplibre error", cause instanceof Error ? cause : { message: String(cause) });
    });

    try {
        await waitForStyleLoad(map);
    } catch (err) {
        try {
            map.remove();
        } catch (cleanupErr) {
            log.warn("map cleanup failed", {
                err: cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr),
            });
        }
        host.remove();
        throw err;
    }

    addTrackLayer(map, records);

    let isDisposed = false;
    let providerStyleChange = Promise.resolve();
    const unsubscribeProvider = subscribeMapProvider((provider, previous) => {
        if (provider === activeProvider || isDisposed) return;
        activeProvider = provider;
        providerStyleChange = providerStyleChange
            .then(async () => {
                const nextStyle = await loadMapStyle(theme, false, source, provider);
                if (!nextStyle || isDisposed || provider !== activeProvider) return;
                const styled = applyStreetLabelDensity(
                    scaleStyleTextSizes(nextStyle, labelScalePct / 100),
                    labelDensity,
                );
                await waitForStyleLoad(map, styled);
                if (!map.getSource(TRACK_SOURCE_ID)) addTrackLayer(map, records);
            })
            .catch((err: unknown) => {
                log.warn("provider style switch failed", {
                    provider,
                    err: err instanceof Error ? err.message : String(err),
                });
            });
        if (previous !== null) log.info("snapshot map provider changed", { from: previous, to: provider });
    });

    // Reused across snapshots so per-frame allocation churn stays low.
    // Sized lazily on the first snapshot to match map.getCanvas() dimensions
    // (which may diverge from SNAPSHOT_WIDTH/HEIGHT after devicePixelRatio
    // application during initial render).
    const composite = document.createElement("canvas");
    const cctx = composite.getContext("2d");
    if (!cctx) {
        isDisposed = true;
        unsubscribeProvider();
        try {
            map.remove();
        } catch {
            /* ignore */
        }
        host.remove();
        throw new Error("canvas 2d ctx unavailable");
    }

    return {
        async prewarm(recs, zoomKm, signal, chase): Promise<void> {
            await providerStyleChange;
            // Filter first: an inactive/NaN seed or waypoint would make
            // distanceM return NaN (NaN < step is false -> not skipped) and feed
            // jumpTo a NaN center, which destabilizes the MapLibre instance.
            const usable = finiteActiveRecords(recs);
            if (usable.length === 0) return;
            const headingUp = chase?.headingUp === true;
            const pitch = headingUp ? clampExportPitch(chase?.pitchDeg) : 0;
            // Add buildings before walking so each idle wait also caches their
            // tessellation - the per-frame hot loop then has them ready.
            if (headingUp) addBuildings3dLayer(map, theme);
            const baseZoom = zoomForDiameterKm(usable[0]!.lat, zoomKm, SNAPSHOT_WIDTH);
            // Walk at the WIDEST zoom the run can reach (base + the full adaptive
            // zoom-out) so the cached corridor spans every frame's footprint. NB:
            // this caches one tile zoom (floor of the widest display zoom). When
            // the run's zoom range straddles maxzoom 14 (wider zoomKm), slow
            // zoomed-in frames can request a finer tile level this walk did not
            // fetch; that is a bounded, tolerated gray-fill (maxTileCacheSize
            // accumulates them as the run proceeds).
            const targetZoom =
                headingUp && chase?.adaptiveZoom
                    ? baseZoom + exportAdaptiveZoomDelta(EXPORT_ADAPTIVE_FULL_SPEED_MS)
                    : baseZoom;
            // Step size = half the visible viewport in meters. After jumping by
            // half a viewport every neighboring snapshot reuses tiles loaded
            // by the previous waypoint.
            const stepMeters = (zoomKm * 1000) / 2 || 5000;
            let lastLat = usable[0]!.lat;
            let lastLon = usable[0]!.lon;
            const startedAtMs = Date.now();
            let budgetExhausted = false;
            // Per-waypoint bearing (only in chase) so the tilted frustum we cache
            // points the same way the per-frame snapshot will; pitch extends it
            // forward to the horizon, which is the tiles a top-down walk misses.
            const visit = (record: GpsRecord, timeoutMs: number): Promise<void> =>
                waitForMapEvent(map, "idle", timeoutMs, {
                    signal,
                    start: () =>
                        map.jumpTo({
                            center: [record.lon, record.lat],
                            zoom: targetZoom,
                            bearing: headingUp ? record.bearingDeg : 0,
                            pitch,
                        }),
                });
            await visit(usable[0]!, 4000);
            for (const r of usable) {
                if (signal.aborted) throw new DOMException("aborted", "AbortError");
                if (Date.now() - startedAtMs > PREWARM_BUDGET_MS) {
                    // Cap, do not fail: the un-walked stretch degrades to brief
                    // gray fills that back-fill during the run, while blowing
                    // the budget risks the first-snapshot timeout killing the
                    // map for the WHOLE export.
                    budgetExhausted = true;
                    break;
                }
                if (distanceM(lastLat, lastLon, r.lat, r.lon) < stepMeters) continue;
                await visit(r, 2000);
                lastLat = r.lat;
                lastLon = r.lon;
            }
            log.info("map snapshot prewarm done", {
                points: usable.length,
                chase: headingUp,
                elapsedMs: Date.now() - startedAtMs,
                budgetExhausted,
            });
        },
        async snapshot(req, opts): Promise<ImageBitmap> {
            await providerStyleChange;
            // Defensive guard: pipeline already filters non-finite positions,
            // but a malformed direct call would otherwise pass NaN into
            // jumpTo and crash maplibre. Throw a typed error so the worker
            // promise rejects instead of the whole MapLibre instance dying.
            if (!Number.isFinite(req.lat) || !Number.isFinite(req.lon) || !Number.isFinite(req.zoomKm)) {
                throw new Error("snapshot request has non-finite lat/lon/zoom");
            }
            const headingUp = req.headingUp === true;
            // 3D buildings ride along with chase (heading-up + tilt), matching
            // the live chase map. Drop them on a north-up frame so a top-down
            // preview after a chase preview does not keep the flat footprints.
            // Idempotent; the building geometry lives in the already-cached z14
            // tiles, so this adds render cost but no tile fetches.
            if (headingUp) addBuildings3dLayer(map, theme);
            else removeBuildings3dLayer(map);
            let zoom = zoomForDiameterKm(req.lat, req.zoomKm, SNAPSHOT_WIDTH);
            // Speed-adaptive zoom-out. At wider zoomKm (or the default 1 km at
            // highway speed) the display zoom dips below the OpenMapTiles maxzoom
            // 14; the building layer's opacity ramp is already 0 at z14, so the 3D
            // extrusion fades out on fast/wide shots. Intentional - the wider
            // frame keeps more road ahead in view, which matters more at speed.
            if (headingUp && req.adaptiveZoom) zoom += exportAdaptiveZoomDelta(req.speedMs);
            const bearing = headingUp ? req.bearingDeg : 0;
            const pitch = headingUp ? clampExportPitch(req.pitchDeg) : 0;
            // Chase pushes the car into the lower third (road ahead in view) via
            // top camera padding; north-up keeps it centered.
            const padTop = headingUp ? Math.round(SNAPSHOT_HEIGHT * CHASE_TOP_PADDING_FRAC) : 0;
            map.jumpTo({
                center: [req.lon, req.lat],
                zoom,
                bearing,
                pitch,
                padding: { top: padTop, bottom: 0, left: 0, right: 0 },
            });
            // Export prewarms its tiles, so a brief render wait captures a full
            // frame. The preview does not prewarm: its first snapshot would catch
            // a blank base layer before tiles arrive (the "nudge to load" bug), so
            // it waits for idle (tiles loaded) instead, capped so a down tile
            // server still resolves on the blank layer per the offline invariant.
            if (opts?.waitForIdle) {
                await waitForMapEvent(map, "idle", 2500);
            } else {
                // Export hot loop: force a SYNCHRONOUS paint instead of awaiting a
                // whole requestAnimationFrame for the next 'render' event. redraw()
                // aborts the pending frame and renders inline in this
                // tick, so the getCanvas() readback below sees the new camera
                // immediately - removing the ~16ms-per-frame rAF tax, and the
                // catastrophic stall when the export tab is backgrounded (rAF
                // throttles to ~1 Hz there; a synchronous redraw does not).
                // preserveDrawingBuffer (constructor) keeps the buffer alive to read.
                map.redraw();
                // Prewarm normally has every tile cached, so redraw paints a full
                // frame. The one exception is a finer tile level than the prewarm
                // walk fetched (a slow segment zooming in past the walk's single
                // cached tile level - see the NB in prewarm): areTilesLoaded() is
                // then false, so grant ONE short grace
                // render. This keeps us strictly no worse than the old 80ms wait on
                // the rare gray-fill frame, while the common case pays zero wait.
                if (!map.areTilesLoaded()) {
                    await waitForMapEvent(map, "render", 30);
                    map.redraw();
                }
            }

            const sourceCanvas = map.getCanvas();
            // Render the car marker on top - direct on a compositor canvas so
            // we hand back a fully self-contained ImageBitmap. Doing the marker
            // here (not in the worker) keeps the symbol crisp at any output
            // size: marker is sized to the snapshot, then the pipeline draws
            // the resulting bitmap scaled into the slot.
            if (composite.width !== sourceCanvas.width || composite.height !== sourceCanvas.height) {
                composite.width = sourceCanvas.width;
                composite.height = sourceCanvas.height;
            } else {
                cctx.clearRect(0, 0, composite.width, composite.height);
            }
            cctx.drawImage(sourceCanvas, 0, 0);
            // Marker placement. North-up: centered, rotated by heading (the map
            // itself is not rotated). Chase: the map IS rotated to heading-up, so
            // the car points straight up (screen bearing 0) and sits wherever the
            // tilted, padded projection puts it - map.project() returns that exact
            // CSS pixel; scale it to drawing-buffer pixels for the composite.
            const markerPoint = headingUp
                ? map.project([req.lon, req.lat])
                : { x: SNAPSHOT_WIDTH / 2, y: SNAPSHOT_HEIGHT / 2 };
            await drawMapMarker(
                cctx,
                activeMarkerAppearance,
                markerPoint.x * (composite.width / SNAPSHOT_WIDTH),
                markerPoint.y * (composite.height / SNAPSHOT_HEIGHT),
                headingUp ? 0 : req.bearingDeg,
                Math.min(composite.width, composite.height) * 0.105 * mapMarkerSizeScale(activeMarkerAppearance.size),
                pitch,
            );

            return await createImageBitmap(composite);
        },
        setMarkerAppearance(appearance: MapMarkerAppearance): void {
            activeMarkerAppearance = { ...appearance };
        },
        dispose(): void {
            isDisposed = true;
            unsubscribeProvider();
            try {
                map.remove();
            } catch (err) {
                log.warn("map remove threw", { err: String(err) });
            }
            host.remove();
        },
    };
}

function waitForStyleLoad(map: maplibregl.Map, style?: maplibregl.StyleSpecification): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        // getStyle is available once JSON is parsed. loaded/isStyleLoaded wait
        // for remote tiles too, which cannot gate a local export overlay.
        if (!style && map.getStyle()) {
            resolve();
            return;
        }
        const timeoutId = setTimeout(() => {
            map.off("style.load", onLoad);
            reject(new Error(`map style load timed out after ${MAP_LOAD_TIMEOUT_MS}ms`));
        }, MAP_LOAD_TIMEOUT_MS);
        const onLoad = (): void => {
            clearTimeout(timeoutId);
            resolve();
        };
        map.once("style.load", onLoad);
        if (style) {
            try {
                map.setStyle(style, { diff: false });
            } catch (err) {
                clearTimeout(timeoutId);
                map.off("style.load", onLoad);
                reject(err);
            }
        }
    });
}

// JSON parsing must settle even if the WebGL context disappears during setup.
const MAP_LOAD_TIMEOUT_MS = 20_000;

/** Active records with finite coords - the only ones safe to feed to MapLibre
 *  (geometry, gradient, prewarm jumps). trip.records may carry inactive
 *  lost-fix entries with stale/zero/NaN coords; the main map filters the same
 *  way before building its track. Feeding the unfiltered list desynced the
 *  gradient (built over all records) from the active-only geometry and could
 *  poison cumulative distances with NaN. */
function finiteActiveRecords(recs: GpsRecord[]): GpsRecord[] {
    return recs.filter(isValidGpsFix);
}

function addTrackLayer(map: maplibregl.Map, records: GpsRecord[]): void {
    const usable = finiteActiveRecords(records);
    if (usable.length < 2) return;
    const coords: [number, number][] = usable.map((r) => [r.lon, r.lat]);
    // Same usable list for geometry AND gradient so line-progress stops align
    // with the actual line vertices; mercator cumdist so the stop fractions use
    // the same metric MapLibre measures line-progress in.
    const { cumDist, total } = buildMercatorCumulativeDistances(usable);
    const gradient = buildSpeedGradient(usable, cumDist, total);
    addSpeedTrack(map, { coords, gradient }, { sourceId: TRACK_SOURCE_ID, layerId: TRACK_LAYER_ID, width: 5 });
}
