// Generates favicons from public/assets/mark.svg into the public/ root.
// Run (one-off, when the brand mark changes):
//   node scripts/generate-favicons.mjs
//
// Why explicit favicons at the site root:
//  - By legacy convention Google tries /favicon.ico first. If the file is
//    missing, CF Pages serves the SPA fallback (our index.html with
//    content-type=text/html); Google reads that as a broken signal and
//    doesn't show an icon in SERP.
//  - Root-level /favicon.svg + /favicon.ico + /favicon-192.png cover all
//    cases: SVG for modern browsers and Google, ICO for legacy crawlers,
//    PNG-192 for apple-touch-icon and schema.org.
//
// ImageMagick (`magick`) - the only dependency, installed via brew. We
// avoided sharp/png-to-ico as npm deps - they have no place in the project's
// dependencies for a script that runs once a year.

import { execSync } from "node:child_process";
import { copyFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const SOURCE = resolve(ROOT, "public/assets/mark.svg");
const MASKABLE_SOURCE = resolve(ROOT, "public/assets/mark-maskable.svg");
const OUT_SVG = resolve(ROOT, "public/favicon.svg");
const OUT_PNG_32 = resolve(ROOT, "public/favicon-32.png");
const OUT_PNG_192 = resolve(ROOT, "public/favicon-192.png");
const OUT_PNG_512 = resolve(ROOT, "public/favicon-512.png");
const OUT_PNG_MASKABLE = resolve(ROOT, "public/icon-maskable-512.png");
const OUT_ICO = resolve(ROOT, "public/favicon.ico");

if (!existsSync(SOURCE)) {
    console.error(`source not found: ${SOURCE}`);
    process.exit(1);
}

// SVG at the root - just a copy of mark.svg. Modern browsers use it
// directly, no rasterization needed.
copyFileSync(SOURCE, OUT_SVG);
console.log(`wrote ${OUT_SVG}`);

// Density via -density: ImageMagick uses this to rasterize the SVG.
// 384 = 128px virtual width × 3 for a square 384x384 canvas,
// then resized to the target size.
function rasterize(outPath, size) {
    const cmd = [
        "magick",
        "-background", "none",
        "-density", "384",
        SOURCE,
        "-resize", `${size}x${size}`,
        outPath,
    ];
    execSync(cmd.join(" "), { stdio: "inherit" });
    console.log(`wrote ${outPath} (${size}x${size})`);
}

rasterize(OUT_PNG_32, 32);
rasterize(OUT_PNG_192, 192);
rasterize(OUT_PNG_512, 512);

// Maskable icon. Per W3C App Manifest spec the OS may apply any shape mask
// (circle, squircle, rounded square); significant content must sit inside the
// inner circle of radius 0.4 * canvas. The companion SVG has that geometry
// baked in - solid black fills the full quad and the glyph is pre-positioned
// in the safe zone - so we just rasterize it straight without compositing.
function rasterizeMaskable(outPath, size) {
    const cmd = [
        "magick",
        "-background", "none",
        "-density", "384",
        MASKABLE_SOURCE,
        "-resize", `${size}x${size}`,
        outPath,
    ];
    execSync(cmd.join(" "), { stdio: "inherit" });
    console.log(`wrote ${outPath} (${size}x${size}, maskable)`);
}
rasterizeMaskable(OUT_PNG_MASKABLE, 512);

// ICO - multi-resolution container 16/32/48. Enough for Google; modern
// browsers will use the SVG anyway. ImageMagick assembles the ICO from
// several sizes in one command.
const icoCmd = [
    "magick",
    "-background", "none",
    "-density", "384",
    SOURCE,
    "-define", "icon:auto-resize=16,32,48",
    OUT_ICO,
];
execSync(icoCmd.join(" "), { stdio: "inherit" });
console.log(`wrote ${OUT_ICO} (multi-res 16/32/48)`);
