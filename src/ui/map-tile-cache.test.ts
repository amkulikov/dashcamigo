import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AddProtocolAction } from "maplibre-gl";

import {
    _resetForTests,
    createSharedTileCache,
    getSharedMapTileCacheStats,
    registerSharedMapTileCache,
    transformMapTileRequest,
} from "./map-tile-cache.js";
import {
    _resetForTests as resetMapProvider,
    getMapProvider,
    MAP_PROVIDER_REQUEST_TIMEOUT_MS,
    reportMapProviderTileError,
} from "./map-provider.js";
import { isOffline, reportMapTileNetworkError, reportMapTilesOk } from "./connectivity.js";

function yandexTile(x: number): string {
    return `https://tiles.api-maps.yandex.ru/v1/tiles/?x=${x}&y=204&z=10&apikey=local-debug-key`;
}

function bytes(...values: number[]): ArrayBuffer {
    return new Uint8Array(values).buffer;
}

describe("shared map tile cache", () => {
    beforeEach(() => {
        _resetForTests();
        resetMapProvider();
        reportMapTilesOk();
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it("routes every known provider resource through the shared protocol", () => {
        const tile = "https://tile.openstreetmap.org/12/2200/1400.png";
        const transformed = transformMapTileRequest(tile, "Tile");

        expect(transformed?.url).toContain(encodeURIComponent(tile));
        expect(
            transformMapTileRequest("https://tiles.openfreemap.org/sprites/ofm/sprite.png", "SpriteImage")?.url,
        ).toContain(encodeURIComponent("https://tiles.openfreemap.org/sprites/ofm/sprite.png"));
        expect(transformMapTileRequest("https://example.com/12/2200/1400.png", "Tile")).toBeUndefined();
    });

    it("routes OpenFreeMap raster tiles and its TileJSON bootstrap", () => {
        const raster = "https://tiles.openfreemap.org/natural_earth/ne2sr/2/1/1.png";
        const tileJson = "https://tiles.openfreemap.org/planet";

        expect(transformMapTileRequest(raster, "Tile")?.url).toContain(encodeURIComponent(raster));
        expect(transformMapTileRequest(tileJson, "Source")?.url).toContain(encodeURIComponent(tileJson));
    });

    it("shares one in-flight fetch and returns independent transferable buffers", async () => {
        let resolveFetch!: (value: { data: ArrayBuffer }) => void;
        const fetcher = vi.fn(
            () =>
                new Promise<{ data: ArrayBuffer }>((resolve) => {
                    resolveFetch = resolve;
                }),
        );
        const cache = createSharedTileCache(1024, fetcher);
        const first = cache.load("tile-a", new AbortController().signal);
        const second = cache.load("tile-a", new AbortController().signal);

        expect(fetcher).toHaveBeenCalledTimes(1);
        resolveFetch({ data: bytes(1, 2, 3) });
        const [a, b] = await Promise.all([first, second]);

        expect([...new Uint8Array(a.data)]).toEqual([1, 2, 3]);
        expect([...new Uint8Array(b.data)]).toEqual([1, 2, 3]);
        expect(a.data).not.toBe(b.data);
        expect(cache.stats()).toMatchObject({ entries: 1, bytes: 3, inflight: 0 });
    });

    it("serves later requests from the shared LRU", async () => {
        const fetcher = vi.fn(async () => ({ data: bytes(4, 5) }));
        const cache = createSharedTileCache(1024, fetcher);

        await cache.load("tile-a", new AbortController().signal);
        const hit = await cache.load("tile-a", new AbortController().signal);

        expect(fetcher).toHaveBeenCalledTimes(1);
        expect([...new Uint8Array(hit.data)]).toEqual([4, 5]);
    });

    it("evicts least-recently-used bytes at the shared budget", async () => {
        const fetcher = vi.fn(async (url: string) => ({
            data: url === "tile-a" ? bytes(1, 1) : url === "tile-b" ? bytes(2, 2) : bytes(3, 3),
        }));
        const cache = createSharedTileCache(4, fetcher);

        await cache.load("tile-a", new AbortController().signal);
        await cache.load("tile-b", new AbortController().signal);
        await cache.load("tile-a", new AbortController().signal); // tile-b is now oldest
        await cache.load("tile-c", new AbortController().signal);
        await cache.load("tile-b", new AbortController().signal);

        expect(fetcher.mock.calls.map(([url]) => url)).toEqual(["tile-a", "tile-b", "tile-c", "tile-b"]);
        expect(cache.stats().bytes).toBe(4);
    });

    it("keeps a shared fetch alive while another map still needs it", async () => {
        let resolveFetch!: (value: { data: ArrayBuffer }) => void;
        const fetcher = vi.fn(
            (_url: string, signal: AbortSignal) =>
                new Promise<{ data: ArrayBuffer }>((resolve, reject) => {
                    resolveFetch = resolve;
                    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
                }),
        );
        const cache = createSharedTileCache(1024, fetcher);
        const firstController = new AbortController();
        const secondController = new AbortController();
        const first = cache.load("tile-a", firstController.signal);
        const second = cache.load("tile-a", secondController.signal);

        firstController.abort("first map moved");
        await expect(first).rejects.toMatchObject({ name: "AbortError" });
        expect(fetcher.mock.calls[0]?.[1].aborted).toBe(false);

        resolveFetch({ data: bytes(9) });
        await expect(second).resolves.toMatchObject({ data: expect.any(ArrayBuffer) });
        expect(fetcher).toHaveBeenCalledTimes(1);
    });

    it("aborts the network request after its last consumer leaves", async () => {
        const fetcher = vi.fn(
            (_url: string, signal: AbortSignal) =>
                new Promise<{ data: ArrayBuffer }>((_resolve, reject) => {
                    signal.addEventListener("abort", () => reject(new DOMException("unused", "AbortError")), {
                        once: true,
                    });
                }),
        );
        const cache = createSharedTileCache(1024, fetcher);
        const controller = new AbortController();
        const request = cache.load("tile-a", controller.signal);

        controller.abort("map moved");

        await expect(request).rejects.toMatchObject({ name: "AbortError" });
        expect(fetcher.mock.calls[0]?.[1].aborted).toBe(true);
    });

    it("starts a fresh request when an abandoned fetch has not settled yet", async () => {
        let finishAbandoned!: (payload: { data: ArrayBuffer }) => void;
        const fetcher = vi.fn(() => {
            if (fetcher.mock.calls.length === 1) {
                return new Promise<{ data: ArrayBuffer }>((resolve) => {
                    finishAbandoned = resolve;
                });
            }
            return Promise.resolve({ data: bytes(2) });
        });
        const cache = createSharedTileCache(1024, fetcher);
        const controller = new AbortController();
        const first = cache.load("tile-a", controller.signal);
        controller.abort("map moved");
        await expect(first).rejects.toMatchObject({ name: "AbortError" });

        const replacement = await cache.load("tile-a", new AbortController().signal);

        expect(fetcher).toHaveBeenCalledTimes(2);
        expect([...new Uint8Array(replacement.data)]).toEqual([2]);
        finishAbandoned({ data: bytes(1) });
        const cached = await cache.load("tile-a", new AbortController().signal);
        expect([...new Uint8Array(cached.data)]).toEqual([2]);
    });

    it("reports network failures from every map and clears them on a fetched resource", async () => {
        const fetcher = vi
            .fn()
            .mockRejectedValueOnce(new TypeError("failed to fetch"))
            .mockResolvedValueOnce(new Response(bytes(3)));
        vi.stubGlobal("fetch", fetcher);
        const cache = createSharedTileCache(1024);
        const tile = "https://tiles.openfreemap.org/planet/build/10/1/2.pbf";

        await expect(cache.load(tile, new AbortController().signal)).rejects.toMatchObject({ status: 0 });
        expect(isOffline()).toBe(true);
        await cache.load(tile, new AbortController().signal);
        expect(isOffline()).toBe(false);
    });

    it("does not treat a memory cache hit as network recovery", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => new Response(bytes(3))),
        );
        const cache = createSharedTileCache(1024);
        const tile = "https://tiles.openfreemap.org/planet/build/10/1/2.pbf";
        await cache.load(tile, new AbortController().signal);
        reportMapTileNetworkError();

        await cache.load(tile, new AbortController().signal);

        expect(isOffline()).toBe(true);
    });

    it("keeps connectivity online for missing tiles and cancelled requests", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => new Response(null, { status: 404 })),
        );
        const cache = createSharedTileCache(1024);
        const tile = "https://tiles.openfreemap.org/planet/build/10/1/2.pbf";
        await expect(cache.load(tile, new AbortController().signal)).rejects.toMatchObject({ status: 404 });
        const controller = new AbortController();
        controller.abort();
        await expect(cache.load(tile, controller.signal)).rejects.toMatchObject({ name: "AbortError" });

        expect(isOffline()).toBe(false);
    });

    it.each([408, 429, 500, 502, 503, 504])(
        "keeps recovery active after HTTP %s when fallback is unavailable",
        async (status) => {
            resetMapProvider(async () => false);
            const fetcher = vi
                .fn()
                .mockResolvedValueOnce(new Response(null, { status }))
                .mockResolvedValueOnce(new Response(JSON.stringify({ tiles: [] })));
            vi.stubGlobal("fetch", fetcher);
            const cache = createSharedTileCache(1024);
            const source = "https://tiles.openfreemap.org/planet";
            const failure = await cache
                .load(source, new AbortController().signal, "json")
                .catch((error: unknown) => error);
            expect(failure).toMatchObject({ status, url: source });

            await reportMapProviderTileError(failure);

            expect(getMapProvider()).toBe("openfreemap");
            expect(isOffline(), "resource recovery must keep retrying without another browser online event").toBe(true);
            await cache.load(source, new AbortController().signal, "json");
            expect(isOffline()).toBe(false);
            expect(fetcher).toHaveBeenCalledTimes(2);
        },
    );

    it("registers a protocol handler that unwraps the original tile URL", async () => {
        let loader: AddProtocolAction = async () => ({ data: new ArrayBuffer(0) });
        registerSharedMapTileCache((_protocol, registered) => {
            loader = registered;
        });
        const tile = "https://tile.openstreetmap.org/0/0/0.png";
        const transformed = transformMapTileRequest(tile, "Tile");

        expect(transformed).toBeDefined();
        // Abort before the loader reaches fetch: this exercises URL decoding
        // without allowing a unit test to touch the network.
        const controller = new AbortController();
        controller.abort("test");
        await expect(loader({ url: transformed?.url ?? "" }, controller)).rejects.toMatchObject({
            name: "AbortError",
        });
    });

    it("decodes JSON provider resources for MapLibre", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => new Response(JSON.stringify({ tiles: ["https://example.test/{z}/{x}/{y}.pbf"] }))),
        );
        let loader: AddProtocolAction = async () => ({ data: {} });
        registerSharedMapTileCache((_protocol, registered) => {
            loader = registered;
        });
        const source = "https://tiles.openfreemap.org/planet";
        const transformed = transformMapTileRequest(source, "Source");

        const response = await loader({ url: transformed?.url ?? "", type: "json" }, new AbortController());

        expect(response.data).toEqual({ tiles: ["https://example.test/{z}/{x}/{y}.pbf"] });
    });

    it.each([
        { body: "<html>upstream error</html>", error: SyntaxError },
        { body: "null", error: TypeError },
        { body: "false", error: TypeError },
        { body: "42", error: TypeError },
        { body: '"upstream error"', error: TypeError },
    ])("rejects $body without caching it or reporting recovery", async ({ body, error }) => {
        const fetcher = vi
            .fn()
            .mockResolvedValueOnce(new Response(body))
            .mockResolvedValueOnce(new Response(JSON.stringify({ tiles: ["https://example.test/{z}/{x}/{y}.pbf"] })));
        vi.stubGlobal("fetch", fetcher);
        const probe = vi.fn(async () => false);
        resetMapProvider(probe);
        let loader: AddProtocolAction = async () => ({ data: {} });
        registerSharedMapTileCache((_protocol, registered) => {
            loader = registered;
        });
        const source = "https://tiles.openfreemap.org/planet";
        const request = { url: transformMapTileRequest(source, "Source")?.url ?? "", type: "json" as const };

        const failure = await loader(request, new AbortController()).catch((error: unknown) => error);

        expect(failure).toMatchObject({ status: 0, url: source, cause: expect.any(error) });
        expect(getSharedMapTileCacheStats()).toMatchObject({ entries: 0, bytes: 0 });
        expect(isOffline()).toBe(true);
        await reportMapProviderTileError(failure);
        expect(probe).toHaveBeenNthCalledWith(1, "osm-vector");
        expect(probe).toHaveBeenNthCalledWith(2, "osm-raster");

        const response = await loader(request, new AbortController());

        expect(response.data).toEqual({ tiles: ["https://example.test/{z}/{x}/{y}.pbf"] });
        expect(fetcher).toHaveBeenCalledTimes(2);
        expect(isOffline()).toBe(false);
    });

    it("times out a provider request instead of waiting for the browser", async () => {
        vi.useFakeTimers();
        vi.stubGlobal(
            "fetch",
            vi.fn(
                (_url: string, init?: RequestInit) =>
                    new Promise<Response>((_resolve, reject) => {
                        init?.signal?.addEventListener(
                            "abort",
                            () => reject(new DOMException("timed out", "AbortError")),
                            { once: true },
                        );
                    }),
            ),
        );
        let loader: AddProtocolAction = async () => ({ data: {} });
        registerSharedMapTileCache((_protocol, registered) => {
            loader = registered;
        });
        const source = "https://tiles.openfreemap.org/planet";
        const transformed = transformMapTileRequest(source, "Source");
        const request = loader({ url: transformed?.url ?? "", type: "json" }, new AbortController());
        const rejection = expect(request).rejects.toMatchObject({ status: 0, statusText: "timeout", url: source });

        await vi.advanceTimersByTimeAsync(MAP_PROVIDER_REQUEST_TIMEOUT_MS);

        await rejection;
    });

    it("paces Yandex starts across independent map caches below thirty requests per second", async () => {
        vi.useFakeTimers();
        vi.setSystemTime(0);
        const startedAt: number[] = [];
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => {
                startedAt.push(Date.now());
                return new Response(bytes(1));
            }),
        );
        const firstCache = createSharedTileCache(0);
        const secondCache = createSharedTileCache(0);
        const requests = Array.from({ length: 60 }, (_, index) =>
            (index % 2 ? firstCache : secondCache).load(yandexTile(index), new AbortController().signal),
        );
        await vi.advanceTimersByTimeAsync(999);
        expect(startedAt.length).toBeGreaterThan(0);
        expect(startedAt.length).toBeLessThan(30);
        await vi.advanceTimersByTimeAsync(4_000);
        await Promise.all(requests);
        expect(startedAt).toHaveLength(60);
        for (const start of startedAt) {
            expect(startedAt.filter((time) => time >= start && time < start + 1000).length).toBeLessThan(30);
        }
        expect(vi.getTimerCount()).toBe(0);
    });

    it("keeps Yandex admission moving when the system clock moves backward", async () => {
        vi.useFakeTimers();
        vi.setSystemTime(0);
        const fetcher = vi.fn(async () => new Response(bytes(1)));
        vi.stubGlobal("fetch", fetcher);
        const cache = createSharedTileCache(0);
        await cache.load(yandexTile(1), new AbortController().signal);
        vi.setSystemTime(-60_000);
        const next = cache.load(yandexTile(2), new AbortController().signal);
        await vi.advanceTimersByTimeAsync(40);
        await next;
        expect(fetcher).toHaveBeenCalledTimes(2);
        expect(vi.getTimerCount()).toBe(0);
    });

    it("removes abandoned queued Yandex requests without reserving their slots", async () => {
        vi.useFakeTimers();
        vi.setSystemTime(0);
        const started: { url: string; time: number }[] = [];
        vi.stubGlobal(
            "fetch",
            vi.fn(async (url: string) => {
                started.push({ url, time: Date.now() });
                return new Response(bytes(1));
            }),
        );
        const cache = createSharedTileCache(0);
        await cache.load(yandexTile(1), new AbortController().signal);
        const canceledController = new AbortController();
        const canceled = cache.load(yandexTile(2), canceledController.signal);
        const cancellation = expect(canceled).rejects.toMatchObject({ name: "AbortError" });
        const next = cache.load(yandexTile(3), new AbortController().signal);
        canceledController.abort("map moved");
        await cancellation;
        await vi.advanceTimersByTimeAsync(40);
        await next;
        expect(started).toEqual([
            { url: yandexTile(1), time: 0 },
            { url: yandexTile(3), time: 40 },
        ]);
        expect(vi.getTimerCount()).toBe(0);

        const finalController = new AbortController();
        const final = cache.load(yandexTile(4), finalController.signal);
        const finalCancellation = expect(final).rejects.toMatchObject({ name: "AbortError" });
        finalController.abort("map moved");
        await finalCancellation;
        expect(vi.getTimerCount()).toBe(0);
    });

    it("starts the Yandex network deadline after a long queue wait", async () => {
        vi.useFakeTimers();
        vi.setSystemTime(0);
        let lastSignal: AbortSignal | null | undefined;
        const fetcher = vi.fn((url: string, init?: RequestInit) => {
            if (url !== yandexTile(99)) return Promise.resolve(new Response(bytes(1)));
            lastSignal = init?.signal;
            return new Promise<Response>((_resolve, reject) => {
                init?.signal?.addEventListener("abort", () => reject(new DOMException("timeout", "AbortError")), {
                    once: true,
                });
            });
        });
        vi.stubGlobal("fetch", fetcher);
        const cache = createSharedTileCache(0);
        const requests = Array.from({ length: 99 }, (_, index) =>
            cache.load(yandexTile(index), new AbortController().signal),
        );
        const last = cache.load(yandexTile(99), new AbortController().signal);
        const failure = expect(last).rejects.toMatchObject({ statusText: "timeout" });
        await vi.advanceTimersByTimeAsync(3_960);
        await Promise.all(requests);
        expect(fetcher).toHaveBeenCalledTimes(100);
        expect(lastSignal?.aborted).toBe(false);
        await vi.advanceTimersByTimeAsync(MAP_PROVIDER_REQUEST_TIMEOUT_MS - 1);
        expect(lastSignal?.aborted).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        await failure;
        expect(vi.getTimerCount()).toBe(0);
    });

    it("deduplicates Yandex requests before taking a queue slot", async () => {
        vi.useFakeTimers();
        vi.setSystemTime(0);
        const fetcher = vi.fn(async () => new Response(bytes(1)));
        vi.stubGlobal("fetch", fetcher);
        const cache = createSharedTileCache(0);
        const first = cache.load(yandexTile(1), new AbortController().signal);
        const second = cache.load(yandexTile(1), new AbortController().signal);
        await Promise.all([first, second]);
        expect(fetcher).toHaveBeenCalledOnce();
        expect(vi.getTimerCount()).toBe(0);
    });

    it.each(["no-store", "no-cache", "max-age=0"])("does not retain a %s response", async (cacheControl) => {
        const fetcher = vi.fn(async () => ({ data: bytes(1), cacheControl }));
        const cache = createSharedTileCache(1024, fetcher);
        await cache.load("tile-a", new AbortController().signal);
        await cache.load("tile-a", new AbortController().signal);
        expect(fetcher).toHaveBeenCalledTimes(2);
        expect(cache.stats()).toMatchObject({ entries: 0, bytes: 0 });
    });

    it("expires cached bytes at their response freshness deadline", async () => {
        vi.useFakeTimers();
        const fetcher = vi.fn(async () => ({ data: bytes(1), cacheControl: "public, max-age=2" }));
        const cache = createSharedTileCache(1024, fetcher);
        await cache.load("tile-a", new AbortController().signal);
        await vi.advanceTimersByTimeAsync(1_999);
        await cache.load("tile-a", new AbortController().signal);
        expect(fetcher).toHaveBeenCalledOnce();
        await vi.advanceTimersByTimeAsync(1);
        expect(cache.stats()).toMatchObject({ entries: 0, bytes: 0 });
        await cache.load("tile-a", new AbortController().signal);
        expect(fetcher).toHaveBeenCalledTimes(2);
        cache.clear();
        expect(vi.getTimerCount()).toBe(0);
    });

    it("uses Expires when a response has no max-age", async () => {
        vi.useFakeTimers();
        vi.setSystemTime(0);
        const fetcher = vi.fn(async () => ({ data: bytes(1), expires: new Date(2000).toUTCString() }));
        const cache = createSharedTileCache(1024, fetcher);
        await cache.load("tile-a", new AbortController().signal);
        await vi.advanceTimersByTimeAsync(2000);
        expect(cache.stats()).toMatchObject({ entries: 0, bytes: 0 });
        expect(vi.getTimerCount()).toBe(0);
    });

    it("keeps MapLibre's expiry fixed when cached tiles are reused by another map", async () => {
        vi.useFakeTimers();
        vi.setSystemTime(0);
        const fetcher = vi.fn(async () => ({ data: bytes(1), cacheControl: "max-age=999999999" }));
        const cache = createSharedTileCache(1024, fetcher);
        const first = await cache.load("tile-a", new AbortController().signal);
        await vi.advanceTimersByTimeAsync(20 * 24 * 60 * 60 * 1000);
        const reused = await cache.load("tile-a", new AbortController().signal);
        expect(fetcher).toHaveBeenCalledOnce();
        expect(first.cacheControl).toBeNull();
        expect(reused.cacheControl).toBeNull();
        expect(Date.parse(first.expires!)).toBe(30 * 24 * 60 * 60 * 1000);
        expect(reused.expires).toBe(first.expires);
        cache.clear();
    });

    it("accounts for the upstream response age before caching it", async () => {
        vi.useFakeTimers();
        vi.setSystemTime(0);
        const fetcher = vi.fn(async () => ({ data: bytes(1), cacheControl: "max-age=30", age: "29" }));
        const cache = createSharedTileCache(1024, fetcher);
        const response = await cache.load("tile-a", new AbortController().signal);
        expect(Date.parse(response.expires!)).toBe(1000);
        await vi.advanceTimersByTimeAsync(1000);
        expect(cache.stats()).toMatchObject({ entries: 0, bytes: 0 });
        expect(vi.getTimerCount()).toBe(0);
    });

    it("removes cached bytes after thirty days on a long-lived page", async () => {
        vi.useFakeTimers();
        vi.setSystemTime(0);
        const fetcher = vi.fn(async () => ({ data: bytes(1), cacheControl: "max-age=999999999" }));
        const cache = createSharedTileCache(1024, fetcher);
        await cache.load("tile-a", new AbortController().signal);
        await vi.advanceTimersByTimeAsync(30 * 24 * 60 * 60 * 1000);
        expect(cache.stats()).toMatchObject({ entries: 0, bytes: 0 });
        expect(vi.getTimerCount()).toBe(0);
    });

    it("keeps Yandex credentials and tile coordinates out of error diagnostics", async () => {
        const url = yandexTile(12345);
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => {
                throw new TypeError(`fetch failed: ${url}`);
            }),
        );
        const cache = createSharedTileCache(0);
        const error = await cache.load(url, new AbortController().signal).catch((cause: unknown) => cause);
        if (!(error instanceof Error)) throw new Error("missing fetch error");
        expect(error.message).toContain("https://tiles.api-maps.yandex.ru/v1/tiles/");
        expect(error.message).not.toContain("apikey");
        expect(error.message).not.toContain("12345");
        expect(error.cause).toBeUndefined();
        expect(error.stack).not.toContain("local-debug-key");
        expect(JSON.stringify(error)).not.toContain("local-debug-key");
        expect(error).toMatchObject({ url, status: 0 });
    });
});
