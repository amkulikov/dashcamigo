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

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Plugin } from "vite";
import { getDefaultSeoLocale } from "../src/i18n/seo-config.js";
import { getAlternativeSlugs } from "./alternative-pages.js";
import { VENDOR_LIST } from "./vendor-list.js";

export function redirectsPlugin(): Plugin {
    return {
        name: "dashcamigo-redirects",
        apply: "build",
        closeBundle() {
            const distDir = resolve(process.cwd(), "dist");
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
            // would fall through to the catch-all 404. Emit both variants per
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
            // page instead of hitting the catch-all 404. Same default-locale
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
            // Catch-all 404. CF Pages applies _redirects rules only when no
            // static asset matches the URL ("Rules apply only if there are
            // no static assets at the URL"), so prerendered /<lang>/index.html,
            // /<lang>/cameras/<slug>/index.html, hashed assets etc. fall through
            // and reach this rule only for genuine not-found requests. Status
            // 404 is preserved end-to-end.
            //
            // Without this rule the dashboard "Single-page application" toggle
            // (enabled on this project) rewrites every miss to /index.html with
            // 200, which is a textbook soft-404 and Google flags it in Search
            // Console. _redirects overrides the SPA toggle - the rule must be
            // the LAST line because CF picks the first matching pattern.
            lines.push("# Catch-all not-found fallback - last rule wins.");
            lines.push("/* /404.html 404");
            lines.push("");

            writeFileSync(resolve(distDir, "_redirects"), lines.join("\n"));
        },
    };
}
