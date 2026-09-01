// Real YOUQINGGPS block structure from a RedTiger F7NP-4K clip. Coordinates
// are rounded to whole degrees and all unknown/opaque fields are zeroed by
// scripts/anonymize-youqing-mp4.mjs; UTC, OSD clock, speed and course remain.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildMp4Index } from "../../internal/mp4-index.js";
import { freegpsPrimitive } from "../../primitives/freegps.js";
import { dispatchParseVideoEmbeddedGps } from "../../registry.js";

const FIXTURE = resolve(dirname(fileURLToPath(import.meta.url)), "real-anonymized.mp4");
const NAME = "20260825093511_001359F.MP4";

async function loadFixture() {
    const file = new File([readFileSync(FIXTURE)], NAME);
    const vf = { file, relativePath: NAME };
    const index = await buildMp4Index(file);
    return { vf, index };
}

describe("real-anonymized YOUQINGGPS fixture", () => {
    it("keeps the real structural gps table and freeGPS marker", async () => {
        const { vf, index } = await loadFixture();
        expect(index.novatekGpsAtom).not.toBeNull();
        expect(await freegpsPrimitive.marker(vf, index)).toBe(true);
    });

    it("parses five monotonic UTC fixes with anonymized coordinates and OSD-matched speed", async () => {
        const { vf, index } = await loadFixture();
        const result = await freegpsPrimitive.parse(vf, index);

        expect(result.records).toHaveLength(5);
        expect(result.skipped).toHaveLength(0);
        expect(result.localClockOffsetHintSec).toBeUndefined();

        for (let i = 0; i < result.records.length; i++) {
            const record = result.records[i]!;
            expect(Number.isInteger(record.lat)).toBe(true);
            expect(Number.isInteger(record.lon)).toBe(true);
            expect(record.active).toBe(true);
            expect(record.speedMs).toBeGreaterThan(0);
            expect(record.speedMs).toBeLessThan(200 / 3.6);
            expect(record.bearingDeg).toBeGreaterThanOrEqual(0);
            expect(record.bearingDeg).toBeLessThanOrEqual(360);
            expect(record.mp4Filename).toBe(NAME);
            if (i > 0) expect(record.unixSeconds).toBe(result.records[i - 1]!.unixSeconds + 1);
        }

        const first = result.records[0]!;
        expect(first.unixSeconds).toBe(Date.UTC(2026, 7, 25, 7, 35, 13) / 1000);
        expect(first.speedMs * 3.6).toBeCloseTo(142, 0);
    });

    it("wins through the embedded dispatcher", async () => {
        const { vf } = await loadFixture();
        const result = await dispatchParseVideoEmbeddedGps([
            { file: vf, role: "video", sidecarId: null, sidecarMp4: null, logExtractorId: null },
        ]);

        expect(result.appliedExtractors).toEqual(["freegps"]);
        expect(result.records).toHaveLength(5);
        expect(result.errors).toHaveLength(0);
    });
});
