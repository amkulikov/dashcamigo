// Offline PWA regression gate. The reported bug: an installed app opened with
// no network showed the browser's built-in "you're offline" page instead of the
// cached app. These specs install the service worker online, wait for it to
// activate and control the page (so its precache is populated), then cut the
// network and assert the SW serves the app from cache.
//
// Why this spec does NOT use the shared _fixtures harness:
//   Playwright's offline emulation (context.setOffline / CDP
//   Network.emulateNetworkConditions) fails the renderer's *declarative*
//   subresource loads (<script src>, <link href>) BEFORE they reach the service
//   worker, even when the page is SW-controlled and the resource is cached.
//   A programmatic fetch() of the same URL from the same page IS served from
//   the SW cache (verified) - which is how real Chrome serves an offline PWA's
//   subresources. So the Playwright failure is a tooling artifact, not a real
//   bug; but it means an offline reload logs benign "Failed to load resource"
//   console errors that the shared fixture's strict teardown would flag. We
//   therefore assert offline behavior two ways that ARE reliable under
//   Playwright: (a) the navigation document is served from cache (the exact
//   thing that was broken - the launch no longer hits the browser offline
//   page), and (b) every functional code resource is served from the SW cache via
//   programmatic fetch (proving the app has all it needs to run offline).

import { expect, test } from "@playwright/test";

const READY_TIMEOUT = 20_000;

// Load /en/ online and wait until OUR service worker controls the page.
// `controller` alone is the sufficient (and strongest) signal: it is set by
// clients.claim() in the activate handler, which the browser runs only after
// the install waitUntil (the precache reconcile) settled - so a controlled
// page implies the shell is fully cached. A fresh context has no prior SW, so
// the controller can only be this test's worker.
//
// The predicate MUST stay synchronous: waitForFunction does not await an async
// predicate - it sees the returned Promise object, which is always truthy, and
// resolves on the first poll. An async predicate here silently turns the gate
// into a no-op, so setOffline() then cuts the network mid-install, kills the
// in-flight precache fetches (holes in the cache), and runs assertions against
// a not-yet-controlled page (every fetch bypasses the SW into the dead
// network) - the exact flake this gate exists to prevent.
async function installServiceWorker(page: import("@playwright/test").Page): Promise<void> {
    await page.addInitScript(() => {
        try {
            localStorage.setItem("dashcamigo:lang", "en");
            localStorage.setItem("dc-theme", "dark");
        } catch {
            /* private mode - ignore */
        }
    });
    await page.goto("/en/");
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, {
        timeout: READY_TIMEOUT,
    });
}

// Run an offline top-level navigation, retrying until the service worker serves
// it. Playwright's offline emulation does not compose reliably with SW
// navigation interception on Chromium (microsoft/playwright#2311): even with the
// worker active and controlling the page, an offline reload/goto can race the
// worker's startup and fall through to the (now-dead) network, throwing
// ERR_INTERNET_DISCONNECTED - though the SW's navigation handler itself always
// returns a Response (worst case the baked-in offline page), so a routed
// navigation never errors. The race is transient: the first navigation warms the
// worker, and the retry routes through it. We retry the navigation IN-test on
// purpose - a Playwright per-test retry would not help, since each retry is a
// fresh context that re-hits the same cold start. A genuinely broken offline
// navigation still fails: every attempt throws until READY_TIMEOUT and toPass
// surfaces the last error - no silent pass.
async function navigateOffline(navigate: () => Promise<unknown>): Promise<void> {
    await expect(navigate).toPass({ timeout: READY_TIMEOUT });
}

test.describe("offline", () => {
    test("offline reload serves the cached app shell, not the browser offline page", async ({ page, context }) => {
        await installServiceWorker(page);
        await context.setOffline(true);

        await navigateOffline(() => page.reload());

        // The cached /en/ document is served by the SW. The browser's built-in
        // offline page would carry neither the app title nor #folder-input - so
        // these two assertions distinguish "served from cache" from "you're
        // offline". (JS does not fully boot here only because of the Playwright
        // subresource artifact described in the file header.)
        await expect(page).toHaveTitle(/dashcamigo/i);
        await expect(page.locator("#folder-input")).toBeAttached();
    });

    test("offline PWA start_url (/?source=pwa) resolves to a cached locale shell", async ({ page, context }) => {
        await installServiceWorker(page);
        await context.setOffline(true);

        // The manifest's start_url. Offline this must NOT hit the browser error
        // page: the root stub is served (the cache match ignores the query
        // string), its inline JS redirects to /en/, and /en/ is cache-served
        // too (also query-agnostic). The stub goto warms the worker; the
        // client-side redirect to /en/ then routes through the now-warm SW.
        await navigateOffline(() => page.goto("/?source=pwa"));
        await page.waitForURL(/\/en\//, { timeout: READY_TIMEOUT });
        await expect(page.locator("#folder-input")).toBeAttached();
    });

    test("service worker serves the functional offline code graph from cache", async ({ page, context }) => {
        await installServiceWorker(page);

        // The asset URLs the /en/ document declares: entry <script>, every
        // modulepreload chunk and the stylesheet. Fonts deliberately stay out:
        // their unicode-range files cache only when used, and system fonts are
        // the functional offline fallback.
        const declared = await page.evaluate(() => {
            const urls = new Set<string>();
            for (const s of document.querySelectorAll<HTMLScriptElement>("script[src]")) {
                urls.add(new URL(s.src).pathname);
            }
            for (const l of document.querySelectorAll<HTMLLinkElement>(
                'link[rel="modulepreload"][href], link[rel="stylesheet"][href]',
            )) {
                urls.add(new URL(l.href).pathname);
            }
            return [...urls].filter((u) => u.startsWith("/assets/"));
        });
        expect(declared.length, "parsed the entry + preloads + css from /en/").toBeGreaterThanOrEqual(2);

        // A worker chunk: proves the offline cache covers ingest (reading an SD
        // card spins up these workers), not just the landing shell.
        const workerChunk = await page.evaluate(async () => {
            const name = (await caches.keys()).find((n) => n.includes("precache"));
            if (!name) return null;
            const keys = await (await caches.open(name)).keys();
            return (
                keys
                    .map((r) => new URL(r.url).pathname)
                    .find((p) => /\/assets\/(ingest|indexer|gps-extract)-worker-/.test(p)) ?? null
            );
        });
        expect(workerChunk, "an ingest worker chunk is precached").not.toBeNull();

        const probe = [...declared, workerChunk as string, "/en/"];
        await context.setOffline(true);

        // Programmatic fetch() from the SW-controlled page routes through the SW
        // fetch handler - the exact code path that serves declarative loads in a
        // real browser. Every boot resource must come back as a cached basic 200.
        const results = await page.evaluate(async (urls) => {
            const out: Record<string, boolean> = {};
            for (const u of urls) {
                try {
                    const r = await fetch(u);
                    out[u] = r.ok && r.type === "basic";
                } catch {
                    out[u] = false;
                }
            }
            return out;
        }, probe);

        for (const [u, ok] of Object.entries(results)) {
            expect(ok, `${u} must be served from the SW cache offline`).toBe(true);
        }
    });

    test("evicted cache but live SW: navigation gets the self-contained fallback, not the browser error", async ({
        page,
        context,
    }) => {
        await installServiceWorker(page);
        // Simulate the Android sub-case where the browser evicts Cache Storage
        // but the SW registration survives: wipe every cache, keep the worker.
        await page.evaluate(async () => {
            for (const k of await caches.keys()) await caches.delete(k);
        });
        await context.setOffline(true);

        await navigateOffline(() => page.goto("/en/"));
        // The SW served its baked-in fallback (no external refs), so the page
        // renders our retry UI rather than the browser's offline page.
        await expect(page.locator("#dc-r")).toBeVisible();
        await expect(page.locator("#dc-t")).toHaveText(/offline/i);
    });

    test("offline banner shows when connectivity drops and clears when it returns", async ({ page, context }) => {
        // Load online first so the app boots fully (this avoids the offline-reload
        // subresource artifact in the file header - the page JS is already
        // running, and setOffline just fires the 'offline' event into it).
        await installServiceWorker(page);
        const banner = page.locator("#offline-banner");
        await expect(banner).toBeHidden();

        await context.setOffline(true);
        await expect(banner).toBeVisible();
        await expect(page.locator(".offline-banner-label")).toHaveText(/offline/i);
        // body class drives the layout re-base (topbar tokens) - assert it flips.
        await expect(page.locator("body")).toHaveClass(/has-offline-banner/);

        // Info button toggles the detail popover.
        const popover = page.locator("#offline-banner-popover");
        await expect(popover).toBeHidden();
        await page.locator("#offline-banner-info").click();
        await expect(popover).toBeVisible();

        await context.setOffline(false);
        await expect(banner).toBeHidden();
        await expect(page.locator("body")).not.toHaveClass(/has-offline-banner/);
    });
});
