import { beforeEach, describe, expect, it, vi } from "vitest";

import {
    _resetForTests,
    forceMapProvider,
    getMapProvider,
    mapProviderForTileUrl,
    reportMapProviderTileError,
    subscribeMapProvider,
    type MapProvider,
} from "./map-provider.js";

const OFM_TILE_A = { url: "https://tiles.openfreemap.org/planet/build/10/1/2.pbf" };
const OFM_TILE_B = { url: "https://tiles.openfreemap.org/planet/build/10/1/3.pbf" };
const OFM_TILEJSON = { url: "https://tiles.openfreemap.org/planet" };
const OSM_VECTOR_TILE_A = { url: "https://vector.openstreetmap.org/shortbread_v1/10/1/2.mvt" };
const OSM_VECTOR_TILE_B = { url: "https://vector.openstreetmap.org/shortbread_v1/10/1/3.mvt" };

describe("map provider fallback", () => {
    beforeEach(() => {
        _resetForTests();
    });

    it("requires two different failed tiles inside five seconds", async () => {
        const probe = vi.fn(async () => true);
        _resetForTests(probe);

        expect(reportMapProviderTileError(OFM_TILE_A, 1_000)).toBeNull();
        expect(reportMapProviderTileError(OFM_TILE_A, 2_000)).toBeNull();
        expect(reportMapProviderTileError(OFM_TILE_B, 7_001)).toBeNull();
        expect(probe).not.toHaveBeenCalled();

        const transition = reportMapProviderTileError(OFM_TILE_A, 7_002);
        await transition;
        expect(probe).toHaveBeenCalledOnce();
        expect(getMapProvider()).toBe("osm-vector");
    });

    it("uses raster when the vector probe fails", async () => {
        const probe = vi.fn(async (provider: MapProvider) => provider === "osm-raster");
        _resetForTests(probe);

        reportMapProviderTileError(OFM_TILE_A, 1_000);
        await reportMapProviderTileError(OFM_TILE_B, 1_001);

        expect(probe.mock.calls.map(([provider]) => provider)).toEqual(["osm-vector", "osm-raster"]);
        expect(getMapProvider()).toBe("osm-raster");
    });

    it("downgrades after the TileJSON bootstrap fails once", async () => {
        const probe = vi.fn(async () => true);
        _resetForTests(probe);

        await reportMapProviderTileError(OFM_TILEJSON, 1_000);

        expect(probe).toHaveBeenCalledOnce();
        expect(getMapProvider()).toBe("osm-vector");
    });

    it("recognizes every OpenFreeMap resource needed before vector tiles", () => {
        expect(mapProviderForTileUrl(OFM_TILEJSON.url)).toBe("openfreemap");
        expect(mapProviderForTileUrl("https://tiles.openfreemap.org/natural_earth/ne2sr/2/1/1.png")).toBe(
            "openfreemap",
        );
        expect(mapProviderForTileUrl("https://tiles.openfreemap.org/fonts/Inter/0-255.pbf")).toBe("openfreemap");
    });

    it("downgrades an active vector provider to raster", async () => {
        const probe = vi.fn(async () => true);
        _resetForTests(probe);
        reportMapProviderTileError(OFM_TILE_A, 1_000);
        await reportMapProviderTileError(OFM_TILE_B, 1_001);

        reportMapProviderTileError(OSM_VECTOR_TILE_A, 2_000);
        await reportMapProviderTileError(OSM_VECTOR_TILE_B, 2_001);

        expect(getMapProvider()).toBe("osm-raster");
    });

    it("forces any provider for page-scoped DevTools debugging", () => {
        const seen: MapProvider[] = [];
        subscribeMapProvider((provider) => seen.push(provider));

        expect(forceMapProvider("osm-raster")).toBe("osm-raster");
        expect(forceMapProvider("openfreemap")).toBe("openfreemap");
        expect(seen).toEqual(["openfreemap", "osm-raster", "openfreemap"]);
    });

    it("does not let a late automatic probe undo a forced provider", async () => {
        let finishProbe: ((available: boolean) => void) | undefined;
        _resetForTests(
            () =>
                new Promise<boolean>((resolve) => {
                    finishProbe = resolve;
                }),
        );
        reportMapProviderTileError(OFM_TILE_A, 1_000);
        const transition = reportMapProviderTileError(OFM_TILE_B, 1_001);
        forceMapProvider("osm-raster");
        finishProbe?.(true);
        await transition;

        expect(getMapProvider()).toBe("osm-raster");
    });
});
