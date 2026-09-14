import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { expectPlausibleGpsTrack } from "../__fixtures__/helpers.js";
import { buildMp4Index } from "../internal/mp4-index.js";
import {
    decodeSstarSsmdRow,
    findSstarSsmdTrack,
    looksLikeSstarSsmdSample,
    SSTAR_DDMM_FLAGS_FIX,
    SSTAR_DDMM_FLAGS_NO_FIX,
    SSTAR_DDMM_SSMD_SAMPLE_SIZE,
} from "../internal/sstar-ssmd-extract.js";
import { WrongFormatError } from "../types.js";
import { roveSsmdPrimitive } from "./rove-ssmd.js";
import { sstarSsmdPrimitive } from "./sstar-ssmd.js";

const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), "../__fixtures__/sstar-ssmd");
const NAME = "REC20260902-231922-661.mp4";
const START_UTC = Date.UTC(2026, 8, 2, 21, 19, 22) / 1000;
const NO_FIX_SENTINEL = 4294967295;

function fixtureBytes(name = "synthetic-ddmm-happy.mp4"): Buffer {
    return readFileSync(resolve(FIXTURES, name));
}

function sampleRows(bytes: Buffer): Buffer[] {
    const markerOffset = bytes.indexOf(Buffer.from("mdat", "ascii"));
    if (markerOffset < 4) throw new Error("fixture has no mdat");
    const payloadOffset = markerOffset + 4;
    const rows: Buffer[] = [];
    for (let offset = payloadOffset; offset < bytes.length; offset += SSTAR_DDMM_SSMD_SAMPLE_SIZE) {
        rows.push(bytes.subarray(offset, offset + SSTAR_DDMM_SSMD_SAMPLE_SIZE));
    }
    return rows;
}

function firstRow(): Buffer {
    return sampleRows(fixtureBytes())[0]!;
}

function fixtureBox(bytes: Buffer, type: string): Buffer {
    const markerOffset = bytes.indexOf(Buffer.from(type, "ascii"));
    if (markerOffset < 4) throw new Error(`fixture has no ${type}`);
    const start = markerOffset - 4;
    return bytes.subarray(start, start + bytes.readUInt32BE(start));
}

function mp4Box(type: string, payload: Buffer): Buffer {
    const header = Buffer.alloc(8);
    header.writeUInt32BE(8 + payload.length, 0);
    header.write(type, 4, "ascii");
    return Buffer.concat([header, payload]);
}

function combineTracks(fixtures: Buffer[]): Buffer {
    const ftyp = fixtureBox(fixtures[0]!, "ftyp");
    const mvhd = fixtureBox(fixtures[0]!, "mvhd");
    const tracks = fixtures.map((bytes) => Buffer.from(fixtureBox(bytes, "trak")));
    const payloads = fixtures.map((bytes) => fixtureBox(bytes, "mdat").subarray(8));
    const moovSize = 8 + mvhd.length + tracks.reduce((sum, track) => sum + track.length, 0);
    let mediaOffset = ftyp.length + moovSize + 8;
    for (const [i, track] of tracks.entries()) {
        const stco = fixtureBox(track, "stco");
        stco.writeUInt32BE(mediaOffset, 16);
        const tkhd = fixtureBox(track, "tkhd");
        tkhd.writeUInt32BE(i + 1, 20);
        mediaOffset += payloads[i]!.length;
    }
    return Buffer.concat([
        ftyp,
        mp4Box("moov", Buffer.concat([mvhd, ...tracks])),
        mp4Box("mdat", Buffer.concat(payloads)),
    ]);
}

function dv(bytes: Buffer): DataView {
    return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

async function loadBytes(bytes: Buffer, name = NAME) {
    const file = new File([new Uint8Array(bytes)], name);
    return { vf: { file, relativePath: name }, index: await buildMp4Index(file) };
}

describe("32-byte SStar DDmm row decoding", () => {
    it("decodes fractional minutes, integer km/h, two-degree course and UTC clock bytes", () => {
        const bytes = firstRow();
        expect(bytes).toHaveLength(32);
        expect(bytes.readUInt16LE(22)).toBe(SSTAR_DDMM_FLAGS_FIX);
        expect(looksLikeSstarSsmdSample(dv(bytes))).toBe(true);
        const row = decodeSstarSsmdRow(dv(bytes));
        expect(row).toMatchObject({ lat: 50.5, lon: 30.25, bearingDeg: 76, day: 2, hour: 21, minute: 19, second: 22 });
        if (!row || row === "nofix") throw new Error("expected a decoded fix");
        expect(row.speedMs).toBeCloseTo(40 / 3.6, 9);
    });

    it("preserves signed DDmm coordinates", () => {
        const bytes = firstRow();
        bytes.writeDoubleLE(-5030, 0);
        bytes.writeDoubleLE(-3015, 8);
        expect(decodeSstarSsmdRow(dv(bytes))).toMatchObject({ lat: -50.5, lon: -30.25 });
    });

    it.each([
        { field: "latitude minutes", offset: 0, value: 5060 },
        { field: "longitude minutes", offset: 8, value: 3060 },
        { field: "negative latitude minutes", offset: 0, value: -5060 },
        { field: "latitude NaN", offset: 0, value: Number.NaN },
        { field: "longitude NaN", offset: 8, value: Number.NaN },
        { field: "infinite latitude", offset: 0, value: Number.POSITIVE_INFINITY },
        { field: "latitude range", offset: 0, value: 9000.01 },
        { field: "longitude range", offset: 8, value: 18000.01 },
    ])("rejects malformed $field in both the probe and decoder", ({ offset, value }) => {
        const bytes = firstRow();
        bytes.writeDoubleLE(value, offset);
        expect(looksLikeSstarSsmdSample(dv(bytes))).toBe(false);
        expect(decodeSstarSsmdRow(dv(bytes))).toBeNull();
    });

    it.each([
        { field: "zero day", offset: 24, value: 0 },
        { field: "day overflow", offset: 24, value: 32 },
        { field: "hour overflow", offset: 25, value: 24 },
        { field: "minute overflow", offset: 26, value: 60 },
        { field: "second overflow", offset: 27, value: 60 },
    ])("rejects $field in both the probe and decoder", ({ offset, value }) => {
        const bytes = firstRow();
        bytes.writeUInt8(value, offset);
        expect(looksLikeSstarSsmdSample(dv(bytes))).toBe(false);
        expect(decodeSstarSsmdRow(dv(bytes))).toBeNull();
    });

    it.each([0, 0x047e, 0x057e, 0x067e, 0x077e, 0x087e, 0x0b7e])(
        "rejects the unsupported fix flags word %i",
        (flags) => {
            const bytes = firstRow();
            bytes.writeUInt16LE(flags, 22);
            expect(looksLikeSstarSsmdSample(dv(bytes))).toBe(false);
            expect(decodeSstarSsmdRow(dv(bytes))).toBeNull();
        },
    );

    it.each([SSTAR_DDMM_FLAGS_FIX, SSTAR_DDMM_FLAGS_NO_FIX])(
        "recognizes both sentinels under known flags %i",
        (flags) => {
            const bytes = firstRow();
            bytes.writeUInt16LE(flags, 22);
            bytes.writeDoubleLE(NO_FIX_SENTINEL, 0);
            expect(looksLikeSstarSsmdSample(dv(bytes))).toBe(false);
            expect(decodeSstarSsmdRow(dv(bytes))).toBeNull();

            bytes.writeDoubleLE(NO_FIX_SENTINEL, 8);
            expect(looksLikeSstarSsmdSample(dv(bytes))).toBe(true);
            expect(decodeSstarSsmdRow(dv(bytes))).toBe("nofix");

            bytes.writeDoubleLE(5030, 0);
            expect(looksLikeSstarSsmdSample(dv(bytes))).toBe(false);
            expect(decodeSstarSsmdRow(dv(bytes))).toBeNull();
        },
    );

    it("rejects both sentinels under an unknown flags word", () => {
        const bytes = firstRow();
        bytes.writeDoubleLE(NO_FIX_SENTINEL, 0);
        bytes.writeDoubleLE(NO_FIX_SENTINEL, 8);
        bytes.writeUInt16LE(0x0b7e, 22);
        expect(looksLikeSstarSsmdSample(dv(bytes))).toBe(false);
        expect(decodeSstarSsmdRow(dv(bytes))).toBeNull();
    });
});

describe("sstar-ssmd primitive on 32-byte DDmm fixtures", () => {
    it("marks and parses coordinates, speed, course and UTC anchored by the REC filename", async () => {
        const { vf, index } = await loadBytes(fixtureBytes());
        expect(await findSstarSsmdTrack(vf, index)).not.toBeNull();
        expect(await sstarSsmdPrimitive.marker(vf, index)).toBe(true);
        const result = await sstarSsmdPrimitive.parse(vf, index);
        expect(result.records).toHaveLength(5);
        expect(result.skipped).toHaveLength(0);
        expectPlausibleGpsTrack(result.records, { minCount: 5 });
        for (const [i, record] of result.records.entries()) {
            expect(record.lat, `latitude at ${i}`).toBeCloseTo(50.5 + i * 0.0001, 9);
            expect(record.lon, `longitude at ${i}`).toBeCloseTo(30.25 + i * 0.0001, 9);
            expect(record.speedMs, `speed at ${i}`).toBeCloseTo((40 + i) / 3.6, 9);
            expect(record.unixSeconds, `UTC at ${i}`).toBe(START_UTC + i);
            expect(record.timeUnsynced).toBeUndefined();
            expect(record.mp4Filename).toBe(NAME);
        }
        expect(result.records.map((record) => record.bearingDeg)).toEqual([76, 76, 78, 78, 78]);
        expect(result.videoStartUtcHint).toBe(START_UTC);
    });

    it("skips corrupt fields and unmatched calendar days while retaining valid fixes", async () => {
        const { vf, index } = await loadBytes(fixtureBytes("synthetic-ddmm-edge.mp4"));
        expect(await sstarSsmdPrimitive.marker(vf, index)).toBe(true);
        const result = await sstarSsmdPrimitive.parse(vf, index);
        expect(result.records).toHaveLength(2);
        expect(result.skipped.map((row) => row.line)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14]);
        expect(result.skipped.find((row) => row.line === 12)?.reason).toContain("date anchor");
        expect(result.records[1]!.lat).toBeCloseTo(50.5015, 9);
        expect(result.records[1]!.lon).toBeCloseTo(30.2515, 9);
        expect(result.records[1]!.speedMs).toBe(0);
        expect(result.records[1]!.bearingDeg).toBe(76);
        expect(result.records.map((record) => record.unixSeconds)).toEqual([START_UTC, START_UTC + 15]);
        expect(result.videoStartUtcHint).toBe(START_UTC);
    });

    it("preserves gaps in media time after a dateless rename", async () => {
        const bytes = fixtureBytes();
        sampleRows(bytes)[2]!.writeDoubleLE(Number.NaN, 0);
        const { vf, index } = await loadBytes(bytes, "video.mp4");
        const result = await sstarSsmdPrimitive.parse(vf, index);
        expect(result.records).toHaveLength(4);
        expect(result.skipped.map((row) => row.line)).toEqual([3]);
        expect(result.records.map((record) => record.relStartSeconds)).toEqual([0, 1, 3, 4]);
        expect(result.records.every((record) => record.timeUnsynced)).toBe(true);
        expect(result.videoStartUtcHint).toBeUndefined();
    });

    it("keeps every happy-path sample at its media offset when the date anchor is absent", async () => {
        const { vf, index } = await loadBytes(fixtureBytes(), "video.mp4");
        const result = await sstarSsmdPrimitive.parse(vf, index);
        expect(result.records).toHaveLength(5);
        expect(result.records.map((record) => record.relStartSeconds)).toEqual([0, 1, 2, 3, 4]);
        expect(result.records.every((record) => record.timeUnsynced)).toBe(true);
        expect(result.videoStartUtcHint).toBeUndefined();
    });

    it("uses the REC suffix date ahead of an unrelated date in a renamed copy", async () => {
        const { vf, index } = await loadBytes(fixtureBytes(), `backup-20250101 ${NAME}`);
        const result = await sstarSsmdPrimitive.parse(vf, index);
        expect(result.records).toHaveLength(5);
        expect(result.records[0]!.unixSeconds).toBe(START_UTC);
        expect(result.records[0]!.timeUnsynced).toBeUndefined();
        expect(result.videoStartUtcHint).toBe(START_UTC);
    });

    it("anchors UTC to the preceding month when the local filename date crosses midnight", async () => {
        const bytes = fixtureBytes();
        for (const row of sampleRows(bytes)) row.writeUInt8(28, 24);
        const { vf, index } = await loadBytes(bytes, "REC20260301-001922-661.mp4");
        const result = await sstarSsmdPrimitive.parse(vf, index);
        expect(result.records).toHaveLength(5);
        expect(result.records[0]!.unixSeconds).toBe(Date.UTC(2026, 1, 28, 21, 19, 22) / 1000);
        expect(result.records[0]!.timeUnsynced).toBeUndefined();
        expect(result.videoStartUtcHint).toBe(Date.UTC(2026, 1, 28, 21, 19, 22) / 1000);
    });

    it("demotes an off-grid clock to media time when it disagrees with the REC filename", async () => {
        const { vf, index } = await loadBytes(fixtureBytes(), "REC20260902-232122-661.mp4");
        const result = await sstarSsmdPrimitive.parse(vf, index);
        expect(result.records).toHaveLength(5);
        expect(result.records.every((record) => record.timeUnsynced)).toBe(true);
        expect(result.records.map((record) => record.relStartSeconds)).toEqual([0, 1, 2, 3, 4]);
        expect(result.records[0]!.lat).toBeCloseTo(50.5, 9);
        expect(result.videoStartUtcHint).toBeUndefined();
    });

    it("keeps the frame-zero UTC hint after a defensive no-fix lead-in", async () => {
        const bytes = fixtureBytes();
        const first = sampleRows(bytes)[0]!;
        first.writeDoubleLE(NO_FIX_SENTINEL, 0);
        first.writeDoubleLE(NO_FIX_SENTINEL, 8);
        const { vf, index } = await loadBytes(bytes);
        expect(await sstarSsmdPrimitive.marker(vf, index)).toBe(true);
        const result = await sstarSsmdPrimitive.parse(vf, index);
        expect(result.records).toHaveLength(4);
        expect(result.skipped).toHaveLength(0);
        expect(result.records[0]!.unixSeconds).toBe(START_UTC + 1);
        expect(result.videoStartUtcHint).toBe(START_UTC);
    });

    it("ignores the local RTC clock during a no-fix interval without dropping surrounding fixes", async () => {
        const bytes = fixtureBytes();
        const row = sampleRows(bytes)[2]!;
        row.writeDoubleLE(NO_FIX_SENTINEL, 0);
        row.writeDoubleLE(NO_FIX_SENTINEL, 8);
        row.writeUInt16LE(SSTAR_DDMM_FLAGS_NO_FIX, 22);
        row.writeUInt8(23, 25);
        const { vf, index } = await loadBytes(bytes);
        const result = await sstarSsmdPrimitive.parse(vf, index);
        expect(result.records.map((record) => record.unixSeconds)).toEqual([
            START_UTC,
            START_UTC + 1,
            START_UTC + 3,
            START_UTC + 4,
        ]);
        expect(result.skipped).toEqual([]);
        expect(result.videoStartUtcHint).toBe(START_UTC);
    });

    it("recognizes a no-fix-only track without treating its local RTC as UTC", async () => {
        const bytes = fixtureBytes();
        for (const row of sampleRows(bytes)) {
            row.writeDoubleLE(NO_FIX_SENTINEL, 0);
            row.writeDoubleLE(NO_FIX_SENTINEL, 8);
            row.writeUInt16LE(SSTAR_DDMM_FLAGS_NO_FIX, 22);
            row.writeUInt8(23, 25);
        }
        const { vf, index } = await loadBytes(bytes);
        expect(await sstarSsmdPrimitive.marker(vf, index)).toBe(true);
        const result = await sstarSsmdPrimitive.parse(vf, index);
        expect(result.records).toEqual([]);
        expect(result.skipped).toEqual([]);
        expect(result.videoStartUtcHint).toBeUndefined();
    });

    it("rejects a foreign constant-32 ssmd track", async () => {
        const { vf, index } = await loadBytes(fixtureBytes("synthetic-ddmm-wrong-format.mp4"));
        expect(await sstarSsmdPrimitive.marker(vf, index)).toBe(false);
        await expect(sstarSsmdPrimitive.parse(vf, index)).rejects.toBeInstanceOf(WrongFormatError);
    });

    it.each([
        { fixture: "synthetic-ddmm-happy.mp4", name: NAME, lat: 50.5 },
        { fixture: "synthetic-happy.mp4", name: "INF20260315-203950-7-F.mp4", lat: 50 },
        { fixture: "synthetic-ktrx-happy.mp4", name: NAME, lat: 50 },
    ])("finds $fixture after a foreign 32-byte ssmd sibling", async ({ fixture, name, lat }) => {
        const bytes = combineTracks([fixtureBytes("synthetic-ddmm-wrong-format.mp4"), fixtureBytes(fixture)]);
        const { vf, index } = await loadBytes(bytes, name);
        expect(index.tracks).toHaveLength(2);
        expect(await sstarSsmdPrimitive.marker(vf, index)).toBe(true);
        const result = await sstarSsmdPrimitive.parse(vf, index);
        expect(result.records).toHaveLength(5);
        expect(result.records[0]!.lat).toBeCloseTo(lat, 9);
        expect(result.records[0]!.timeUnsynced).toBeUndefined();
    });

    it("keeps valid 32-byte Rove and SStar DDmm samples disjoint", async () => {
        const ddmm = await loadBytes(fixtureBytes());
        expect(await roveSsmdPrimitive.marker(ddmm.vf, ddmm.index)).toBe(false);
        await expect(roveSsmdPrimitive.parse(ddmm.vf, ddmm.index)).rejects.toBeInstanceOf(WrongFormatError);

        const bytes = fixtureBytes();
        for (const row of sampleRows(bytes)) {
            row.writeUInt8(26, 22);
            row.writeUInt8(9, 23);
        }
        const rove = await loadBytes(bytes, "REC_0001.MP4");
        expect(await roveSsmdPrimitive.marker(rove.vf, rove.index)).toBe(true);
        expect((await roveSsmdPrimitive.parse(rove.vf, rove.index)).records).toHaveLength(5);
        expect(await sstarSsmdPrimitive.marker(rove.vf, rove.index)).toBe(false);
        await expect(sstarSsmdPrimitive.parse(rove.vf, rove.index)).rejects.toBeInstanceOf(WrongFormatError);
    });
});
