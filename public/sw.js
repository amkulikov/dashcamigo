// Service worker for dashcamigo: the offline app shell (PWA precache).
//
// At build time vite-plugins/sw-precache.ts injects a precache manifest (every
// same-origin code asset the app needs to boot and run: the entry JS+CSS, lazy
// chunks and workers, plus every per-locale shell and the root stub) with a
// per-file content revision. On install the SW
// reconciles that manifest into a cache (fetching ONLY entries whose revision
// changed since the last install), so an installed PWA opens and works with no
// network. Map tile server and analytics are cross-origin and skip the SW
// entirely - the CLAUDE.md invariant ("if an external dependency is
// unavailable, the functional app keeps working") holds: offline the map base
// layer is blank but the route, video, chart and export still work.
//
// Cache lifecycle:
//   - PRECACHE holds the injected manifest's responses, keyed by bare URL. A
//     hidden MANIFEST_KEY entry stores the last-installed {url,revision} list
//     so the next install only re-fetches changed files (Workbox-style
//     reconcile - NOT a blind whole-cache re-download per deploy).
//   - RUNTIME holds opportunistically cached non-precache same-origin GETs
//     (e.g. /privacy, /<lang>/cameras/...) plus the previous deploy's precache
//     entries demoted on activate. FIFO-trimmed to MAX_RUNTIME_ENTRIES.
//   - TRACKER holds the blur-zone auto-tracker's lazy download (/ort/ wasm +
//     /models/ onnx). A dedicated cache so it is NOT FIFO-evicted like RUNTIME -
//     once fetched online the tracker keeps running offline. Its URLs are
//     cache-busted (TRACKER_ASSET_URLS); activate drops superseded entries so a
//     dependency upgrade cannot serve stale bytes from this non-FIFO cache.
//   - SCHEMA versions the cache NAMES; bump it MANUALLY only when this file's
//     caching logic changes. Per-deploy freshness rides on per-file revisions,
//     not on the cache name. Old caches (incl. the pre-2026 "dashcamigo-shell-*")
//     are purged on activate.
//
// Update handover: an updated SW does NOT skipWaiting. It pre-fetches changed
// entries into the (shared) precache on install, then WAITS until every tab of
// the old build is gone before activating - so the old build's chunk graph
// stays cached and complete for as long as any tab may lazy-load from it. An
// open tab's session is File-API handles plus decoded video held in memory; a
// forced reload cannot restore it, and with no backend there is no server
// contract that could require the newest client - so an old tab must keep
// working, not "must reload". Waiting costs the user nothing: navigation is
// network-first, so an ONLINE (re)launch always runs the newest app no matter
// which SW version is still in control. (Staleness of sw.js itself under the
// CF Browser Cache TTL is handled by updateViaCache:"none" in the
// registration, not here.)

// === Precache manifest (build-time injection) ===

// vite-plugins/sw-precache.ts replaces the array literal on the next line with
// the real manifest ([{ url, revision }, ...]) after the SEO prerender runs and
// before this file is minified. In dev the manifest stays empty and the SW
// does runtime caching only (offline is a production/PWA concern).
const PRECACHE_MANIFEST = []; // __DC_PRECACHE_MANIFEST__

// vite-plugins/tracker-assets.ts replaces this with the build's set of
// cache-busted tracker asset URLs (/ort/<version>/*, content-hashed models). The
// activate handler drops any TRACKER entry not in this set - so an onnxruntime
// upgrade or a re-exported model does not leave stale bytes in the non-FIFO
// TRACKER cache. Empty in dev (no injection): the dev tracker cache is left
// untouched.
const TRACKER_ASSET_URLS = []; // __DC_TRACKER_ASSET_URLS__

// Cache-name schema. Bump MANUALLY only when the caching LOGIC below changes -
// per-deploy file freshness is handled by per-entry revisions + reconcile, so a
// normal deploy must NOT change this. v3: precache-manifest rewrite (was the
// "dashcamigo-shell-v2" SWR-only shell).
const SCHEMA = "v3";
const PRECACHE = `dashcamigo-precache-${SCHEMA}`;
const RUNTIME = `dashcamigo-runtime-${SCHEMA}`;
// Blur-zone tracker assets (/ort/ wasm, /models/ onnx). Separate from RUNTIME so
// the ~14 MB lazy download is not FIFO-evicted by ordinary page browsing - an
// installed PWA that ran the tracker online once can then run it offline. Rides
// SCHEMA and is added to the activate keep-set; purely additive (PRECACHE /
// RUNTIME semantics are unchanged), so no SCHEMA bump is required.
const TRACKER = `dashcamigo-tracker-${SCHEMA}`;

// Internal cache key holding the last-installed manifest (JSON of the injected
// array). Read on install to reconcile, never served to the page. Leading
// double underscore + the dc prefix keep it from colliding with a real route.
const MANIFEST_KEY = "/__dc-precache-manifest__";

// Upper bound on the opportunistic RUNTIME cache. FIFO eviction (Cache.keys()
// is insertion order per spec) keeps it from growing unbounded across a long
// session of visiting non-precached pages.
const MAX_RUNTIME_ENTRIES = 60;

// How long a navigation waits for the network before falling back to the
// precached shell. Navigation is network-first (an online user must get HTML
// matching the current deploy's asset hashes), but in "connected but no
// internet" limbo a bare fetch does NOT reject - it hangs for the OS connection
// timeout (tens of seconds), and a cold PWA launch navigates twice (root stub
// "/" then "/<lang>/"), stacking the hangs into the multi-second blank screen.
// Online the response returns well under this bound, so the timeout fires only
// when the network is effectively dead - where fresh HTML is unreachable anyway
// and the cached shell is the correct answer. A slow-network user is not pinned
// to a stale shell across launches: the next SW update re-precaches the current
// shell out of band.
const NAV_NETWORK_TIMEOUT_MS = 2500;

// Normalize a (possibly relative) URL to its absolute form so it compares
// directly against Request.url, which is always absolute.
const toAbs = (u) => new URL(u, self.location.origin).toString();

// Absolute URLs of every precached entry - O(1) membership test for routing.
const PRECACHE_URLS = new Set(PRECACHE_MANIFEST.map((e) => toAbs(e.url)));

// Per-locale shells ("/en/", "/ru/", ...) for the offline navigation fallback:
// an offline navigation to an uncached /<lang>/<page>/ degrades to that
// locale's home rather than the browser error page.
const LOCALE_SHELLS = PRECACHE_MANIFEST.map((e) => e.url).filter((u) => /^\/[a-z]{2}\/$/.test(u));

// Last-resort offline page, baked into the SW itself (NOT in Cache Storage). If
// the browser has evicted the precache but the SW registration survives, every
// cached shell match misses and we'd otherwise hand the navigation back to the
// browser's "you're offline" page. This self-contained page (no external refs)
// shows a human message and auto-reloads when the network returns - which
// triggers the SW to re-precache. (If the SW registration itself was evicted,
// nothing here runs - the launch never reaches this worker; only an online
// visit recovers that.) RU/EN picked from navigator.language inline.
const OFFLINE_FALLBACK_HTML = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>dashcamigo</title><style>html,body{margin:0;height:100%;background:#0a0a0a;color:#f5f4f1;font:16px/1.5 system-ui,-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;text-align:center}.dc-b{max-width:30rem;padding:2rem}h1{color:#ff9000;font-size:1.25rem;margin:0 0 .75rem}p{margin:0 0 1.5rem;color:#bdbdbd}button{background:#ff9000;color:#000;border:0;border-radius:.5rem;padding:.75rem 1.5rem;font:inherit;font-weight:600;cursor:pointer}</style></head><body><div class="dc-b"><h1 id="dc-t"></h1><p id="dc-m"></p><button id="dc-r"></button></div><script>(function(){var ru=(navigator.language||"").toLowerCase().indexOf("ru")===0;document.getElementById("dc-t").textContent=ru?"Нет интернета":"You're offline";document.getElementById("dc-m").textContent=ru?"Сохранённой копии приложения сейчас нет на устройстве. Подключитесь к интернету один раз — и она восстановится сама.":"The saved copy of the app isn't on this device right now. Connect to the internet once and it will restore itself.";var b=document.getElementById("dc-r");b.textContent=ru?"Повторить":"Retry";b.onclick=function(){location.reload()};addEventListener("online",function(){location.reload()})})()</script></body></html>`;

// === Install: reconcile the precache (fetch only changed entries) ===

// Retries a precache fetch through a couple of short backoffs before giving
// up - a transient blip (a loaded preview/edge server, a flaky connection
// mid-install) would otherwise silently leave that one entry uncached for the
// rest of this SW version's lifetime (the next install reconciles it, but
// that could be a whole deploy away - see navigationCacheFallback for what an
// uncached locale shell does to offline navigation in the meantime). Bounded
// at 3 attempts / <=550ms worst case per entry, so a genuinely missing file
// (a real 404) still fails fast rather than stalling install.
async function fetchForPrecache(entryUrl) {
    const attempts = 3;
    for (let i = 0; i < attempts; i++) {
        try {
            // Vite's /assets/ filenames are content addresses. Reusing an HTTP-
            // cached response is therefore exact, including when the page just
            // fetched its boot graph before this first SW install. Stable shell
            // URLs still bypass HTTP cache: their manifest revision can change
            // without the URL changing, so install must fetch the new bytes.
            const cacheMode = entryUrl.startsWith("/assets/") ? "force-cache" : "reload";
            const res = await fetch(new Request(entryUrl, { cache: cacheMode }));
            if (res.ok || i === attempts - 1) return res;
        } catch (err) {
            if (i === attempts - 1) throw err;
        }
        await new Promise((resolve) => setTimeout(resolve, 150 * (i + 1)));
    }
}

self.addEventListener("install", (event) => {
    event.waitUntil(
        (async () => {
            const cache = await caches.open(PRECACHE);
            const prev = await readStoredManifest(cache);
            // Per-entry, so one failed fetch does NOT discard the whole batch
            // the way cache.addAll would (addAll is atomic). Failures are
            // graded AFTER the batch settles: what a miss breaks depends on
            // what the entry is (see below).
            const results = await Promise.allSettled(
                PRECACHE_MANIFEST.map(async (entry) => {
                    const url = toAbs(entry.url);
                    const fresh = (await cache.match(url)) && prev.get(url) === entry.revision;
                    if (fresh) return; // unchanged since last install - keep it
                    const res = await fetchForPrecache(entry.url);
                    if (!res.ok) throw new Error(`precache ${entry.url} -> ${res.status}`);
                    // A redirected response cached for a shell would throw when
                    // later served for a navigation ("redirected response used
                    // for navigation"). Shells are canonical (no redirect) on CF
                    // Pages; treat a redirect as a misconfig and skip the entry
                    // (allSettled isolates the throw to this one entry).
                    if (res.redirected) throw new Error(`precache ${entry.url} redirected`);
                    await cache.put(url, res);
                }),
            );
            // Persist the manifest BEFORE grading failures: entries that DID
            // land keep their revision, so a retried install re-fetches only
            // what is still missing (the freshness check above also requires a
            // cache hit, so a recorded-but-missing entry is re-fetched anyway).
            await writeStoredManifest(cache, PRECACHE_MANIFEST);
            // Grade the failures. A missing /assets/ entry is app CODE: serving
            // the shell with a hole in its module graph does not degrade, it
            // detonates later - an offline lazy import / module worker comes up
            // with every field undefined ("load-failure"), possibly weeks after
            // this install. Fail the install instead: the previous complete
            // version stays active and the browser retries this install on the
            // next update check. Everything else (shells, fonts, icons) fails
            // soft by design - navigationCacheFallback covers a missing shell,
            // fonts fall back to system - so best-effort is right for those.
            const missingCode = PRECACHE_MANIFEST.filter(
                (entry, i) => results[i].status === "rejected" && entry.url.startsWith("/assets/"),
            );
            if (missingCode.length > 0) {
                throw new Error(`precache missing app code: ${missingCode.map((e) => e.url).join(", ")}`);
            }
        })(),
    );
});

// === Activate: purge old caches + stale precache entries ===

self.addEventListener("activate", (event) => {
    event.waitUntil(
        (async () => {
            // Drop every dashcamigo-* cache that is not one of the current pair
            // (covers prior SCHEMA versions and the legacy "dashcamigo-shell-*").
            const keep = new Set([PRECACHE, RUNTIME, TRACKER]);
            const names = await caches.keys();
            await Promise.all(
                names.filter((n) => n.startsWith("dashcamigo-") && !keep.has(n)).map((n) => caches.delete(n)),
            );
            // Reconcile inside PRECACHE: entries no longer in the manifest (the
            // previous deploy's renamed bundles) are DEMOTED to RUNTIME, not
            // deleted. Without skipWaiting this activate normally runs with no
            // old-build tab left - but not never: a bfcache'd tab restored
            // after we activate, or a tab claimed after a hard reload, still
            // lazy-loads old-hash chunks, and the network 404s those (the new
            // deploy no longer serves them). The demoted copy in RUNTIME is
            // what stands between such a tab and the module-worker load crash
            // (cacheFirst falls back to RUNTIME on a non-ok network response);
            // RUNTIME's FIFO trim then ages the demoted entries out naturally.
            const cache = await caches.open(PRECACHE);
            const valid = new Set([...PRECACHE_URLS, toAbs(MANIFEST_KEY)]);
            const keys = await cache.keys();
            const runtime = await caches.open(RUNTIME);
            await Promise.all(
                keys
                    .filter((req) => !valid.has(req.url))
                    .map(async (req) => {
                        const res = await cache.match(req);
                        if (res) await runtime.put(req, res);
                        await cache.delete(req);
                    }),
            );
            await trimCache(runtime);
            // Drop superseded tracker assets. TRACKER is NOT FIFO-trimmed, so an
            // onnxruntime upgrade (new /ort/<version>/ dir) or a re-exported model
            // (new content-hashed name) would otherwise leave the old file cached
            // forever under its old URL - dead bytes at best, and offline a stale
            // wasm served against freshly-precached glue (an ORT ABI mismatch) at
            // worst. Keep only the current build's asset URLs. Skipped when empty
            // (dev: no injection) so a dev session keeps its warmed cache.
            if (TRACKER_ASSET_URLS.length > 0) {
                const keepTracker = new Set(TRACKER_ASSET_URLS.map(toAbs));
                const tracker = await caches.open(TRACKER);
                const trackerKeys = await tracker.keys();
                await Promise.all(
                    trackerKeys.filter((req) => !keepTracker.has(req.url)).map((req) => tracker.delete(req)),
                );
            }
            // claim() is for the FIRST install: it puts the just-activated SW
            // in control of the already-open tab, so the offline shell and the
            // runtime caches work from visit one (the offline e2e gates on
            // this). On an update, activation happens once the old build's
            // tabs are gone, so there is nothing mid-session to seize.
            await self.clients.claim();
        })(),
    );
});

// Read the stored {url->revision} map from the previous install (empty map on
// first install or any parse failure - reconcile then re-fetches everything).
async function readStoredManifest(cache) {
    try {
        const res = await cache.match(toAbs(MANIFEST_KEY));
        if (!res) return new Map();
        const arr = await res.json();
        return new Map(arr.map((e) => [toAbs(e.url), e.revision]));
    } catch {
        return new Map();
    }
}

// Persist the manifest just installed, so the next install can diff against it.
async function writeStoredManifest(cache, manifest) {
    const body = JSON.stringify(manifest);
    await cache.put(toAbs(MANIFEST_KEY), new Response(body, { headers: { "content-type": "application/json" } }));
}

// === Fetch routing ===

self.addEventListener("fetch", (evt) => {
    const req = evt.request;

    // 1) Only GET requests are cached. POST/PUT and friends pass through.
    if (req.method !== "GET") return;

    // 2) Same-origin only. Map tiles, GA4, Cloudflare Insights and other
    // cross-origin go straight to the network - we don't make them worse.
    const url = new URL(req.url);
    if (url.origin !== self.location.origin) return;

    // Never intercept the internal manifest key (defensive - it is not a route).
    if (url.pathname === MANIFEST_KEY) return;

    // 3) Navigation - network-first so an online user always gets HTML matching
    // the current deployment's asset hashes; offline falls back to the cached
    // shell (exact -> query-agnostic -> locale -> /en/ -> /).
    if (req.mode === "navigate") {
        evt.respondWith(navigationResponse(req, evt));
        return;
    }

    // 4) Precached assets and cache-as-used /assets/ + /fonts/ - cache-first.
    // Code is content-hashed; a font URL is immutable under the hosting cache
    // contract. A Cache Storage hit is therefore correct and instant.
    if (PRECACHE_URLS.has(url.href) || url.pathname.startsWith("/assets/") || url.pathname.startsWith("/fonts/")) {
        evt.respondWith(cacheFirst(req, evt));
        return;
    }

    // 5) Blur-zone tracker assets (/ort/ wasm, /models/ onnx) - stale-while-
    // revalidate into the DEDICATED, non-FIFO TRACKER cache so the lazy download
    // survives a long browsing session and the tracker runs offline after one
    // online use. The URLs are cache-busted (versioned /ort/ dir, content-hashed
    // models - see vite-plugins/tracker-assets.ts), so a dependency upgrade lands
    // fresh URLs; the activate handler drops the superseded entries.
    if (url.pathname.startsWith("/ort/") || url.pathname.startsWith("/models/")) {
        evt.respondWith(staleWhileRevalidate(req, evt, TRACKER, false));
        return;
    }

    // 6) Everything else same-origin (other HTML pages, og images, robots) -
    // stale-while-revalidate into the runtime cache.
    evt.respondWith(staleWhileRevalidate(req, evt));
});

// Network-first navigation with a bounded network wait and a layered offline
// fallback. Online, fetch returns under NAV_NETWORK_TIMEOUT_MS so the user gets
// HTML matching the current deploy's asset hashes. Offline (hard, or "connected
// but no internet" limbo) the network can't deliver fresh HTML, so we serve the
// precached shell instead of letting the navigation hang on the OS connection
// timeout.
async function navigationResponse(req, evt) {
    const runtime = await caches.open(RUNTIME);
    // Hard-offline fast path: in airplane mode the fetch would reject anyway,
    // and onLine===false is reliable for that case - skip straight to the cache
    // so the launch is instant. In limbo onLine is TRUE (the radio is up), so
    // this does not catch limbo; the timeout below does.
    if (navigator.onLine) {
        // Bound the network wait so a hung fetch (limbo) cannot stall the
        // navigation. AbortController fires the timeout; on abort / offline /
        // any network error we fall through to the cached shell.
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), NAV_NETWORK_TIMEOUT_MS);
        try {
            const res = await fetch(req, { signal: ctrl.signal });
            cacheAndTrim(runtime, req, res, evt);
            return res;
        } catch {
            // timeout, offline, or network error - serve the cached shell below.
        } finally {
            clearTimeout(timer);
        }
    }
    return navigationCacheFallback(req, runtime);
}

// Layered offline fallback for a navigation the network could not serve. Every
// cache.match result is truthiness-guarded so a miss can never resolve
// respondWith() to undefined - an undefined/rejected navigation response is
// exactly what makes the browser show its built-in "you're offline" page.
// Pulled out of navigationResponse so the hard-offline fast path and the
// network-timeout path share one chain.
async function navigationCacheFallback(req, runtime) {
    const pre = await caches.open(PRECACHE);
    // 1. Exact URL (a precached shell, or a sub-page visited online before).
    let hit = (await pre.match(req)) || (await runtime.match(req));
    if (hit) return hit;
    // 2. Ignore the query string: handles start_url "/?source=pwa" and the
    // stub's "/<lang>/?source=pwa" redirect target.
    hit = (await pre.match(req, { ignoreSearch: true })) || (await runtime.match(req, { ignoreSearch: true }));
    if (hit) return hit;
    // 3. Locale-derived shell: /<lang>/<anything> -> that locale's home.
    const seg = new URL(req.url).pathname.split("/").filter(Boolean)[0];
    const isLocaleRequest = !!seg && LOCALE_SHELLS.includes(`/${seg}/`);
    if (isLocaleRequest) {
        hit = await pre.match(`/${seg}/`);
        if (hit) return hit;
    }
    // 4. English home, then the root stub (the stub's inline JS redirects to
    // a locale shell, which step 3 served from cache) - but ONLY when the
    // request was not already for a known locale that just missed above.
    // Serving the root stub for a locale request whose own shell is missing
    // would just bounce right back into the same miss: the stub's inline JS
    // unconditionally redirects to a locale, landing back on this same
    // request with no memory of the failed attempt - an infinite navigation
    // loop instead of the intended graceful degradation (observed in CI: a
    // precache install that transiently failed to fetch one locale shell,
    // e.g. "/en/", left "/" cached but "/en/" not, and every offline nav to
    // "/en/" bounced through "/" and back, forever, never reaching the
    // OFFLINE_FALLBACK_HTML below).
    if (!isLocaleRequest) {
        hit = (await pre.match("/en/")) || (await pre.match("/"));
        if (hit) return hit;
    }
    // Precache evicted (or, for a locale request, just missing that one
    // shell) but the SW is still alive: serve the self-contained offline
    // page instead of the browser error page or an infinite redirect. It
    // auto-reloads when the network returns (which re-precaches the shell).
    return new Response(OFFLINE_FALLBACK_HTML, {
        headers: { "content-type": "text/html; charset=utf-8" },
    });
}

// Cache-first against PRECACHE, then RUNTIME, then network. On a fresh deploy a
// not-yet-reactivated SW may miss a new hash here; we fetch it and mirror it
// into RUNTIME so a later offline load still has it.
async function cacheFirst(req, evt) {
    const pre = await caches.open(PRECACHE);
    const hit = await pre.match(req);
    if (hit) return hit;
    const runtime = await caches.open(RUNTIME);
    try {
        const res = await fetch(req);
        // Deploy skew: a hash the current deployment no longer serves comes
        // back 404. Everything routed here is immutable-by-name, so ANY cached
        // copy is the correct bytes - serve it rather than hand an error page
        // to a <script>/worker load, which "succeeds" and then crashes the
        // module with every field undefined. The old-build copy lives in
        // RUNTIME (see the activate demotion).
        if (!res.ok) {
            const rt = await runtime.match(req);
            if (rt) return rt;
        }
        cacheAndTrim(runtime, req, res, evt);
        return res;
    } catch (err) {
        const rt = await runtime.match(req);
        if (rt) return rt;
        throw err;
    }
}

// cacheName / trim default to the RUNTIME behaviour; the tracker-asset route
// passes the dedicated TRACKER cache with trim=false so its ~14 MB entries are
// never FIFO-evicted.
async function staleWhileRevalidate(req, evt, cacheName = RUNTIME, trim = true) {
    const cache = await caches.open(cacheName);
    const cached = await cache.match(req);
    // Fire the network request in parallel: it refreshes the cache for next
    // time, or serves this request when the cache is empty. The single
    // .catch(() => null) is the ONLY fetch here - it keeps a failed request
    // (offline) from surfacing as an unhandled rejection on both branches: a
    // background revalidation behind a cache hit, and a cache miss with nothing
    // to fall back to.
    const networkPromise = fetch(req)
        .then((res) => {
            cacheAndTrim(cache, req, res, evt, trim);
            return res;
        })
        .catch(() => null);

    if (cached) {
        // Stale-while-revalidate: serve the cache now, let the refresh finish in
        // the background. waitUntil keeps the SW alive for it without blocking
        // the response.
        evt.waitUntil(networkPromise);
        return cached;
    }
    const fresh = await networkPromise;
    if (fresh) return fresh;
    // Network failed and the cache is empty - resolve respondWith with a network
    // error Response. The browser still shows this one resource as failed (the
    // normal offline outcome), but there is no uncaught fetch rejection. The
    // previous `return fetch(req)` re-fetched and logged
    // "Uncaught (in promise) TypeError: Failed to fetch".
    return Response.error();
}

// Schedule a put + trim in the background via evt.waitUntil, without blocking
// the response. res.clone() runs synchronously (the body could be consumed by
// the time the async closure starts); errors from cache.put (quota, storage
// disabled) are swallowed with a warning - we never fail a user-visible
// response over a caching hiccup. Only same-origin, OK, basic responses are
// cached (opaque cross-origin responses have status 0 and are not useful here).
// Redirected responses are skipped: a cached redirected Response served back
// for a navigation throws ("redirected response used for navigation"), and the
// offline-critical shells are precached unredirected anyway.
function cacheAndTrim(cache, req, res, evt, trim = true) {
    if (!res.ok || res.type !== "basic" || res.redirected) return;
    const cloned = res.clone();
    evt.waitUntil(
        (async () => {
            try {
                await cache.put(req, cloned);
                // trim=false for the dedicated TRACKER cache: its ~14 MB entries
                // must not be FIFO-evicted (that would break offline tracking).
                if (trim) await trimCache(cache);
            } catch (err) {
                console.warn("[sw] cache put failed", err);
            }
        })(),
    );
}

// FIFO eviction of the RUNTIME cache down to MAX_RUNTIME_ENTRIES. Cache.keys()
// is insertion order per spec, so the oldest opportunistic entries drop first.
async function trimCache(cache) {
    const keys = await cache.keys();
    if (keys.length <= MAX_RUNTIME_ENTRIES) return;
    const overflow = keys.length - MAX_RUNTIME_ENTRIES;
    await Promise.all(keys.slice(0, overflow).map((r) => cache.delete(r)));
}
