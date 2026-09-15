import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { vendorFileKey } from "../../../vendor-file-key.js";
import { matchFilenameTime } from "../../filename/index.js";
import { classifyGpsSource, shouldTryEmbeddedGps } from "../../gps-source-hints.js";
import { buildMp4Index } from "../../internal/mp4-index.js";
import { seiDoubleGpsPrimitive } from "../../primitives/sei-double-gps.js";
import { classifyFiles, dispatchParseVideoEmbeddedGps } from "../../registry.js";
import { makeVendorFile } from "../helpers.js";

function fixture(filename: string) {
    const bytes = readFileSync(new URL(`./${filename}`, import.meta.url));
    return makeVendorFile(filename.replace(/^real-(?:fix|nofix)-anonymized/, "080546_828_023_D"), bytes);
}

describe("real-anonymized SEI double GPS MP4", () => {
    it("extracts all fixes without source coordinates or media", async () => {
        const vf = fixture("real-fix-anonymized.mp4");
        const index = await buildMp4Index(vf.file);
        expect(vf.file.size).toBeLessThan(5_000_000);
        expect(index.tracks).toHaveLength(1);
        expect(await seiDoubleGpsPrimitive.marker(vf, index)).toBe(true);
        const result = await seiDoubleGpsPrimitive.parse(vf, index);
        expect(result.records).toHaveLength(12);
        expect(result.skipped).toEqual([]);
        for (const record of result.records) {
            expect(record.lat).toBe(50);
            expect(record.lon).toBe(30);
            expect(record.timeUnsynced).toBe(true);
            expect(record.speedMs).toBe(0);
        }
        for (let i = 1; i < result.records.length; i++) {
            expect(result.records[i]!.unixSeconds - result.records[i - 1]!.unixSeconds).toBe(2);
        }
        expect({ count: result.records.length, coordinates: [result.records[0]!.lat, result.records[0]!.lon] })
            .toMatchInlineSnapshot(`
              {
                "coordinates": [
                  50,
                  30,
                ],
                "count": 12,
              }
            `);
    });

    it("keeps the embedded probe enabled and dispatches the extractor", async () => {
        const vf = fixture("real-fix-anonymized.mp4");
        expect(matchFilenameTime(vf).value).toBeNull();
        expect(classifyGpsSource(vf)).toBe("embedded");
        expect(shouldTryEmbeddedGps(vf, false)).toBe(true);
        const result = await dispatchParseVideoEmbeddedGps(await classifyFiles([vf]));
        expect(result.appliedExtractors).toEqual(["sei-double-gps"]);
        expect(result.errors).toEqual([]);
        expect(result.records).toHaveLength(12);
        expect(result.videoStartUtcHintByFileKey.has(vendorFileKey(vf))).toBe(false);
    });

    it("accepts no-fix packets without inventing a route", async () => {
        const vf = fixture("real-nofix-anonymized.mp4");
        const index = await buildMp4Index(vf.file);
        expect(await seiDoubleGpsPrimitive.marker(vf, index)).toBe(true);
        const result = await seiDoubleGpsPrimitive.parse(vf, index);
        expect(result.records).toEqual([]);
        expect(result.skipped).toEqual([]);
    });
});
