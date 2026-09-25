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
    retryMapProvider,
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
const OSM_RASTER_TILE_A = { url: "https://tile.openstreetmap.org/10/1/2.png" };
const OSM_RASTER_TILE_B = { url: "https://tile.openstreetmap.org/10/1/3.png" };

describe("map provider fallback", () => {
    beforeEach(() => {
        vi.stubGlobal("__PORTABLE__", false);
        vi.stubEnv("VITE_YANDEX_TILES_API_KEY", "");
        vi.stubEnv("VITE_DEFAULT_MAP_PROVIDER", "");
        _resetForTests();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.unstubAllEnvs();
    });

    it("keeps route-only maps local even when old tile failures arrive", async () => {
        const probe = vi.fn(async (_provider: MapProvider) => true);
        _resetForTests(probe);
        setMapProviderPreference("route-only");
        const overlay = createOverlayMapProviderSession("route-only");
        await reportMapProviderTileError(OFM_TILEJSON);
        await overlay.reportTileError(OFM_TILEJSON);
        expect(getMapProvider()).toBe("route-only");
        expect(overlay.getProvider()).toBe("route-only");
        expect(probe).not.toHaveBeenCalled();
        overlay.dispose();
    });

    it.each([
        ["", "", "openfreemap"],
        ["invalid", "test-key", "openfreemap"],
        ["openfreemap", "test-key", "openfreemap"],
        ["osm-vector", "", "osm-vector"],
        ["yandex", "", "openfreemap"],
        ["yandex", "test-key", "yandex"],
    ])("uses available deployment default %j with key %j as %s", (configured, key, expected) => {
        vi.stubEnv("VITE_DEFAULT_MAP_PROVIDER", configured);
        vi.stubEnv("VITE_YANDEX_TILES_API_KEY", key);
        const setItem = vi.fn();
        vi.stubGlobal("localStorage", { getItem: () => null, setItem });

        expect(getMapProviderPreference()).toBe(expected);
        expect(getMapProvider()).toBe(expected);
        expect(setItem, "a deployment default is not a saved user choice").not.toHaveBeenCalled();
        const overlay = createOverlayMapProviderSession();
        expect(overlay.getProvider()).toBe("openfreemap");
        overlay.dispose();
    });

    it.each(["openfreemap", "osm-vector", "yandex"])("keeps saved %s above the deployment default", (stored) => {
        vi.stubEnv("VITE_DEFAULT_MAP_PROVIDER", "yandex");
        vi.stubEnv("VITE_YANDEX_TILES_API_KEY", "test-key");
        vi.stubGlobal("localStorage", { getItem: () => stored });

        expect(getMapProviderPreference()).toBe(stored);
        expect(getMapProvider()).toBe(stored);
    });

    it("uses the deployment default when the saved preference is invalid", () => {
        vi.stubEnv("VITE_DEFAULT_MAP_PROVIDER", "yandex");
        vi.stubEnv("VITE_YANDEX_TILES_API_KEY", "test-key");
        vi.stubGlobal("localStorage", { getItem: () => "invalid" });

        expect(getMapProviderPreference()).toBe("yandex");
    });

    it("uses the deployment default when browser storage is blocked", () => {
        vi.stubEnv("VITE_DEFAULT_MAP_PROVIDER", "yandex");
        vi.stubEnv("VITE_YANDEX_TILES_API_KEY", "test-key");
        vi.stubGlobal("localStorage", {
            getItem: () => {
                throw new Error("storage is blocked");
            },
        });

        expect(getMapProviderPreference()).toBe("yandex");
        expect(getMapProvider()).toBe("yandex");
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

    it("keeps the hosted provider when every fallback probe fails", async () => {
        const probe = vi.fn(async (_provider: MapProvider) => false);
        _resetForTests(probe);
        await reportMapProviderTileError(OFM_TILEJSON);
        expect(getMapProvider()).toBe("openfreemap");
        expect(probe.mock.calls.map(([provider]) => provider)).toEqual(["osm-vector", "osm-raster"]);
        forceMapProvider("osm-raster");
        expect(reportMapProviderTileError(OSM_RASTER_TILE_A)).toBeNull();
        expect(reportMapProviderTileError(OSM_RASTER_TILE_B)).toBeNull();
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

describe("portable map provider fallback and recovery", () => {
    beforeEach(() => {
        vi.stubGlobal("__PORTABLE__", true);
        vi.stubEnv("VITE_YANDEX_TILES_API_KEY", "");
        vi.stubEnv("VITE_DEFAULT_MAP_PROVIDER", "");
        const values = new Map<string, string>();
        vi.stubGlobal("localStorage", {
            getItem: (key: string) => values.get(key) ?? null,
            setItem: (key: string, value: string) => values.set(key, value),
        });
        _resetForTests();
    });

    afterEach(() => {
        _resetForTests();
        vi.unstubAllGlobals();
        vi.unstubAllEnvs();
    });

    it("starts the viewer and overlay with OpenFreeMap", () => {
        expect(getMapProvider()).toBe("openfreemap");
        expect(getMapProviderPreference()).toBe("openfreemap");
        const overlay = createOverlayMapProviderSession();
        expect(overlay.getProvider()).toBe("openfreemap");
        overlay.dispose();
        // @ts-expect-error Runtime validation also covers plain JavaScript callers.
        const invalid = createOverlayMapProviderSession("unknown");
        expect(invalid.getProvider()).toBe("openfreemap");
        invalid.dispose();
    });

    it.each(["openfreemap", "osm-vector", "route-only"] as const)("restores the saved %s choice", (provider) => {
        setMapProviderPreference(provider);
        expect(localStorage.getItem("dashcamigo:mapProvider")).toBe(provider);
        _resetForTests();
        expect(getMapProviderPreference()).toBe(provider);
        expect(getMapProvider()).toBe(provider);
    });

    it("falls back locally after all online providers fail without saving the fallback", async () => {
        const probe = vi.fn(async (_provider: MapProvider) => false);
        _resetForTests(probe);
        const seen: MapProvider[] = [];
        subscribeMapProvider((provider) => seen.push(provider));
        await reportMapProviderTileError(OFM_TILEJSON);
        expect(getMapProvider()).toBe("route-only");
        expect(getMapProviderPreference()).toBe("openfreemap");
        expect(localStorage.getItem("dashcamigo:mapProvider")).toBeNull();
        expect(probe.mock.calls.map(([provider]) => provider)).toEqual(["osm-vector", "osm-raster"]);
        expect(seen).toEqual(["openfreemap", "route-only"]);
    });

    it("falls back from failed raster tiles to the local route", async () => {
        const probe = vi.fn(async (provider: MapProvider) => provider === "osm-raster");
        _resetForTests(probe);
        await reportMapProviderTileError(OFM_TILEJSON, 1_000);
        expect(getMapProvider()).toBe("osm-raster");
        probe.mockClear();
        expect(reportMapProviderTileError(OSM_RASTER_TILE_A, 2_000)).toBeNull();
        await reportMapProviderTileError(OSM_RASTER_TILE_B, 2_001);
        expect(getMapProvider()).toBe("route-only");
        expect(probe).not.toHaveBeenCalled();
    });

    it("keeps export fallback independent of the viewer", async () => {
        const probe = vi.fn(async (_provider: MapProvider) => false);
        _resetForTests(probe);
        const overlay = createOverlayMapProviderSession();
        await overlay.reportTileError(OFM_TILEJSON);
        expect(overlay.getProvider()).toBe("route-only");
        expect(getMapProvider()).toBe("openfreemap");
        expect(probe.mock.calls.map(([provider]) => provider)).toEqual(["osm-vector", "osm-raster"]);
        overlay.dispose();
    });

    it("keeps explicit route-only and working online choices free of recovery probes", async () => {
        const probe = vi.fn(async (_provider: MapProvider) => true);
        _resetForTests(probe);
        expect(await retryMapProvider()).toBe(false);
        setMapProviderPreference("route-only");
        expect(await retryMapProvider()).toBe(false);
        expect(probe).not.toHaveBeenCalled();
        expect(getMapProvider()).toBe("route-only");
    });

    it("recovers selected Yandex through one fixed tile request with the configured key", async () => {
        const key = "portable-test&projection=wrong";
        vi.stubEnv("VITE_YANDEX_TILES_API_KEY", key);
        const fetcher = vi.fn(async (_url: string, _options: RequestInit) => new Response(null, { status: 503 }));
        vi.stubGlobal("fetch", fetcher);
        setMapProviderPreference("yandex");
        await reportMapProviderTileError({ ...YANDEX_TILE_A, status: 403 });
        expect(getMapProvider()).toBe("route-only");
        expect(fetcher.mock.calls.every(([url]) => new URL(url).hostname !== "tiles.api-maps.yandex.ru")).toBe(true);

        fetcher.mockClear();
        fetcher.mockImplementation(async () => new Response(null, { status: 200 }));
        expect(await retryMapProvider()).toBe(true);
        expect(getMapProvider()).toBe("yandex");
        expect(getMapProviderPreference()).toBe("yandex");
        expect(fetcher).toHaveBeenCalledOnce();
        const [rawUrl, options] = fetcher.mock.calls[0]!;
        const url = new URL(rawUrl);
        expect(url.origin).toBe("https://tiles.api-maps.yandex.ru");
        expect(url.pathname).toBe("/v1/tiles/");
        expect(Object.fromEntries(url.searchParams)).toEqual({
            x: "0",
            y: "0",
            z: "0",
            lang: "en_US",
            l: "map",
            scale: "2",
            projection: "web_mercator",
            apikey: key,
        });
        expect(options.cache).toBe("no-store");
        expect(options.signal).toBeInstanceOf(AbortSignal);
    });

    it.each([
        [true, "openfreemap", true],
        [false, "yandex", true],
        [true, "yandex", false],
    ] as const)(
        "avoids Yandex recovery requests with portable=%s, preference=%s, key=%s",
        async (portable, preference, hasKey) => {
            vi.stubGlobal("__PORTABLE__", portable);
            vi.stubEnv("VITE_YANDEX_TILES_API_KEY", "portable-test");
            const fetcher = vi.fn(async (_url: string, _options: RequestInit) => new Response(null, { status: 503 }));
            vi.stubGlobal("fetch", fetcher);
            setMapProviderPreference(preference);
            forceMapProvider("route-only");
            if (!hasKey) vi.stubEnv("VITE_YANDEX_TILES_API_KEY", "");
            expect(await retryMapProvider()).toBe(false);
            expect(getMapProvider()).toBe("route-only");
            expect(fetcher).toHaveBeenCalledTimes(3);
            expect(fetcher.mock.calls.map(([url]) => new URL(url).hostname)).toEqual([
                "tiles.openfreemap.org",
                "vector.openstreetmap.org",
                "tile.openstreetmap.org",
            ]);
            for (const [, options] of fetcher.mock.calls) {
                expect(options.cache, "cached tiles must not trigger a false recovery").toBe("no-store");
            }
        },
    );

    it.each(["openfreemap", "osm-vector", "osm-raster"] as const)(
        "recovers the local fallback to available %s without changing the preference",
        async (availableProvider) => {
            const probe = vi.fn(async (_provider: MapProvider) => false);
            _resetForTests(probe);
            await reportMapProviderTileError(OFM_TILEJSON);
            probe.mockClear();
            probe.mockImplementation(async (provider) => provider === availableProvider);
            expect(await retryMapProvider()).toBe(true);
            expect(getMapProvider()).toBe(availableProvider);
            expect(getMapProviderPreference()).toBe("openfreemap");
            const order: MapProvider[] = ["openfreemap", "osm-vector", "osm-raster"];
            expect(probe.mock.calls.map(([provider]) => provider)).toEqual(
                order.slice(0, order.indexOf(availableProvider) + 1),
            );
        },
    );

    it("preserves the local style without notifications when recovery probes fail", async () => {
        const probe = vi.fn(async (_provider: MapProvider) => false);
        _resetForTests(probe);
        await reportMapProviderTileError(OFM_TILEJSON);
        probe.mockClear();
        const listener = vi.fn();
        subscribeMapProvider(listener);
        listener.mockClear();
        expect(await retryMapProvider()).toBe(false);
        expect(await retryMapProvider()).toBe(false);
        expect(getMapProvider()).toBe("route-only");
        expect(listener).not.toHaveBeenCalled();
        expect(probe.mock.calls.map(([provider]) => provider)).toEqual([
            "openfreemap",
            "osm-vector",
            "osm-raster",
            "openfreemap",
            "osm-vector",
            "osm-raster",
        ]);
    });

    it.each(["<html>upstream unavailable</html>", "null", "{}", '{"tiles":[]}', '{"tiles":[""]}'])(
        "keeps the local route when the bootstrap probe returns invalid data %s",
        async (body) => {
            const fetcher = vi.fn(async (url: string) =>
                url === OFM_TILEJSON.url ? new Response(body) : new Response(null, { status: 503 }),
            );
            vi.stubGlobal("fetch", fetcher);
            await reportMapProviderTileError(OFM_TILEJSON);
            expect(getMapProvider()).toBe("route-only");
            const listener = vi.fn();
            subscribeMapProvider(listener);
            listener.mockClear();

            expect(await retryMapProvider()).toBe(false);
            expect(getMapProvider()).toBe("route-only");
            expect(listener).not.toHaveBeenCalled();
        },
    );

    it("recovers only after a bootstrap response contains tile endpoints", async () => {
        const fetcher = vi.fn(async (_url: string) => new Response(null, { status: 503 }));
        vi.stubGlobal("fetch", fetcher);
        await reportMapProviderTileError(OFM_TILEJSON);
        fetcher.mockImplementation(async () =>
            Response.json({ tilejson: "3.0.0", tiles: ["https://tiles.openfreemap.org/planet/{z}/{x}/{y}.pbf"] }),
        );

        expect(await retryMapProvider()).toBe(true);
        expect(getMapProvider()).toBe("openfreemap");
        expect(getMapProviderPreference()).toBe("openfreemap");
    });

    it("shares concurrent recovery and resumes from the saved provider order", async () => {
        const probe = vi.fn(async (_provider: MapProvider) => false);
        _resetForTests(probe);
        setMapProviderPreference("osm-vector");
        reportMapProviderTileError(OSM_VECTOR_TILE_A, 1_000);
        await reportMapProviderTileError(OSM_VECTOR_TILE_B, 1_001);
        let finishProbe: ((available: boolean) => void) | undefined;
        probe.mockClear();
        probe.mockImplementation(
            () =>
                new Promise<boolean>((resolve) => {
                    finishProbe = resolve;
                }),
        );
        const first = retryMapProvider();
        const second = retryMapProvider();
        expect(first).toBe(second);
        expect(probe.mock.calls.map(([provider]) => provider)).toEqual(["osm-vector"]);
        finishProbe?.(true);
        expect(await first).toBe(true);
        expect(getMapProvider()).toBe("osm-vector");
    });

    it.each(["route-only", "osm-vector"] as const)("does not let late recovery undo a %s selection", async (choice) => {
        const probe = vi.fn(async (_provider: MapProvider) => false);
        _resetForTests(probe);
        await reportMapProviderTileError(OFM_TILEJSON);
        let finishProbe: ((available: boolean) => void) | undefined;
        probe.mockImplementation(
            () =>
                new Promise<boolean>((resolve) => {
                    finishProbe = resolve;
                }),
        );
        const recovery = retryMapProvider();
        setMapProviderPreference(choice);
        finishProbe?.(true);
        expect(await recovery).toBe(false);
        expect(getMapProvider()).toBe(choice);
        expect(getMapProviderPreference()).toBe(choice);
    });

    it("ignores recovery from a disposed viewer session", async () => {
        const probe = vi.fn(async (_provider: MapProvider) => false);
        _resetForTests(probe);
        await reportMapProviderTileError(OFM_TILEJSON);
        let finishProbe: ((available: boolean) => void) | undefined;
        probe.mockImplementation(
            () =>
                new Promise<boolean>((resolve) => {
                    finishProbe = resolve;
                }),
        );
        const listener = vi.fn();
        subscribeMapProvider(listener);
        listener.mockClear();
        const recovery = retryMapProvider();
        _resetForTests();
        finishProbe?.(true);
        expect(await recovery).toBe(false);
        expect(listener).not.toHaveBeenCalled();
        expect(getMapProvider()).toBe("openfreemap");
    });
});
