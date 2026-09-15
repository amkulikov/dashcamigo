import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildMp4Index } from "../internal/mp4-index.js";
import { readSampleTable } from "../internal/mp4-walker.js";
import { WrongFormatError } from "../types.js";
import { makeVendorFile } from "../__fixtures__/helpers.js";
import { seiDoubleGpsPrimitive } from "./sei-double-gps.js";

const NAME = "080546_828_023_D.mp4";
const FIXTURE = readFileSync(new URL("../__fixtures__/sei-double-gps/real-fix-anonymized.mp4", import.meta.url));

function fixture(bytes: Uint8Array = FIXTURE) {
    return makeVendorFile(NAME, Buffer.from(bytes));
}

async function sampleOffsets() {
    const index = await buildMp4Index(fixture().file);
    const track = index.tracks[0]!;
    return readSampleTable(index.moovView!, track.trakBox)!.map((sample) => sample.offset);
}

describe("sei double gps primitive", () => {
    it("recognizes the metadata-like hvc1 track and extracts relative GPS fixes", async () => {
        const vf = fixture();
        const index = await buildMp4Index(vf.file);
        expect(index.tracks.map((track) => [track.handlerType, track.sampleFormat])).toEqual([["vide", "hvc1"]]);
        expect(await seiDoubleGpsPrimitive.marker(vf, index)).toBe(true);
        const result = await seiDoubleGpsPrimitive.parse(vf, index);
        expect(result.records).toHaveLength(12);
        expect(result.skipped).toEqual([]);
        expect(result.records.map((record) => record.relStartSeconds)).toEqual(
            Array.from({ length: 12 }, (_, i) => i * 2),
        );
        for (const record of result.records) {
            expect(record).toMatchObject({ lat: 50, lon: 30, active: true, timeUnsynced: true, speedMs: 0 });
        }
    });

    it("derives speed from the packet counter despite the short second MP4 timestamp", async () => {
        const bytes = Buffer.from(FIXTURE);
        const offsets = await sampleOffsets();
        bytes.writeDoubleLE(30.0005, offsets[1]! + 21);
        const vf = fixture(bytes);
        const result = await seiDoubleGpsPrimitive.parse(vf, await buildMp4Index(vf.file));
        expect(result.records[1]!.speedMs).toBeGreaterThan(15);
        expect(result.records[1]!.speedMs).toBeLessThan(25);
        expect(result.records[0]!.bearingDeg).toBeCloseTo(90, 0);
        expect(result.records[1]!.unixSeconds - result.records[0]!.unixSeconds).toBe(2);
    });

    it("applies hemisphere flags to coordinate magnitudes", async () => {
        const bytes = Buffer.from(FIXTURE);
        const offsets = await sampleOffsets();
        for (const offset of offsets) {
            bytes.write("WS", offset + 18, "ascii");
        }
        const vf = fixture(bytes);
        const result = await seiDoubleGpsPrimitive.parse(vf, await buildMp4Index(vf.file));
        expect(result.records[0]).toMatchObject({ lat: -50, lon: -30 });
    });

    it("rejects a false-positive first packet followed by alien samples", async () => {
        const bytes = Buffer.from(FIXTURE);
        const offsets = await sampleOffsets();
        for (const offset of offsets.slice(1)) bytes[offset + 4] = 0;
        const vf = fixture(bytes);
        const index = await buildMp4Index(vf.file);
        expect(await seiDoubleGpsPrimitive.marker(vf, index)).toBe(true);
        await expect(seiDoubleGpsPrimitive.parse(vf, index)).rejects.toBeInstanceOf(WrongFormatError);
    });

    it("does not claim a file when the first packet lacks its signature", async () => {
        const bytes = Buffer.from(FIXTURE);
        bytes[(await sampleOffsets())[0]! + 4] = 0;
        const vf = fixture(bytes);
        expect(await seiDoubleGpsPrimitive.marker(vf, await buildMp4Index(vf.file))).toBe(false);
    });
});
