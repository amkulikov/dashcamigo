// Generates dist/_redirects for Cloudflare Pages. The _redirects file is a
// static config that CF Pages reads on deploy and applies as edge-level
// 301/302/308 redirects - NOT a Pages Function (which we cannot use on the
// current plan). Format docs: https://developers.cloudflare.com/pages/configuration/redirects/
//
// Why this exists:
//
//   Before 2026-05 English vendor pages lived at /cameras/<slug>/ (English
//   was the default locale with urlSegment=""). The migration moves them to
//   /en/cameras/<slug>/ to make every locale symmetric. The old paths may be
//   in:
//     - external backlinks (forum posts, social shares)
//     - Google's index (post-deploy reindexing takes 2-4 weeks)
//     - users' bookmarks
//   so we keep them resolvable via a server-side 301 to the new location.
//   301 preserves link equity (PageRank carries forward); a JS stub redirect
//   wouldn't, and Google would re-evaluate the page as a near-duplicate.
//
// Pages with no _redirects line:
//
//   The site root "/" is NOT in _redirects: it serves a JS stub that resolves
//   the visitor's preferred locale and redirects via location.replace.
//   _redirects could only do a static 302 to one locale, which would defeat
//   the purpose. Same reason "/cameras/" and "/cameras/<slug>/" don't end up
//   doing client-side lang detection - they're language-agnostic legacy URLs
//   that map to a single English destination.

import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Plugin } from "vite";
import { getDefaultSeoLocale, getIndexableSeoLocales } from "../src/i18n/seo-config.js";
import { getAlternativeSlugs } from "./alternative-pages.js";
import { VENDOR_LIST } from "./vendor-list.js";

export function redirectsPlugin(): Plugin {
    return {
        name: "dashcamigo-redirects",
        apply: "build",
        closeBundle() {
            const distDir = resolve(process.cwd(), "dist");
            // A top-level 404.html disables Pages' SPA fallback. _redirects
            // does not support 404 rewrites; a catch-all also shadows assets.
            if (!existsSync(resolve(distDir, "404.html"))) {
                throw new Error("redirects: 404.html is required to prevent soft 404 responses");
            }
            const defaultSegment = getDefaultSeoLocale().urlSegment;
            // Sanity check - if the default locale somehow becomes empty
            // again, this file would 301 to /cameras/, an infinite loop.
            if (!defaultSegment) {
                throw new Error(
                    "redirects: default locale has empty urlSegment - cannot build legacy /cameras/* redirects",
                );
            }

            const lines: string[] = [];
            lines.push("# Cloudflare Pages _redirects.");
            lines.push("# Generated at build time by vite-plugins/redirects.ts.");
            lines.push("# Format: source destination status");
            lines.push("");
            lines.push("# Legacy English vendor URLs - pre-2026-05 they lived directly");
            lines.push("# under /cameras/<slug>/ because English was the default locale");
            lines.push("# with an empty URL segment. After migration they live under");
            lines.push("# /<defaultSegment>/cameras/<slug>/. 301 preserves PageRank.");
            // Single-space separator per CF Pages _redirects spec examples.
            // The runtime parses multiple spaces too, but stick to documented
            // format to avoid relying on permissive parsing.
            //
            // Trailing slashes are significant in _redirects matching (the CF
            // docs treat "/trailing" and "/trailing/" as distinct patterns),
            // and there is no asset at these legacy paths to trigger CF's
            // slash normalization - a slashless backlink (/cameras/70mai)
            // would return a 404. Emit both variants per
            // legacy path; the destination is always slash-terminated (the
            // canonical form CF Pages serves).
            const pushBothSlashVariants = (sourcePath: string, destinationPath: string): void => {
                lines.push(`${sourcePath} ${destinationPath} 301`);
                lines.push(`${sourcePath}/ ${destinationPath} 301`);
            };
            for (const vendor of VENDOR_LIST) {
                pushBothSlashVariants(
                    `/cameras/${vendor.slug}`,
                    `/${defaultSegment}/cameras/${vendor.slug}/`,
                );
            }
            lines.push("");
            lines.push("# Legacy English /cameras/ section hub.");
            pushBothSlashVariants("/cameras", `/${defaultSegment}/cameras/`);
            lines.push("");
            // Alternative-to pages never had a bare (locale-less) URL - they were
            // born under /<lang>/. These 301s exist only so a hand-typed or
            // externally-linked /alternatives/<slug>/ resolves to the English
            // page instead of returning a 404. Same default-locale
            // target and PageRank-preserving 301 as the /cameras/ block above.
            lines.push("# Locale-less /alternatives/* -> English variant.");
            for (const slug of getAlternativeSlugs()) {
                pushBothSlashVariants(
                    `/alternatives/${slug}`,
                    `/${defaultSegment}/alternatives/${slug}/`,
                );
            }
            pushBothSlashVariants("/alternatives", `/${defaultSegment}/alternatives/`);
            lines.push("");
            // NAVITEL used to live under the alternatives section as a
            // competitor page. It is now a supported-camera page; preserve
            // indexed URLs and send each old locale to the matching new page
            // where it exists, otherwise to the English canonical.
            lines.push("# Retired NAVITEL alternative page -> supported-camera page.");
            const navitel = VENDOR_LIST.find((vendor) => vendor.slug === "navitel");
            if (!navitel) {
                throw new Error("redirects: NAVITEL landing page is missing");
            }
            pushBothSlashVariants(
                "/alternatives/navitel-dvr-player",
                `/${defaultSegment}/cameras/navitel/`,
            );
            for (const locale of getIndexableSeoLocales()) {
                const destinationSegment = navitel.locales.includes(locale.lang)
                    ? locale.urlSegment
                    : defaultSegment;
                pushBothSlashVariants(
                    `/${locale.urlSegment}/alternatives/navitel-dvr-player`,
                    `/${destinationSegment}/cameras/navitel/`,
                );
            }
            lines.push("");
            // These pages existed before locale coverage became explicit but
            // had no meaningful search visibility. Redirect instead of
            // leaving indexed URLs as 404s after the build stops emitting them.
            lines.push("# Retired low-signal vendor locales -> English canonical.");
            for (const retiredPage of [
                { source: "/pt/cameras/blackvue", slug: "blackvue" },
                { source: "/ko/cameras/garmin", slug: "garmin" },
                { source: "/pt/cameras/vantrue", slug: "vantrue" },
                { source: "/pt/cameras/thinkware", slug: "thinkware" },
            ]) {
                pushBothSlashVariants(
                    retiredPage.source,
                    `/${defaultSegment}/cameras/${retiredPage.slug}/`,
                );
            }
            lines.push("");
            // Retired locales: kk and uk pages no longer build, but their URLs
            // sit in search indexes and bookmarks. 301 to the English
            // (x-default) variant - :splat preserves the deep path, so
            // /uk/cameras/70mai/ lands on the English page, not the homepage.
            lines.push("# Retired locales -> English (x-default) variant.");
            for (const retired of ["kk", "uk"]) {
                lines.push(`/${retired} /${defaultSegment}/ 301`);
                lines.push(`/${retired}/* /${defaultSegment}/:splat 301`);
            }
            lines.push("");
            writeFileSync(resolve(distDir, "_redirects"), lines.join("\n"));
        },
    };
}
