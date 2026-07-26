// Regression test on a real-anonymized CARCAM 4CH fixture: actual SigmaStar
// MP4 structure (meta-track 'ssmd' + LigoGPS-encrypted chunks), coordinates
// replaced with sentinel (50.0 N / 30.0 E).
//
// Source: scripts/anonymize-carcam-mp4.mjs.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ligoGpsPrimitive } from "../../primitives/ligogps.js";
import { buildMp4Index } from "../../internal/mp4-index.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const PUBLIC_FIXTURES = resolve(REPO_ROOT, "tests/testdata/carcam-real-anonymized");

describe("real-anonymized CARCAM 4CH fixture", () => {
    it("3 LigoGPS samples decrypt + parse to records with sentinel coords", async () => {
        const buf = readFileSync(resolve(PUBLIC_FIXTURES, "carcam-4ch-front.mp4"));
        const file = new File([buf], "REC20250607-180600-001-A.mp4");
        const index = await buildMp4Index(file);
        const result = await ligoGpsPrimitive.parse(
            { file, relativePath: "Normal/A/REC20250607-180600-001-A.mp4" },
            index,
        );
        expect(result.records).toHaveLength(3);
        for (let i = 0; i < 3; i++) {
            const r = result.records[i]!;
            // Sentinel coords - 50.0°N / 30.0°E (Baltic Sea, not PII).
            expect(r.lat).toBeCloseTo(50 + i * 0.0001, 4);
            expect(r.lon).toBeCloseTo(30 + i * 0.0001, 4);
            expect(r.active).toBe(true);
            // Sentinel datetime - 2025-06-07 18:06:00 + i seconds.
            expect(r.unixSeconds).toBe(Date.UTC(2025, 5, 7, 18, 6, i) / 1000);
        }
    });
});
