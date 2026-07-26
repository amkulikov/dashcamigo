// Computes SHA-256 of the inline <script id="dc-bootstrap"> in
// dist/index.html and splices 'sha256-...' into the script-src directive
// of dist/_headers. Required because our CSP disallows 'unsafe-inline'
// (see public/_headers) and the bootstrap script must run synchronously
// in <head> before any paint - moving it to an external /bootstrap.js
// would add a render-blocking round-trip we explicitly want to avoid.
//
// Why hash and not nonce: nonce requires per-request HTML rewriting
// (CF Pages Function / Worker generating a fresh value per response).
// Our bootstrap script is byte-identical across builds - a static hash
// in _headers fits this perfectly without new infrastructure.
//
// Hashing happens AFTER html-minifier-terser ran (minifyJS: true in
// minifyHtmlPlugin runs terser over the inline body) - the bytes the
// browser will hash on load are exactly what we read from disk here.
//
// One hash covers all prerendered HTMLs: i18nPrerenderPlugin and
// vendorPagesPlugin only touch data-i18n nodes, og:* / canonical
// metas, FAQ JSON-LD and href="/cameras/" links - never our bootstrap
// script. Confirmed by reading both plugins.
//
// Plugin order: registered AFTER the SEO plugins so dist/index.html is
// in its final form when we read it. _headers is copied from public/
// by Vite during build (public/* assets pass through unchanged), so
// it exists at closeBundle time.

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Plugin } from "vite";

const BOOTSTRAP_SCRIPT_RE = /<script\b[^>]*\bid="dc-bootstrap"[^>]*>([\s\S]*?)<\/script>/;

// Anchors on "script-src 'self'" - the first allowlist token, present
// regardless of which external origins follow. Splicing the hash right
// after 'self' keeps the directive readable in the rendered _headers.
const CSP_SCRIPT_SRC_RE = /(Content-Security-Policy:[^\n]*?script-src 'self')(\s)/;

export function cspHashPlugin(): Plugin {
    return {
        name: "dashcamigo-csp-hash",
        apply: "build",
        closeBundle() {
            const distDir = resolve(process.cwd(), "dist");
            const indexPath = resolve(distDir, "index.html");
            const html = readFileSync(indexPath, "utf-8");
            const match = BOOTSTRAP_SCRIPT_RE.exec(html);
            if (!match) {
                throw new Error('csp-hash: <script id="dc-bootstrap"> not found in dist/index.html');
            }
            const scriptBody = match[1] ?? "";
            const hash = createHash("sha256").update(scriptBody, "utf-8").digest("base64");
            const directive = `'sha256-${hash}'`;

            const headersPath = resolve(distDir, "_headers");
            const headers = readFileSync(headersPath, "utf-8");
            if (!CSP_SCRIPT_SRC_RE.test(headers)) {
                throw new Error("csp-hash: script-src 'self' anchor not found in dist/_headers");
            }
            const updated = headers.replace(CSP_SCRIPT_SRC_RE, `$1 ${directive}$2`);
            writeFileSync(headersPath, updated);
        },
    };
}
