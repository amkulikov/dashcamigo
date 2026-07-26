// Marker IO contract. Decoding and the fixture-built gpmd carrier live in
// internal/xor-ascii-gps.test.ts; what is pinned here is the read path: rove-gpmd
// closes the gpmd chain (gpmf -> wolfbox -> vantrue-fmas -> rove), so on every
// GoPro/Wolfbox/Vantrue/Rove file it probes a first sample a predecessor has
// already read. It must come from the Mp4Index first-sample cache - a direct
// read here is a second slice of the same bytes on every such file, which is
// exactly the per-file cost the index exists to avoid on SD/SAF backends.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { buildMp4Index } from "../internal/mp4-index.js";
import { roveGpmdPrimitive } from "./rove-gpmd.js";
import { wolfboxGpmdPrimitive } from "./wolfbox-gpmd.js";
import type { VendorFile } from "../types.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
// Real GoPro clip: a `gpmd` track whose samples are GPMF KLV, i.e. the
// dispatcher walks past gpmf/wolfbox/fmas down to rove-gpmd on it.
const GOPRO = "tests/testdata/gopro-gpmf/hero5-trimmed.mp4";

/** Wraps a File so every slice() the parsers issue is counted. */
function countingVendorFile(name: string, bytes: Uint8Array): { vf: VendorFile; reads: () => number } {
    const real = new File([bytes as BlobPart], name);
    let reads = 0;
    const counting = {
        name: real.name,
        size: real.size,
        type: real.type,
        lastModified: real.lastModified,
        slice: (start?: number, end?: number) => {
            reads++;
            return real.slice(start, end);
        },
        arrayBuffer: () => real.arrayBuffer(),
    } as unknown as File;
    return { vf: { file: counting, relativePath: name }, reads: () => reads };
}

describe("rove-gpmd marker", () => {
    it("re-uses the first sample an earlier gpmd primitive already read", async () => {
        const bytes = new Uint8Array(readFileSync(resolve(REPO_ROOT, GOPRO)));
        const { vf, reads } = countingVendorFile("GH010001.MP4", bytes);
        const index = await buildMp4Index(vf.file);

        // The predecessor in the walk probes the same track first.
        expect(await wolfboxGpmdPrimitive.marker(vf, index)).toBe(false);
        const afterPredecessor = reads();
        expect(index.firstSampleCache.size).toBe(1);

        // GPMF KLV carries no XOR-0xAA signature, and answering that costs
        // nothing: the sample is already in the index cache.
        expect(await roveGpmdPrimitive.marker(vf, index)).toBe(false);
        expect(reads()).toBe(afterPredecessor);
    });

    it("caches its own read when it is the first to probe the track", async () => {
        const bytes = new Uint8Array(readFileSync(resolve(REPO_ROOT, GOPRO)));
        const { vf } = countingVendorFile("GH010002.MP4", bytes);
        const index = await buildMp4Index(vf.file);

        expect(await roveGpmdPrimitive.marker(vf, index)).toBe(false);
        // Populated for whoever probes the same track next.
        expect(index.firstSampleCache.size).toBe(1);
    });
});
