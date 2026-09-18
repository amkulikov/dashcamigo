import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
    _resetForTests,
    createOverlayMapProviderSession,
    forceMapProvider,
    getMapProvider,
    getMapProviderPreference,
    mapProviderForTileUrl,
    mapProviderErrorKey,
    reportMapProviderTileError,
    setMapProviderPreference,
    subscribeMapProvider,
    subscribeMapProviderPreference,
    type MapProvider,
} from "./map-provider.js";

const YANDEX_TILE_A = { url: "https://tiles.api-maps.yandex.ru/v1/tiles/?x=1&y=2&z=10&apikey=test" };
const YANDEX_TILE_B = { url: "https://tiles.api-maps.yandex.ru/v1/tiles/?x=1&y=3&z=10&apikey=test" };
const OFM_TILE_A = { url: "https://tiles.openfreemap.org/planet/build/10/1/2.pbf" };
const OFM_TILE_B = { url: "https://tiles.openfreemap.org/planet/build/10/1/3.pbf" };
const OFM_TILEJSON = { url: "https://tiles.openfreemap.org/planet" };
const OSM_VECTOR_TILE_A = { url: "https://vector.openstreetmap.org/shortbread_v1/10/1/2.mvt" };
const OSM_VECTOR_TILE_B = { url: "https://vector.openstreetmap.org/shortbread_v1/10/1/3.mvt" };

describe("map provider fallback", () => {
    beforeEach(() => {
        vi.stubEnv("VITE_YANDEX_TILES_API_KEY", "");
        _resetForTests();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.unstubAllEnvs();
    });

    it("saves the preferred provider and restores it on a new page session", () => {
        const values = new Map<string, string>();
        vi.stubGlobal("localStorage", {
            getItem: (key: string) => values.get(key) ?? null,
            setItem: (key: string, value: string) => values.set(key, value),
        });

        setMapProviderPreference("osm-vector");
        expect(getMapProvider()).toBe("osm-vector");
        expect(values.get("dashcamigo:mapProvider")).toBe("osm-vector");

        _resetForTests();
        expect(getMapProviderPreference()).toBe("osm-vector");
        expect(getMapProvider()).toBe("osm-vector");
    });

    it("falls back to OpenFreeMap when the selected OpenStreetMap vector tiles fail", async () => {
        const probe = vi.fn(async (_provider: MapProvider) => true);
        _resetForTests(probe);
        setMapProviderPreference("osm-vector");

        reportMapProviderTileError(OSM_VECTOR_TILE_A, 1_000);
        await reportMapProviderTileError(OSM_VECTOR_TILE_B, 1_001);

        expect(probe.mock.calls.map(([provider]) => provider)).toEqual(["openfreemap"]);
        expect(getMapProvider()).toBe("openfreemap");
        expect(getMapProviderPreference()).toBe("osm-vector");
    });

    it("uses raster after both vector providers fail under the OpenStreetMap preference", async () => {
        const probe = vi.fn(async (provider: MapProvider) => provider === "osm-raster");
        _resetForTests(probe);
        setMapProviderPreference("osm-vector");

        reportMapProviderTileError(OSM_VECTOR_TILE_A, 1_000);
        await reportMapProviderTileError(OSM_VECTOR_TILE_B, 1_001);

        expect(probe.mock.calls.map(([provider]) => provider)).toEqual(["openfreemap", "osm-raster"]);
        expect(getMapProvider()).toBe("osm-raster");
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

    it("groups repeated outages by provider without hiding different failures", () => {
        const first = new Error(`failed to fetch map resource: ${OFM_TILE_A.url}`);
        const second = new Error(`failed to fetch map resource: ${OFM_TILE_B.url}`);
        const missing = new Error(`map request failed (404): ${OFM_TILE_B.url}`);

        expect(mapProviderErrorKey(first)).toBe(mapProviderErrorKey(second));
        expect(mapProviderErrorKey(first)).not.toBe(mapProviderErrorKey(missing));
        expect(mapProviderErrorKey(new Error("style is not loaded"))).toBe("style is not loaded");
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

    it("does not let a late automatic probe undo a new preference", async () => {
        let finishProbe: ((available: boolean) => void) | undefined;
        _resetForTests(
            () =>
                new Promise<boolean>((resolve) => {
                    finishProbe = resolve;
                }),
        );
        reportMapProviderTileError(OFM_TILE_A, 1_000);
        const transition = reportMapProviderTileError(OFM_TILE_B, 1_001);
        setMapProviderPreference("osm-vector");
        finishProbe?.(true);
        await transition;

        expect(getMapProvider()).toBe("osm-vector");
        expect(getMapProviderPreference()).toBe("osm-vector");
    });

    it("rejects Yandex when its public key is absent", () => {
        vi.stubGlobal("localStorage", { getItem: () => "yandex" });
        expect(getMapProviderPreference()).toBe("openfreemap");
        expect(getMapProvider()).toBe("openfreemap");
        expect(() => setMapProviderPreference("yandex")).toThrow("key is not configured");
        expect(() => forceMapProvider("yandex")).toThrow("key is not configured");
    });

    it("restores a configured Yandex preference", () => {
        vi.stubEnv("VITE_YANDEX_TILES_API_KEY", "test-key");
        const values = new Map<string, string>();
        vi.stubGlobal("localStorage", {
            getItem: (key: string) => values.get(key) ?? null,
            setItem: (key: string, value: string) => values.set(key, value),
        });
        setMapProviderPreference("yandex");
        _resetForTests();
        expect(getMapProviderPreference()).toBe("yandex");
        expect(getMapProvider()).toBe("yandex");
    });

    it("falls back from Yandex through OpenFreeMap and both OpenStreetMap sources", async () => {
        vi.stubEnv("VITE_YANDEX_TILES_API_KEY", "test-key");
        const probe = vi.fn(async (_provider: MapProvider) => true);
        _resetForTests(probe);
        setMapProviderPreference("yandex");
        reportMapProviderTileError(YANDEX_TILE_A, 1_000);
        await reportMapProviderTileError(YANDEX_TILE_B, 1_001);
        expect(getMapProvider()).toBe("openfreemap");
        await reportMapProviderTileError(OFM_TILEJSON, 2_000);
        expect(getMapProvider()).toBe("osm-vector");
        reportMapProviderTileError(OSM_VECTOR_TILE_A, 3_000);
        await reportMapProviderTileError(OSM_VECTOR_TILE_B, 3_001);
        expect(getMapProvider()).toBe("osm-raster");
        expect(getMapProviderPreference()).toBe("yandex");
        expect(probe.mock.calls.map(([provider]) => provider)).toEqual(["openfreemap", "osm-vector", "osm-raster"]);
    });

    it.each([403, 429])("falls back on one Yandex HTTP %s response", async (status) => {
        vi.stubEnv("VITE_YANDEX_TILES_API_KEY", "test-key");
        const probe = vi.fn(async (_provider: MapProvider) => true);
        _resetForTests(probe);
        setMapProviderPreference("yandex");
        await reportMapProviderTileError({ ...YANDEX_TILE_A, status }, 1_000);
        expect(getMapProvider()).toBe("openfreemap");
        expect(getMapProviderPreference()).toBe("yandex");
        expect(probe.mock.calls.map(([provider]) => provider)).toEqual(["openfreemap"]);
    });

    it("never probes Yandex as a fallback for an OpenStreetMap preference", async () => {
        vi.stubEnv("VITE_YANDEX_TILES_API_KEY", "test-key");
        const probe = vi.fn(async (_provider: MapProvider) => false);
        _resetForTests(probe);
        setMapProviderPreference("osm-vector");
        reportMapProviderTileError(OSM_VECTOR_TILE_A, 1_000);
        await reportMapProviderTileError(OSM_VECTOR_TILE_B, 1_001);
        expect(probe.mock.calls.map(([provider]) => provider)).toEqual(["openfreemap", "osm-raster"]);
    });

    it("notifies preferences when the selected fallback is already active", async () => {
        _resetForTests(async () => true);
        const preferences: string[] = [];
        const unsubscribe = subscribeMapProviderPreference((provider) => preferences.push(provider));
        await reportMapProviderTileError(OFM_TILEJSON, 1_000);
        expect(preferences).toEqual(["openfreemap"]);
        setMapProviderPreference("osm-vector");
        expect(preferences).toEqual(["openfreemap", "osm-vector"]);
        unsubscribe();
        setMapProviderPreference("openfreemap");
        expect(preferences).toEqual(["openfreemap", "osm-vector"]);
    });

    it("isolates overlay fallback and selection from a Yandex viewer", async () => {
        vi.stubEnv("VITE_YANDEX_TILES_API_KEY", "test-key");
        const probe = vi.fn(async (_provider: MapProvider) => true);
        _resetForTests(probe);
        setMapProviderPreference("yandex");
        const overlay = createOverlayMapProviderSession();
        const seen: string[] = [];
        overlay.subscribe((provider) => seen.push(provider));
        expect(overlay.getProvider()).toBe("openfreemap");
        expect(overlay.reportTileError(YANDEX_TILE_A, 1_000)).toBeNull();
        await overlay.reportTileError(OFM_TILEJSON, 2_000);
        expect(overlay.getProvider()).toBe("osm-vector");
        expect(getMapProvider()).toBe("yandex");
        setMapProviderPreference("openfreemap");
        setMapProviderPreference("yandex");
        expect(overlay.getProvider()).toBe("osm-vector");
        overlay.reportTileError(OSM_VECTOR_TILE_A, 3_000);
        await overlay.reportTileError(OSM_VECTOR_TILE_B, 3_001);
        expect(seen).toEqual(["openfreemap", "osm-vector", "osm-raster"]);
        expect(probe.mock.calls.map(([provider]) => provider)).toEqual(["osm-vector", "osm-raster"]);
        overlay.dispose();
    });

    it("keeps the default overlay source independent of an OpenStreetMap viewer preference", () => {
        setMapProviderPreference("osm-vector");
        const overlay = createOverlayMapProviderSession();
        expect(overlay.getProvider()).toBe("openfreemap");
        expect(getMapProvider()).toBe("osm-vector");
        overlay.dispose();
    });

    it("uses the overlay's explicit choice independently of the viewer", () => {
        const overlay = createOverlayMapProviderSession("osm-vector");
        expect(getMapProvider()).toBe("openfreemap");
        expect(overlay.getProvider()).toBe("osm-vector");
        overlay.dispose();
    });

    it("rejects Yandex in overlay sessions even for untyped callers", () => {
        // @ts-expect-error The runtime guard also protects plain JavaScript callers.
        const overlay = createOverlayMapProviderSession("yandex");
        expect(overlay.getProvider()).toBe("openfreemap");
        overlay.dispose();
    });

    it("ignores a pending overlay probe after disposal", async () => {
        let finishProbe: ((available: boolean) => void) | undefined;
        _resetForTests(
            () =>
                new Promise<boolean>((resolve) => {
                    finishProbe = resolve;
                }),
        );
        const overlay = createOverlayMapProviderSession();
        const seen: string[] = [];
        overlay.subscribe((provider) => seen.push(provider));
        const transition = overlay.reportTileError(OFM_TILEJSON, 1_000);
        overlay.dispose();
        finishProbe?.(true);
        await transition;
        expect(overlay.getProvider()).toBe("openfreemap");
        expect(seen).toEqual(["openfreemap"]);
    });
});
