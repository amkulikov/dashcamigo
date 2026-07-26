// Integration test for the precache injection pipeline. Reads the built
// artifacts and asserts:
//
//   1. The manifest the plugin builds from the real dist/ covers the actual
//      boot graph of /en/ (entry <script>, every modulepreload chunk, the
//      stylesheet) and every file in dist/fonts/. A boot dependency missing
//      from the precache is an offline-boot failure visible only in the field.
//
//   2. All prerendered locale shells (/<lang>/) are in the manifest.
//
//   3. The placeholder in dist/sw.js was actually replaced at build time
//      (injection happened) and the minified result is syntactically valid
//      JavaScript. Catches a plugin-order regression (injector after the SW
//      minifier) or a minifier change that breaks the SW.
//
// Like csp-hash.integration.test.ts this runs against artifacts on disk: it
// needs `npm run build` first. Missing dist/ skips locally but THROWS in CI.

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { SEO_LOCALES } from "./i18n/seo-config.js";
import { collectPrecacheEntries } from "../vite-plugins/sw-precache.js";

const DIST_DIR = resolve(__dirname, "..", "dist");
const EN_HTML = resolve(DIST_DIR, "en", "index.html");
const SW = resolve(DIST_DIR, "sw.js");

const hasDist = existsSync(EN_HTML) && existsSync(SW);
if (!hasDist && process.env.CI) {
    throw new Error(
        "sw-precache integration: dist/en/index.html or dist/sw.js missing in CI - run `npm run build` first",
    );
}
const itIf = hasDist ? it : it.skip;

// Root-relative asset URLs the /en/ shell needs to boot: the entry <script>,
// every <link rel=modulepreload>, and the stylesheet.
function bootAssetsOf(html: string): string[] {
    const out: string[] = [];
    const script = html.match(/<script\b[^>]*\bsrc="(\/assets\/[^"]+)"/i);
    if (script?.[1]) out.push(script[1]);
    for (const m of html.matchAll(/<link\b[^>]*\bhref="(\/assets\/[^"]+\.js)"[^>]*\bmodulepreload/gi)) {
        if (m[1]) out.push(m[1]);
    }
    // modulepreload attribute order is not guaranteed - also match rel-first.
    for (const m of html.matchAll(/<link\b[^>]*\bmodulepreload\b[^>]*\bhref="(\/assets\/[^"]+\.js)"/gi)) {
        if (m[1]) out.push(m[1]);
    }
    for (const m of html.matchAll(/<link\b[^>]*\bhref="(\/assets\/[^"]+\.css)"/gi)) {
        if (m[1]) out.push(m[1]);
    }
    return [...new Set(out)];
}

describe("sw-precache integration: manifest covers the real boot graph", () => {
    itIf("every /en/ boot asset (entry, preloads, css) is in the precache manifest", () => {
        const segments = SEO_LOCALES.map((l) => l.urlSegment);
        const urls = new Set(collectPrecacheEntries(DIST_DIR, segments).map((e) => e.url));

        const boot = bootAssetsOf(readFileSync(EN_HTML, "utf-8"));
        expect(boot.length, "parsed at least the entry script + css from /en/").toBeGreaterThanOrEqual(2);
        for (const asset of boot) {
            expect(urls.has(asset), `boot asset ${asset} must be precached`).toBe(true);
        }
    });

    itIf("every self-hosted font is in the precache manifest", () => {
        const segments = SEO_LOCALES.map((l) => l.urlSegment);
        const urls = new Set(collectPrecacheEntries(DIST_DIR, segments).map((e) => e.url));
        const fontDir = resolve(DIST_DIR, "fonts");
        const fonts = existsSync(fontDir) ? readdirSync(fontDir) : [];
        expect(fonts.length, "dist/fonts has self-hosted fonts").toBeGreaterThan(0);
        for (const f of fonts) {
            expect(urls.has(`/fonts/${f}`), `font /fonts/${f} must be precached`).toBe(true);
        }
    });

    itIf("all prerendered locale shells are in the precache manifest", () => {
        const segments = SEO_LOCALES.map((l) => l.urlSegment);
        const urls = new Set(collectPrecacheEntries(DIST_DIR, segments).map((e) => e.url));
        for (const seg of segments) {
            expect(urls.has(`/${seg}/`), `locale shell /${seg}/ must be precached`).toBe(true);
        }
        expect(urls.has("/"), "root stub must be precached").toBe(true);
    });

    itIf("dist/sw.js had its placeholder replaced (injection happened)", () => {
        const sw = readFileSync(SW, "utf-8");
        expect(sw.includes("PRECACHE_MANIFEST = []"), "empty placeholder must be gone after injection").toBe(false);
    });

    itIf("the minified dist/sw.js is syntactically valid JavaScript", () => {
        // Throws (non-zero exit) if the minified SW does not parse.
        expect(() => execFileSync("node", ["--check", SW], { stdio: "ignore" })).not.toThrow();
    });
});
