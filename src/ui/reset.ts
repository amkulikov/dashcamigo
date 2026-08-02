// "Reset all app state" - wipes every persistent storage layer the app touches
// on the current origin, then hard-reloads the page so the user lands on a
// "first visit" state.
//
// Triggered from the Danger zone in settings-modal after a user confirmation.
// Order matters: SW unregister + cache delete BEFORE reload, otherwise the
// reload would hit the cached shell again and the cleanup would look partial.
//
// What we cannot reset from JS (and surface in the UI copy):
//  - installed-PWA shortcut: OS-level, the user must uninstall it manually.
//  - browser permissions / autoplay policy: not exposed to scripts.
//  - HttpOnly cookies: invisible to document.cookie. We don't set any, but
//    if a third-party CDN ever does, they'd survive.

import { createLogger } from "../log.js";
import { closePersistDb } from "../persist/db.js";

const log = createLogger("reset");

/**
 * Unregisters all service workers and clears every Cache Storage entry on
 * this origin. Shared between the full Danger zone reset and the lighter
 * "Clear offline cache" action in settings - the only common destructive
 * pieces between the two.
 *
 * Both steps are best-effort: a failed unregister or cache.delete is logged
 * and swallowed, never propagated. Callers always proceed (typically to
 * reload the page), wiping more state on top.
 */
export async function clearServiceWorkerAndCaches(): Promise<void> {
    if ("serviceWorker" in navigator) {
        try {
            const regs = await navigator.serviceWorker.getRegistrations();
            await Promise.all(regs.map((r) => r.unregister().catch(() => false)));
        } catch (err) {
            log.warn("sw unregister failed", err);
        }
    }
    if ("caches" in self) {
        try {
            const keys = await caches.keys();
            await Promise.all(keys.map((k) => caches.delete(k).catch(() => false)));
        } catch (err) {
            log.warn("caches clear failed", err);
        }
    }
}

/**
 * Performs the full reset and reloads. Returns once the reload has been
 * scheduled; callers don't need to await the resolved value - the page is
 * going away.
 */
export async function resetAllAppState(): Promise<void> {
    log.info("reset started");

    // 1) Service Workers + Cache Storage. Done first so the reload below
    // cannot pick up the still-active SW and serve cached shell content
    // from a moment before we wiped storage.
    await clearServiceWorkerAndCaches();

    // 2) localStorage + sessionStorage. .clear() is synchronous and can
    // throw if storage is disabled (private mode, quota); we just log.
    try {
        localStorage.clear();
    } catch (err) {
        log.warn("localStorage clear failed", err);
    }
    try {
        sessionStorage.clear();
    } catch (err) {
        log.warn("sessionStorage clear failed", err);
    }

    // 3) Cookies. document.cookie only exposes non-HttpOnly ones, which is
    // what GA4 (_ga, _gid) and Cloudflare Insights (__cf_*) use. To actually
    // delete a cookie we set it to expire in the past on each plausible
    // domain scope - the browser silently ignores combinations that don't
    // match an existing cookie.
    try {
        clearAllCookies();
    } catch (err) {
        log.warn("cookies clear failed", err);
    }

    // 4) IndexedDB. Includes our own persist database (remembered folders,
    // annotations, cached indexing - wiping those is the point of the Danger
    // zone) plus anything third-party libraries opened (MapLibre tile cache,
    // Mediabunny, browser-internal SW bookkeeping in some engines).
    // indexedDB.databases() is the standard enumeration API (Chrome,
    // Firefox 119+, Safari 17+); on older browsers we skip it.
    // Our own connection must close first: deleteDatabase against a live
    // connection reports "blocked", which the loop below counts as done -
    // the wipe would silently skip the very data this reset is for.
    try {
        await closePersistDb();
    } catch (err) {
        log.warn("persist db close failed", err);
    }
    if (typeof indexedDB !== "undefined" && typeof indexedDB.databases === "function") {
        try {
            const dbs = await indexedDB.databases();
            await Promise.all(
                dbs
                    .filter((db) => typeof db.name === "string" && db.name.length > 0)
                    .map(
                        (db) =>
                            new Promise<void>((resolve) => {
                                const name = db.name as string;
                                const req = indexedDB.deleteDatabase(name);
                                req.onsuccess = () => resolve();
                                req.onerror = () => resolve();
                                req.onblocked = () => resolve();
                            }),
                    ),
            );
        } catch (err) {
            log.warn("indexedDB clear failed", err);
        }
    }

    log.info("reset finished, reloading");
    // Forced reload bypasses bfcache so the user actually gets a fresh
    // pageload with the cleared state, not a restored DOM snapshot.
    location.reload();
}

/** Expires every cookie visible to document.cookie across plausible domain scopes. */
function clearAllCookies(): void {
    const cookies = document.cookie ? document.cookie.split(";") : [];
    const hostname = location.hostname;
    // Try the bare hostname AND with a leading dot - GA4 in particular sets
    // cookies on `.example.app`, which is a different scope from `example.app`.
    const domains = ["", `; domain=${hostname}`, `; domain=.${hostname}`];
    for (const raw of cookies) {
        const eq = raw.indexOf("=");
        const name = (eq >= 0 ? raw.slice(0, eq) : raw).trim();
        if (!name) continue;
        for (const domain of domains) {
            // biome-ignore lint/suspicious/noDocumentCookie: Cookie Store API is Chromium-only (Chrome 87+); we ship to Safari + Firefox too, document.cookie is the portable way to expire cookies.
            document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/${domain}`;
        }
    }
}
