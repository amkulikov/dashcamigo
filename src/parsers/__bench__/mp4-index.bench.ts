// Microbench for buildMp4Index against real videos from private/samples.
//
// buildMp4Index is called once per video file during ingest and reads the
// first 16 MB header + walks moov. A regression here scales linearly with
// every dropped file - 240 videos × +100 ms = +24 sec of perceived ingest
// time. Tracking it in isolation catches regressions before the full
// e2e suite has to run.
//
// Per-vendor selection: the first video (alphabetical) per vendor folder.
// Not necessarily "representative" - just stable across runs so that diffs
// between bench results compare like-for-like. The diversity across vendors
// (Novatek freeGPS in `udta`, BlackVue free->gps box, GPMF gpmd track,
// MPEG-TS, etc) is what gives the bench its coverage, not the choice within
// a single vendor. Vendors without samples silently produce no benches.

import { existsSync, readFileSync, readdirSync, type Stats, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { bench, describe } from "vitest";

import { buildMp4Index } from "../internal/mp4-index.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..", "..");
const SAMPLES_ROOT = join(REPO_ROOT, "private", "samples");
const VIDEO_EXTS = new Set([".mp4", ".mov", ".ts", ".m2ts"]);

interface VideoFixture {
    vendor: string;
    name: string;
    /** preloaded ArrayBuffer (so bench measures only the parser, not disk IO) */
    buffer: ArrayBuffer;
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
        // Read header only (32 MB) - buildMp4Index touches the first 16 MB
        // for the index plus may follow up to find moov at EOF. Loading
        // the full 500 MB file just to bench an operation that only reads
        // 16 MB is wasteful and pollutes the process RSS.
        //
        // We materialize a Blob/File wrapper backed by a partial read. For
        // moov-at-end MP4s (mediabunny output, some 70mai variants) this
        // means buildMp4Index hits "moov not in header" and may end up at
        // EOF; we accept the lower number for those - the relative measure
        // across runs is still meaningful.
        const HEADER_BYTES = 32 * 1024 * 1024;
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

describe("buildMp4Index per vendor (real samples, header-only)", () => {
    if (fixtures.length === 0) {
        // tinybench skips empty describes silently.
        return;
    }
    for (const fx of fixtures) {
        bench(`${fx.vendor} (${(fx.size / 1024 / 1024).toFixed(0)} MB)`, async () => {
            const file = new File([fx.buffer], fx.name);
            await buildMp4Index(file);
        });
    }
});
