// Root stub HTML generator. Overwrites dist/index.html with a tiny redirect-
// only page after the regular i18n prerender has consumed it as the baseline
// for /en/, /de/, ... outputs.
//
// Why "/" became a stub:
//
//   Before 2026-05 "/" was the English content page (canonical /, urlSegment=""
//   for the default locale). Returning users with localStorage="ru" got
//   redirected to /ru/, but new users with navigator.language="de" stayed on
//   /, applyStaticI18n() swapped the visible text to German, and the URL
//   still said /. A user who copied that URL and shared it landed the
//   receiver on the same / with their own browser-derived language - the
//   share-link was language-non-deterministic.
//
//   The fix is to make / a language-neutral redirect that always sends every
//   visitor to /<lang>/ via the same priority chain (localStorage > navigator
//   > en). The bootstrap script inside this stub does that on the client;
//   <meta http-equiv="refresh"> + <link rel="canonical" href="/en/"> are
//   fallbacks for no-JS bots and for canonicalization signaling.
//
// What this stub serves to crawlers:
//
//   - meta http-equiv=refresh delay=0 → /en/: Googlebot treats instant
//     meta-refresh as equivalent to a 301 (documented behavior). Without
//     JS it follows to /en/ and indexes that page.
//   - link rel=canonical → /en/: any crawler that does index the stub
//     consolidates ranking signals onto /en/ (the English locale's home).
//   - NO robots noindex on production. The stub used to carry
//     "noindex, follow", but noindex next to a canonical-to-another-page
//     sends conflicting signals (Google docs explicitly discourage using
//     noindex for canonicalization: the page is then fully blocked instead
//     of consolidated). The redirect + canonical pair already keeps the
//     stub itself out of the index. Staging builds (options.noIndex) still
//     get the noindex meta like every other page of that deploy.
//   - Full OG/Twitter meta with English copy: Slack/Telegram/Twitter unfurl
//     bots fetch / and need preview metadata. We give them the English
//     defaults since "/" doesn't have a user-selected language at fetch time.
//   - Minimal #dc-loader shell: visual continuity for users who hit / before
//     the JS redirect fires (typical browser: ~5-20ms).
//
// What this stub does NOT contain:
//
//   - No app bundle (no <script type="module">) - the stub is a redirect,
//     not the app. Loading the bundle here would waste bandwidth for every
//     first-visit user before they get to /<lang>/.
//   - No application CSS - same reason. Only inline styles for #dc-loader.
//   - No hreflang cluster - the stub is not a content page so it doesn't
//     emit alternates; the per-locale pages each carry the full cluster.
//
// Plugin ordering:
//
//   This plugin's closeBundle MUST run AFTER i18nPrerenderPlugin (which
//   reads dist/index.html as the source-of-truth baseline and writes
//   dist/<lang>/index.html for each locale) and BEFORE cspHashPlugin (which
//   reads the bootstrap from dist/index.html to compute the inline-script
//   SHA-256 for the _headers CSP allowlist). Both plugins run in closeBundle;
//   Vite executes closeBundle hooks in plugin-array order, so this plugin
//   sits between them in vite.config.ts.

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Plugin } from "vite";
import {
    SITE_ORIGIN,
    getDefaultSeoLocale,
} from "../src/i18n/seo-config.js";
import { enDict } from "../src/i18n/en.js";
import { escapeAttr, escapeText } from "./html-utils.js";

// Staging-only noindex meta - same shape used by vendor-pages.ts
// (noindex, nofollow: staging pages should not be indexed NOR have their
// links crawled as if they were the real site).
const NOINDEX_META = '<meta name="robots" content="noindex, nofollow">';

// Read the bootstrap <script id="dc-bootstrap">...</script> block from the
// baseline dist/index.html. The minifier has already run by closeBundle, so
// the script text is the final form whose SHA-256 cspHashPlugin will compute.
// Reusing that exact block here means the stub and the per-locale pages
// share one CSP hash, not two.
function extractBootstrapScript(distIndexHtml: string): string {
    const match = distIndexHtml.match(/<script\b[^>]*\bid="dc-bootstrap"[^>]*>[\s\S]*?<\/script>/i);
    if (!match) {
        throw new Error(
            "root-stub: <script id=\"dc-bootstrap\"> not found in dist/index.html - " +
                "the stub needs the same bootstrap as the prerendered locale pages",
        );
    }
    return match[0];
}

// Read the inline <style> block (the #dc-loader shell). Same reuse logic as
// extractBootstrapScript - keeps visual continuity between / and /<lang>/.
function extractLoaderStyle(distIndexHtml: string): string {
    // The loader style is the first <style> in <head> (declared right before
    // the bootstrap script in index.html source). We anchor on the contents
    // (#dc-loader) to disambiguate from any other inline <style> a future
    // change might add.
    const match = distIndexHtml.match(/<style\b[^>]*>[^<]*?#dc-loader[\s\S]*?<\/style>/i);
    if (!match) {
        throw new Error(
            "root-stub: inline <style> with #dc-loader not found in dist/index.html",
        );
    }
    return match[0];
}

export interface RootStubOptions {
    // Mirror of SeoBuildOptions.noIndex from seo-prerender.ts. On staging
    // (true) the stub carries the same noindex meta as every other page of
    // the deploy. On production (false) the stub has NO robots meta: it is
    // a redirect (meta refresh 0) with a canonical, and adding noindex on
    // top would conflict with the canonical (see the header comment).
    noIndex?: boolean;
}

export function rootStubPlugin(options: RootStubOptions = {}): Plugin {
    return {
        name: "dashcamigo-root-stub",
        apply: "build",
        // Higher enforce + later position in vite.config.ts plugins array
        // is how we sequence after i18nPrerender. Vite docs: closeBundle
        // hooks run in plugin order.
        closeBundle() {
            const distDir = resolve(process.cwd(), "dist");
            const indexPath = resolve(distDir, "index.html");
            const baseline = readFileSync(indexPath, "utf-8");

            const bootstrapScript = extractBootstrapScript(baseline);
            const loaderStyle = extractLoaderStyle(baseline);

            const defaultLocale = getDefaultSeoLocale();
            // Absolute URL for canonical + og:url (per spec - search engines
            // and OG scrapers expect absolute). Relative URL for meta refresh
            // and the no-JS noscript link - this lets staging deploys
            // (*.pages.dev, localhost preview) bounce within the same host
            // instead of dragging crawlers off to the production domain.
            const defaultHomeAbsolute = `${SITE_ORIGIN}/${defaultLocale.urlSegment}/`;
            const defaultHomeRelative = `/${defaultLocale.urlSegment}/`;
            const enTitle = enDict["page.title"];
            const enDescription = enDict["meta.description"];

            // OG title slightly shorter than dict["page.title"] for unfurl
            // cards - strip the " | dashcamigo" tail used for SERP.
            const ogTitle = enTitle.replace(/ \| dashcamigo$/, "");

            const stub = `<!doctype html>
<html lang="en">
<head>
${options.noIndex ? `${NOINDEX_META}\n` : ""}<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${escapeText(enTitle)}</title>
<meta name="description" content="${escapeAttr(enDescription)}">
<link rel="canonical" href="${defaultHomeAbsolute}">
<meta http-equiv="refresh" content="0; url=${defaultHomeRelative}">
<meta property="og:type" content="website">
<meta property="og:url" content="${defaultHomeAbsolute}">
<meta property="og:site_name" content="dashcamigo">
<meta property="og:title" content="${escapeAttr(ogTitle)}">
<meta property="og:description" content="${escapeAttr(enDescription)}">
<meta property="og:image" content="${SITE_ORIGIN}/og-cover.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:type" content="image/png">
<meta property="og:locale" content="en_US">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeAttr(ogTitle)}">
<meta name="twitter:description" content="${escapeAttr(enDescription)}">
<meta name="twitter:image" content="${SITE_ORIGIN}/og-cover.png">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="alternate icon" href="/favicon.ico" sizes="any">
<link rel="apple-touch-icon" href="/favicon-192.png">
<link rel="manifest" href="/manifest.webmanifest">
<meta name="theme-color" content="#ff9000">
${loaderStyle}
${bootstrapScript}
</head>
<body>
<div id="dc-loader" role="status" aria-label="loading"></div>
<noscript><p style="color:#fff;background:#000;font:14px system-ui;padding:1em;margin:0">JavaScript is disabled. <a href="${defaultHomeRelative}" style="color:#ff9000">Continue to dashcamigo</a>.</p></noscript>
</body>
</html>
`;
            writeFileSync(indexPath, stub);
        },
    };
}
