import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { buildMp4Index } from "../internal/mp4-index.js";
import { WrongFormatError } from "../types.js";
import { ligoGpsTrailerTsPrimitive } from "./ligogps-trailer-ts.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = resolve(HERE, "../__fixtures__/ligogps-trailer-ts");
const happy = readFileSync(resolve(FIXTURES, "synthetic-happy.TS"));
const edge = readFileSync(resolve(FIXTURES, "synthetic-edge.TS"));
const wrongFormat = readFileSync(resolve(FIXTURES, "synthetic-wrong-format.TS"));
const juscar = readFileSync(resolve(HERE, "../__fixtures__/juscar/real-anonymized.TS"));

const NAME = "20260813211138_0000002F.ts";

// buildMp4Index degrades gracefully on MPEG-TS (no boxes) but still detects
// the EOF trailer - the path production uses.
async function indexed(buf: Buffer, name = NAME) {
    const file = new File([Uint8Array.from(buf)], name);
    return { vf: { file, relativePath: name }, index: await buildMp4Index(file) };
}

describe("ligogps-trailer-ts primitive", () => {
    it("marker fires on the trailer and parse yields the slot records", async () => {
        const { vf, index } = await indexed(happy);
        expect(await ligoGpsTrailerTsPrimitive.marker(vf, index)).toBe(true);

        const result = await ligoGpsTrailerTsPrimitive.parse(vf, index);
        expect(result.records).toHaveLength(3);
        expect(result.skipped).toHaveLength(0);

        const [first, second, third] = result.records;
        expect(first!.unixSeconds).toBe(Date.UTC(2026, 7, 13, 21, 11, 39) / 1000);
        expect(first!.lat).toBeCloseTo(45.0, 6);
        expect(first!.lon).toBeCloseTo(9.0, 6);
        expect(first!.speedMs).toBe(0);
        // 3.60 km/h = 1 m/s - the trailer speed field is km/h, not knots.
        expect(second!.speedMs).toBeCloseTo(1, 6);
        expect(second!.bearingDeg).toBeCloseTo(90, 6);
        expect(third!.unixSeconds - first!.unixSeconds).toBe(2);
        expect(first!.mp4Filename).toBe(NAME);
    });

    it("skips blank and garbage slots, stops at an early terminator", async () => {
        const { vf, index } = await indexed(edge);
        const result = await ligoGpsTrailerTsPrimitive.parse(vf, index);
        // Slots: record, blank (silent gap), garbage (skipped entry), record,
        // early '####' terminator, then one more record that must stay unread.
        expect(result.records).toHaveLength(2);
        expect(result.records[1]!.unixSeconds - result.records[0]!.unixSeconds).toBe(3);
        expect(result.skipped).toHaveLength(1);
        expect(result.skipped[0]!.reason).toContain("regex did not match");
    });

    it("marker rejects a foreign magic, a non-TS name and a trailer-less file", async () => {
        const foreign = await indexed(wrongFormat);
        expect(await ligoGpsTrailerTsPrimitive.marker(foreign.vf, foreign.index)).toBe(false);
        const mp4Named = await indexed(happy, "20260813211138_0000002F.mp4");
        expect(await ligoGpsTrailerTsPrimitive.marker(mp4Named.vf, mp4Named.index)).toBe(false);
        const clean = await indexed(happy.subarray(0, 376));
        expect(await ligoGpsTrailerTsPrimitive.marker(clean.vf, clean.index)).toBe(false);
    });

    it("marker rejects a Juscar TS (in-stream LigoGPS, no EOF trailer)", async () => {
        const { vf, index } = await indexed(juscar, "20260429_182640F.ts");
        expect(await ligoGpsTrailerTsPrimitive.marker(vf, index)).toBe(false);
    });

    it("parse throws WrongFormatError when the trailer is absent", async () => {
        const { vf, index } = await indexed(happy.subarray(0, 376));
        await expect(ligoGpsTrailerTsPrimitive.parse(vf, index)).rejects.toThrow(WrongFormatError);
    });
});
