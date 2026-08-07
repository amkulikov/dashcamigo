// Regression test on a real-anonymized Beferich J18 fixture: actual trailer
// bytes (encrypted directory with zeroed chunk bodies + plaintext table),
// coordinates replaced with a sentinel (48.1 N / 2.1 W, counter fraction).
//
// Source: scripts/anonymize-ligogps-trailer-mp4.mjs.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildMp4Index } from "../../internal/mp4-index.js";
import { ligoGpsTrailerPrimitive } from "../../primitives/ligogps-trailer.js";

const HERE = dirname(fileURLToPath(import.meta.url));

describe("real-anonymized Beferich J18 fixture", () => {
    it("parses 180 one-hertz records with sentinel coords from the trailer table", async () => {
        const buf = readFileSync(resolve(HERE, "real-anonymized.mp4"));
        const file = new File([buf], "2026-08-03_11_34_53_f.mp4");
        const vf = { file, relativePath: file.name };
        const index = await buildMp4Index(file);

        expect(await ligoGpsTrailerPrimitive.marker(vf, index), "marker").toBe(true);
        const result = await ligoGpsTrailerPrimitive.parse(vf, index);

        expect(result.records).toHaveLength(180);
        const first = result.records[0]!;
        // Camera-local clock stamp, matching the filename (the local-as-UTC
        // handling happens later, in the time layer).
        expect(first.unixSeconds).toBe(Date.UTC(2026, 7, 3, 11, 34, 53) / 1000);
        // Sentinel coords: 48.1 N / 2.1 W with a per-record counter fraction.
        for (let i = 0; i < 180; i++) {
            const r = result.records[i]!;
            expect(r.lat, `lat[${i}]`).toBeCloseTo(48.1 + i * 1e-6, 5);
            expect(r.lon, `lon[${i}]`).toBeCloseTo(-(2.1 + i * 1e-6), 5);
            expect(r.active, `active[${i}]`).toBe(true);
        }
        // Plausibility beside the sentinel snapshot: real speed (km/h) and
        // course carried over from the recording.
        expect(first.speedMs).toBeCloseTo(19 / 3.6, 3);
        expect(first.bearingDeg).toBeCloseTo(212, 3);
        const times = result.records.map((r) => r.unixSeconds);
        expect(times.at(-1)! - times[0]!, "window covers the 3-minute clip").toBe(179);

        // The encrypted twin is recognized and skipped, never parsed.
        expect(result.skipped.some((s) => s.reason.includes("encrypted trailer directory"))).toBe(true);
    });
});
