import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { classifyGpsSource, shouldTryEmbeddedGps } from "../../gps-source-hints.js";
import { classifyFiles, dispatchParseVideoEmbeddedGps } from "../../registry.js";
import { escortMapSidecar, parseMapText } from "../../sidecars/escort-map.js";
import { expectPlausibleGpsTrack, makeVendorFile } from "../helpers.js";

// Metadata-only fixtures from scripts/anonymize-novatek-mp4.mjs and
// scripts/anonymize-escort-log.mjs; no source video or precise locations.
const NAME = "20260923_0134_CAM1.MP4";
const video = makeVendorFile(
    `Normal_Front/${NAME}`,
    readFileSync(new URL("./real-anonymized.mp4", import.meta.url)),
);
const mapText = readFileSync(new URL("./real-anonymized.map", import.meta.url), "utf8");
const sidecar = makeVendorFile(`Normal_Front/${NAME.replace(".MP4", ".map")}`, mapText);

describe("date-sequence-cam real anonymized pair", () => {
    it.each([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])("keeps embedded GPS authoritative for CAM%s", async (index) => {
        const name = NAME.replace("CAM1", `CAM${index}`);
        const numberedVideo = makeVendorFile(name, video.file);
        const numberedMap = makeVendorFile(name.replace(".MP4", ".map"), sidecar.file);
        const classified = await classifyFiles([numberedVideo, numberedMap]);
        expect(classified.find((file) => file.file === numberedMap)?.role).toBe("unknown");
        expect(classifyGpsSource(numberedVideo)).toBe("embedded");
        expect(shouldTryEmbeddedGps(numberedVideo, false)).toBe(true);
        const parsed = await dispatchParseVideoEmbeddedGps(classified);
        expect(parsed.errors).toEqual([]);
        expect(parsed.appliedExtractors).toEqual(["freegps"]);
        expect(parsed.records).toHaveLength(3);
        expect(parsed.records.every((record) => record.mp4Filename === name)).toBe(true);
    });

    it("uses embedded GPS even when a same-basename map contains older records", async () => {
        const classified = await classifyFiles([video, sidecar]);
        expect(escortMapSidecar.matches(sidecar, new Set([NAME]))).toBeNull();
        expect(classified.find((file) => file.file === sidecar)?.role).toBe("unknown");
        expect(classifyGpsSource(video)).toBe("embedded");
        expect(shouldTryEmbeddedGps(video, false)).toBe(true);

        const parsed = await dispatchParseVideoEmbeddedGps(classified);
        expect(parsed.errors).toEqual([]);
        expect(parsed.appliedExtractors).toEqual(["freegps"]);
        expect(parsed.records).toHaveLength(3);
        expectPlausibleGpsTrack(parsed.records);
        for (const [i, record] of parsed.records.entries()) {
            expect(record.unixSeconds).toBe(Date.UTC(2026, 8, 24, 2, 32, 9 + i) / 1000);
            expect(record.lat).toBeCloseTo(50 + i * 0.0001, 4);
            expect(record.lon).toBeCloseTo(30 + i * 0.0001, 4);
            expect(record.speedMs).toBeGreaterThanOrEqual(0);
            expect(record.speedMs).toBeLessThan(50);
        }
    });

    it("parses both map rows including the final lone carriage return", () => {
        expect(mapText.endsWith(";\r")).toBe(true);
        const parsed = parseMapText(mapText, NAME);
        expect(parsed.skipped).toEqual([]);
        expect(parsed.records).toHaveLength(2);
        expectPlausibleGpsTrack(parsed.records);
        for (const [i, record] of parsed.records.entries()) {
            expect(record.unixSeconds).toBe(Date.UTC(2026, 8, 23, 18, 37, 43 + i) / 1000);
            expect(Number.isInteger(record.lat)).toBe(true);
            expect(Number.isInteger(record.lon)).toBe(true);
        }
    });
});
