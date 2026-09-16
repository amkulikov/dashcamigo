import type { LayerSpecification, StyleSpecification } from "maplibre-gl";

import type { MapStylePreset } from "./map-view-pref.js";

const ROAD_HIDDEN = new Set(["poi", "address", "context-label", "landuse", "boundary"]);
const MINIMAL_HIDDEN = new Set([...ROAD_HIDDEN, "poi-driver", "park", "landcover", "water-label"]);

function layerRole(layer: LayerSpecification): string | undefined {
    const metadata: unknown = layer.metadata;
    if (!metadata || typeof metadata !== "object" || !("dashcamigo:role" in metadata)) return undefined;
    const role = metadata["dashcamigo:role"];
    return typeof role === "string" ? role : undefined;
}

/** Keep transport geometry and labels identical while reducing the surrounding
 * context. Unknown layers survive, including the final raster fallback. */
export function applyMapStylePreset(style: StyleSpecification, preset: MapStylePreset): StyleSpecification {
    if (preset === "classic") return style;
    const hidden = preset === "minimal" ? MINIMAL_HIDDEN : ROAD_HIDDEN;
    const clone = structuredClone(style);
    clone.layers = clone.layers.filter((layer) => {
        const role = layerRole(layer);
        return (
            role === undefined ||
            (!hidden.has(role) && !(preset === "road" && role === "park" && layer.type === "line"))
        );
    });
    if (preset === "road") {
        for (const layer of clone.layers) {
            const role = layerRole(layer);
            if (layer.type === "fill" && (role === "park" || role === "landcover")) {
                layer.paint = { ...layer.paint, "fill-opacity": 0.22 };
            }
        }
    }
    return clone;
}
