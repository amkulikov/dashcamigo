// Lock test: CSP in <script id="csp-source"> must equal the
// Content-Security-Policy header emitted by public/_headers.
//
// The renderer in src/ui/csp-modal.ts displays the JSON string as the canonical
// CSP enforced by the browser. If _headers changes and the inline string is
// not updated (or vice versa), the privacy claim on the landing diverges from
// reality. Cheap byte-level check that breaks the build on drift.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const HEADERS_PATH = resolve(process.cwd(), "public/_headers");
const HTML_PATH = resolve(process.cwd(), "index.html");

function extractHeaderCsp(headers: string): string {
    // public/_headers lines look like "  Content-Security-Policy: <value>"
    // (two-space indent inside a path block). Match the policy value to EOL.
    // The leading-whitespace pattern explicitly forbids '#' so a future
    // commented-out "# Content-Security-Policy: <old>" line is ignored.
    const m = headers.match(/^[ \t]+Content-Security-Policy:[ \t]*(.+)$/m);
    if (!m?.[1]) throw new Error("Content-Security-Policy not found in public/_headers");
    return m[1].trim();
}

function extractHtmlCsp(html: string): string {
    const m = html.match(/<script\b[^>]*\bid="csp-source"[^>]*>([\s\S]*?)<\/script>/i);
    if (!m?.[1]) throw new Error('<script id="csp-source"> not found in index.html');
    // The script body is a JSON string literal. Parse it to get the raw CSP.
    return JSON.parse(m[1].trim());
}

/** Sources of a single CSP directive ("connect-src 'self' https://a https://b" ->
 *  ["'self'", "https://a", "https://b"]). Throws if the directive is absent. */
function directiveSources(csp: string, name: string): string[] {
    const dir = csp
        .split(";")
        .map((s) => s.trim())
        .find((d) => d === name || d.startsWith(`${name} `));
    if (!dir) throw new Error(`${name} directive not found in CSP`);
    return dir.slice(name.length).trim().split(/\s+/).filter(Boolean);
}

describe("csp-source", () => {
    it("matches the CSP in public/_headers byte-for-byte", () => {
        const headerCsp = extractHeaderCsp(readFileSync(HEADERS_PATH, "utf-8"));
        const htmlCsp = extractHtmlCsp(readFileSync(HTML_PATH, "utf-8"));
        // If this fails: bring index.html's <script id="csp-source"> in sync with
        // the Content-Security-Policy line in public/_headers (or vice versa).
        expect(htmlCsp).toBe(headerCsp);
    });

    it("connect-src stays a tight allowlist - the network boundary of a no-backend app", () => {
        // Semantic lock, not a byte compare: adding a connect-src host widens where
        // the app may send bytes. That is a change to the "No backend. Video is
        // never uploaded." invariant (CLAUDE.md), so it must go through this test
        // deliberately - never land silently in an unrelated header edit.
        const headerCsp = extractHeaderCsp(readFileSync(HEADERS_PATH, "utf-8"));
        const connect = new Set(directiveSources(headerCsp, "connect-src"));
        expect(connect).toEqual(
            new Set([
                "'self'",
                "https://tiles.openfreemap.org", // map tiles/style
                "https://*.openfreemap.org",
                "https://vector.openstreetmap.org", // vector map fallback
                "https://tile.openstreetmap.org", // raster map fallback
                "https://cloudflareinsights.com", // CF Web Analytics beacon
                "https://o4511528520843264.ingest.de.sentry.io", // Sentry envelope
            ]),
        );
    });
});
