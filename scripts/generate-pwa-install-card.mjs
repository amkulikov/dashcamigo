// Generates the PWA install-card images for manifest.webmanifest.
// Manual run (when the brand mark / wordmark changes):
//   node scripts/generate-pwa-install-card.mjs
//
// Why these images exist:
//   Chromium's richer install dialog (Chrome 108+ desktop, 94+ Android) shows
//   the manifest "screenshots" entries. We deliberately do NOT feed it a real
//   app screenshot: in the dialog it gets cropped to a "fragment of the page",
//   which looks unpolished. Instead each "screenshot" slot carries a clean
//   branded logo card (camera mark + "dashcamigo" wordmark). Chromium validates
//   screenshots only by geometry (320-3840px per side, max/min <= 2.3, identical
//   aspect ratio per form_factor, JPEG/PNG) - never by content - so a logo card
//   is accepted and rendered just like a screenshot would be.
//
//   wide  -> form_factor:"wide"   -> shown on desktop
//   narrow-> form_factor:"narrow" -> shown on mobile
//
// Implementation:
//   The card is a self-contained HTML document (inline SVG mark + the Space
//   Grotesk wordmark font embedded as a base64 data: URI, so there are no external
//   subresources). Headless Chrome (via scripts/_headless-chrome.mjs) renders it
//   from a file:// URL at each form factor and writes the PNG straight to
//   public/. No vite preview / dist needed - the card does not depend on the
//   built app.

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { findChrome, renderHtmlToPng } from "./_headless-chrome.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const CHROME = findChrome();

// Wordmark font, embedded so the card needs no network/file subresources.
// Latin subset covers "dashcamigo"; Space Grotesk is the brand display face.
const FONT_PATH = resolve(ROOT, "public/fonts/space-grotesk-700-latin.woff2");
if (!existsSync(FONT_PATH)) {
    console.error(`font not found: ${FONT_PATH}`);
    process.exit(1);
}
const FONT_B64 = readFileSync(FONT_PATH).toString("base64");

// Card output set. Aspect ratios stay well inside Chromium's <= 2.3 bound
// (1280x800 = 1.60, 824x1464 = 1.78) and within 320-3840px per side. The card
// layout is vmin-based, so the same HTML composes correctly at both sizes.
//
// WIDTH FLOOR: headless Chrome clamps the rendered page to a minimum width
// (~500px). A narrower --window-size renders the page centered at that larger
// width and then crops to the requested width, pushing the centered lockup off
// to the right. Both cards therefore render well above that floor (the narrow
// one at 2x of the old 412px) so the logo stays truly centered.
const CARDS = [
    { out: "public/pwa-install-card-wide.png", width: 1280, height: 800 },
    { out: "public/pwa-install-card-narrow.png", width: 824, height: 1464 },
];

// The card markup. Brand-black canvas with a warm orange vignette; an elevated
// app tile holding the camera mark (white body, orange lens - the production
// look, where the wordmark is --fg white, not the staging-orange env tint);
// the lowercase "dashcamigo" wordmark below. vmin sizing keeps the lockup
// centered inside a generous safe zone, so whatever crop the install dialog
// applies, the logo stays whole.
const cardHtml = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<style>
  @font-face {
    font-family: "Space Grotesk";
    font-weight: 700;
    font-style: normal;
    font-display: block;
    src: url(data:font/woff2;base64,${FONT_B64}) format("woff2");
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; }
  .card {
    width: 100%; height: 100%;
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    gap: 6vmin;
    background:
      radial-gradient(58vmin 58vmin at 50% 43%, rgba(255,144,0,0.13), rgba(255,144,0,0) 70%),
      #0a0a0a;
    font-family: "Space Grotesk", system-ui, sans-serif;
  }
  .tile {
    width: 34vmin; height: 34vmin;
    border-radius: 23%;
    background: #161616;
    border: 0.18vmin solid rgba(255,255,255,0.08);
    box-shadow: 0 3vmin 9vmin rgba(0,0,0,0.55);
    display: flex; align-items: center; justify-content: center;
  }
  .tile svg { width: 62%; height: 62%; }
  .wordmark {
    font-weight: 700;
    font-size: 11vmin;
    line-height: 1;
    /* -0.02em: the canonical wordmark tracking (matches .dc-mark). */
    letter-spacing: -0.02em;
    color: #f5f4f1;
    text-transform: lowercase;
  }
</style>
</head>
<body>
  <div class="card">
    <div class="tile">
      <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <rect x="3" y="7" width="26" height="20" rx="3" fill="#f5f4f1"/>
        <rect x="14" y="4" width="4" height="3" rx="0.6" fill="#f5f4f1"/>
        <circle cx="16" cy="17" r="7" fill="#ff9000"/>
        <circle cx="16" cy="17" r="4" fill="#0e0e0e"/>
        <circle cx="14" cy="15" r="1.4" fill="rgba(255,255,255,0.5)"/>
      </svg>
    </div>
    <div class="wordmark">dashcamigo</div>
  </div>
</body>
</html>
`;

for (const card of CARDS) {
    const outPath = resolve(ROOT, card.out);
    console.log(`rendering ${card.width}x${card.height} -> ${outPath}`);
    renderHtmlToPng({
        chrome: CHROME,
        html: cardHtml,
        width: card.width,
        height: card.height,
        outPath,
        tmpName: "dashcamigo-pwa-install-card.html",
    });
}
console.log("done");
