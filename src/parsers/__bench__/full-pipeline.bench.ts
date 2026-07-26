// Full-pipeline GPS extraction bench, per-vendor on real samples in
// private/samples/. Measures the actual hot path for ingest:
//   1. Mp4Index build (moov walk + classifier markers).
//   2. dispatchParseVideoEmbeddedGps for one file at a time.
//
// Per-vendor: the first video (alphabetical) per vendor folder, by analogy
// with mp4-index.bench.ts. Stable choice = comparable diffs across runs;
// diversity across vendors is what gives the bench its coverage.
//
// Vendors without samples produce no benches (silently skipped). Run via
// `npm run test:bench`. Compare two runs with vitest's --compare flag.
//
// Numbers in the JSON output (private/perf-results/bench-latest.json)
// can be diffed against a baseline; significant regressions in either stage
// scale linearly with the number of dropped files in real ingests.

import { existsSync, readFileSync, readdirSync, type Stats, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { bench, describe } from "vitest";

import { buildMp4Index } from "../internal/mp4-index.js";
import { classifyFiles, dispatchParseVideoEmbeddedGps } from "../registry.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..", "..");
const SAMPLES_ROOT = join(REPO_ROOT, "private", "samples");
const VIDEO_EXTS = new Set([".mp4", ".mov", ".ts", ".m2ts"]);

interface VideoFixture {
    vendor: string;
    name: string;
    /** Preloaded bytes - so disk IO does not pollute parser measurements. */
    buffer: ArrayBuffer;
    /** Real on-disk size (preserved as File.size even when we trimmed for memory). */
    size: number;
}

function pickFirstVideo(vendorFolder: string): string | null {
    let firstVideo: string | null = null;
    const walk = (dir: string): void => {
        if (firstVideo) return;
        let entries: string[];
        try {
            entries = readdirSync(dir);
        } catch {
            return;
        }
        entries.sort();
        for (const name of entries) {
            if (firstVideo) return;
            if (name.startsWith(".")) continue;
            const full = join(dir, name);
            let st: Stats;
            try {
                st = statSync(full);
            } catch {
                continue;
            }
            if (st.isDirectory()) {
                walk(full);
                continue;
            }
            const dot = name.lastIndexOf(".");
            if (dot < 0) continue;
            if (VIDEO_EXTS.has(name.slice(dot).toLowerCase())) {
                firstVideo = full;
                return;
            }
        }
    };
    walk(vendorFolder);
    return firstVideo;
}

function loadFixtures(): VideoFixture[] {
    if (!existsSync(SAMPLES_ROOT)) return [];
    const out: VideoFixture[] = [];
    let vendors: string[];
    try {
        vendors = readdirSync(SAMPLES_ROOT);
    } catch {
        return [];
    }
    vendors.sort();
    for (const v of vendors) {
        if (v.startsWith(".")) continue;
        const vFolder = join(SAMPLES_ROOT, v);
        try {
            if (!statSync(vFolder).isDirectory()) continue;
        } catch {
            continue;
        }
        const video = pickFirstVideo(vFolder);
        if (!video) continue;
        // Load up to 64 MB - enough for moov (typical 100 KB - 2 MB), plus
        // the first chunks for streaming/jump-scan when needed. Loading a
        // full 1 GB clip wastes RSS on parts the parser never touches.
        // For Novatek streaming-scan we WANT to measure the full IO cost;
        // those benches override this with a larger window below.
        const HEADER_BYTES = 64 * 1024 * 1024;
        const stat = statSync(video);
        const readSize = Math.min(stat.size, HEADER_BYTES);
        const buf = readFileSync(video, { encoding: null }).subarray(0, readSize);
        const ab = new ArrayBuffer(buf.byteLength);
        new Uint8Array(ab).set(buf);
        out.push({ vendor: v, name: video.split("/").pop()!, buffer: ab, size: stat.size });
    }
    return out;
}

const fixtures = loadFixtures();

describe("buildMp4Index per vendor", () => {
    if (fixtures.length === 0) return;
    for (const fx of fixtures) {
        bench(`${fx.vendor} (${(fx.size / 1024 / 1024).toFixed(0)} MB)`, async () => {
            const file = new File([fx.buffer], fx.name);
            await buildMp4Index(file);
        });
    }
});

describe("dispatchParseVideoEmbeddedGps light-only per vendor", () => {
    if (fixtures.length === 0) return;
    for (const fx of fixtures) {
        bench(`${fx.vendor} (${(fx.size / 1024 / 1024).toFixed(0)} MB)`, async () => {
            const file = new File([fx.buffer], fx.name);
            const classified = await classifyFiles([{ file, relativePath: fx.name }]);
            await dispatchParseVideoEmbeddedGps(classified, undefined, /* concurrency */ 1, undefined, "light-only");
        });
    }
});
