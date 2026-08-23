import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { KNOTS_TO_MS, type VendorFile, WrongFormatError } from "../types.js";
import { sectionedNmeaLogPrimitive } from "./sectioned-nmea-log.js";

const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), "../__fixtures__/sectioned-nmea-log");

function makeFile(name: string, content: string, sourceKey?: string): VendorFile {
    return {
        file: new File([content], name, { type: "text/plain" }),
        relativePath: `PRIVATE/SONY/GPS/${name}`,
        ...(sourceKey === undefined ? {} : { sourceKey }),
    };
}

function fixture(name: string, sourceKey?: string): VendorFile {
    return makeFile(name, readFileSync(resolve(FIXTURES, name), "utf8"), sourceKey);
}

describe("sectionedNmeaLogPrimitive.marker", () => {
    it("recognizes a .LOG with an @Sonygps version header", async () => {
        expect(await sectionedNmeaLogPrimitive.marker(fixture("synthetic-happy.LOG"))).toBe(true);
    });

    it("requires both the log extension and content marker", async () => {
        const content = "@Sonygps/ver5.0/wgs-84/20260823075402.000/\n";
        expect(await sectionedNmeaLogPrimitive.marker(makeFile("renamed.txt", content))).toBe(false);
        expect(await sectionedNmeaLogPrimitive.marker(makeFile("unrelated.LOG", "ordinary text\n"))).toBe(false);
    });
});

describe("sectionedNmeaLogPrimitive.parse", () => {
    it("parses each recording section and preserves its exact clip-start association", async () => {
        const result = await sectionedNmeaLogPrimitive.parse(fixture("synthetic-happy.LOG", "card-a"));

        expect(result.records).toHaveLength(3);
        expect(result.skipped).toEqual([]);
        expect(result.records.map((record) => record.recordingAssociation?.startUtc)).toEqual([
            Date.UTC(2026, 7, 23, 7, 54, 2) / 1000,
            Date.UTC(2026, 7, 23, 7, 54, 2) / 1000,
            Date.UTC(2026, 7, 23, 8, 16, 45, 250) / 1000,
        ]);
        expect(result.records.every((record) => record.recordingAssociation?.sourceKey === "card-a")).toBe(true);
        expect(result.records[0]!.unixSeconds).toBe(Date.UTC(2026, 7, 23, 7, 54, 3) / 1000);
        expect(result.records[0]!.speedMs).toBeCloseTo(10 * KNOTS_TO_MS, 6);
        expect(result.records[0]!.lat).toBeCloseTo(51, 6);
        expect(result.records[0]!.lon).toBeCloseTo(4, 6);
        expect(result.records[0]!.bearingDeg).toBeGreaterThan(0);
        expect(result.records[0]!.mp4Filename).not.toBe(result.records[2]!.mp4Filename);
    });

    it("keeps equal sections from different log paths separate inside one source scope", async () => {
        const first = fixture("synthetic-happy.LOG", "card-a");
        const second = { ...fixture("synthetic-happy.LOG", "card-a"), relativePath: "BACKUP/GPS/synthetic-happy.LOG" };
        const firstResult = await sectionedNmeaLogPrimitive.parse(first);
        const secondResult = await sectionedNmeaLogPrimitive.parse(second);

        expect(firstResult.records[0]!.mp4Filename).not.toBe(secondResult.records[0]!.mp4Filename);
    });

    it("skips invalid headers, void fixes, and malformed RMC rows without losing a later valid section", async () => {
        const result = await sectionedNmeaLogPrimitive.parse(fixture("synthetic-edge.LOG"));

        expect(result.records).toHaveLength(1);
        expect(result.records[0]).toMatchObject({ lat: -10, lon: -10 });
        expect(result.skipped.map((item) => item.reason)).toEqual([
            "bad recording header",
            "bad recording header",
            "rmc: too few fields",
        ]);
        expect(result.skipped[2]!.line).toBe(8);
    });

    it("rejects a marker lookalike with no valid timestamped recording header", async () => {
        await expect(sectionedNmeaLogPrimitive.parse(fixture("synthetic-wrong-format.LOG"))).rejects.toBeInstanceOf(
            WrongFormatError,
        );
    });
});
