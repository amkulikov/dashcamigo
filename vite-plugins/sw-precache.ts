// Build-time precache-manifest injector for public/sw.js.
//
// The service worker ships with an empty `const PRECACHE_MANIFEST = [];`
// placeholder (so dev works with no injection). At build time this plugin scans
// the finished dist/, computes a per-file content revision, and replaces the
// placeholder with the real manifest. The SW then reconciles that manifest into
// a cache on install, so an installed PWA boots and runs offline.
//
// What goes IN the precache (the app's real boot+run graph):
//   - JS/CSS under /assets/ (entry, lazy chunks and workers);
//   - every per-locale shell (/<lang>/) and the root stub (/).
// What stays OUT (loaded and cached only if the page actually requests it):
//   - fonts, icons and other media. The SW cache-first route stores fonts when
//     the page actually uses their unicode range; a missing offline font falls
//     back to the system face and cannot break app functionality;
//   - the web app manifest and install icons. The browser/OS owns installed-PWA
//     metadata; duplicating it in the app's Cache Storage does not help boot;
//   - SEO/marketing/legal HTML (privacy, 404, /<lang>/cameras, /alternatives…),
//     OG/share images, screenshots, sitemap/robots/llms - none are needed to
//     boot the app, and precaching them would pin stale markup and waste quota.
//
// Revision = first 16 hex of the file's SHA-256. Hashed asset filenames already
// encode content, but a uniform per-file revision lets the SW reconcile every
// entry the same way (re-fetch only when the revision changed), including the
// non-hashed HTML shells.
//
// ORDERING (critical): this plugin's closeBundle MUST run
//   - AFTER i18nPrerenderPlugin + rootStubPlugin (so all locale shells and the stub
//     exist in dist/), and after Vite has emitted assets and copied public/sw.js;
//   - BEFORE minifyServiceWorker() (which reads, minifies and overwrites
//     dist/sw.js) - we must inject into the readable source first.
// Vite runs closeBundle hooks in plugin-array order, so this plugin sits after
// rootStubPlugin and before minifyServiceWorker in vite.config.ts.

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Plugin } from "vite";
import { SEO_LOCALES } from "../src/i18n/seo-config.js";

export interface PrecacheEntry {
    // Same-origin, root-relative URL as the page requests it (locale shells use
    // the trailing-slash directory form "/en/", not "/en/index.html", so the
    // navigation match hits).
    url: string;
    // First 16 hex chars of the file's SHA-256 content hash.
    revision: string;
}

function sha16(buf: Buffer): string {
    return createHash("sha256").update(buf).digest("hex").slice(0, 16);
}

// Recursively list files under `dir`, returning paths relative to `dir` with
// forward slashes. Returns [] if the directory does not exist.
function listFilesRecursive(dir: string, base = dir): string[] {
    if (!existsSync(dir)) return [];
    const out: string[] = [];
    for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) {
            out.push(...listFilesRecursive(full, base));
        } else {
            out.push(full.slice(base.length + 1).split(/[\\/]/).join("/"));
        }
    }
    return out;
}

/**
 * Build the precache manifest by scanning `distDir`. Pure (no writes) so it can
 * be unit-tested against a synthetic dist tree.
 *
 * @param distDir absolute path to the build output directory
 * @param localeSegments url segments of the prerendered locale homes (e.g.
 *        ["de","en",...]); each must have a "<seg>/index.html" shell or the
 *        build is incomplete and this throws.
 * @returns manifest entries sorted by url (deterministic output)
 */
export function collectPrecacheEntries(distDir: string, localeSegments: ReadonlyArray<string>): PrecacheEntry[] {
    const entries: PrecacheEntry[] = [];
    const add = (relFile: string, url: string): void => {
        const full = resolve(distDir, relFile);
        entries.push({ url, revision: sha16(readFileSync(full)) });
    };

    // 1) Functional code under /assets/ (recursive). Vite gives every emitted
    // JS/CSS file a content hash; images and other media are presentation-only
    // and stay cache-as-used. WASM under /assets/ is an unused ORT duplicate;
    // the tracker loads its runtime from /ort/ into its dedicated cache.
    for (const rel of listFilesRecursive(resolve(distDir, "assets"))) {
        if (!rel.endsWith(".js") && !rel.endsWith(".css")) continue;
        add(`assets/${rel}`, `/assets/${rel}`);
    }

    // 2) Per-locale shells, requested as "/<seg>/" (CF serves the index.html).
    for (const seg of localeSegments) {
        const rel = `${seg}/index.html`;
        if (!existsSync(resolve(distDir, rel))) {
            throw new Error(`sw-precache: locale shell ${rel} missing in dist - prerender did not run before this plugin`);
        }
        add(rel, `/${seg}/`);
    }

    // 3) Root stub "/".
    if (!existsSync(resolve(distDir, "index.html"))) {
        throw new Error("sw-precache: dist/index.html missing - root stub did not run before this plugin");
    }
    add("index.html", "/");

    entries.sort((a, b) => (a.url < b.url ? -1 : a.url > b.url ? 1 : 0));
    return entries;
}

const PLACEHOLDER = /const PRECACHE_MANIFEST = \[\];\s*\/\/ __DC_PRECACHE_MANIFEST__/;

export function swPrecachePlugin(): Plugin {
    return {
        name: "dashcamigo-sw-precache",
        apply: "build",
        closeBundle() {
            const distDir = resolve(process.cwd(), "dist");
            const swPath = resolve(distDir, "sw.js");
            if (!existsSync(swPath)) {
                throw new Error("sw-precache: dist/sw.js missing - public/ copy did not run before this plugin");
            }

            const localeSegments = SEO_LOCALES.map((l) => l.urlSegment);
            const entries = collectPrecacheEntries(distDir, localeSegments);

            // Sanity: the entry must include at least one JS chunk, or the SW
            // would precache no app code and "offline" would silently mean
            // "blank page" - exactly the failure mode this exists to prevent.
            if (!entries.some((e) => e.url.startsWith("/assets/") && e.url.endsWith(".js"))) {
                throw new Error("sw-precache: no /assets/*.js in dist - the build shape changed; re-check this plugin");
            }

            const sw = readFileSync(swPath, "utf-8");
            if (!PLACEHOLDER.test(sw)) {
                throw new Error("sw-precache: PRECACHE_MANIFEST placeholder not found in dist/sw.js");
            }
            const injected = sw.replace(PLACEHOLDER, `const PRECACHE_MANIFEST = ${JSON.stringify(entries)};`);
            writeFileSync(swPath, injected);

            const bytes = entries.reduce((n, e) => {
                try {
                    return n + statSync(resolve(distDir, e.url === "/" ? "index.html" : urlToRel(e.url))).size;
                } catch {
                    return n;
                }
            }, 0);
            console.log(
                `[sw-precache] injected ${entries.length} precache entries (~${(bytes / 1024 / 1024).toFixed(1)} MB)`,
            );
        },
    };
}

// Map a precached URL back to its dist-relative path for the size report. Locale
// shells "/en/" map to "en/index.html"; everything else drops the leading slash.
function urlToRel(url: string): string {
    if (/^\/[a-z]{2}\/$/.test(url)) return `${url.slice(1)}index.html`;
    return url.replace(/^\//, "");
}
