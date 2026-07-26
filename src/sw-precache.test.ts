// Unit test for the precache-manifest builder (vite-plugins/sw-precache.ts).
//
// Hermetic: builds a synthetic dist/ tree in a temp dir and asserts
// collectPrecacheEntries picks up exactly the app boot+run graph and nothing
// else. A missing font or entry chunk in the manifest is an offline-boot
// failure that only shows up in the field, so this is the cheap gate that
// catches a scan-scope regression at build time.

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { collectPrecacheEntries } from "../vite-plugins/sw-precache.js";

const created: string[] = [];

afterAll(() => {
    for (const dir of created) rmSync(dir, { recursive: true, force: true });
});

// Build a synthetic dist/ tree. `files` maps a dist-relative path to its
// content; parent dirs are created as needed. Returns the temp dist dir.
function makeDist(files: Record<string, string>): string {
    const dir = mkdtempSync(join(tmpdir(), "dc-sw-"));
    created.push(dir);
    for (const [rel, content] of Object.entries(files)) {
        const full = join(dir, rel);
        mkdirSync(join(full, ".."), { recursive: true });
        writeFileSync(full, content);
    }
    return dir;
}

// A realistic-enough tree: app assets + fonts + two locale shells + stub +
// manifest + icons, plus the SEO/marketing noise that must stay OUT.
function realisticDist(): string {
    return makeDist({
        "assets/index-AAAA1111.js": "// entry",
        "assets/index-BBBB2222.css": "/* css */",
        "assets/maplibre-CCCC3333.js": "// maplibre",
        "assets/ingest-worker-DDDD.js": "// worker",
        "fonts/inter-var-latin.woff2": "FONT",
        "fonts/space-grotesk-700-latin.woff2": "FONT2",
        "en/index.html": "<html>en</html>",
        "ru/index.html": "<html>ru</html>",
        "index.html": "<html>stub</html>",
        "manifest.webmanifest": "{}",
        "favicon.svg": "<svg/>",
        "favicon-192.png": "PNG",
        "icon-maskable-512.png": "PNG",
        // Noise - must NOT be precached:
        "og-cover.png": "PNG",
        "pwa-install-card-wide.png": "PNG",
        "privacy.html": "<html>privacy</html>",
        "robots.txt": "noindex",
        "sitemap.xml": "<urlset/>",
        "en/cameras/70mai/index.html": "<html>vendor</html>",
        "sw.js": "// the SW itself must not precache itself",
    });
}

describe("collectPrecacheEntries", () => {
    it("includes the full app shell (assets, fonts, locale shells, stub, manifest, icons)", () => {
        const dir = realisticDist();
        const urls = collectPrecacheEntries(dir, ["en", "ru"]).map((e) => e.url);

        expect(urls).toEqual(
            expect.arrayContaining([
                "/assets/index-AAAA1111.js",
                "/assets/index-BBBB2222.css",
                "/assets/maplibre-CCCC3333.js",
                "/assets/ingest-worker-DDDD.js",
                "/fonts/inter-var-latin.woff2",
                "/fonts/space-grotesk-700-latin.woff2",
                "/en/",
                "/ru/",
                "/",
                "/manifest.webmanifest",
                "/favicon.svg",
                "/favicon-192.png",
                "/icon-maskable-512.png",
            ]),
        );
    });

    it("excludes SEO/marketing/legal pages, share images and the SW itself", () => {
        const dir = realisticDist();
        const urls = new Set(collectPrecacheEntries(dir, ["en", "ru"]).map((e) => e.url));

        for (const out of [
            "/og-cover.png",
            "/pwa-install-card-wide.png",
            "/privacy.html",
            "/robots.txt",
            "/sitemap.xml",
            "/en/cameras/70mai/",
            "/en/cameras/70mai/index.html",
            "/sw.js",
        ]) {
            expect(urls.has(out), `${out} must NOT be precached`).toBe(false);
        }
    });

    it("excludes .wasm from the shell (runtime lazy download, not boot shell)", () => {
        // The ~13 MB onnxruntime wasm is emitted into /assets by the bundler but
        // loaded from /ort/ at runtime; precaching the /assets duplicate only
        // bloats the shell and races eviction. JS/CSS/fonts stay in.
        const dir = makeDist({
            "assets/index-AAAA1111.js": "// entry",
            "assets/ort-wasm-simd-threaded-Cpm-ox6i.wasm": "WASM",
            "en/index.html": "<html>en</html>",
            "index.html": "<html>stub</html>",
        });
        const urls = new Set(collectPrecacheEntries(dir, ["en"]).map((e) => e.url));
        expect(urls.has("/assets/index-AAAA1111.js")).toBe(true);
        expect(urls.has("/assets/ort-wasm-simd-threaded-Cpm-ox6i.wasm")).toBe(false);
    });

    it("uses the trailing-slash navigation form for locale shells, not index.html", () => {
        const dir = realisticDist();
        const urls = new Set(collectPrecacheEntries(dir, ["en", "ru"]).map((e) => e.url));
        expect(urls.has("/en/")).toBe(true);
        expect(urls.has("/en/index.html")).toBe(false);
    });

    it("gives every entry a 16-hex content revision, and the revision tracks content", () => {
        const a = collectPrecacheEntries(makeDist({ "en/index.html": "v1", "index.html": "x", "assets/x.js": "x" }), [
            "en",
        ]);
        const enA = a.find((e) => e.url === "/en/");
        expect(enA?.revision).toMatch(/^[0-9a-f]{16}$/);

        const b = collectPrecacheEntries(makeDist({ "en/index.html": "v2", "index.html": "x", "assets/x.js": "x" }), [
            "en",
        ]);
        const enB = b.find((e) => e.url === "/en/");
        // Same path, different content -> different revision (drives reconcile).
        expect(enB?.revision).not.toBe(enA?.revision);
    });

    it("returns entries sorted by url (deterministic injection output)", () => {
        const urls = collectPrecacheEntries(realisticDist(), ["en", "ru"]).map((e) => e.url);
        const sorted = [...urls].sort();
        expect(urls).toEqual(sorted);
    });

    it("throws when a prerendered locale shell is missing (incomplete build)", () => {
        const dir = makeDist({ "en/index.html": "en", "index.html": "stub", "assets/x.js": "x" });
        // "de" has no shell in this tree.
        expect(() => collectPrecacheEntries(dir, ["en", "de"])).toThrow(/de\/index\.html missing/);
    });

    it("throws when the root stub is missing", () => {
        const dir = makeDist({ "en/index.html": "en", "assets/x.js": "x" });
        expect(() => collectPrecacheEntries(dir, ["en"])).toThrow(/index\.html missing/);
    });
});
