#!/usr/bin/env node
// Generates public/styles/neon.json from public/styles/dark.json.
//
// Why a generator (vs hand-authoring like light/dark): neon reuses dark's
// geometry verbatim - the same OpenMapTiles source, the same per-zoom road
// widths and filters - and only swaps the PALETTE. Keeping that swap in one
// readable place means a future tweak ("make motorways hotter") is a one-line
// edit, not a hunt through 37 hand-copied layers. Run after editing the palette:
//
//   node scripts/build-neon-style.mjs
//
// The look: a semi-transparent black slot (video bleeds through - MapLibre v5
// always creates an alpha:true GL context, so background-color alpha survives
// the getCanvas -> drawImage -> ImageBitmap composite in the export snapshotter)
// with the dashcam-relevant features (roads, buildings, place names) glowing in
// brand orange. Roads are drawn as a wide blurred orange halo (casing) under a
// bright thin core (inner) - the classic neon trick. Clutter that is irrelevant
// to a dashcam route (landuse/landcover fills, POI sprite icons) is dropped.

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const SRC = resolve(ROOT, "public/styles/dark.json");
const OUT = resolve(ROOT, "public/styles/neon.json");

// --- Neon palette ---
const BG = "rgba(0,0,0,0.5)"; // semi-transparent black: video shows through
const WATER = "rgba(10,18,34,0.55)"; // a touch darker/bluer than the bg tint
const ORANGE = "#ff9000"; // brand orange (road glow, building edges, boundaries)
const ORANGE_DIM = "#cc6a00"; // dimmed orange (minor roads, casings, subtle)
const ORANGE_CORE = "#ffb347"; // bright core (major-road inner)
const ORANGE_HOT = "#ffd9a0"; // near-white-hot core (motorway inner, labels)
const ORANGE_LABEL = "#ffe6c2"; // place-name text fill (hot, reads on dark)
const RAIL = "#8a4a00"; // dimmed amber for railways (present but secondary)

// Base-map layers with no value on a dashcam route - dropped entirely so the
// neon slot stays clean (orange roads/buildings/cities on black, nothing else).
const DROP = new Set(["landuse_residential", "landcover_wood", "landuse_park"]);

/** Strips sprite-icon layout/paint from a symbol layer (neon ships no sprite -
 *  keeping icon-image would log "image not found" and draw nothing). Returns a
 *  shallow-cloned layout without the icon-* keys; text-* keys are preserved. */
function stripIcons(layout) {
    if (!layout) return layout;
    const out = {};
    for (const [k, v] of Object.entries(layout)) {
        if (k.startsWith("icon-")) continue;
        out[k] = v;
    }
    return out;
}

/** Keeps the width/dash/blur sizing expression from the source layer (well
 *  tuned per zoom) but only those keys - colors are set fresh by the caller. */
function keepSizing(paint, keys) {
    const out = {};
    for (const k of keys) {
        if (paint && paint[k] !== undefined) out[k] = paint[k];
    }
    return out;
}

/** Maps one dark-matter layer to its neon paint+layout. Returns null to drop. */
function neonize(layer) {
    const id = layer.id;
    if (DROP.has(id)) return null;

    const out = { ...layer };
    const p = layer.paint || {};

    if (layer.type === "background") {
        out.paint = { "background-color": BG };
        return out;
    }

    if (id === "water") {
        out.paint = { "fill-antialias": false, "fill-color": WATER };
        return out;
    }
    if (id === "waterway") {
        out.paint = { ...keepSizing(p, ["line-width"]), "line-color": ORANGE_DIM, "line-opacity": 0.25 };
        return out;
    }
    if (id === "building") {
        // Faint orange wash + a bright orange outline = glowing footprints. The
        // 3D extrusion (added at runtime by addBuildings3dLayer for chase) sits
        // on top of these at z14+; north-up keeps the flat glowing outlines.
        out.paint = {
            "fill-antialias": true,
            "fill-color": "rgba(255,144,0,0.05)",
            "fill-outline-color": ORANGE,
        };
        return out;
    }

    if (layer.type === "line" && id.startsWith("highway")) {
        const w = keepSizing(p, ["line-width", "line-dasharray"]);
        if (id.includes("path")) {
            out.paint = { ...w, "line-color": ORANGE_DIM, "line-opacity": 0.55 };
        } else if (id.includes("minor")) {
            out.paint = { ...w, "line-color": "#b35e00", "line-opacity": 0.85 };
        } else if (id.includes("motorway_casing")) {
            // Widest glow halo.
            out.paint = { ...w, "line-color": ORANGE, "line-blur": { stops: [[6, 2], [20, 14]] }, "line-opacity": 0.4 };
        } else if (id.includes("motorway_inner")) {
            out.paint = { ...w, "line-color": ORANGE_HOT };
        } else if (id.includes("motorway_subtle")) {
            out.paint = { ...w, "line-color": ORANGE_CORE };
        } else if (id.includes("major_casing")) {
            out.paint = { ...w, "line-color": ORANGE, "line-blur": { stops: [[10, 2], [20, 10]] }, "line-opacity": 0.35 };
        } else if (id.includes("major_inner")) {
            out.paint = { ...w, "line-color": ORANGE_CORE };
        } else if (id.includes("major_subtle")) {
            out.paint = { ...w, "line-color": ORANGE_DIM };
        } else {
            out.paint = { ...w, "line-color": ORANGE_DIM };
        }
        return out;
    }

    if (layer.type === "line" && id.startsWith("railway")) {
        out.paint = { ...keepSizing(p, ["line-width", "line-dasharray"]), "line-color": RAIL, "line-opacity": 0.5 };
        return out;
    }

    if (layer.type === "line" && id.startsWith("boundary")) {
        out.paint = {
            ...keepSizing(p, ["line-width", "line-dasharray", "line-blur"]),
            "line-color": ORANGE_DIM,
            "line-opacity": 0.4,
        };
        return out;
    }

    if (layer.type === "symbol") {
        out.layout = stripIcons(layer.layout);
        if (id.startsWith("place")) {
            // City/town/country names glow: hot core text + an orange halo with
            // blur. Larger places get a wider, brighter glow.
            const large = id.includes("large") || id.includes("country");
            out.paint = {
                "text-color": large ? "#fff0d8" : ORANGE_LABEL,
                "text-halo-color": ORANGE,
                "text-halo-width": large ? 1.8 : 1.3,
                "text-halo-blur": large ? 2 : 1.4,
            };
        } else if (id.startsWith("highway_name")) {
            out.paint = {
                ...keepSizing(p, ["text-translate"]),
                "text-color": ORANGE_HOT,
                "text-halo-color": "#3a1d00",
                "text-halo-width": 1,
            };
        } else if (id === "water_name") {
            out.paint = {
                "text-color": "#7f93b5",
                "text-halo-color": "#0a1020",
                "text-halo-width": 1,
                "text-halo-blur": 1,
            };
        } else {
            out.paint = { ...(layer.paint || {}) };
        }
        return out;
    }

    return out;
}

const dark = JSON.parse(await readFile(SRC, "utf8"));
const neon = {
    version: dark.version,
    name: "Neon",
    glyphs: dark.glyphs,
    // No sprite: every icon-image reference is stripped (stripIcons). MapLibre
    // tolerates a missing sprite as long as nothing references one.
    sources: dark.sources,
    layers: dark.layers.map(neonize).filter(Boolean),
};

await writeFile(OUT, `${JSON.stringify(neon, null, "\t")}\n`, "utf8");
console.log(`build-neon-style: wrote ${OUT} (${neon.layers.length} layers)`);
