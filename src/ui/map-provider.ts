// Page-scoped base-map provider fallback. The state deliberately lives only in
// this module: a reload starts from OpenFreeMap again, while every MapLibre
// instance created by the current page observes the same one-way downgrade.

import { createLogger } from "../log.js";

const log = createLogger("map-provider");

export type MapProvider = "openfreemap" | "osm-vector" | "osm-raster";

const FAILURE_WINDOW_MS = 5_000;
const FAILURE_THRESHOLD = 2;
const PROBE_TIMEOUT_MS = 5_000;

const PROBE_URLS: Record<Exclude<MapProvider, "openfreemap">, string> = {
    "osm-vector": "https://vector.openstreetmap.org/shortbread_v1/0/0/0.mvt",
    "osm-raster": "https://tile.openstreetmap.org/0/0/0.png",
};

type ProviderListener = (provider: MapProvider, previous: MapProvider | null) => void;
type ProviderProbe = (provider: Exclude<MapProvider, "openfreemap">) => Promise<boolean>;

const listeners = new Set<ProviderListener>();
let activeProvider: MapProvider = "openfreemap";
let failedTiles = new Map<string, number>();
let transitionPromise: Promise<void> | null = null;
let providerRevision = 0;

async function fetchProbe(provider: Exclude<MapProvider, "openfreemap">): Promise<boolean> {
    const ctrl = new AbortController();
    const timeoutId = setTimeout(() => ctrl.abort("timeout"), PROBE_TIMEOUT_MS);
    try {
        const response = await fetch(PROBE_URLS[provider], { signal: ctrl.signal });
        return response.ok;
    } catch {
        return false;
    } finally {
        clearTimeout(timeoutId);
    }
}

let probeProvider: ProviderProbe = fetchProbe;

export function getMapProvider(): MapProvider {
    return activeProvider;
}

export function subscribeMapProvider(listener: ProviderListener): () => void {
    listeners.add(listener);
    listener(activeProvider, null);
    return () => listeners.delete(listener);
}

function switchProvider(next: MapProvider): void {
    if (next === activeProvider) return;
    const previous = activeProvider;
    activeProvider = next;
    providerRevision++;
    failedTiles = new Map();
    log.warn("map provider switched", { from: previous, to: next });
    for (const listener of listeners) listener(next, previous);
}

function errorUrl(error: unknown): string | null {
    if (typeof error === "object" && error !== null) {
        const url = (error as { url?: unknown }).url;
        if (typeof url === "string") return url;
    }
    const message = error instanceof Error ? error.message : String(error);
    const match = message.match(/https:\/\/[^\s)]+/);
    return match?.[0] ?? null;
}

export function mapProviderForTileUrl(rawUrl: string): MapProvider | null {
    let url: URL;
    try {
        url = new URL(rawUrl);
    } catch {
        return null;
    }
    // OpenFreeMap's style reaches the host through several resource types. Most
    // importantly, /planet is the TileJSON bootstrap request: if it is blocked,
    // MapLibre never learns any .pbf URLs, so matching only vector tiles would
    // make the provider fallback impossible on a fresh page load.
    if (url.hostname === "tiles.openfreemap.org") return "openfreemap";
    if (url.hostname === "vector.openstreetmap.org" && url.pathname.endsWith(".mvt")) return "osm-vector";
    if (url.hostname === "tile.openstreetmap.org" && url.pathname.endsWith(".png")) return "osm-raster";
    return null;
}

function isProviderBootstrapRequest(provider: MapProvider, rawUrl: string): boolean {
    if (provider !== "openfreemap") return false;
    try {
        return new URL(rawUrl).pathname.replace(/\/+$/, "") === "/planet";
    } catch {
        return false;
    }
}

async function probeAndSwitch(
    provider: Exclude<MapProvider, "openfreemap">,
    failedProvider: MapProvider,
    expectedRevision: number,
): Promise<boolean> {
    log.info("map provider probe", { provider });
    const isAvailable = await probeProvider(provider);
    log.info("map provider probe result", { provider, available: isAvailable });
    if (isAvailable && activeProvider === failedProvider && providerRevision === expectedRevision) {
        switchProvider(provider);
        return true;
    }
    return false;
}

async function downgradeProvider(failedProvider: MapProvider, expectedRevision: number): Promise<void> {
    if (failedProvider === "openfreemap") {
        if (await probeAndSwitch("osm-vector", failedProvider, expectedRevision)) return;
        if (providerRevision !== expectedRevision || activeProvider !== failedProvider) return;
        await probeAndSwitch("osm-raster", failedProvider, expectedRevision);
        return;
    }
    if (failedProvider === "osm-vector") {
        await probeAndSwitch("osm-raster", failedProvider, expectedRevision);
    }
}

/**
 * Records a failed base-map tile. Two different tiles inside the rolling
 * window start one shared provider probe; repeated errors for the same URL do
 * not count twice. Errors from a provider already left behind are ignored.
 */
export function reportMapProviderTileError(error: unknown, now = Date.now()): Promise<void> | null {
    const url = errorUrl(error);
    const failedProvider = url ? mapProviderForTileUrl(url) : null;
    if (!url || failedProvider !== activeProvider || activeProvider === "osm-raster") return null;

    for (const [failedUrl, failedAt] of failedTiles) {
        if (now - failedAt > FAILURE_WINDOW_MS) failedTiles.delete(failedUrl);
    }
    failedTiles.set(url, now);
    // A failed TileJSON bootstrap is conclusive: without it no actual vector
    // tile URL exists to provide the second distinct failure normally required.
    const threshold = isProviderBootstrapRequest(failedProvider, url) ? 1 : FAILURE_THRESHOLD;
    if (failedTiles.size < threshold || transitionPromise) return transitionPromise;

    const distinctRequests = failedTiles.size;
    failedTiles = new Map();
    log.warn("map provider error threshold reached", {
        provider: failedProvider,
        distinctRequests,
        threshold,
        windowMs: FAILURE_WINDOW_MS,
    });
    transitionPromise = downgradeProvider(failedProvider, providerRevision).finally(() => {
        transitionPromise = null;
    });
    return transitionPromise;
}

/** Page-scoped DevTools override. A reload always restores OpenFreeMap. */
export function forceMapProvider(provider: MapProvider): MapProvider {
    if (provider !== "openfreemap" && provider !== "osm-vector" && provider !== "osm-raster") {
        throw new Error("unknown map provider");
    }
    // Invalidate an in-flight automatic probe even when forcing the provider
    // already active; its late result must not undo an explicit debug choice.
    providerRevision++;
    const previous = activeProvider;
    activeProvider = provider;
    failedTiles = new Map();
    log.warn("map provider forced", { from: previous, to: provider });
    for (const listener of listeners) listener(provider, previous);
    return activeProvider;
}

/** Test-only reset for the module-level page session. */
export function _resetForTests(probe: ProviderProbe = fetchProbe): void {
    activeProvider = "openfreemap";
    failedTiles = new Map();
    transitionPromise = null;
    providerRevision = 0;
    probeProvider = probe;
    listeners.clear();
}
