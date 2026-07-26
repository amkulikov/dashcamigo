// Regression test on a real-anonymized 70mai 4K (A810) MP4 that carries the
// STRUCTURAL path: moov -> `gps ` index atom with a (offset,size) table
// pointing at freeGPS blocks. Coordinates replaced with sentinels
// (50.0 N / 30.0 E); the table shape, freeGPS magic and 70mai self-referential
// tag are real firmware bytes, so this pins the sparse-read path against a
// genuine A810 index atom rather than a synthetic table.
//
// Source: scripts/anonymize-70mai-embedded-mp4.mjs.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildMp4Index } from "../../internal/mp4-index.js";
import { tryStructuralPath } from "../../internal/freegps.js";
import { parse70maiFreeGpsBlock } from "../../internal/freegps-70mai.js";
import { freegps70maiPrimitive } from "../../primitives/freegps-70mai.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const NAME = "NO20240702-094820-000029F.MP4"; // real A810 naming
const BLOCKS = 12;

function loadFixture(): { file: File; vf: { file: File; relativePath: string } } {
    const buf = readFileSync(resolve(HERE, "real-anonymized.mp4"));
    const file = new File([buf], NAME);
    return { file, vf: { file, relativePath: NAME } };
}

describe("real-anonymized 70mai A810 - structural `gps ` atom path", () => {
    it("buildMp4Index finds the real moov `gps ` index atom", async () => {
        const { file } = loadFixture();
        const index = await buildMp4Index(file);
        // The A810 firmware writes the atom inside moov, so buildMp4Index sees
        // it - this is exactly what makes the sparse read reachable.
        expect(index.novatekGpsAtom).not.toBeNull();
        expect(index.moovView).not.toBeNull();
        // Default 4 MB probe covers the tiny fixture, so the marker flag is set.
        expect(index.hasFreeGpsMarker).toBe(true);
    });

    it("tryStructuralPath reads every table entry via sparse block reads", async () => {
        const { file } = loadFixture();
        const index = await buildMp4Index(file);
        // Call the structural reader directly with the 70mai block parser: the
        // records can only come from the table entries, not a streaming scan.
        const parsed = await tryStructuralPath(file, index, parse70maiFreeGpsBlock);
        expect(parsed).not.toBeNull();
        expect(parsed!.records).toHaveLength(BLOCKS);
        for (let i = 0; i < BLOCKS; i++) {
            const r = parsed!.records[i]!;
            // Sentinel coords - 50.0 N (drifting ~22 m north) / 30.0 E.
            expect(r.lat).toBeCloseTo(50 + i * 0.0002, 4);
            expect(r.lon).toBeCloseTo(30, 4);
            expect(r.active).toBe(true);
            // Position-only: the 70mai block has no trustworthy per-record clock.
            expect(r.timeUnsynced).toBe(true);
            expect(r.bearingDeg).toBeGreaterThanOrEqual(0);
            expect(r.bearingDeg).toBeLessThan(360);
        }
    });

    it("primitive marker + parse: structural path yields the finalized track", async () => {
        const { file, vf } = loadFixture();
        const index = await buildMp4Index(file);
        expect(await freegps70maiPrimitive.marker(vf, index)).toBe(true);

        const result = await freegps70maiPrimitive.parse(vf, index);
        // Consecutive fixes differ (lat steps), so nothing collapses.
        expect(result.records).toHaveLength(BLOCKS);
        expect(result.records[0]!.lat).toBeCloseTo(50, 4);
        expect(result.records[BLOCKS - 1]!.lat).toBeCloseTo(50 + (BLOCKS - 1) * 0.0002, 4);
        // Speed is reconstructed from the trajectory (~22 m/s), under the cap.
        expect(result.records[1]!.speedMs).toBeGreaterThan(0);
        expect(result.records[1]!.speedMs).toBeLessThan(90);
    });
});
