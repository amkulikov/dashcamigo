// The viewer shares a persisted preference and one page-scoped fallback chain.
// Export overlays have isolated sessions so viewer choices cannot enter a video.

import { createLogger } from "../log.js";
import { isYandexMapAvailable } from "./yandex-map.js";

const log = createLogger("map-provider");

export type MapProvider = "openfreemap" | "osm-vector" | "osm-raster" | "yandex";
export type MapProviderPreference = Exclude<MapProvider, "osm-raster">;
export type OverlayMapProviderPreference = Exclude<MapProviderPreference, "yandex">;
type OverlayMapProvider = Exclude<MapProvider, "yandex">;

const STORAGE_KEY = "dashcamigo:mapProvider";
const FAILURE_WINDOW_MS = 5_000;
const FAILURE_THRESHOLD = 2;
// A blocked host can leave fetch pending until the browser's network timeout.
export const MAP_PROVIDER_REQUEST_TIMEOUT_MS = 3_000;

const PROBE_URLS: Record<OverlayMapProvider, string> = {
    openfreemap: "https://tiles.openfreemap.org/planet",
    "osm-vector": "https://vector.openstreetmap.org/shortbread_v1/0/0/0.mvt",
    "osm-raster": "https://tile.openstreetmap.org/0/0/0.png",
};

type ProviderListener<Provider extends MapProvider = MapProvider> = (
    provider: Provider,
    previous: Provider | null,
) => void;
type PreferenceListener = (preference: MapProviderPreference) => void;
type ProviderProbe = (provider: MapProvider) => Promise<boolean>;

interface MapProviderSession<Provider extends MapProvider> {
    getProvider(): Provider;
    subscribe(listener: ProviderListener<Provider>): () => void;
    reportTileError(error: unknown, now?: number): Promise<void> | null;
    dispose(): void;
}

interface MutableMapProviderSession<Provider extends MapProvider> extends MapProviderSession<Provider> {
    reset(provider: Provider, order?: readonly Provider[], shouldNotify?: boolean): void;
}

export type OverlayMapProviderSession = MapProviderSession<OverlayMapProvider>;

let preferredProvider: MapProviderPreference | null = null;
let viewerSession: MutableMapProviderSession<MapProvider> | null = null;
const preferenceListeners = new Set<PreferenceListener>();

function overlayProviderOrder(preference: OverlayMapProviderPreference): OverlayMapProvider[] {
    return preference === "osm-vector"
        ? ["osm-vector", "openfreemap", "osm-raster"]
        : ["openfreemap", "osm-vector", "osm-raster"];
}

function viewerProviderOrder(preference: MapProviderPreference): MapProvider[] {
    return preference === "yandex"
        ? ["yandex", "openfreemap", "osm-vector", "osm-raster"]
        : overlayProviderOrder(preference);
}

function availablePreference(value: string | null | undefined): MapProviderPreference | null {
    if (value === "openfreemap" || value === "osm-vector") return value;
    return value === "yandex" && isYandexMapAvailable() ? value : null;
}

export function getMapProviderPreference(): MapProviderPreference {
    if (preferredProvider !== null) return preferredProvider;
    const defaultProvider = availablePreference(import.meta.env.VITE_DEFAULT_MAP_PROVIDER) ?? "openfreemap";
    try {
        preferredProvider = availablePreference(localStorage.getItem(STORAGE_KEY)) ?? defaultProvider;
    } catch {
        preferredProvider = defaultProvider;
    }
    return preferredProvider;
}

async function fetchProbe(provider: MapProvider): Promise<boolean> {
    // Yandex is never a fallback target or background probe.
    if (provider === "yandex") return false;
    const ctrl = new AbortController();
    const timeoutId = setTimeout(() => ctrl.abort("timeout"), MAP_PROVIDER_REQUEST_TIMEOUT_MS);
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

function getViewerSession(): MutableMapProviderSession<MapProvider> {
    if (!viewerSession) {
        const preference = getMapProviderPreference();
        viewerSession = createProviderSession(preference, viewerProviderOrder(preference), probeProvider);
    }
    return viewerSession;
}

export function getMapProvider(): MapProvider {
    return getViewerSession().getProvider();
}

export function subscribeMapProvider(listener: ProviderListener): () => void {
    return getViewerSession().subscribe(listener);
}

export function subscribeMapProviderPreference(listener: PreferenceListener): () => void {
    preferenceListeners.add(listener);
    listener(getMapProviderPreference());
    return () => preferenceListeners.delete(listener);
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

/** Keep one diagnostic per provider/failure, rather than one per missing tile. */
export function mapProviderErrorKey(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    const url = errorUrl(error);
    const provider = url ? mapProviderForTileUrl(url) : null;
    return provider && url ? message.replace(url, provider) : message;
}

export function mapProviderForTileUrl(rawUrl: string): MapProvider | null {
    let url: URL;
    try {
        url = new URL(rawUrl);
    } catch {
        return null;
    }
    // /planet is the TileJSON bootstrap; without it there are no tile URLs yet.
    if (url.hostname === "tiles.openfreemap.org") return "openfreemap";
    if (url.hostname === "vector.openstreetmap.org" && url.pathname.endsWith(".mvt")) return "osm-vector";
    if (url.hostname === "tile.openstreetmap.org" && url.pathname.endsWith(".png")) return "osm-raster";
    if (url.hostname === "tiles.api-maps.yandex.ru" && url.pathname.replace(/\/+$/, "") === "/v1/tiles") {
        return "yandex";
    }
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

function createProviderSession<Provider extends MapProvider>(
    initialProvider: Provider,
    initialOrder: readonly Provider[],
    probe: ProviderProbe,
): MutableMapProviderSession<Provider> {
    let activeProvider = initialProvider;
    let order = initialOrder;
    let failedTiles = new Map<string, number>();
    let transitionPromise: Promise<void> | null = null;
    let providerRevision = 0;
    let isDisposed = false;
    const listeners = new Set<ProviderListener<Provider>>();

    function switchProvider(next: Provider, shouldNotify = false): void {
        const previous = activeProvider;
        activeProvider = next;
        providerRevision++;
        failedTiles = new Map();
        if (next === previous && !shouldNotify) return;
        log.warn("map provider switched", { from: previous, to: next });
        for (const listener of listeners) listener(next, previous);
    }

    async function downgradeProvider(failedProvider: Provider, expectedRevision: number): Promise<void> {
        for (const provider of order.slice(order.indexOf(failedProvider) + 1)) {
            log.info("map provider probe", { provider });
            const isAvailable = await probe(provider);
            if (isDisposed || providerRevision !== expectedRevision || activeProvider !== failedProvider) return;
            log.info("map provider probe result", { provider, available: isAvailable });
            if (isAvailable) {
                switchProvider(provider);
                return;
            }
        }
    }

    return {
        getProvider: () => activeProvider,
        subscribe(listener): () => void {
            if (isDisposed) return () => {};
            listeners.add(listener);
            listener(activeProvider, null);
            return () => listeners.delete(listener);
        },
        reportTileError(error, now = Date.now()): Promise<void> | null {
            if (isDisposed) return null;
            const url = errorUrl(error);
            const failedProvider = url ? mapProviderForTileUrl(url) : null;
            if (!url || failedProvider !== activeProvider || activeProvider === "osm-raster") return null;
            for (const [failedUrl, failedAt] of failedTiles) {
                if (now - failedAt > FAILURE_WINDOW_MS) failedTiles.delete(failedUrl);
            }
            failedTiles.set(url, now);
            const isYandexDenied =
                failedProvider === "yandex" &&
                typeof error === "object" &&
                error !== null &&
                "status" in error &&
                (error.status === 403 || error.status === 429);
            // A missing bootstrap or rejected API key/quota is conclusive even
            // when the whole viewport fits in a single distinct tile.
            const threshold = isProviderBootstrapRequest(failedProvider, url) || isYandexDenied ? 1 : FAILURE_THRESHOLD;
            if (failedTiles.size < threshold || transitionPromise) return transitionPromise;
            const distinctRequests = failedTiles.size;
            failedTiles = new Map();
            log.warn("map provider error threshold reached", {
                provider: failedProvider,
                distinctRequests,
                threshold,
                windowMs: FAILURE_WINDOW_MS,
            });
            const transition = downgradeProvider(activeProvider, providerRevision).finally(() => {
                if (transitionPromise === transition) transitionPromise = null;
            });
            transitionPromise = transition;
            return transitionPromise;
        },
        reset(provider, nextOrder = order, shouldNotify = false): void {
            if (isDisposed) return;
            order = nextOrder;
            transitionPromise = null;
            // Increment even on a no-op so a late probe cannot undo a user choice.
            switchProvider(provider, shouldNotify);
        },
        dispose(): void {
            isDisposed = true;
            providerRevision++;
            transitionPromise = null;
            failedTiles.clear();
            listeners.clear();
        },
    };
}

/** Export sessions cannot select Yandex, including through fallback or viewer changes. */
export function createOverlayMapProviderSession(
    preference: OverlayMapProviderPreference = "openfreemap",
): OverlayMapProviderSession {
    // Runtime validation also covers malformed persisted values and JS callers.
    const safePreference = preference === "osm-vector" ? "osm-vector" : "openfreemap";
    return createProviderSession(safePreference, overlayProviderOrder(safePreference), probeProvider);
}

/** Two distinct failed tiles trigger fallback; stale-provider failures are ignored. */
export function reportMapProviderTileError(error: unknown, now = Date.now()): Promise<void> | null {
    return getViewerSession().reportTileError(error, now);
}

/** Store the user's first choice and immediately retry it on the current page. */
export function setMapProviderPreference(provider: MapProviderPreference): void {
    if (provider !== "openfreemap" && provider !== "osm-vector" && provider !== "yandex") {
        throw new Error("unknown map provider");
    }
    if (provider === "yandex" && !isYandexMapAvailable()) throw new Error("yandex map key is not configured");
    const session = getViewerSession();
    preferredProvider = provider;
    try {
        localStorage.setItem(STORAGE_KEY, provider);
    } catch {
        // Storage may be blocked; the choice still works for this page.
    }
    session.reset(provider, viewerProviderOrder(provider));
    for (const listener of preferenceListeners) listener(provider);
}

/** Page-scoped DevTools override. A reload restores the saved preference. */
export function forceMapProvider(provider: MapProvider): MapProvider {
    if (provider !== "openfreemap" && provider !== "osm-vector" && provider !== "osm-raster" && provider !== "yandex") {
        throw new Error("unknown map provider");
    }
    if (provider === "yandex" && !isYandexMapAvailable()) throw new Error("yandex map key is not configured");
    getViewerSession().reset(provider, provider === "yandex" ? viewerProviderOrder(provider) : undefined, true);
    return getMapProvider();
}

/** Test-only reset for the module-level page session. */
export function _resetForTests(probe: ProviderProbe = fetchProbe): void {
    viewerSession?.dispose();
    viewerSession = null;
    preferredProvider = null;
    probeProvider = probe;
    preferenceListeners.clear();
}
