import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { vendorFileKey } from "../../../vendor-file-key.js";
import { matchFilenameChannel, matchFilenameMode, matchFilenameSequence, matchFilenameTime } from "../../filename/index.js";
import { classifyGpsSource, shouldTryEmbeddedGps } from "../../gps-source-hints.js";
import { buildMp4Index } from "../../internal/mp4-index.js";
import { sstarSsmdPrimitive } from "../../primitives/sstar-ssmd.js";
import { classifyFiles, dispatchParseVideoEmbeddedGps } from "../../registry.js";
import { expectPlausibleGpsTrack, makeVendorFile } from "../helpers.js";

const NAME = "REC20260912-180135-43.mp4";
const START_UTC = Date.UTC(2026, 8, 12, 15, 1, 36) / 1000;

function fixture(name = NAME) {
    const bytes = readFileSync(new URL("./real-anonymized-ddmm.mp4", import.meta.url));
    return makeVendorFile(name, bytes);
}

describe("real-anonymized iBox RoadScan 2K DDmm ssmd", () => {
    it("extracts all real fixes with whole-degree coordinates and the GPS clock", async () => {
        const vf = fixture();
        const index = await buildMp4Index(vf.file);
        expect(index.tracks.map((track) => [track.handlerType, track.sampleFormat])).toEqual([["meta", "ssmd"]]);
        expect(vf.file.size).toBeLessThan(5_000_000);
        expect(await sstarSsmdPrimitive.marker(vf, index)).toBe(true);
        const result = await sstarSsmdPrimitive.parse(vf, index);
        expectPlausibleGpsTrack(result.records, { minCount: 60 });
        expect(result.skipped).toEqual([]);
        expect(result.videoStartUtcHint).toBe(START_UTC);
        for (const [i, record] of result.records.entries()) {
            expect(record.lat).toBe(Math.round(record.lat));
            expect(record.lon).toBe(Math.round(record.lon));
            expect(record.unixSeconds).toBe(START_UTC + i);
            expect(record.timeUnsynced).toBeUndefined();
            expect(record.speedMs).toBeGreaterThanOrEqual(0);
            expect(record.speedMs).toBeLessThan(70 / 3.6);
            expect(record.bearingDeg).toBeGreaterThanOrEqual(0);
            expect(record.bearingDeg).toBeLessThan(360);
        }
        const first = result.records[0]!;
        const last = result.records[result.records.length - 1]!;
        expect({
            count: result.records.length,
            coordinates: [first.lat, first.lon],
            firstKmh: Math.round(first.speedMs * 3.6),
            lastKmh: Math.round(last.speedMs * 3.6),
            firstCourse: first.bearingDeg,
            lastCourse: last.bearingDeg,
        }).toMatchInlineSnapshot(`
          {
            "coordinates": [
              60,
              30,
            ],
            "count": 60,
            "firstCourse": 338,
            "firstKmh": 46,
            "lastCourse": 340,
            "lastKmh": 24,
          }
        `);
    });

    it("reuses REC filename techniques and extracts through the ingest dispatcher", async () => {
        const vf = fixture();
        expect(matchFilenameTime(vf).matchedId).toBe("rec-single-time");
        const local = matchFilenameTime(vf).value!;
        expect([local.getFullYear(), local.getMonth(), local.getDate(), local.getHours(), local.getMinutes(), local.getSeconds()])
            .toEqual([2026, 8, 12, 18, 1, 35]);
        expect(matchFilenameSequence(vf)).toEqual({ value: 43, matchedId: "rec-single-sequence" });
        expect(matchFilenameChannel(vf).value).toBeNull();
        expect(matchFilenameMode(vf).value).toBeNull();
        expect(classifyGpsSource(vf)).toBe("embedded");
        expect(shouldTryEmbeddedGps(vf, false)).toBe(true);
        const result = await dispatchParseVideoEmbeddedGps(await classifyFiles([vf]));
        expect(result.appliedExtractors).toEqual(["sstar-ssmd"]);
        expect(result.errors).toEqual([]);
        expect(result.records).toHaveLength(60);
        expect(result.videoStartUtcHintByFileKey.get(vendorFileKey(vf))).toBe(START_UTC);
        expect(result.accelByFileKey.size).toBe(0);
    });

    it("preserves real media spacing when a renamed file has no date anchor", async () => {
        const vf = fixture("clip.mp4");
        const result = await sstarSsmdPrimitive.parse(vf, await buildMp4Index(vf.file));
        expectPlausibleGpsTrack(result.records, { minCount: 60 });
        expect(result.videoStartUtcHint).toBeUndefined();
        expect(result.records[0]!.relStartSeconds).toBe(0);
        expect(result.records[1]!.relStartSeconds).toBeCloseTo(86713 / 90000, 8);
        for (const [i, record] of result.records.entries()) {
            expect(record.timeUnsynced).toBe(true);
            expect(record.unixSeconds).toBe(0);
            if (i > 0) expect(record.relStartSeconds).toBeGreaterThan(result.records[i - 1]!.relStartSeconds!);
        }
    });
});
