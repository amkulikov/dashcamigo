#!/usr/bin/env node
// Pre-flight check for the self-hosted style.json files in public/styles/.
// MapLibre throws at runtime for issues the style-spec validator misses
// (e.g. sprite URL must be absolute). Run after any edit to public/styles/.
//
//   node scripts/validate-map-styles.mjs

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { validateStyleMin } from "@maplibre/maplibre-gl-style-spec";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const STYLES = ["public/styles/light.json", "public/styles/dark.json", "public/styles/neon.json"];

let failed = 0;

for (const rel of STYLES) {
    const path = resolve(ROOT, rel);
    const raw = await readFile(path, "utf8");
    const style = JSON.parse(raw);

    // 1) Spec validation - paint property names, expression shapes, etc.
    const specErrors = validateStyleMin(style);
    for (const e of specErrors) {
        console.error(`[${rel}] spec: ${e.message}`);
        failed++;
    }

    // 2) URL constraints. MapLibre rejects relative URLs at runtime
    //    ("must be absolute"). We allow:
    //      - https?:// : works as-is.
    //      - /path     : same-origin absolute path; loadMapStyle resolves
    //                    these against location.origin before handing the
    //                    style to MapLibre.
    //    Anything else (./foo, foo, http://foo with no host) is rejected.
    for (const field of ["sprite", "glyphs"]) {
        const v = style[field];
        if (typeof v !== "string") continue;
        if (!/^https?:\/\//.test(v) && !v.startsWith("/")) {
            console.error(`[${rel}] ${field} must be absolute URL or absolute path starting with "/", got: ${v}`);
            failed++;
        }
    }

    // 3) Paint property / layer type mismatches. spec validator catches
    //    most but it's been observed to miss line-color on non-line layers
    //    after jq-based color rewrites.
    const paintByType = {
        background: new Set(["background-color", "background-opacity", "background-pattern"]),
        fill: new Set(["fill-color", "fill-opacity", "fill-outline-color", "fill-pattern", "fill-translate", "fill-translate-anchor", "fill-antialias"]),
        line: new Set(["line-color", "line-opacity", "line-width", "line-blur", "line-dasharray", "line-gap-width", "line-gradient", "line-offset", "line-pattern", "line-translate", "line-translate-anchor"]),
        symbol: new Set(["text-color", "text-halo-color", "text-halo-width", "text-halo-blur", "text-opacity", "text-translate", "text-translate-anchor", "icon-color", "icon-halo-color", "icon-halo-width", "icon-halo-blur", "icon-opacity", "icon-translate", "icon-translate-anchor"]),
        raster: new Set(["raster-opacity", "raster-hue-rotate", "raster-brightness-min", "raster-brightness-max", "raster-saturation", "raster-contrast", "raster-fade-duration", "raster-resampling"]),
        circle: new Set(["circle-color", "circle-opacity", "circle-radius", "circle-blur", "circle-stroke-color", "circle-stroke-opacity", "circle-stroke-width", "circle-translate", "circle-translate-anchor", "circle-pitch-alignment", "circle-pitch-scale"]),
        heatmap: new Set(["heatmap-radius", "heatmap-weight", "heatmap-intensity", "heatmap-color", "heatmap-opacity"]),
        hillshade: new Set(["hillshade-illumination-direction", "hillshade-illumination-anchor", "hillshade-exaggeration", "hillshade-shadow-color", "hillshade-highlight-color", "hillshade-accent-color"]),
    };

    for (const layer of style.layers || []) {
        const allowed = paintByType[layer.type];
        if (!allowed || !layer.paint) continue;
        for (const key of Object.keys(layer.paint)) {
            if (!allowed.has(key)) {
                console.error(`[${rel}] layer "${layer.id}" (type=${layer.type}) has paint.${key} - not valid for this type`);
                failed++;
            }
        }
    }
}

if (failed > 0) {
    console.error(`\nvalidate-map-styles: ${failed} issue(s)`);
    process.exit(1);
}
console.log("validate-map-styles: ok");
