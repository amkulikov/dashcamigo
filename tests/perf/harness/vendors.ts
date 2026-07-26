// Vendor discovery: enumerates private/samples/<vendor>/ folders
// for the perf suite. Vendors absent on the local machine are skipped, not
// failed - the suite must run anywhere the repo exists. private is
// .gitignored so CI without a sample mirror sees an empty discovery and the
// suite reports "no vendors found, nothing to measure" (the spec file then
// uses test.skip() per case).

import { existsSync, readdirSync, type Stats, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Repository root: this file is tests/perf/harness/vendors.ts, so three
// directories up from itself. ESM has no __dirname; use import.meta.url.
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..", "..");
const SAMPLES_ROOT = join(REPO_ROOT, "private", "samples");

const VIDEO_EXTS = new Set([".mp4", ".mov", ".ts", ".m2ts"]);
const SIDECAR_EXTS = new Set([".gpx", ".gps", ".map", ".nmea", ".csv", ".log", ".3gf", ".txt"]);

export interface VendorSample {
    /** Human-readable folder name as in private/samples/. */
    name: string;
    /** Absolute path to the vendor folder. */
    absPath: string;
    /** Absolute paths to every file we want to drop into the app. */
    filePaths: string[];
    /** Sum of file sizes in bytes (for reporting throughput). */
    totalBytes: number;
    /** Count of video files specifically (for "extracted N records / video" stats). */
    videoCount: number;
}

/**
 * Recursively collects file paths under root that match the given extension set.
 * Excludes dot-folders (.DS_Store, etc.) and zero-byte files (broken fixtures).
 */
function collectFiles(root: string, extSet: Set<string>, out: string[]): void {
    let entries: string[];
    try {
        entries = readdirSync(root);
    } catch {
        return;
    }
    for (const name of entries) {
        if (name.startsWith(".")) continue;
        const full = join(root, name);
        let st: Stats;
        try {
            st = statSync(full);
        } catch {
            continue;
        }
        if (st.isDirectory()) {
            collectFiles(full, extSet, out);
            continue;
        }
        if (!st.isFile() || st.size === 0) continue;
        const dot = name.lastIndexOf(".");
        if (dot < 0) continue;
        const ext = name.slice(dot).toLowerCase();
        if (extSet.has(ext)) out.push(full);
    }
}

/**
 * Discovers vendor folders. Returns an empty array if SAMPLES_ROOT does not
 * exist (typical for CI without a sample mirror). Each returned vendor has
 * at least one video file; vendors without videos are skipped (a perf test
 * with no video cannot exercise the ingest pipeline meaningfully).
 */
export function discoverVendors(): VendorSample[] {
    if (!existsSync(SAMPLES_ROOT)) return [];
    const vendors: VendorSample[] = [];
    let topLevel: string[];
    try {
        topLevel = readdirSync(SAMPLES_ROOT);
    } catch {
        return [];
    }
    const allExts = new Set([...VIDEO_EXTS, ...SIDECAR_EXTS]);
    for (const folderName of topLevel) {
        if (folderName.startsWith(".")) continue;
        const folderPath = join(SAMPLES_ROOT, folderName);
        let st: Stats;
        try {
            st = statSync(folderPath);
        } catch {
            continue;
        }
        if (!st.isDirectory()) continue;
        const filePaths: string[] = [];
        collectFiles(folderPath, allExts, filePaths);
        if (filePaths.length === 0) continue;
        let totalBytes = 0;
        let videoCount = 0;
        for (const p of filePaths) {
            try {
                totalBytes += statSync(p).size;
            } catch {
                // Race with deletion - skip
            }
            const dot = p.lastIndexOf(".");
            if (dot >= 0 && VIDEO_EXTS.has(p.slice(dot).toLowerCase())) videoCount++;
        }
        if (videoCount === 0) continue;
        vendors.push({ name: folderName, absPath: folderPath, filePaths, totalBytes, videoCount });
    }
    // Stable sort by name so test order is deterministic between runs.
    vendors.sort((a, b) => a.name.localeCompare(b.name));
    return vendors;
}
