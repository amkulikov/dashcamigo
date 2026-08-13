// Map label size: the user preference and the style transform applying it.
//
// MapLibre has no global text-scale knob - label sizes are baked into each
// style layer's layout["text-size"]. We fetch the style JSON ourselves
// (loadMapStyle in map.ts), so the viewer scales a CLONE of the cached style
// right before setStyle; the cache itself stays pristine, because the export
// snapshotter reads the same cache and applies its own independent factor
// (exportPanelState.overlayMap.labelScalePct).

import type { StyleSpecification } from "maplibre-gl";

/** Scale presets offered in settings. 1 = the style's own sizes. */
export const MAP_LABEL_SCALE_VALUES = [1, 1.25, 1.5, 2] as const;

export type MapLabelScale = (typeof MAP_LABEL_SCALE_VALUES)[number];

const STORAGE_KEY = "dashcamigo:mapLabelScale";

function isMapLabelScale(value: number): value is MapLabelScale {
    return (MAP_LABEL_SCALE_VALUES as readonly number[]).includes(value);
}

/** Stored label-scale preference for the live viewer maps; 1 when unset or
 *  the stored value is not one of the presets. */
export function getMapLabelScale(): MapLabelScale {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw !== null) {
            const parsed = Number(raw);
            if (isMapLabelScale(parsed)) return parsed;
        }
    } catch {
        // private mode - fall through to the default.
    }
    return 1;
}

/** Persists the label-scale preference. The caller re-applies the style to the
 *  live maps (reapplyMapLabelScale in map.ts) - there are no subscribers. */
export function setMapLabelScale(scale: MapLabelScale): void {
    try {
        localStorage.setItem(STORAGE_KEY, String(scale));
    } catch {
        // private mode - won't survive reload but works in this session.
    }
}

/**
 * Scales one text-size value. Zoom-driven values must keep "interpolate"/"step"
 * at the top level (MapLibre rejects a wrapping ["*", factor, expr]), so the
 * numeric OUTPUTS are scaled in place while the zoom breakpoints stay put.
 * An unrecognized expression is returned unchanged - an unscaled label beats a
 * style that fails to render.
 */
function scaleTextSizeValue(value: unknown, factor: number): unknown {
    if (typeof value === "number") return value * factor;
    if (Array.isArray(value)) {
        // ["interpolate", interp, input, stop1, out1, stop2, out2, ...]:
        // outputs sit at even indices from 4 on.
        if (value[0] === "interpolate") {
            return value.map((item, i) => (i >= 4 && i % 2 === 0 ? scaleTextSizeValue(item, factor) : item));
        }
        // ["step", input, out0, stop1, out1, ...]: outputs at even indices from 2 on.
        if (value[0] === "step") {
            return value.map((item, i) => (i >= 2 && i % 2 === 0 ? scaleTextSizeValue(item, factor) : item));
        }
        return value;
    }
    // Legacy zoom function: {base?, stops: [[zoom, size], ...]}.
    if (typeof value === "object" && value !== null && Array.isArray((value as { stops?: unknown }).stops)) {
        const fn = value as { stops: unknown[] };
        return {
            ...fn,
            stops: fn.stops.map((pair) =>
                Array.isArray(pair) && pair.length === 2 ? [pair[0], scaleTextSizeValue(pair[1], factor)] : pair,
            ),
        };
    }
    return value;
}

/**
 * Returns a deep clone of `style` with every symbol layer's text-size
 * multiplied by `factor`. factor === 1 returns the input untouched (same
 * reference), so the default costs nothing. Every text layer in our shipped
 * styles carries an explicit text-size (asserted by the colocated test), so
 * the MapLibre default of 16 never needs synthesizing here.
 */
export function scaleStyleTextSizes(style: StyleSpecification, factor: number): StyleSpecification {
    if (factor === 1) return style;
    const clone = structuredClone(style);
    for (const layer of clone.layers) {
        if (layer.type !== "symbol" || !layer.layout) continue;
        const layout = layer.layout as Record<string, unknown>;
        if (layout["text-size"] === undefined) continue;
        layout["text-size"] = scaleTextSizeValue(layout["text-size"], factor);
    }
    return clone;
}
