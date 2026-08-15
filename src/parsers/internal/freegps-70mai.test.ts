// Unit tests for the 70mai-embedded freeGPS block parser (ddmm.mmmm*1e5 dialect).
import { describe, it, expect } from "vitest";
import type { GpsRecord } from "../types.js";
import { finalize70maiRecords, is70maiFreeGpsBlock, parse70maiFreeGpsBlock } from "./freegps-70mai.js";

// Encodes decimal degrees into the firmware's int32: NMEA ddmm.mmmm * 1e5,
// hemisphere as the sign.
function encodeDdmm(degrees: number): number {
    const abs = Math.abs(degrees);
    const dd = Math.floor(abs);
    const minutes = (abs - dd) * 60;
    return Math.round(Math.sign(degrees) * (dd * 100 + minutes) * 1e5);
}

// Builds a 70mai freeGPS block (64-byte window is enough for the parser).
// `latRaw`/`lonRaw` override the encoded int32 verbatim for malformed-input cases.
function block(opts: {
    lat: number;
    lon: number;
    heading?: number;
    speedKmh?: number;
    active?: boolean;
    breakSig?: boolean;
    noMagic?: boolean;
    latRaw?: number;
    lonRaw?: number;
}): DataView {
    const { lat, lon, heading = 45, speedKmh = 0, active = true, breakSig = false, noMagic = false } = opts;
    const b = new Uint8Array(64);
    if (!noMagic) b.set([0x66, 0x72, 0x65, 0x65, 0x47, 0x50, 0x53, 0x20], 0); // "freeGPS "
    const dv = new DataView(b.buffer);
    dv.setUint16(8, 0x01ed, true);
    dv.setUint16(10, breakSig ? 0x0001 : 0x0000, true);
    dv.setUint16(14, 0x01ed, true);
    b[26] = active ? 0x41 : 0x56; // 'A' / 'V'
    dv.setInt32(27, opts.latRaw ?? encodeDdmm(lat), true);
    dv.setInt32(31, opts.lonRaw ?? encodeDdmm(lon), true);
    dv.setInt32(35, heading, true);
    dv.setInt32(39, speedKmh, true);
    return dv;
}

describe("is70maiFreeGpsBlock", () => {
    it("accepts a well-formed 70mai block", () => {
        expect(is70maiFreeGpsBlock(block({ lat: 50, lon: 30 }))).toBe(true);
        expect(is70maiFreeGpsBlock(block({ lat: -33.8, lon: 151.2 }))).toBe(true); // S/E
    });

    it("rejects a broken signature (u16@10 != 0)", () => {
        expect(is70maiFreeGpsBlock(block({ lat: 50, lon: 30, breakSig: true }))).toBe(false);
    });

    it("rejects a block without the freeGPS magic", () => {
        expect(is70maiFreeGpsBlock(block({ lat: 50, lon: 30, noMagic: true }))).toBe(false);
    });

    it("rejects out-of-range coordinates and the 0,0 fix", () => {
        expect(is70maiFreeGpsBlock(block({ lat: 200, lon: 30 }))).toBe(false);
        expect(is70maiFreeGpsBlock(block({ lat: 0, lon: 0 }))).toBe(false);
    });

    it("rejects a ddmm value whose minutes part is >= 60", () => {
        // 5075.00000: "50 deg 75 min" cannot come from a GPS fix - this is what
        // a decimal-degrees int32 (50.75 * 1e7) looks like when read as ddmm.
        expect(is70maiFreeGpsBlock(block({ lat: 50, lon: 30, latRaw: 507500000 }))).toBe(false);
        expect(is70maiFreeGpsBlock(block({ lat: 50, lon: 30, lonRaw: 307500000 }))).toBe(false);
    });

    it("rejects a VIOFO-style block (no self-referential tag, byte26=0)", () => {
        // Real VIOFO Type-3: byte 26 is 0x00 and the tag bytes are unrelated.
        const b = new Uint8Array(64);
        b.set([0x66, 0x72, 0x65, 0x65, 0x47, 0x50, 0x53, 0x20], 0);
        b[8] = 0x4c; // length-ish, != offset 14
        const dv = new DataView(b.buffer);
        expect(is70maiFreeGpsBlock(dv)).toBe(false);
    });
});

describe("parse70maiFreeGpsBlock", () => {
    it("decodes lat/lon/heading/speed into a one-element array and flags timeUnsynced", () => {
        const recs = parse70maiFreeGpsBlock(
            block({ lat: 50.123456, lon: 30.654321, heading: 217, speedKmh: 54 }),
            "NO.MP4",
        );
        expect(recs).toHaveLength(1);
        const r = recs[0]!;
        expect(r.lat).toBeCloseTo(50.123456, 6);
        expect(r.lon).toBeCloseTo(30.654321, 6);
        expect(r.bearingDeg).toBe(217);
        expect(r.active).toBe(true);
        expect(r.timeUnsynced).toBe(true);
        expect(r.speedMs).toBeCloseTo(15, 5); // 54 km/h -> m/s
        expect(r.mp4Filename).toBe("NO.MP4");
    });

    it("reads a zero speed field as a genuine standstill, not a gap", () => {
        const [r] = parse70maiFreeGpsBlock(block({ lat: 50, lon: 30, speedKmh: 0 }), "x");
        expect(r!.speedMs).toBe(0);
    });

    it("zeroes a negative or implausibly high speed field (firmware garbage)", () => {
        expect(parse70maiFreeGpsBlock(block({ lat: 50, lon: 30, speedKmh: -5 }), "x")[0]!.speedMs).toBe(0);
        expect(parse70maiFreeGpsBlock(block({ lat: 50, lon: 30, speedKmh: 1000 }), "x")[0]!.speedMs).toBe(0);
    });

    it("preserves the sign for southern/western hemispheres", () => {
        const [r] = parse70maiFreeGpsBlock(block({ lat: -33.86, lon: -70.65 }), "x");
        expect(r!.lat).toBeCloseTo(-33.86, 5);
        expect(r!.lon).toBeCloseTo(-70.65, 5);
    });

    it("converts the ddmm minutes part, not a decimal shift of the raw int32", () => {
        // Raw firmware ints whose OSD stamp reads 9 deg 58.340' N, 78 deg 5.719' E:
        // ddmm 958.34060 / 7805.71910. A decimal read (raw/1e7) lands ~43 km off
        // at 9.583406/78.057191 - the exact wrong-track failure mode.
        const [r] = parse70maiFreeGpsBlock(block({ lat: 0, lon: 0, latRaw: 95834060, lonRaw: 780571910 }), "x");
        expect(r!.lat).toBeCloseTo(9 + 58.3406 / 60, 6);
        expect(r!.lon).toBeCloseTo(78 + 5.7191 / 60, 6);
    });

    it("returns an empty array for a void (no-fix) block", () => {
        expect(parse70maiFreeGpsBlock(block({ lat: 50, lon: 30, active: false }), "x")).toEqual([]);
    });

    it("clamps an out-of-range heading to 0", () => {
        const [r] = parse70maiFreeGpsBlock(block({ lat: 50, lon: 30, heading: 999 }), "x");
        expect(r!.bearingDeg).toBe(0);
    });
});

describe("finalize70maiRecords", () => {
    function rec(lat: number, lon: number, speedMs = 0): GpsRecord {
        return {
            unixSeconds: 0,
            active: true,
            lat,
            lon,
            bearingDeg: 0,
            speedMs,
            accelXg: 0,
            accelYg: 0,
            accelZg: 0,
            mp4Filename: "x",
            timeUnsynced: true,
        };
    }

    it("collapses consecutive per-frame repeats into one record per fix", () => {
        const input = [rec(50, 30), rec(50, 30), rec(50, 30), rec(50.001, 30), rec(50.001, 30), rec(50.002, 30)];
        const out = finalize70maiRecords(input);
        expect(out).toHaveLength(3);
        expect(out.map((r) => r.lat)).toEqual([50, 50.001, 50.002]);
    });

    it("keeps the recorded per-fix speed through a position-freeze gap", () => {
        // The firmware froze the position for a while (repeats collapse into
        // one record), then the next fix lands 2+ seconds of travel away. The
        // recorded field stays the receiver's true speed - the exact case where
        // a dt=1s trajectory reconstruction produced a 2-4x spike.
        const input = [rec(50, 30, 14), rec(50, 30, 15), rec(50, 30, 15), rec(50.001, 30, 15)];
        const out = finalize70maiRecords(input);
        expect(out).toHaveLength(2);
        expect(out[0]!.speedMs).toBe(14); // first record of the frozen run
        expect(out[1]!.speedMs).toBe(15); // ~111 m step, speed NOT re-derived from it
    });

    it("handles an empty and single-element input", () => {
        expect(finalize70maiRecords([])).toEqual([]);
        const one = finalize70maiRecords([rec(50, 30)]);
        expect(one).toHaveLength(1);
    });
});
