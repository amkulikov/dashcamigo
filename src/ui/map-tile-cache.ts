// One page-scoped raw-tile cache in front of every MapLibre instance. MapLibre's
// own tile caches are per Map, so the large map, mini-map and export snapshotter
// would otherwise fetch and decode the same URL independently. A custom protocol
// gives all three one request path while the browser HTTP cache remains the
// persistent second level across reloads.

import type { AddProtocolAction, RequestTransformFunction } from "maplibre-gl";

import { mapProviderForTileUrl } from "./map-provider.js";

const TILE_PROTOCOL = "dashcamigo-tile";
const TILE_PROTOCOL_PREFIX = `${TILE_PROTOCOL}://`;

// Raw response bytes only. MapLibre still owns its per-map decoded/GPU caches,
// so keep this bounded for video-heavy mobile sessions. This is large enough to
// retain a useful route corridor without adding another unbounded memory owner.
const SHARED_TILE_CACHE_MAX_BYTES = 64 * 1024 * 1024;

interface TilePayload {
    data: ArrayBuffer;
    cacheControl?: string | null;
    expires?: string | null;
    etag?: string;
}

interface PendingTile {
    controller: AbortController;
    promise: Promise<TilePayload>;
    consumers: number;
    isSettled: boolean;
}

type TileFetcher = (url: string, signal: AbortSignal) => Promise<TilePayload>;

export interface SharedTileCacheStats {
    entries: number;
    bytes: number;
    inflight: number;
    maxBytes: number;
}

interface SharedTileCache {
    load(url: string, signal: AbortSignal): Promise<TilePayload>;
    clear(): void;
    stats(): SharedTileCacheStats;
}

function abortError(reason: unknown): DOMException {
    if (reason instanceof DOMException && reason.name === "AbortError") return reason;
    return new DOMException(typeof reason === "string" ? reason : "aborted", "AbortError");
}

function tileRequestError(url: string, status: number, statusText: string, cause?: unknown): Error {
    const prefix = status > 0 ? `tile request failed (${status} ${statusText})` : "failed to fetch tile";
    const error = new Error(`${prefix}: ${url}`, cause === undefined ? undefined : { cause });
    return Object.assign(error, { status, statusText, url });
}

async function fetchTile(url: string, signal: AbortSignal): Promise<TilePayload> {
    try {
        const response = await fetch(url, { signal });
        if (!response.ok) throw tileRequestError(url, response.status, response.statusText);
        return {
            data: await response.arrayBuffer(),
            cacheControl: response.headers.get("cache-control"),
            expires: response.headers.get("expires"),
            etag: response.headers.get("etag") ?? undefined,
        };
    } catch (err) {
        if (signal.aborted) throw abortError(signal.reason);
        if (err instanceof Error && "url" in err) throw err;
        throw tileRequestError(url, 0, "", err);
    }
}

function clonePayload(payload: TilePayload): TilePayload {
    // Vector-tile buffers can be transferred into a MapLibre worker. Returning
    // the stored buffer itself would detach the shared cache entry on first use.
    return { ...payload, data: payload.data.slice(0) };
}

export function createSharedTileCache(maxBytes: number, fetcher: TileFetcher = fetchTile): SharedTileCache {
    const cached = new Map<string, TilePayload>();
    const pending = new Map<string, PendingTile>();
    let cachedBytes = 0;

    const touch = (url: string, payload: TilePayload): void => {
        cached.delete(url);
        cached.set(url, payload);
    };

    const store = (url: string, payload: TilePayload): void => {
        const size = payload.data.byteLength;
        if (size > maxBytes || maxBytes <= 0) return;

        const previous = cached.get(url);
        if (previous) cachedBytes -= previous.data.byteLength;
        touch(url, payload);
        cachedBytes += size;

        while (cachedBytes > maxBytes) {
            const oldest = cached.entries().next().value;
            if (!oldest) break;
            cached.delete(oldest[0]);
            cachedBytes -= oldest[1].data.byteLength;
        }
    };

    const start = (url: string): PendingTile => {
        const controller = new AbortController();
        const promise = fetcher(url, controller.signal).then((payload) => {
            if (!controller.signal.aborted) store(url, payload);
            return payload;
        });
        const entry: PendingTile = { controller, promise, consumers: 0, isSettled: false };
        pending.set(url, entry);
        void promise.then(
            () => {
                entry.isSettled = true;
                if (pending.get(url) === entry) pending.delete(url);
            },
            () => {
                entry.isSettled = true;
                if (pending.get(url) === entry) pending.delete(url);
            },
        );
        return entry;
    };

    return {
        async load(url, signal): Promise<TilePayload> {
            if (signal.aborted) throw abortError(signal.reason);

            const hit = cached.get(url);
            if (hit) {
                touch(url, hit);
                return clonePayload(hit);
            }

            const entry = pending.get(url) ?? start(url);
            entry.consumers++;
            let isActive = true;
            let onAbort: (() => void) | null = null;
            const aborted = new Promise<never>((_resolve, reject) => {
                onAbort = () => reject(abortError(signal.reason));
                signal.addEventListener("abort", onAbort, { once: true });
            });

            try {
                return clonePayload(await Promise.race([entry.promise, aborted]));
            } finally {
                if (onAbort) signal.removeEventListener("abort", onAbort);
                if (isActive) {
                    isActive = false;
                    entry.consumers--;
                    // A pan/zoom can abandon a tile while it is queued. Keep a
                    // shared fetch only while at least one map still needs it.
                    if (entry.consumers === 0 && !entry.isSettled) entry.controller.abort("unused");
                }
            }
        },
        clear(): void {
            for (const entry of pending.values()) entry.controller.abort("cache cleared");
            pending.clear();
            cached.clear();
            cachedBytes = 0;
        },
        stats(): SharedTileCacheStats {
            return {
                entries: cached.size,
                bytes: cachedBytes,
                inflight: pending.size,
                maxBytes,
            };
        },
    };
}

const sharedTileCache = createSharedTileCache(SHARED_TILE_CACHE_MAX_BYTES);

function unwrapTileUrl(protocolUrl: string): string {
    if (!protocolUrl.startsWith(TILE_PROTOCOL_PREFIX)) throw new Error("invalid shared tile URL");
    try {
        return decodeURIComponent(protocolUrl.slice(TILE_PROTOCOL_PREFIX.length));
    } catch (err) {
        throw new Error("invalid shared tile URL", { cause: err });
    }
}

const loadSharedTile: AddProtocolAction = async (request, abortController) => {
    return sharedTileCache.load(unwrapTileUrl(request.url), abortController.signal);
};

export const transformMapTileRequest = ((url: string, resourceType?: string) => {
    if (resourceType !== "Tile" || mapProviderForTileUrl(url) === null) return undefined;
    return { url: `${TILE_PROTOCOL_PREFIX}${encodeURIComponent(url)}` };
}) satisfies RequestTransformFunction;

export function registerSharedMapTileCache(addProtocol: (protocol: string, loader: AddProtocolAction) => void): void {
    addProtocol(TILE_PROTOCOL, loadSharedTile);
}

export function getSharedMapTileCacheStats(): SharedTileCacheStats {
    return sharedTileCache.stats();
}

/** Test-only reset for the module-level page-session cache. */
export function _resetForTests(): void {
    sharedTileCache.clear();
}
