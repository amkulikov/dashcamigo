// Regression test on the real-anonymized gps0-tail fixture from the .TS
// spelling of the family: a 2-channel motorcycle cam that writes plain
// ISO-BMFF (ftyp/moov + IDIT/gps0 tail atoms) under a .TS extension, card
// layout `Normal/<F|R>/`. The lat/lon doubles are translated onto a
// whole-degree 50 N / 30 E anchor with the real displacement deltas
// preserved; IDIT, timestamps, speed and course are the original camera
// bytes. The preserved trajectory is load-bearing: this firmware writes
// speed in KNOTS and the course byte as the LOW BYTE of the full course
// (mod 256), and the parser resolves both by calibrating against the
// trajectory - a fabricated coordinate walk would not exercise that.
//
// Source: scripts/anonymize-navitel-mov.mjs. Ground truth for the dialect:
// the camera's burned-in OSD (e.g. field 25 while the OSD shows 46 km/h =
// 25 kn; raw course byte tracks the trajectory bearing within ~1 deg).
//
// The excerpt deliberately contains a left turn through north (records
// ~19-24): true headings >= 256 deg store only their low byte, so the
// calibration must resolve the +256 alias there.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { classifyGpsSource } from "../../gps-source-hints.js";
import { buildMp4Index } from "../../internal/mp4-index.js";
import { navitelTailPrimitive } from "../../primitives/navitel-tail.js";
import { KNOTS_TO_MS } from "../../types.js";
import { expectPlausibleGpsTrack } from "../helpers.ts";

const FIXTURE = resolve(dirname(fileURLToPath(import.meta.url)), "real-anonymized.TS");
const NAME = "FILE260817-180301-000004F.TS";
const REL_PATH = `0817/CARD/Normal/F/${NAME}`;

describe("real-anonymized Navitel gps0 tail in a .TS container", () => {
    it("marker + parse end-to-end with the knots/mod-256 dialect calibrated", async () => {
        const vf = { file: new File([Uint8Array.from(readFileSync(FIXTURE))], NAME), relativePath: REL_PATH };
        expect(classifyGpsSource(vf)).toBe("embedded");

        const index = await buildMp4Index(vf.file);
        expect(await navitelTailPrimitive.marker(vf, index)).toBe(true);

        const result = await navitelTailPrimitive.parse(vf, index);
        expect(result.records).toHaveLength(40);
        expect(result.skipped).toHaveLength(0);
        expectPlausibleGpsTrack(result.records, { minCount: 40, monotonicTime: true });

        // gps0 rows are satellite UTC while IDIT ("2026-08-17 18:03:01") is the
        // camera-local clock - the two-hour gap is the recording timezone, and
        // it is the reason the trips layer must not read IDIT as UTC.
        const first = result.records[0]!;
        expect(first.unixSeconds).toBe(Date.UTC(2026, 7, 17, 16, 3, 2) / 1000);
        // Strict 1 Hz cadence, no stale ring-buffer row in this excerpt.
        expect(result.records[39]!.unixSeconds - first.unixSeconds).toBe(39);

        // Sentinel-anchored coords - the track starts at the whole-degree
        // anchor and stays in its immediate vicinity, never the real place.
        expect(first.lat).toBeCloseTo(50, 6);
        expect(first.lon).toBeCloseTo(30, 6);
        for (const r of result.records) {
            expect(Math.abs(r.lat - 50), "lat stays near the sentinel anchor").toBeLessThan(0.01);
            expect(Math.abs(r.lon - 30), "lon stays near the sentinel anchor").toBeLessThan(0.01);
            expect(r.active).toBe(true);
            expect(r.mp4Filename).toBe(NAME);
        }

        // Speed field is knots on this firmware; the calibration pass must
        // detect it from the trajectory (haversine/field ratio ~1.85) and
        // emit real m/s, not the km/h misreading. Raw fields: 29 first, 24 last.
        expect(first.speedMs, "29 kn").toBeCloseTo(29 * KNOTS_TO_MS, 3);
        expect(result.records[39]!.speedMs, "24 kn").toBeCloseTo(24 * KNOTS_TO_MS, 3);

        // Course byte is the raw heading (NOT halved): a steady ~72 deg
        // east-northeast run at the start...
        for (const r of result.records.slice(0, 6)) {
            expect(r.bearingDeg).toBeGreaterThanOrEqual(71);
            expect(r.bearingDeg).toBeLessThanOrEqual(74);
        }
        // ...and the +256 alias resolved through the left turn across north
        // (raw bytes 102/81/59 at trajectory bearings ~358/343/318).
        expect(result.records[20]!.bearingDeg, "alias 102 -> 358").toBe(358);
        expect(result.records[21]!.bearingDeg, "alias 81 -> 337").toBe(337);
        expect(result.records[22]!.bearingDeg, "alias 59 -> 315").toBe(315);
    });
});
