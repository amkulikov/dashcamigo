// Tests for the LigoGPS file-trailer primitive (Beferich J18 layout).
// Fixtures: src/parsers/__fixtures__/ligogps-trailer/build-synthetic.mjs.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildMp4Index } from "../internal/mp4-index.js";
import type { VendorFile } from "../types.js";
import { WrongFormatError } from "../types.js";
import { ligoGpsTrailerPrimitive } from "./ligogps-trailer.js";

const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), "../__fixtures__/ligogps-trailer");

function loadFixture(name: string, asFilename = "2026-08-03_11_34_53_f.mp4"): VendorFile {
    const buf = readFileSync(resolve(FIXTURES, name));
    const file = new File([buf], asFilename);
    return { file, relativePath: asFilename };
}

describe("ligogps-trailer marker", () => {
    it("accepts a trailer with the LIGOGPSINFO magic", async () => {
        const vf = loadFixture("synthetic-happy.mp4");
        const index = await buildMp4Index(vf.file);
        expect(await ligoGpsTrailerPrimitive.marker(vf, index)).toBe(true);
    });

    it("rejects a trailer without the magic", async () => {
        const vf = loadFixture("synthetic-wrong-format.mp4");
        const index = await buildMp4Index(vf.file);
        expect(await ligoGpsTrailerPrimitive.marker(vf, index)).toBe(false);
    });

    it("rejects a file whose box structure reaches EOF", async () => {
        const vf = loadFixture("synthetic-happy.mp4");
        const index = await buildMp4Index(vf.file);
        // Simulate "no trailer": the box walk covered the whole file.
        index.lastTopLevelBoxEnd = index.fileSize;
        expect(await ligoGpsTrailerPrimitive.marker(vf, index)).toBe(false);
    });
});

describe("ligogps-trailer parse", () => {
    it("parses the plaintext table and skips the encrypted twin", async () => {
        const vf = loadFixture("synthetic-happy.mp4");
        const index = await buildMp4Index(vf.file);
        const result = await ligoGpsTrailerPrimitive.parse(vf, index);

        expect(result.records).toHaveLength(6);
        const first = result.records[0]!;
        expect(first.unixSeconds).toBe(Date.UTC(2026, 7, 3, 11, 34, 53) / 1000);
        expect(first.lat).toBeCloseTo(50.1, 5);
        expect(first.lon).toBeCloseTo(30.1, 5);
        // 19.0 km/h, already km/h in this carrier (no knots conversion).
        expect(first.speedMs).toBeCloseTo(19 / 3.6, 4);
        // A: course lands in bearingDeg.
        expect(first.bearingDeg).toBeCloseTo(210, 4);
        expect(first.active).toBe(true);

        // Encrypted directory is recognized but unclaimed.
        const encSkip = result.skipped.filter((s) => s.reason.includes("encrypted trailer directory"));
        expect(encSkip).toHaveLength(1);
    });

    it("survives blank, garbage, no-fix and out-of-range slots", async () => {
        const vf = loadFixture("synthetic-edge.mp4");
        const index = await buildMp4Index(vf.file);
        const result = await ligoGpsTrailerPrimitive.parse(vf, index);

        // Slots: valid + blank + garbage + '?' no-fix + lat 99 + index-10
        // valid + valid. Blank is silent; the three bad ones are logged.
        expect(result.records).toHaveLength(3);
        const badSlots = result.skipped.filter((s) => s.reason.includes("plaintext slot"));
        expect(badSlots).toHaveLength(3);
        // The index-10 slot (counter byte 0x0a) parses - the record regex
        // carries the `s` flag so a binary counter byte cannot break `^.{4}`.
        expect(result.records[1]!.unixSeconds).toBe(Date.UTC(2026, 7, 3, 11, 34, 58) / 1000);
        // Declared count (100) exceeds stored slots - the '####' terminator
        // stops the walk instead of running into the trailing bytes.
        expect(result.records[2]!.unixSeconds).toBe(Date.UTC(2026, 7, 3, 11, 34, 59) / 1000);
    });

    it("returns zero records with a skipped entry for an encrypted-only trailer", async () => {
        const vf = loadFixture("synthetic-encrypted-only.mp4");
        const index = await buildMp4Index(vf.file);
        const result = await ligoGpsTrailerPrimitive.parse(vf, index);
        expect(result.records).toHaveLength(0);
        expect(result.skipped).toHaveLength(1);
    });

    it("throws WrongFormatError when the trailer carries no LIGOGPSINFO", async () => {
        const vf = loadFixture("synthetic-wrong-format.mp4");
        const index = await buildMp4Index(vf.file);
        await expect(ligoGpsTrailerPrimitive.parse(vf, index)).rejects.toThrow(WrongFormatError);
    });
});
