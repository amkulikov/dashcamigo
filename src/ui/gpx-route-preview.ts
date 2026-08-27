// Transient route map for the loose-GPX assignment dialog. The local SVG is
// immediate and remains the offline/WebGL fallback; MapLibre replaces it with
// geographic context when the regular map stack is available.

import type * as maplibregl from "maplibre-gl";

import { probeWebGL } from "../capabilities.js";
import { createLogger } from "../log.js";
import type { GpsRecord } from "../parsers/types.js";
import { loadMaplibre, loadMapStyle } from "./map.js";
import { applyViewerLabelPrefs } from "./map-label-scale.js";
import { getMapProvider } from "./map-provider.js";
import { transformMapTileRequest } from "./map-tile-cache.js";
import { currentMapTheme, getCssVar } from "./theme.js";

const log = createLogger("gpx-route-preview");

const ROUTE_SOURCE_ID = "gpx-assignment-route";
const ROUTE_LINE_LAYER_ID = "gpx-assignment-route-line";
const ROUTE_POINT_LAYER_ID = "gpx-assignment-route-points";
const SVG_NS = "http://www.w3.org/2000/svg";
const SVG_WIDTH = 640;
const SVG_HEIGHT = 360;
const SVG_PADDING = 36;
const MAX_MERCATOR_LAT = 85.051129;
const MAX_PREVIEW_POINTS = 5000;

type PreviewCoordinate = [number, number];

function previewCoordinates(records: readonly GpsRecord[]): PreviewCoordinate[] {
    const coords: PreviewCoordinate[] = [];
    for (const record of records) {
        if (!record.active || !Number.isFinite(record.lat) || !Number.isFinite(record.lon)) continue;
        const previous = coords[coords.length - 1];
        if (previous && previous[0] === record.lon && previous[1] === record.lat) continue;
        coords.push([record.lon, record.lat]);
    }
    if (coords.length <= MAX_PREVIEW_POINTS) return coords;
    const stride = Math.ceil(coords.length / MAX_PREVIEW_POINTS);
    const reduced = coords.filter((_, index) => index % stride === 0);
    const last = coords[coords.length - 1]!;
    if (reduced[reduced.length - 1] !== last) reduced.push(last);
    return reduced;
}

function mercatorY(lat: number): number {
    const clamped = Math.max(-MAX_MERCATOR_LAT, Math.min(MAX_MERCATOR_LAT, lat));
    const radians = (clamped * Math.PI) / 180;
    return Math.log(Math.tan(Math.PI / 4 + radians / 2));
}

function routeData(coords: readonly PreviewCoordinate[]): maplibregl.GeoJSONSourceSpecification["data"] {
    const first = coords[0];
    const last = coords[coords.length - 1];
    const features: Array<{
        type: "Feature";
        properties: { kind: "route" | "endpoint" };
        geometry:
            | { type: "LineString"; coordinates: PreviewCoordinate[] }
            | { type: "Point"; coordinates: PreviewCoordinate };
    }> = [];
    if (coords.length >= 2) {
        features.push({
            type: "Feature",
            properties: { kind: "route" },
            geometry: { type: "LineString", coordinates: [...coords] },
        });
    }
    if (first) {
        features.push({
            type: "Feature",
            properties: { kind: "endpoint" },
            geometry: { type: "Point", coordinates: first },
        });
    }
    if (last && last !== first) {
        features.push({
            type: "Feature",
            properties: { kind: "endpoint" },
            geometry: { type: "Point", coordinates: last },
        });
    }
    return { type: "FeatureCollection", features };
}

function appendEndpoint(svg: SVGSVGElement, x: number, y: number): void {
    const point = document.createElementNS(SVG_NS, "circle");
    point.classList.add("gpx-assignment-map-fallback__endpoint");
    point.setAttribute("cx", x.toFixed(2));
    point.setAttribute("cy", y.toFixed(2));
    point.setAttribute("r", "6");
    svg.appendChild(point);
}

function renderFallback(host: HTMLElement, coords: readonly PreviewCoordinate[]): void {
    host.querySelector(".gpx-assignment-map-fallback")?.remove();
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.classList.add("gpx-assignment-map-fallback");
    svg.setAttribute("viewBox", `0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`);
    svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
    svg.setAttribute("aria-hidden", "true");
    host.prepend(svg);
    if (coords.length === 0) return;

    const projected = coords.map(([lon, lat]) => [lon, mercatorY(lat)] as const);
    let minX = projected[0]![0];
    let maxX = minX;
    let minY = projected[0]![1];
    let maxY = minY;
    for (const [x, y] of projected.slice(1)) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
    }
    const spanX = maxX - minX;
    const spanY = maxY - minY;
    const scaleX = spanX > 1e-9 ? (SVG_WIDTH - SVG_PADDING * 2) / spanX : Number.POSITIVE_INFINITY;
    const scaleY = spanY > 1e-9 ? (SVG_HEIGHT - SVG_PADDING * 2) / spanY : Number.POSITIVE_INFINITY;
    const finiteScale = Math.min(scaleX, scaleY);
    const scale = Number.isFinite(finiteScale) ? finiteScale : 1;
    const usedWidth = spanX * scale;
    const usedHeight = spanY * scale;
    const offsetX = (SVG_WIDTH - usedWidth) / 2;
    const offsetY = (SVG_HEIGHT - usedHeight) / 2;
    const points = projected.map(([x, y]) => [offsetX + (x - minX) * scale, offsetY + (maxY - y) * scale] as const);

    if (points.length >= 2) {
        const route = document.createElementNS(SVG_NS, "polyline");
        route.classList.add("gpx-assignment-map-fallback__route");
        route.setAttribute("points", points.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" "));
        svg.appendChild(route);
    }
    appendEndpoint(svg, points[0]![0], points[0]![1]);
    if (points.length >= 2) appendEndpoint(svg, points[points.length - 1]![0], points[points.length - 1]![1]);
}

/** Owns one short-lived WebGL map and its immediate SVG fallback. */
export class GpxRoutePreview {
    private map: maplibregl.Map | null = null;
    private maplibre: typeof import("maplibre-gl") | null = null;
    private coords: PreviewCoordinate[] = [];
    private isReady = false;
    private isDisposed = false;
    private initStarted = false;
    private readonly seenErrors = new Set<string>();

    constructor(private readonly host: HTMLElement) {}

    show(records: readonly GpsRecord[]): void {
        this.coords = previewCoordinates(records);
        renderFallback(this.host, this.coords);
        if (this.isReady) {
            this.syncMapRoute();
            this.host.querySelector(".gpx-assignment-map-fallback")?.remove();
            return;
        }
        if (!this.initStarted && probeWebGL()) {
            this.initStarted = true;
            void this.initMap();
        }
    }

    dispose(): void {
        this.isDisposed = true;
        this.isReady = false;
        this.removeMap();
        this.maplibre = null;
        this.host.replaceChildren();
    }

    private async initMap(): Promise<void> {
        try {
            const theme = currentMapTheme();
            const provider = getMapProvider();
            const [maplibre, loadedStyle] = await Promise.all([
                loadMaplibre(),
                loadMapStyle(theme, false, "preview", provider),
            ]);
            if (this.isDisposed) return;
            // The SVG already provides the route offline. An empty MapLibre
            // canvas adds no geographic context and would draw a second route.
            if (!loadedStyle) return;
            this.maplibre = maplibre;

            const mapHost = document.createElement("div");
            mapHost.className = "gpx-assignment-maplibre";
            mapHost.setAttribute("aria-hidden", "true");
            this.host.appendChild(mapHost);
            const map = new maplibre.Map({
                container: mapHost,
                style: applyViewerLabelPrefs(loadedStyle),
                center: this.coords[0] ?? [0, 0],
                zoom: 12,
                interactive: false,
                attributionControl: { compact: true },
                fadeDuration: 0,
                refreshExpiredTiles: false,
                crossSourceCollisions: false,
                validateStyle: false,
                transformRequest: transformMapTileRequest,
            });
            this.map = map;
            map.on("error", (event) => {
                const cause = (event as { error?: unknown }).error;
                const message = cause instanceof Error ? cause.message : String(cause);
                if (this.seenErrors.has(message)) return;
                this.seenErrors.add(message);
                log.warn("maplibre error", { message });
            });
            map.once("load", () => {
                if (this.isDisposed || this.map !== map) return;
                this.isReady = true;
                this.addMapLayers();
                this.syncMapRoute();
                mapHost.classList.add("is-ready");
                this.host.querySelector(".gpx-assignment-map-fallback")?.remove();
            });
        } catch (err) {
            if (this.isDisposed) return;
            log.warn("route preview map unavailable", {
                err: err instanceof Error ? err.message : String(err),
            });
            this.removeMap();
            this.host.querySelector(".gpx-assignment-maplibre")?.remove();
            renderFallback(this.host, this.coords);
        }
    }

    private removeMap(): void {
        const map = this.map;
        this.map = null;
        if (!map) return;
        try {
            map.remove();
        } catch (err) {
            log.warn("route preview cleanup failed", {
                err: err instanceof Error ? err.message : String(err),
            });
        }
    }

    private addMapLayers(): void {
        if (!this.map || this.map.getSource(ROUTE_SOURCE_ID)) return;
        this.map.addSource(ROUTE_SOURCE_ID, {
            type: "geojson",
            data: routeData(this.coords),
        });
        this.map.addLayer({
            id: ROUTE_LINE_LAYER_ID,
            type: "line",
            source: ROUTE_SOURCE_ID,
            filter: ["==", ["get", "kind"], "route"],
            layout: { "line-cap": "round", "line-join": "round" },
            paint: {
                "line-color": getCssVar("--accent"),
                "line-width": 5,
                "line-opacity": 0.95,
            },
        });
        this.map.addLayer({
            id: ROUTE_POINT_LAYER_ID,
            type: "circle",
            source: ROUTE_SOURCE_ID,
            filter: ["==", ["get", "kind"], "endpoint"],
            paint: {
                "circle-radius": 5,
                "circle-color": getCssVar("--accent"),
                "circle-stroke-color": getCssVar("--bg-elev"),
                "circle-stroke-width": 2,
            },
        });
    }

    private syncMapRoute(): void {
        if (!this.map || !this.maplibre || !this.isReady) return;
        const source = this.map.getSource(ROUTE_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
        source?.setData(routeData(this.coords));
        const first = this.coords[0];
        if (!first) return;
        if (this.coords.length === 1) {
            this.map.jumpTo({ center: first, zoom: 14 });
            return;
        }
        const bounds = this.coords.reduce(
            (current, coord) => current.extend(coord),
            new this.maplibre.LngLatBounds(first, first),
        );
        this.map.fitBounds(bounds, { padding: 36, maxZoom: 15, animate: false });
    }
}
