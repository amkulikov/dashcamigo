// One page-scoped raw-resource cache in front of every MapLibre instance.
// MapLibre's own caches are per Map, so the large map, mini-map and export
// snapshotter would otherwise fetch the same URL independently. The custom
// protocol also gives every provider request a real deadline: blocked hosts
// often leave browser fetch pending for tens of seconds instead of rejecting.

import type { AddProtocolAction, RequestParameters, RequestTransformFunction } from "maplibre-gl";

import { reportMapTileNetworkError, reportMapTilesOk } from "./connectivity.js";
import { getMapProvider, MAP_PROVIDER_REQUEST_TIMEOUT_MS, mapProviderForTileUrl } from "./map-provider.js";

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

type TileFetcher = (url: string, signal: AbortSignal, type?: RequestParameters["type"]) => Promise<TilePayload>;

export interface SharedTileCacheStats {
    entries: number;
    bytes: number;
    inflight: number;
    maxBytes: number;
}

interface SharedTileCache {
    load(url: string, signal: AbortSignal, type?: RequestParameters["type"]): Promise<TilePayload>;
    clear(): void;
    stats(): SharedTileCacheStats;
}

function abortError(reason: unknown): DOMException {
    if (reason instanceof DOMException && reason.name === "AbortError") return reason;
    return new DOMException(typeof reason === "string" ? reason : "aborted", "AbortError");
}

function tileRequestError(url: string, status: number, statusText: string, cause?: unknown): Error {
    const prefix =
        status > 0
            ? `map request failed (${status} ${statusText})`
            : statusText
              ? `map request failed (${statusText})`
              : "failed to fetch map resource";
    const error = new Error(`${prefix}: ${url}`, cause === undefined ? undefined : { cause });
    return Object.assign(error, { status, statusText, url });
}

async function fetchTile(url: string, signal: AbortSignal, type?: RequestParameters["type"]): Promise<TilePayload> {
    const requestController = new AbortController();
    const forwardAbort = () => requestController.abort(signal.reason);
    signal.addEventListener("abort", forwardAbort, { once: true });
    const timeoutId = setTimeout(() => requestController.abort("timeout"), MAP_PROVIDER_REQUEST_TIMEOUT_MS);
    try {
        const response = await fetch(url, { signal: requestController.signal });
        if (!response.ok) throw tileRequestError(url, response.status, response.statusText);
        const payload = {
            data: await response.arrayBuffer(),
            cacheControl: response.headers.get("cache-control"),
            expires: response.headers.get("expires"),
            etag: response.headers.get("etag") ?? undefined,
        };
        // A successful HTTP response can still contain an upstream error page.
        // Reject it before it enters the shared cache or signals recovery.
        if (type === "json") JSON.parse(new TextDecoder().decode(payload.data));
        // Local GeoJSON and memory-cache hits cannot prove network recovery.
        if (mapProviderForTileUrl(url) === getMapProvider()) reportMapTilesOk();
        return payload;
    } catch (err) {
        if (signal.aborted) throw abortError(signal.reason);
        const status = err instanceof Error && "status" in err && typeof err.status === "number" ? err.status : 0;
        const shouldRetry = status === 0 || status === 408 || status === 429 || status >= 500;
        if (shouldRetry && mapProviderForTileUrl(url) === getMapProvider()) reportMapTileNetworkError();
        if (requestController.signal.aborted && requestController.signal.reason === "timeout") {
            throw tileRequestError(url, 0, "timeout", err);
        }
        if (err instanceof Error && "url" in err) throw err;
        throw tileRequestError(url, 0, "", err);
    } finally {
        clearTimeout(timeoutId);
        signal.removeEventListener("abort", forwardAbort);
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

    const start = (url: string, type?: RequestParameters["type"]): PendingTile => {
        const controller = new AbortController();
        const promise = fetcher(url, controller.signal, type).then((payload) => {
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
        async load(url, signal, type): Promise<TilePayload> {
            if (signal.aborted) throw abortError(signal.reason);

            const hit = cached.get(url);
            if (hit) {
                touch(url, hit);
                return clonePayload(hit);
            }

            const existing = pending.get(url);
            const entry = existing && !existing.controller.signal.aborted ? existing : start(url, type);
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
                    if (entry.consumers === 0 && !entry.isSettled) {
                        if (pending.get(url) === entry) pending.delete(url);
                        entry.controller.abort("unused");
                    }
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
    const payload = await sharedTileCache.load(unwrapTileUrl(request.url), abortController.signal, request.type);
    let data: unknown = payload.data;
    if (request.type === "json") data = JSON.parse(new TextDecoder().decode(payload.data));
    else if (request.type === "string") data = new TextDecoder().decode(payload.data);
    return { ...payload, data };
};

export const transformMapTileRequest = ((url: string, _resourceType?: string) => {
    if (mapProviderForTileUrl(url) === null) return undefined;
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
