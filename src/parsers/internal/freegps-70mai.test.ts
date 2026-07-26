// Unit tests for the 70mai-embedded freeGPS block parser (int32*1e7 dialect).
import { describe, it, expect } from "vitest";
import type { GpsRecord } from "../types.js";
import { finalize70maiRecords, is70maiFreeGpsBlock, parse70maiFreeGpsBlock } from "./freegps-70mai.js";

// Builds a 70mai freeGPS block (64-byte window is enough for the parser).
function block(opts: {
    lat: number;
    lon: number;
    heading?: number;
    active?: boolean;
    breakSig?: boolean;
    noMagic?: boolean;
}): DataView {
    const { lat, lon, heading = 45, active = true, breakSig = false, noMagic = false } = opts;
    const b = new Uint8Array(64);
    if (!noMagic) b.set([0x66, 0x72, 0x65, 0x65, 0x47, 0x50, 0x53, 0x20], 0); // "freeGPS "
    const dv = new DataView(b.buffer);
    dv.setUint16(8, 0x01ed, true);
    dv.setUint16(10, breakSig ? 0x0001 : 0x0000, true);
    dv.setUint16(14, 0x01ed, true);
    b[26] = active ? 0x41 : 0x56; // 'A' / 'V'
    dv.setInt32(27, Math.round(lat * 1e7), true);
    dv.setInt32(31, Math.round(lon * 1e7), true);
    dv.setInt32(35, heading, true);
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
    it("decodes lat/lon/heading into a one-element array and flags timeUnsynced", () => {
        const recs = parse70maiFreeGpsBlock(block({ lat: 50.123456, lon: 30.654321, heading: 217 }), "NO.MP4");
        expect(recs).toHaveLength(1);
        const r = recs[0]!;
        expect(r.lat).toBeCloseTo(50.123456, 6);
        expect(r.lon).toBeCloseTo(30.654321, 6);
        expect(r.bearingDeg).toBe(217);
        expect(r.active).toBe(true);
        expect(r.timeUnsynced).toBe(true);
        expect(r.speedMs).toBe(0); // filled later by finalize70maiRecords
        expect(r.mp4Filename).toBe("NO.MP4");
    });

    it("preserves the sign for southern/western hemispheres", () => {
        const [r] = parse70maiFreeGpsBlock(block({ lat: -33.86, lon: -70.65 }), "x");
        expect(r!.lat).toBeCloseTo(-33.86, 5);
        expect(r!.lon).toBeCloseTo(-70.65, 5);
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
    function rec(lat: number, lon: number): GpsRecord {
        return {
            unixSeconds: 0,
            active: true,
            lat,
            lon,
            bearingDeg: 0,
            speedMs: 0,
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

    it("derives speed from the trajectory (haversine, dt~1s) with the first copying the second", () => {
        // 0.0005 deg of latitude ~ 55.6 m -> ~55.6 m/s at dt=1s (under the cap).
        const out = finalize70maiRecords([rec(50, 30), rec(50.0005, 30), rec(50.001, 30)]);
        expect(out[1]!.speedMs).toBeCloseTo(55.6, 0);
        expect(out[0]!.speedMs).toBe(out[1]!.speedMs); // first copies second, not stuck at 0
        expect(out[2]!.speedMs).toBeCloseTo(55.6, 0);
    });

    it("handles an empty and single-element input", () => {
        expect(finalize70maiRecords([])).toEqual([]);
        const one = finalize70maiRecords([rec(50, 30)]);
        expect(one).toHaveLength(1);
        expect(one[0]!.speedMs).toBe(0);
    });

    it("zeroes an implausible trajectory-speed spike (GPS gap, not motion)", () => {
        // ~1 deg of latitude (~111 km) between consecutive fixes -> ~111 km/s:
        // a GPS gap/reacquire, not real motion. Dropped to 0 over the cap rather
        // than shown as a 1000+ km/h spike. The normal small step is kept.
        const out = finalize70maiRecords([rec(50, 30), rec(51, 30), rec(51.0005, 30)]);
        expect(out[1]!.speedMs).toBe(0); // the 1-deg jump, over the cap
        expect(out[2]!.speedMs).toBeGreaterThan(0); // ~55 m/s, kept
        expect(out[2]!.speedMs).toBeLessThan(90);
        expect(out[0]!.speedMs).toBe(0); // first copies second (0 here)
    });
});
