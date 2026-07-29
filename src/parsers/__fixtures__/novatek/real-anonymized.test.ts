// Regression tests on real-anonymized Novatek MP4 fixtures (2E Drive,
// SilverStone). Coordinates replaced with sentinel (50.0 N / 30.0 E).
// Covers real preamble/padding structure, not just synthetic output.
//
// Source: scripts/anonymize-novatek-mp4.mjs.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { freegpsPrimitive } from "../../primitives/freegps.js";
import { buildMp4Index } from "../../internal/mp4-index.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const PUBLIC_FIXTURES = resolve(REPO_ROOT, "tests/testdata/novatek-real-anonymized");

describe("real-anonymized Novatek MP4 fixtures", () => {
    it("2E Drive 730 Magnet: 3 active blocks parse to records with sentinel coords", async () => {
        const buf = readFileSync(resolve(PUBLIC_FIXTURES, "2e-drive-730.mp4"));
        const file = new File([buf], "2021_1013_183759_050.MP4");
        const index = await buildMp4Index(file);
        const result = await freegpsPrimitive.parse(
            { file, relativePath: "2021_1013_183759_050.MP4" },
            index,
        );
        expect(result.records).toHaveLength(3);
        // Sentinel coords - 50.0°N / 30.0°E (Baltic Sea, not PII).
        for (let i = 0; i < 3; i++) {
            const r = result.records[i]!;
            expect(r.lat).toBeCloseTo(50 + i * 0.0001, 4);
            expect(r.lon).toBeCloseTo(30 + i * 0.0001, 4);
            expect(r.active).toBe(true);
            // Datetime is original (not PII), from 2021-10-13.
            expect(r.unixSeconds).toBeGreaterThan(Date.UTC(2021, 9, 1) / 1000);
            expect(r.unixSeconds).toBeLessThan(Date.UTC(2021, 11, 1) / 1000);
        }
    });

    it("SilverStone F1 A80-GPS Sky: same LAYOUT_DEFAULT works", async () => {
        const buf = readFileSync(resolve(PUBLIC_FIXTURES, "silverstone-a80.mp4"));
        const file = new File([buf], "2019_0216_150750_196.MOV");
        const index = await buildMp4Index(file);
        const result = await freegpsPrimitive.parse(
            { file, relativePath: "2019_0216_150750_196.MOV" },
            index,
        );
        expect(result.records).toHaveLength(3);
        for (let i = 0; i < 3; i++) {
            const r = result.records[i]!;
            expect(r.lat).toBeCloseTo(50 + i * 0.0001, 4);
            expect(r.lon).toBeCloseTo(30 + i * 0.0001, 4);
            // Datetime from 2019-02-16.
            expect(r.unixSeconds).toBeGreaterThan(Date.UTC(2019, 1, 1) / 1000);
            expect(r.unixSeconds).toBeLessThan(Date.UTC(2019, 2, 1) / 1000);
        }
    });

    // VIOFO A119 Mini 2: LAYOUT_ALT plus a cold-start prefix - pre-fix RTC
    // blocks in UTC, satellite-synced records with the +3h zone baked in.
    // The fixture keeps 4 pre-fix + 4 active blocks around the transition;
    // the local-as-UTC evidence (localClockOffsetHintSec) must come out as
    // the real measured jump.
    describe("VIOFO A119 Mini 2 cold-start (local-as-UTC firmware)", () => {
        const NAME = "20260406142122_000022.MP4";

        async function parseFixture(filename: string) {
            const buf = readFileSync(resolve(PUBLIC_FIXTURES, "viofo-a119-mini2-coldstart.mp4"));
            const file = new File([buf], filename);
            const index = await buildMp4Index(file);
            return freegpsPrimitive.parse({ file, relativePath: filename }, index);
        }

        it("parses LAYOUT_ALT records with sentinel coords and measures the +3h jump", async () => {
            const result = await parseFixture(NAME);
            expect(result.records).toHaveLength(4);
            for (let i = 0; i < 4; i++) {
                const r = result.records[i]!;
                expect(r.lat).toBeCloseTo(50 + i * 0.0001, 4);
                expect(r.lon).toBeCloseTo(30 + i * 0.0001, 4);
                expect(r.active).toBe(true);
            }
            // Records still carry the local clock at parse time (14:22:05
            // local on 2026-04-06); the correction happens in trips.ts.
            expect(result.records[0]!.unixSeconds).toBe(Date.UTC(2026, 3, 6, 14, 22, 5) / 1000);
            expect(result.localClockOffsetHintSec).toBe(10_800);
        });

        it("withholds the hint when the filename clock disagrees with the records", async () => {
            // Same bytes under a UTC-looking filename = the honest-camera
            // shape (local RTC, UTC satellite stamps) - the jump means the
            // opposite thing there and must not be published as evidence.
            const result = await parseFixture("20260406112122_000022.MP4");
            expect(result.records).toHaveLength(4);
            expect(result.localClockOffsetHintSec).toBeUndefined();
        });
    });
});
