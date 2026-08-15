// Integration test: the freegps-70mai primitive against a synthetic MP4 that
// carries 70mai-dialect freeGPS blocks (sentinel coords). Fixture builder:
// build-70mai.mjs. Exercises Mp4Index + probe + streaming scan + finalize.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildMp4Index, probeMarkers } from "../../internal/mp4-index.js";
import { freegps70maiPrimitive } from "../../primitives/freegps-70mai.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const NAME = "NO20240702-094820-000029F.MP4"; // real A810 naming

describe("70mai embedded freeGPS - synthetic fixture", () => {
    it("marker + parse: 3 unique fixes, repeats collapsed, void skipped", async () => {
        const buf = readFileSync(resolve(HERE, "synthetic-70mai.mp4"));
        const file = new File([buf], NAME);
        const index = await buildMp4Index(file);
        await probeMarkers(file, index, 16 << 20);
        const vf = { file, relativePath: NAME };

        expect(await freegps70maiPrimitive.marker(vf, index)).toBe(true);

        const result = await freegps70maiPrimitive.parse(vf, index);
        // 9 blocks of 3 repeated fixes + 1 void -> 3 records.
        expect(result.records).toHaveLength(3);

        // Sentinel coords (50.0 N / 30.0 E, drifting ~50 m).
        expect(result.records[0]!.lat).toBeCloseTo(50.0, 4);
        expect(result.records[0]!.lon).toBeCloseTo(30.0, 4);
        expect(result.records[1]!.lat).toBeCloseTo(50.0005, 4);
        expect(result.records[2]!.lat).toBeCloseTo(50.001, 4);

        // Time is position-only (no per-record clock); heading is real.
        expect(result.records.every((r) => r.timeUnsynced === true)).toBe(true);
        expect(result.records.every((r) => r.active === true)).toBe(true);
        expect(result.records[2]!.bearingDeg).toBe(47);

        // Speed comes from the block's km/h field (43/45/47 in the fixture).
        expect(result.records[0]!.speedMs).toBeCloseTo(43 / 3.6, 5);
        expect(result.records[1]!.speedMs).toBeCloseTo(45 / 3.6, 5);
        expect(result.records[2]!.speedMs).toBeCloseTo(47 / 3.6, 5);
    });
});
