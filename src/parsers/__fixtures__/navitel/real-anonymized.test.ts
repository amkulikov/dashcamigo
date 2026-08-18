// Regression test on the real-anonymized gps0-tail fixture from the .TS
// spelling of the family: a 2-channel motorcycle cam that writes plain
// ISO-BMFF (ftyp/moov + IDIT/gps0 tail atoms) under a .TS extension, card
// layout `Normal/<F|R>/`. Only the lat/lon doubles are overwritten
// (whole-degree 50 N / 30 E plus a 0.0001 deg/record walk); IDIT, timestamps,
// speed and course are the original camera bytes.
//
// Source: scripts/anonymize-navitel-mov.mjs.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { classifyGpsSource } from "../../gps-source-hints.js";
import { buildMp4Index } from "../../internal/mp4-index.js";
import { navitelTailPrimitive } from "../../primitives/navitel-tail.js";
import { expectPlausibleGpsTrack } from "../helpers.ts";

const FIXTURE = resolve(dirname(fileURLToPath(import.meta.url)), "real-anonymized.TS");
const NAME = "FILE260817-180301-000004F.TS";
const REL_PATH = `0817/CARD/Normal/F/${NAME}`;

describe("real-anonymized Navitel gps0 tail in a .TS container", () => {
    it("marker + parse end-to-end", async () => {
        const vf = { file: new File([Uint8Array.from(readFileSync(FIXTURE))], NAME), relativePath: REL_PATH };
        expect(classifyGpsSource(vf)).toBe("embedded");

        const index = await buildMp4Index(vf.file);
        expect(await navitelTailPrimitive.marker(vf, index)).toBe(true);

        const result = await navitelTailPrimitive.parse(vf, index);
        expect(result.records).toHaveLength(6);
        expect(result.skipped).toHaveLength(0);
        expectPlausibleGpsTrack(result.records, { minCount: 6, monotonicTime: true });

        // gps0 rows are satellite UTC while IDIT ("2026-08-17 18:03:01") is the
        // camera-local clock - the two-hour gap is the recording timezone, and
        // it is the reason the trips layer must not read IDIT as UTC.
        const first = result.records[0]!;
        expect(first.unixSeconds).toBe(Date.UTC(2026, 7, 17, 16, 3, 2) / 1000);
        // Strict 1 Hz cadence, no stale ring-buffer row in this excerpt.
        expect(result.records[5]!.unixSeconds - first.unixSeconds).toBe(5);

        for (const [i, r] of result.records.entries()) {
            expect(r.active).toBe(true);
            // Sentinel coords - whole-degree anchored, never the real track.
            expect(r.lat).toBeCloseTo(50 + i * 0.0001, 6);
            expect(r.lon).toBeCloseTo(30 + i * 0.0001, 6);
            expect(r.mp4Filename).toBe(NAME);
        }

        // Real speed/course bytes survive anonymization: a motorcycle rolling
        // at ~29 km/h on a steady south-east heading.
        expect(first.speedMs).toBeCloseTo(29 / 3.6, 3);
        expect(result.records[5]!.speedMs).toBeCloseTo(28 / 3.6, 3);
        for (const r of result.records) {
            expect(r.bearingDeg).toBeGreaterThanOrEqual(144);
            expect(r.bearingDeg).toBeLessThanOrEqual(146);
        }
    });
});
