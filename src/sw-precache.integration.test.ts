// Integration test for the precache injection pipeline. Reads the built
// artifacts and asserts:
//
//   1. The manifest the plugin builds from the real dist/ covers every emitted
//      JS/CSS file and local map style/sprite dependencies, including the actual
//      /en/ boot graph, while fonts and decorative media stay cache-as-used.
//      A code dependency missing from the precache is an
//      offline failure visible only in the field.
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
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { SEO_LOCALES } from "./i18n/seo-config.js";
import { collectPrecacheEntries } from "../vite-plugins/sw-precache.js";
import { computeTrackerAssets } from "../vite-plugins/tracker-assets.js";

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

function injectedValue(name: "PRECACHE_MANIFEST" | "TRACKER_ASSET_URLS"): unknown {
    return runInNewContext(`${readFileSync(SW, "utf-8")}\n;${name};`, {
        URL,
        self: { location: { origin: "https://dashcamigo.test" }, addEventListener() {} },
    });
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

    itIf("every emitted JS/CSS file is in the precache manifest", () => {
        const segments = SEO_LOCALES.map((l) => l.urlSegment);
        const urls = new Set(collectPrecacheEntries(DIST_DIR, segments).map((e) => e.url));
        const assets = readdirSync(resolve(DIST_DIR, "assets"), { recursive: true, encoding: "utf8" })
            .filter((file) => /\.(?:m?js|css)$/.test(file))
            .map((file) => file.replaceAll("\\", "/"));
        expect(assets.length, "dist/assets has emitted JS/CSS").toBeGreaterThan(0);
        for (const asset of assets) {
            expect(urls.has(`/assets/${asset}`), `code asset /assets/${asset} must be precached`).toBe(true);
        }
    });

    itIf("all local map styles and sprite variants are available before opening the map", () => {
        const segments = SEO_LOCALES.map((locale) => locale.urlSegment);
        const urls = new Set(collectPrecacheEntries(DIST_DIR, segments).map((entry) => entry.url));
        const styles = readdirSync(resolve(DIST_DIR, "styles"), { recursive: true, encoding: "utf8" })
            .filter((file) => /\.(?:json|png)$/.test(file))
            .map((file) => file.replaceAll("\\", "/"));
        expect(
            styles.some((file) => file.endsWith(".json")),
            "local map style JSON exists",
        ).toBe(true);
        expect(
            styles.some((file) => file.endsWith("@2x.png")),
            "high-density map sprite exists",
        ).toBe(true);
        for (const file of styles) {
            expect(urls.has(`/styles/${file}`), `map dependency /styles/${file} must be precached`).toBe(true);
        }
    });

    itIf("self-hosted fonts stay out of the precache manifest", () => {
        const segments = SEO_LOCALES.map((l) => l.urlSegment);
        const urls = new Set(collectPrecacheEntries(DIST_DIR, segments).map((e) => e.url));
        const fonts = readdirSync(resolve(DIST_DIR, "fonts"));
        expect(fonts.length, "dist/fonts has self-hosted fonts").toBeGreaterThan(0);
        for (const f of fonts) {
            expect(urls.has(`/fonts/${f}`), `font /fonts/${f} must stay cache-as-used`).toBe(false);
        }
    });

    itIf("all prerendered locale shells are in the precache manifest", () => {
        const segments = SEO_LOCALES.map((l) => l.urlSegment);
        const entries = collectPrecacheEntries(DIST_DIR, segments);
        for (const url of ["/", ...segments.map((segment) => `/${segment}/`)]) {
            expect(
                entries.find((entry) => entry.url === url),
                `shell ${url} must carry its build identity`,
            ).toMatchObject({
                htmlRevision: expect.stringMatching(/^[0-9a-f]{16}$/),
            });
        }
    });

    itIf("the injected manifest contains every final artifact and its current content revision", () => {
        const expected = collectPrecacheEntries(
            DIST_DIR,
            SEO_LOCALES.map((locale) => locale.urlSegment),
        );
        expect(injectedValue("PRECACHE_MANIFEST")).toEqual(expected);
    });

    itIf("the injected tracker URLs match the emitted runtime and model bytes", () => {
        const root = resolve(DIST_DIR, "..");
        const assets = computeTrackerAssets("build", root);
        expect(injectedValue("TRACKER_ASSET_URLS")).toEqual(assets.urls);
        for (const url of assets.urls) {
            const emitted = readFileSync(resolve(DIST_DIR, url.slice(1)));
            const model = assets.modelEmit.find((entry) => entry.url === url);
            const source = model
                ? resolve(root, "public", model.rel)
                : resolve(root, "node_modules/onnxruntime-web/dist", url.slice(url.lastIndexOf("/") + 1));
            expect(emitted.equals(readFileSync(source)), `tracker asset ${url} matches its source bytes`).toBe(true);
        }
    });

    itIf("the minified dist/sw.js is syntactically valid JavaScript", () => {
        // Throws (non-zero exit) if the minified SW does not parse.
        expect(() => execFileSync("node", ["--check", SW], { stdio: "ignore" })).not.toThrow();
    });
});
