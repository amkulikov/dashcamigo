// Shared headless-Chrome renderer for the brand-asset generator scripts
// (generate-pwa-install-card.mjs, generate-og-cover.mjs).
//
// Why Chrome and not puppeteer/playwright: these scripts run maybe once a
// year, by hand, when the brand changes - a system Chrome screenshot keeps
// them dependency-free. The input HTML must be self-contained (fonts inlined
// as data: URIs, no subresources), so file:// + --virtual-time-budget is
// deterministic.

import { execFileSync } from "node:child_process";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Candidate Chrome paths. First existing one wins. Mac first (main dev env),
// then Linux/Windows. No silent fallback: bail with a clear message if absent.
const CHROME_PATHS = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
];

/** Returns the first available Chrome/Chromium binary, or exits the process
 *  with a clear message - callers never need a fallback path. */
export function findChrome() {
    const chrome = CHROME_PATHS.find(existsSync);
    if (!chrome) {
        console.error("Chrome/Chromium not found. Install Google Chrome or extend CHROME_PATHS.");
        process.exit(1);
    }
    console.log(`using chrome: ${chrome}`);
    return chrome;
}

/** Renders a self-contained HTML string to a PNG of exactly width x height.
 *  The HTML must not reference network/file subresources (inline everything).
 *  tmpName keeps parallel scripts from clobbering each other's temp file. */
export function renderHtmlToPng({ chrome, html, width, height, outPath, tmpName }) {
    const tmpHtml = resolve(tmpdir(), tmpName);
    writeFileSync(tmpHtml, html);
    try {
        execFileSync(
            chrome,
            [
                "--headless=new",
                "--hide-scrollbars",
                "--disable-gpu",
                "--no-sandbox",
                // Pin DSF to 1 so --window-size maps 1:1 to output pixels
                // (otherwise a hi-dpi machine would double the dimensions).
                "--force-device-scale-factor=1",
                `--window-size=${width},${height}`,
                `--screenshot=${outPath}`,
                // Fonts are inlined (data: URI), so paint is fast; a small
                // budget still covers font decode + first paint.
                "--virtual-time-budget=1500",
                pathToFileURL(tmpHtml).href,
            ],
            { stdio: "inherit" },
        );
    } finally {
        rmSync(tmpHtml, { force: true });
    }
}
