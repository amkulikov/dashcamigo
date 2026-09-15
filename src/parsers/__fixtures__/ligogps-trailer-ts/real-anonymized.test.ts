// Regression tests on real-anonymized LigoGPS-TS-trailer fixtures. The video
// bodies are generated from scratch (testsrc2 + sine AAC); each trailer
// retains its original structure, timestamps, speed and cadence while
// coordinate fractions are zeroed to whole degrees.
//
// Source: scripts/anonymize-ligogps-trailer-ts.mjs.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { buildMp4Index } from "../../internal/mp4-index.js";
import { ligoGpsTrailerTsPrimitive } from "../../primitives/ligogps-trailer-ts.js";
import { expectPlausibleGpsTrack } from "../helpers.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(HERE, "real-anonymized.TS");
const AMPERSAND_FIXTURE = resolve(HERE, "real-anonymized-ampersand.TS");
// The real camera's filename shape; the trailer clock is the camera-LOCAL
// 2026-08-13 21:11:xx and tracks the filename stamp to the second.
const NAME = "20260813211138_0000002F.ts";

describe("real-anonymized LigoGPS-TS-trailer fixture", () => {
    it.each([
        ["real-anonymized.TS", 120],
        ["real-anonymized-ampersand.TS", 120],
        ["real-anonymized-count.TS", 120],
        ["real-anonymized-empty.TS", 0],
        ["real-anonymized-empty-capacity.TS", 0],
    ])("keeps every trailer coordinate in %s at whole degrees", (name, count) => {
        const bytes = readFileSync(resolve(HERE, name));
        const trailerLength = bytes.readUInt32BE(bytes.length - 4);
        const text = bytes.subarray(-trailerLength).toString("latin1");
        const coordinates = [...text.matchAll(/[NSEW?]:(-?[\d.]+)/g)];
        expect(coordinates).toHaveLength(count);
        for (const coordinate of coordinates) {
            expect(Number.isInteger(Number(coordinate[1]))).toBe(true);
        }
    });

    it("marker + parse end-to-end", async () => {
        const file = new File([Uint8Array.from(readFileSync(FIXTURE))], NAME);
        const vf = { file, relativePath: `video/F/${NAME}` };
        const index = await buildMp4Index(file);

        expect(await ligoGpsTrailerTsPrimitive.marker(vf, index)).toBe(true);

        const result = await ligoGpsTrailerTsPrimitive.parse(vf, index);
        expect(result.records).toHaveLength(60);
        expect(result.skipped).toHaveLength(0);
        expectPlausibleGpsTrack(result.records, { minCount: 60, monotonicTime: true });

        const first = result.records[0]!;
        // Camera-local wall clock parsed as if UTC; estimateTzByFingerprint
        // shifts it at the trips layer (the juscar-ts convention).
        expect(first.unixSeconds).toBe(Date.UTC(2026, 7, 13, 21, 11, 39) / 1000);

        for (const r of result.records) {
            // Sentinel coords - whole-degree anchored, never the real track.
            expect(r.lat).toBeCloseTo(45, 6);
            expect(r.lon).toBeCloseTo(9, 6);
            expect(r.active).toBe(true);
            // The source clip is stationary - real speed bytes survive
            // anonymization and must read as a parked car.
            expect(r.speedMs).toBe(0);
            expect(r.mp4Filename).toBe(NAME);
        }

        // Strict 1 Hz cadence from the real trailer.
        const last = result.records[59]!;
        expect(last.unixSeconds - first.unixSeconds).toBe(59);
    });

    it("parses the slot-count header and positional course", async () => {
        const name = "20260904_202849F.ts";
        const file = new File([Uint8Array.from(readFileSync(resolve(HERE, "real-anonymized-count.TS")))], name);
        const vf = { file, relativePath: `video/F/${name}` };
        const index = await buildMp4Index(file);
        expect(await ligoGpsTrailerTsPrimitive.marker(vf, index)).toBe(true);
        const result = await ligoGpsTrailerTsPrimitive.parse(vf, index);
        expect(result.skipped).toHaveLength(0);
        expectPlausibleGpsTrack(result.records, { minCount: 60, monotonicTime: true });
        expect(result.records).toHaveLength(60);
        const first = result.records[0]!;
        expect(first.unixSeconds).toBe(Date.UTC(2026, 8, 4, 20, 29, 0) / 1000);
        expect(first.speedMs).toBeCloseTo(16 / 3.6);
        expect(first.bearingDeg).toBeCloseTo(97.85);
        expect(result.records[59]!.unixSeconds - first.unixSeconds).toBe(59);
        for (const record of result.records) {
            expect(record.lat).toBe(53);
            expect(record.lon).toBe(49);
            expect(record.active).toBe(true);
            expect(record.accelXg).toBe(0);
            expect(record.accelYg).toBe(0);
            expect(record.accelZg).toBe(0);
        }
    });

    it("indexes an empty parking trailer without inventing GPS", async () => {
        const name = "20260902_174435F_PARK.ts";
        const file = new File([Uint8Array.from(readFileSync(resolve(HERE, "real-anonymized-empty.TS")))], name);
        const vf = { file, relativePath: `park/F/${name}` };
        const index = await buildMp4Index(file);
        expect(await ligoGpsTrailerTsPrimitive.marker(vf, index)).toBe(true);
        expect(await ligoGpsTrailerTsPrimitive.parse(vf, index)).toEqual({ records: [], skipped: [] });
    });

    it("parses an empty LCAI table with retained capacity without inventing GPS", async () => {
        const name = "20260904_205125F.ts";
        const file = new File(
            [Uint8Array.from(readFileSync(resolve(HERE, "real-anonymized-empty-capacity.TS")))],
            name,
        );
        const vf = { file, relativePath: `video/F/${name}` };
        const index = await buildMp4Index(file);
        expect(await ligoGpsTrailerTsPrimitive.marker(vf, index)).toBe(true);
        expect(await ligoGpsTrailerTsPrimitive.parse(vf, index)).toEqual({ records: [], skipped: [] });
    });

    it("parses the classic LIGO magic with an ampersand terminator", async () => {
        const name = "2026081822373512_f.ts";
        const file = new File([Uint8Array.from(readFileSync(AMPERSAND_FIXTURE))], name);
        const vf = { file, relativePath: `VIDEO_F/${name}` };
        const index = await buildMp4Index(file);

        expect(await ligoGpsTrailerTsPrimitive.marker(vf, index)).toBe(true);

        const result = await ligoGpsTrailerTsPrimitive.parse(vf, index);
        expect(result.records).toHaveLength(60);
        expect(result.skipped).toHaveLength(0);
        expectPlausibleGpsTrack(result.records, { minCount: 60, monotonicTime: true });

        const first = result.records[0]!;
        expect(first.unixSeconds).toBe(Date.UTC(2026, 7, 18, 22, 37, 36) / 1000);
        expect(first.speedMs).toBeCloseTo(11 / 3.6, 6);
        for (const record of result.records) {
            expect(record.lat).toBeCloseTo(49, 6);
            expect(record.lon).toBeCloseTo(24, 6);
            expect(record.active).toBe(true);
            expect(record.mp4Filename).toBe(name);
        }

        const last = result.records[59]!;
        expect(last.unixSeconds - first.unixSeconds).toBe(59);
    });
});
