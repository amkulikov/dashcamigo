// Regression test on a real-anonymized Vantrue N2X fixture: actual freeGPS
// block structure (NMEA-embedded variant), coordinates replaced with sentinel
// (50.0 N / 30.0 E) in the NMEA sentence, binary preamble (lat/lon doubles +
// datetime metadata) zeroed out.
//
// Source: scripts/anonymize-vantrue-mp4.mjs.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { freegpsPrimitive } from "../../primitives/freegps.js";
import { buildMp4Index } from "../../internal/mp4-index.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const PUBLIC_FIXTURES = resolve(REPO_ROOT, "tests/testdata/vantrue-real-anonymized");

describe("real-anonymized Vantrue N2X fixture", () => {
    it("3 NMEA-embedded freeGPS blocks parse to records with sentinel coords", async () => {
        const buf = readFileSync(resolve(PUBLIC_FIXTURES, "vantrue-n2x.mp4"));
        const file = new File([buf], "20250607_180617_00001_N_A.MP4");
        const index = await buildMp4Index(file);
        const result = await freegpsPrimitive.parse(
            { file, relativePath: "20250607_180617_00001_N_A.MP4" },
            index,
        );
        expect(result.records).toHaveLength(3);
        for (let i = 0; i < 3; i++) {
            const r = result.records[i]!;
            expect(r.lat).toBeCloseTo(50 + i * 0.0001, 4);
            expect(r.lon).toBeCloseTo(30 + i * 0.0001, 4);
            expect(r.active).toBe(true);
            // Sentinel datetime - 2025-06-07 18:06:17 + i seconds.
            expect(r.unixSeconds).toBe(Date.UTC(2025, 5, 7, 18, 6, 17 + i) / 1000);
        }
    });
});
