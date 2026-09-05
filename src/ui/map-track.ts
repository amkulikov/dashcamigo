import type { ExpressionSpecification, Map as MapLibreMap } from "maplibre-gl";
import type { MiniMapData } from "./state.js";
import { unwrapTrackCoordinates } from "../coordinates.js";

/** Geometry and gradient must describe the same ordered vertices. */
export function addSpeedTrack(
    map: MapLibreMap,
    data: MiniMapData,
    options: { sourceId: string; layerId?: string; width: number; opacity?: number },
): void {
    const { sourceId, layerId = sourceId, width, opacity = 1 } = options;
    map.addSource(sourceId, {
        type: "geojson",
        // MapLibre requires line metrics for a line-progress gradient.
        lineMetrics: true,
        data: {
            type: "Feature",
            properties: {},
            geometry: { type: "LineString", coordinates: unwrapTrackCoordinates(data.coords) },
        },
    });
    map.addLayer({
        id: layerId,
        type: "line",
        source: sourceId,
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
            "line-width": width,
            "line-opacity": opacity,
            "line-gradient": data.gradient as ExpressionSpecification,
        },
    });
}
