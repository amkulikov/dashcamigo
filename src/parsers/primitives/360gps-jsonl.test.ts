import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { KNOTS_TO_MS, type VendorFile, WrongFormatError } from "../types.js";
import { threeSixtyGpsJsonlPrimitive } from "./360gps-jsonl.js";

const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), "../__fixtures__/360gps-jsonl");
const VIDEOS = ["20260102030400_000001AAN.MP4", "20260102030500_000002AAN.MP4"];

function makeFile(name: string, content: BlobPart): VendorFile {
    return {
        file: new File([content], name, { type: "text/plain" }),
        relativePath: `360CARDVR/GPS/${name}`,
        sourceKey: "card-a",
    };
}

function fixture(name: string, fileName = name): VendorFile {
    return makeFile(fileName, readFileSync(resolve(FIXTURES, name)));
}

function parse(name: string, knownVideoNames = VIDEOS) {
    return threeSixtyGpsJsonlPrimitive.parse(fixture(name), undefined, undefined, { knownVideoNames });
}

describe("threeSixtyGpsJsonlPrimitive.marker", () => {
    it("recognizes a timestamped GPS JSONL file", async () => {
        expect(
            await threeSixtyGpsJsonlPrimitive.marker(fixture("synthetic-happy.TXT", "20260102030400_000001GPS.TXT")),
        ).toBe(true);
    });

    it("requires both the GPS filename and JSON row signature", async () => {
        const content = readFileSync(resolve(FIXTURES, "synthetic-happy.TXT"));
        expect(await threeSixtyGpsJsonlPrimitive.marker(makeFile("renamed.TXT", content))).toBe(false);
        expect(
            await threeSixtyGpsJsonlPrimitive.marker(makeFile("20260102030400_000001GPS.TXT", '{"ordinary":"json"}\n')),
        ).toBe(false);
    });
});

describe("threeSixtyGpsJsonlPrimitive.parse", () => {
    it("partitions the whole-session stream by video-name clock windows", async () => {
        const result = await parse("synthetic-happy.TXT");

        expect(result.records).toHaveLength(11);
        expect(result.skipped).toEqual([]);
        expect(result.records.slice(0, 9).every((record) => record.mp4Filename === VIDEOS[0])).toBe(true);
        expect(result.records[9]!.mp4Filename).toBe(VIDEOS[1]);
        expect(result.records[10]!.mp4Filename).toBe(VIDEOS[1]);
        expect(result.records[0]).toMatchObject({
            timeUnsynced: true,
            relStartSeconds: 15,
            bearingDeg: 90,
            accelXg: 0,
            accelYg: 0,
            accelZg: 0,
        });
        expect(result.records[0]!.speedMs).toBeCloseTo(10 * KNOTS_TO_MS, 6);
        expect(result.records[9]!.relStartSeconds).toBe(0);
        expect(result.records.map((record) => record.unixSeconds)).toEqual(
            [...result.records.map((record) => record.unixSeconds)].sort((a, b) => a - b),
        );
    });

    it("prefers the A channel when front and rear share a start", async () => {
        const result = await parse("synthetic-happy.TXT", [
            "20260102030400_000001ABN.MP4",
            "20260102030400_000002AAN.MP4",
            "20260102030500_000003ABN.MP4",
            "20260102030500_000004AAN.MP4",
        ]);
        expect(new Set(result.records.map((record) => record.mp4Filename))).toEqual(
            new Set(["20260102030400_000002AAN.MP4", "20260102030500_000004AAN.MP4"]),
        );
    });

    it("skips no-fix and malformed rows while preserving their five-second slots", async () => {
        const result = await parse("synthetic-edge.TXT");

        expect(result.records).toHaveLength(2);
        expect(result.records[0]).toMatchObject({ bearingDeg: 0, relStartSeconds: 0 });
        expect(result.records[1]).toMatchObject({ lat: 52, lon: 5, relStartSeconds: 35 });
        expect(result.skipped.map((item) => item.reason)).toEqual([
            "no gps fix",
            "bad json",
            "missing field",
            "bad coordinates",
            "bad speed",
            "bad bearing",
        ]);
    });

    it("does not attach a whole log tail to the last selected clip", async () => {
        const result = await parse("synthetic-happy.TXT", [VIDEOS[0]!]);
        expect(result.records).toHaveLength(10);
        expect(result.skipped.at(-1)?.reason).toBe("no video for gps timestamp");
    });

    it("rejects a marker lookalike with an invalid timestamp anchor", async () => {
        const file = fixture("synthetic-wrong-format.TXT", "20260102030400_000001GPS.TXT");
        expect(await threeSixtyGpsJsonlPrimitive.marker(file)).toBe(true);
        await expect(
            threeSixtyGpsJsonlPrimitive.parse(file, undefined, undefined, { knownVideoNames: VIDEOS }),
        ).rejects.toBeInstanceOf(WrongFormatError);
    });
});
