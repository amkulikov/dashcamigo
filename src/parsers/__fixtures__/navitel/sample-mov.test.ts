// Regression test on the anonymized Navitel R600-1 fixture - the km/h +
// course/2 side of the gps0 dialect split. Only 5 low-speed records survive
// in the excerpt, which is exactly the point: below the calibration sample
// floor the parser must keep the provisional km/h + course/2 reading that was
// haversine-verified on this camera's original full sample. The anonymized
// coordinate walk here is fabricated (predates delta-preservation), so a
// calibration verdict from it would be meaningless - the floor is what keeps
// it from firing.
//
// Source: scripts/anonymize-navitel-mov.mjs (an early run; the original .MOV
// is no longer retained).

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { buildMp4Index } from "../../internal/mp4-index.js";
import { navitelTailPrimitive } from "../../primitives/navitel-tail.js";

const FIXTURE = resolve(dirname(fileURLToPath(import.meta.url)), "sample.MOV");
const NAME = "sample.MOV";

describe("anonymized Navitel R600-1 gps0 tail (.MOV, km/h + course/2 dialect)", () => {
    it("parses with the provisional reading kept below the calibration floor", async () => {
        const vf = { file: new File([Uint8Array.from(readFileSync(FIXTURE))], NAME), relativePath: NAME };
        const index = await buildMp4Index(vf.file);
        expect(await navitelTailPrimitive.marker(vf, index)).toBe(true);

        const result = await navitelTailPrimitive.parse(vf, index);
        expect(result.records).toHaveLength(5);

        // IDIT 2020-11-04 16:30:14 is camera-local MSK; rows are UTC.
        const first = result.records[0]!;
        expect(first.unixSeconds).toBe(Date.UTC(2020, 10, 4, 13, 30, 15) / 1000);

        // Real speed/course bytes: 13 km/h, course byte 46 -> 92 deg.
        expect(first.speedMs).toBeCloseTo(13 / 3.6, 3);
        expect(first.bearingDeg).toBe(92);
    });
});
