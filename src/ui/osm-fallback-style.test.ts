import { validateStyleMin } from "@maplibre/maplibre-gl-style-spec";
import { describe, expect, it } from "vitest";

import {
    createFallbackMapStyle,
    OSM_SHORTBREAD_BUILDING_SOURCE_LAYER,
    OSM_SHORTBREAD_SOURCE_ID,
} from "./osm-fallback-style.js";
import type { MapStyleId } from "./theme.js";

describe("OSM fallback styles", () => {
    it.each<MapStyleId>(["light", "dark", "neon"])("builds a valid %s Shortbread style", (theme) => {
        const style = createFallbackMapStyle("osm-vector", theme);
        expect(validateStyleMin(style)).toEqual([]);
        expect(style.glyphs).toBeUndefined();
        expect(style.sprite).toBeUndefined();
        expect(style.sources).toHaveProperty(OSM_SHORTBREAD_SOURCE_ID);
        expect(style.layers.some((layer) => "source-layer" in layer && layer["source-layer"] === "street_labels")).toBe(
            true,
        );
        expect(
            style.layers.some(
                (layer) => "source-layer" in layer && layer["source-layer"] === OSM_SHORTBREAD_BUILDING_SOURCE_LAYER,
            ),
        ).toBe(true);
        for (const layer of style.layers) {
            if (layer.type === "symbol") expect(layer.layout?.["text-size"], layer.id).toBeDefined();
        }
    });

    it("builds a valid standard raster style", () => {
        const style = createFallbackMapStyle("osm-raster", "dark");
        expect(validateStyleMin(style)).toEqual([]);
        expect(style.layers).toEqual([{ id: "osm-raster", type: "raster", source: "osm-raster" }]);
    });

    it("keeps Shortbread roads compact and scales link roads down", () => {
        const style = createFallbackMapStyle("osm-vector", "light");
        const layer = style.layers.find((candidate) => candidate.id === "osm-motorways");

        expect(layer?.type).toBe("line");
        if (layer?.type !== "line") throw new Error("motorway layer missing");
        expect(layer.paint?.["line-width"]).toEqual([
            "interpolate",
            ["linear"],
            ["zoom"],
            5,
            ["*", 0.9, ["case", ["==", ["get", "link"], true], 0.72, 1]],
            14,
            ["*", 4.6, ["case", ["==", ["get", "link"], true], 0.72, 1]],
        ]);
    });
});
