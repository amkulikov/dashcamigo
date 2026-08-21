import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AddProtocolAction } from "maplibre-gl";

import {
    _resetForTests,
    createSharedTileCache,
    registerSharedMapTileCache,
    transformMapTileRequest,
} from "./map-tile-cache.js";
import { MAP_PROVIDER_REQUEST_TIMEOUT_MS } from "./map-provider.js";

function bytes(...values: number[]): ArrayBuffer {
    return new Uint8Array(values).buffer;
}

describe("shared map tile cache", () => {
    beforeEach(() => {
        _resetForTests();
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
});
