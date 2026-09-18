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
const SHARED_TILE_CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
// This pace applies to one page; other visitors share the API key's allowance.
const YANDEX_REQUEST_INTERVAL_MS = 40;

interface QueuedYandexRequest {
    signal: AbortSignal;
    resolve(): void;
    reject(error: DOMException): void;
    onAbort(): void;
}

const yandexQueue: QueuedYandexRequest[] = [];
let yandexQueueTimer: ReturnType<typeof setTimeout> | null = null;
let nextYandexRequestAt = 0;

function pumpYandexQueue(): void {
    if (yandexQueueTimer !== null) {
        clearTimeout(yandexQueueTimer);
        yandexQueueTimer = null;
    }
    if (yandexQueue.length === 0) return;
    const delay = nextYandexRequestAt - performance.now();
    if (delay > 0) {
        yandexQueueTimer = setTimeout(pumpYandexQueue, delay);
        return;
    }
    const request = yandexQueue.shift()!;
    request.signal.removeEventListener("abort", request.onAbort);
    nextYandexRequestAt = performance.now() + YANDEX_REQUEST_INTERVAL_MS;
    request.resolve();
    if (yandexQueue.length > 0) yandexQueueTimer = setTimeout(pumpYandexQueue, YANDEX_REQUEST_INTERVAL_MS);
}

function waitForYandexRequest(signal: AbortSignal): Promise<void> {
    if (signal.aborted) return Promise.reject(abortError(signal.reason));
    return new Promise<void>((resolve, reject) => {
        const request: QueuedYandexRequest = {
            signal,
            resolve,
            reject,
            onAbort(): void {
                const index = yandexQueue.indexOf(request);
                if (index >= 0) yandexQueue.splice(index, 1);
                signal.removeEventListener("abort", request.onAbort);
                reject(abortError(signal.reason));
                pumpYandexQueue();
            },
        };
        yandexQueue.push(request);
        signal.addEventListener("abort", request.onAbort, { once: true });
        pumpYandexQueue();
    });
}

interface TilePayload {
    data: ArrayBuffer;
    cacheControl?: string | null;
    expires?: string | null;
    age?: string | null;
    etag?: string;
}

interface CachedTile {
    payload: TilePayload;
    expiresAt: number;
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
    const isYandex = mapProviderForTileUrl(url) === "yandex";
    const diagnosticUrl = isYandex ? "https://tiles.api-maps.yandex.ru/v1/tiles/" : url;
    // Fetch errors can repeat the full URL in their cause. Keep API keys and
    // tile coordinates out of the logger, including nested Error serialization.
    const error = new Error(`${prefix}: ${diagnosticUrl}`, isYandex || cause === undefined ? undefined : { cause });
    Object.assign(error, { status, statusText });
    // Fallback still needs distinct tile URLs; ordinary object serialization does not.
    Object.defineProperty(error, "url", { value: url, enumerable: !isYandex });
    return error;
}

async function fetchTile(url: string, signal: AbortSignal, type?: RequestParameters["type"]): Promise<TilePayload> {
    if (mapProviderForTileUrl(url) === "yandex") await waitForYandexRequest(signal);
    if (signal.aborted) throw abortError(signal.reason);
    // Queueing is not a network failure: start the deadline only after admission.
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
            age: response.headers.get("age"),
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

function cacheExpiresAt(payload: TilePayload, now: number): number {
    const directives = (payload.cacheControl ?? "").split(",").map((part) => part.trim());
    if (directives.some((part) => /^(?:no-store|no-cache)(?:=|$)/i.test(part))) return now;
    const maxAge = directives.map((part) => part.match(/^max-age\s*=\s*"?(\d+)"?$/i)).find((match) => match !== null);
    const responseAge = Math.max(0, Number(payload.age) || 0);
    const declaredExpiry = maxAge ? now + (Number(maxAge[1]) - responseAge) * 1000 : Date.parse(payload.expires ?? "");
    const ceiling = now + SHARED_TILE_CACHE_MAX_AGE_MS;
    return Number.isFinite(declaredExpiry) ? Math.min(ceiling, declaredExpiry) : ceiling;
}

export function createSharedTileCache(maxBytes: number, fetcher: TileFetcher = fetchTile): SharedTileCache {
    const cached = new Map<string, CachedTile>();
    const pending = new Map<string, PendingTile>();
    let cachedBytes = 0;

    let expiryTimer: ReturnType<typeof setTimeout> | null = null;
    let scheduledExpiryAt = Number.POSITIVE_INFINITY;

    const remove = (url: string, entry: CachedTile): void => {
        cached.delete(url);
        cachedBytes -= entry.payload.data.byteLength;
    };

    const pruneExpired = (): void => {
        const now = Date.now();
        for (const [url, entry] of cached) {
            if (entry.expiresAt <= now) remove(url, entry);
        }
    };

    const scheduleExpiry = (expiresAt: number): void => {
        if (expiresAt >= scheduledExpiryAt) return;
        if (expiryTimer !== null) clearTimeout(expiryTimer);
        // Browser timers overflow above a signed 32-bit delay, before 30 days.
        const delay = Math.min(2_147_483_647, Math.max(0, expiresAt - Date.now()));
        scheduledExpiryAt = Date.now() + delay;
        expiryTimer = setTimeout(() => {
            expiryTimer = null;
            scheduledExpiryAt = Number.POSITIVE_INFINITY;
            pruneExpired();
            for (const entry of cached.values()) scheduleExpiry(entry.expiresAt);
        }, delay);
    };

    const touch = (url: string, entry: CachedTile): void => {
        cached.delete(url);
        cached.set(url, entry);
    };

    const store = (url: string, payload: TilePayload, expiresAt: number): void => {
        const size = payload.data.byteLength;
        if (size > maxBytes || maxBytes <= 0 || expiresAt <= Date.now()) return;

        const previous = cached.get(url);
        if (previous) remove(url, previous);
        touch(url, { payload, expiresAt });
        cachedBytes += size;

        while (cachedBytes > maxBytes) {
            const oldest = cached.entries().next().value;
            if (!oldest) break;
            remove(oldest[0], oldest[1]);
        }
        scheduleExpiry(expiresAt);
    };

    const start = (url: string, type?: RequestParameters["type"]): PendingTile => {
        const controller = new AbortController();
        const promise = fetcher(url, controller.signal, type).then((payload) => {
            const expiresAt = cacheExpiresAt(payload, Date.now());
            // MapLibre must keep the original deadline on a shared cache hit.
            // Its max-age clock restarts on every response and overrides Expires.
            const boundedPayload = { ...payload, cacheControl: null, expires: new Date(expiresAt).toUTCString() };
            if (!controller.signal.aborted) store(url, boundedPayload, expiresAt);
            return boundedPayload;
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
            if (hit && hit.expiresAt > Date.now()) {
                touch(url, hit);
                return clonePayload(hit.payload);
            }
            if (hit) remove(url, hit);

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
            if (expiryTimer !== null) clearTimeout(expiryTimer);
            expiryTimer = null;
            scheduledExpiryAt = Number.POSITIVE_INFINITY;
            for (const entry of pending.values()) entry.controller.abort("cache cleared");
            pending.clear();
            cached.clear();
            cachedBytes = 0;
        },
        stats(): SharedTileCacheStats {
            pruneExpired();
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
    if (yandexQueueTimer !== null) clearTimeout(yandexQueueTimer);
    yandexQueueTimer = null;
    nextYandexRequestAt = 0;
    for (const request of yandexQueue.splice(0)) {
        request.signal.removeEventListener("abort", request.onAbort);
        request.reject(abortError("cache reset"));
    }
}
