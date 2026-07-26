// Tests for the BlackVue .3gf accel sidecar. The format is implemented from
// foreign source (ExifTool 13.59 Process_3gf + blackclue) with no real sample
// in the repo - fixtures here are synthetic, built byte-for-byte from the
// documented layout: 10-byte records (u32 BE ms, 3x i16 BE), 0xFFFFFFFF
// sentinel, 0xFF padding tail (blackclue/blackclue.py:82-99).

import { describe, it, expect } from "vitest";
import { parse3gfBuffer, blackvue3gfSidecar } from "./blackvue-3gf.js";
import { makeVendorFile } from "../__fixtures__/helpers.js";

interface Rec3gf {
    ms: number;
    y: number;
    x: number;
    z: number;
}

/** Builds a BE .3gf buffer; optional sentinel record + 0xFF padding tail. */
function buildBlackvue3gf(records: Rec3gf[], opts: { sentinel?: boolean; paddingRecords?: number } = {}): ArrayBuffer {
    const sentinelCount = opts.sentinel ? 1 : 0;
    const padCount = opts.paddingRecords ?? 0;
    const buf = new ArrayBuffer((records.length + sentinelCount + padCount) * 10);
    const dv = new DataView(buf);
    for (let i = 0; i < records.length; i++) {
        const r = records[i]!;
        dv.setUint32(i * 10, r.ms, false);
        dv.setInt16(i * 10 + 4, r.y, false);
        dv.setInt16(i * 10 + 6, r.x, false);
        dv.setInt16(i * 10 + 8, r.z, false);
    }
    // Sentinel + padding: firmware pre-allocates the block and fills the tail
    // with 0xFF; the first padding-like record's ms reads 0xFFFFFFFF.
    new Uint8Array(buf, records.length * 10).fill(0xff);
    return buf;
}

/** LE variant of the builder - the legacy (pre-fix) layout, for the auto-detect guard. */
function buildBlackvue3gfLE(records: Rec3gf[]): ArrayBuffer {
    const buf = new ArrayBuffer(records.length * 10);
    const dv = new DataView(buf);
    for (let i = 0; i < records.length; i++) {
        const r = records[i]!;
        dv.setUint32(i * 10, r.ms, true);
        dv.setInt16(i * 10 + 4, r.y, true);
        dv.setInt16(i * 10 + 6, r.x, true);
        dv.setInt16(i * 10 + 8, r.z, true);
    }
    return buf;
}

/** ~10 Hz ramp with mild accel wiggle, long enough to engage auto-detect. */
function rampRecords(count: number): Rec3gf[] {
    return Array.from({ length: count }, (_, i) => ({
        ms: i * 100,
        y: 128 + (i % 3),
        x: i % 5,
        z: -(i % 7),
    }));
}

describe("parse3gfBuffer", () => {
    it("parses dense array of 10-byte BE records, 1g=128", () => {
        // 1g vertical = Y=128 (raw); driving forward gentle accel = Z=20 (raw).
        const buf = buildBlackvue3gf([
            { ms: 0, y: 128, x: 0, z: 0 },
            { ms: 100, y: 128, x: 10, z: 20 },
            { ms: 200, y: 130, x: -8, z: -16 },
        ]);
        const samples = parse3gfBuffer(buf);
        expect(samples).toHaveLength(3);
        // Mapping: Y(file) -> accelZg, X(file) -> accelXg, Z(file) -> accelYg.
        expect(samples[0]!.accelZg).toBe(128 / 128);
        expect(samples[0]!.accelXg).toBe(0);
        expect(samples[0]!.accelYg).toBe(0);
        expect(samples[1]!.msSinceStart).toBe(100);
        expect(samples[1]!.accelXg).toBe(10 / 128);
        expect(samples[1]!.accelYg).toBe(20 / 128);
        expect(samples[2]!.accelXg).toBe(-8 / 128);
        expect(samples[2]!.accelYg).toBe(-16 / 128);
        expect(samples[2]!.accelZg).toBeCloseTo(130 / 128);
    });

    it("stops at the 0xFFFFFFFF sentinel - 0xFF padding never becomes samples", () => {
        const records = rampRecords(10);
        const buf = buildBlackvue3gf(records, { sentinel: true, paddingRecords: 20 });
        const samples = parse3gfBuffer(buf);
        expect(samples).toHaveLength(10);
        expect(samples[9]!.msSinceStart).toBe(900);
        // Not a single sample carries a padding-derived value (-1/128 etc).
        expect(samples.every((s) => s.msSinceStart < 0xffffffff)).toBe(true);
    });

    it("breaks on ms === 0xFFFFFFFF even when the accel bytes are not 0xFF", () => {
        // Single break condition per both sources (blackclue, ExifTool):
        // `last if $tc == 0xffffffff` - the rest of the record is irrelevant.
        const records = rampRecords(5);
        const buf = buildBlackvue3gf([...records, { ms: 0xffffffff, y: 1, x: 2, z: 3 }, { ms: 600, y: 0, x: 0, z: 0 }]);
        expect(parse3gfBuffer(buf)).toHaveLength(5);
    });

    it("auto-detects a legacy LE-written buffer and parses it identically (back-compat guard)", () => {
        const records = rampRecords(16);
        const fromBe = parse3gfBuffer(buildBlackvue3gf(records));
        const fromLe = parse3gfBuffer(buildBlackvue3gfLE(records));
        expect(fromLe).toEqual(fromBe);
        expect(fromLe[1]!.msSinceStart).toBe(100);
    });

    it("defaults to BE on an ambiguous 1-record buffer", () => {
        const buf = buildBlackvue3gf([{ ms: 100, y: 128, x: 0, z: 0 }]);
        const samples = parse3gfBuffer(buf);
        expect(samples).toHaveLength(1);
        // A LE read of these BE bytes would be 0x64000000 ms (~19 days).
        expect(samples[0]!.msSinceStart).toBe(100);
        expect(samples[0]!.accelZg).toBe(1);
    });

    it("defaults to BE on a 2-record buffer (below the detect threshold)", () => {
        const buf = buildBlackvue3gf([
            { ms: 0, y: 128, x: 0, z: 0 },
            { ms: 100, y: 128, x: 0, z: 0 },
        ]);
        const samples = parse3gfBuffer(buf);
        expect(samples).toHaveLength(2);
        expect(samples[1]!.msSinceStart).toBe(100);
    });

    it("at-rest record raw 128 on the first axis maps to accelZg === 1", () => {
        const buf = buildBlackvue3gf(rampRecords(3).map((r) => ({ ...r, y: 128 })));
        const samples = parse3gfBuffer(buf);
        expect(samples.every((s) => s.accelZg === 1)).toBe(true);
    });

    it("ignores trailing bytes shorter than a 10-byte record", () => {
        const full = buildBlackvue3gf([{ ms: 50, y: 128, x: 0, z: 0 }]);
        const buf = new ArrayBuffer(15); // 1 full record + 5 byte tail
        new Uint8Array(buf).set(new Uint8Array(full), 0);
        const samples = parse3gfBuffer(buf);
        expect(samples).toHaveLength(1);
        expect(samples[0]!.msSinceStart).toBe(50);
    });

    it("returns empty array for buffer < 10 bytes", () => {
        expect(parse3gfBuffer(new ArrayBuffer(5))).toHaveLength(0);
    });

    it("returns empty array for a buffer that starts with the sentinel", () => {
        const buf = new ArrayBuffer(30);
        new Uint8Array(buf).fill(0xff);
        expect(parse3gfBuffer(buf)).toHaveLength(0);
    });
});

describe("blackvue3gfSidecar.matches", () => {
    it("matches .3gf by basename with known MP4", () => {
        const file = makeVendorFile("20231114_120000_NF.3gf", "");
        const known = new Set(["20231114_120000_NF.mp4"]);
        expect(blackvue3gfSidecar.matches(file, known)).toBe("20231114_120000_NF.mp4");
    });

    it("rejects non-.3gf extensions", () => {
        const file = makeVendorFile("20231114_120000_NF.gps", "");
        const known = new Set(["20231114_120000_NF.mp4"]);
        expect(blackvue3gfSidecar.matches(file, known)).toBeNull();
    });

    it("matches case-insensitively (.3GF)", () => {
        const file = makeVendorFile("ABC.3GF", "");
        const known = new Set(["abc.MP4"]);
        expect(blackvue3gfSidecar.matches(file, known)).toBe("abc.MP4");
    });

    it("pairs a mode-only .3gf (DR550DW) with both channels, binding to front", () => {
        // DR-series shares one `_N.3gf` across `_NF`/`_NR`, same as the `.gps`.
        const file = makeVendorFile("20260718_070333_N.3gf", "");
        const known = new Set(["20260718_070333_NR.mp4", "20260718_070333_NF.mp4"]);
        expect(blackvue3gfSidecar.matches(file, known)).toBe("20260718_070333_NF.mp4");
    });
});

describe("blackvue3gfSidecar.parseAccel", () => {
    it("reads samples through File API", async () => {
        const buf = buildBlackvue3gf([
            { ms: 0, y: 128, x: 5, z: 10 },
            { ms: 100, y: 128, x: 7, z: 15 },
        ]);
        const file = {
            file: new File([new Uint8Array(buf)], "test.3gf"),
            relativePath: "test.3gf",
        };
        const samples = await blackvue3gfSidecar.parseAccel(file);
        expect(samples).toHaveLength(2);
        expect(samples[0]!.msSinceStart).toBe(0);
        expect(samples[1]!.msSinceStart).toBe(100);
    });
});
