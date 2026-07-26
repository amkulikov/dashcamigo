// Tests for GPS9 sample extraction (HERO11+). GPS9 is TYPE=lllllllSS:
// 7 int32 + 2 uint16 = 32 bytes per sample (lat/lon/alt/speed2d/speed3d/days/secs
// int32, dop/fix uint16). Regression guard for the earlier 36-byte all-int32
// layout, which mis-strided every sample after the first and read `fix` 4 bytes
// past its real offset.
//
// Spec: github.com/gopro/gpmf-parser - GPS9 SCAL = 10000000 10000000 1000 1000 100 1 1000 100 1.

import { describe, expect, it } from "vitest";

import type { GpsRecord } from "../types.js";
import { dropGps5WhenGps9Present, extractGpsFromSample, type GpmfGpsStreamKind } from "./gpmf-extract.js";

/** Builds one KLV block (8-byte header + payload padded to a multiple of 4). */
function klv(fourCC: string, type: number, sampleSize: number, repeat: number, payload: Uint8Array): Uint8Array {
    const expected = sampleSize * repeat;
    if (payload.byteLength !== expected) {
        throw new Error(`payload size mismatch: got ${payload.byteLength}, expected ${expected}`);
    }
    const padded = (expected + 3) & ~3;
    const out = new Uint8Array(8 + padded);
    out[0] = fourCC.charCodeAt(0);
    out[1] = fourCC.charCodeAt(1);
    out[2] = fourCC.charCodeAt(2);
    out[3] = fourCC.charCodeAt(3);
    out[4] = type;
    out[5] = sampleSize;
    out[6] = (repeat >> 8) & 0xff;
    out[7] = repeat & 0xff;
    out.set(payload, 8);
    return out;
}

/** Nests child KLV bytes inside a container token (type=0). */
function nested(fourCC: string, children: Uint8Array): Uint8Array {
    // A nested block's sampleSize=1, repeat=childByteLength. Children are already
    // 4-aligned, so no extra padding.
    return klv(fourCC, 0, 1, children.byteLength, children);
}

function concat(...parts: Uint8Array[]): Uint8Array {
    const total = parts.reduce((n, p) => n + p.byteLength, 0);
    const out = new Uint8Array(total);
    let off = 0;
    for (const p of parts) {
        out.set(p, off);
        off += p.byteLength;
    }
    return out;
}

// GPS9 SCAL divisors (one per field). Field order: lat lon alt speed2d speed3d days secs dop fix.
const SCAL = [10000000, 10000000, 1000, 1000, 100, 1, 1000, 100, 1];

function scalBlock(): Uint8Array {
    const payload = new Uint8Array(SCAL.length * 4);
    const view = new DataView(payload.buffer);
    for (let i = 0; i < SCAL.length; i++) view.setInt32(i * 4, SCAL[i]!, false);
    return klv("SCAL", 0x6c, 4, SCAL.length, payload); // type 'l'
}

function gpsfBlock(fix: number): Uint8Array {
    const payload = new Uint8Array(4);
    new DataView(payload.buffer).setUint32(0, fix, false);
    return klv("GPSF", 0x4c, 4, 1, payload); // type 'L'
}

interface Gps9Sample {
    latDeg: number;
    lonDeg: number;
    altM: number;
    speed2dMs: number;
    speed3dMs: number;
    days: number;
    secsSinceMidnight: number;
    dop: number;
    fix: number;
}

/** Encodes one 32-byte GPS9 sample applying the SCAL divisors in reverse. */
function encodeGps9Sample(s: Gps9Sample): Uint8Array {
    const buf = new Uint8Array(32);
    const view = new DataView(buf.buffer);
    view.setInt32(0, Math.round(s.latDeg * SCAL[0]!), false);
    view.setInt32(4, Math.round(s.lonDeg * SCAL[1]!), false);
    view.setInt32(8, Math.round(s.altM * SCAL[2]!), false);
    view.setInt32(12, Math.round(s.speed2dMs * SCAL[3]!), false);
    view.setInt32(16, Math.round(s.speed3dMs * SCAL[4]!), false);
    view.setInt32(20, s.days, false);
    view.setInt32(24, Math.round(s.secsSinceMidnight * SCAL[6]!), false); // secs -> ms
    view.setUint16(28, Math.round(s.dop * SCAL[7]!), false);
    view.setUint16(30, s.fix, false);
    return buf;
}

function gps9Block(samples: Gps9Sample[]): Uint8Array {
    const payload = concat(...samples.map(encodeGps9Sample));
    return klv("GPS9", 0x3f, 32, samples.length, payload); // type '?' (complex)
}

/** Builds a full DEVC -> STRM gpmd sample with SCAL, GPSF and GPS9. */
function buildGps9Sample(samples: Gps9Sample[], fix = 3): DataView {
    const strm = nested("STRM", concat(scalBlock(), gpsfBlock(fix), gps9Block(samples)));
    const devc = nested("DEVC", strm);
    return new DataView(devc.buffer, devc.byteOffset, devc.byteLength);
}

// 2000-01-01T00:00:00Z in unix seconds (GPS9 day epoch).
const GPS9_EPOCH_UNIX = Date.UTC(2000, 0, 1) / 1000;

describe("extractGpsFromSample - GPS9", () => {
    it("decodes lat/lon/speed/time from a single valid sample", () => {
        const sample: Gps9Sample = {
            latDeg: 51.5,
            lonDeg: -0.12,
            altM: 100,
            speed2dMs: 10,
            speed3dMs: 11,
            days: 8000,
            secsSinceMidnight: 3661,
            dop: 1.5,
            fix: 3,
        };
        const out: GpsRecord[] = [];
        extractGpsFromSample(buildGps9Sample([sample]), "GS010001.MP4", 1, out);

        expect(out).toHaveLength(1);
        const rec = out[0]!;
        expect(rec.lat).toBeCloseTo(51.5, 6);
        expect(rec.lon).toBeCloseTo(-0.12, 6);
        expect(rec.speedMs).toBeCloseTo(10, 6);
        expect(rec.unixSeconds).toBeCloseTo(GPS9_EPOCH_UNIX + 8000 * 86400 + 3661, 3);
        expect(rec.mp4Filename).toBe("GS010001.MP4");
    });

    it("strides 32 bytes per sample and reads fix at offset 30 (drops fix<2)", () => {
        // Three samples with distinct coordinates. The middle one has fix=1 and
        // must be dropped. If the stride were 36 or fix were read at offset 32,
        // sample 2's coordinates and the per-sample fix would be mis-read.
        const samples: Gps9Sample[] = [
            {
                latDeg: 51.5,
                lonDeg: -0.12,
                altM: 100,
                speed2dMs: 10,
                speed3dMs: 11,
                days: 8000,
                secsSinceMidnight: 10,
                dop: 1,
                fix: 3,
            },
            {
                latDeg: 40.0,
                lonDeg: 10.0,
                altM: 50,
                speed2dMs: 5,
                speed3dMs: 6,
                days: 8000,
                secsSinceMidnight: 11,
                dop: 1,
                fix: 1,
            },
            {
                latDeg: -33.86,
                lonDeg: 151.21,
                altM: 20,
                speed2dMs: 20,
                speed3dMs: 21,
                days: 8000,
                secsSinceMidnight: 12,
                dop: 1,
                fix: 2,
            },
        ];
        const out: GpsRecord[] = [];
        extractGpsFromSample(buildGps9Sample(samples), "GS010001.MP4", 1, out);

        expect(out).toHaveLength(2);
        expect(out[0]!.lat).toBeCloseTo(51.5, 6);
        expect(out[1]!.lat).toBeCloseTo(-33.86, 6);
        expect(out[1]!.lon).toBeCloseTo(151.21, 6);
        expect(out[1]!.speedMs).toBeCloseTo(20, 6);
    });

    it("drops the whole stream when GPSF<2", () => {
        const sample: Gps9Sample = {
            latDeg: 51.5,
            lonDeg: -0.12,
            altM: 100,
            speed2dMs: 10,
            speed3dMs: 11,
            days: 8000,
            secsSinceMidnight: 0,
            dop: 1,
            fix: 3,
        };
        const out: GpsRecord[] = [];
        extractGpsFromSample(buildGps9Sample([sample], 0), "GS010001.MP4", 1, out);
        expect(out).toHaveLength(0);
    });
});

// ===== GPS5 builders (for the dual-stream HERO11 preference tests) =====

// GPS5 SCAL divisors. Field order: lat lon alt speed2d speed3d
// (gpmf-parser README; same lat/lon 1e7 scale as GPS9).
const SCAL5 = [10000000, 10000000, 1000, 1000, 100];

function scal5Block(): Uint8Array {
    const payload = new Uint8Array(SCAL5.length * 4);
    const view = new DataView(payload.buffer);
    for (let i = 0; i < SCAL5.length; i++) view.setInt32(i * 4, SCAL5[i]!, false);
    return klv("SCAL", 0x6c, 4, SCAL5.length, payload); // type 'l'
}

/** GPSU = ASCII "YYMMDDHHmmss.sss" (UTC base time of the GPS5 block). */
function gpsuBlock(text: string): Uint8Array {
    const bytes = new TextEncoder().encode(text);
    return klv("GPSU", 0x55, bytes.byteLength, 1, bytes); // type 'U'
}

interface Gps5Sample {
    latDeg: number;
    lonDeg: number;
    altM: number;
    speed2dMs: number;
    speed3dMs: number;
}

function gps5Block(samples: Gps5Sample[]): Uint8Array {
    const payload = new Uint8Array(samples.length * 20);
    const view = new DataView(payload.buffer);
    for (let i = 0; i < samples.length; i++) {
        const s = samples[i]!;
        view.setInt32(i * 20, Math.round(s.latDeg * SCAL5[0]!), false);
        view.setInt32(i * 20 + 4, Math.round(s.lonDeg * SCAL5[1]!), false);
        view.setInt32(i * 20 + 8, Math.round(s.altM * SCAL5[2]!), false);
        view.setInt32(i * 20 + 12, Math.round(s.speed2dMs * SCAL5[3]!), false);
        view.setInt32(i * 20 + 16, Math.round(s.speed3dMs * SCAL5[4]!), false);
    }
    return klv("GPS5", 0x6c, 20, samples.length, payload); // type 'l'
}

function gps5Strm(samples: Gps5Sample[], gpsu = "240101120000.000"): Uint8Array {
    return nested("STRM", concat(scal5Block(), gpsuBlock(gpsu), gpsfBlock(3), gps5Block(samples)));
}

const GPS5_POINT: Gps5Sample = { latDeg: 48.85, lonDeg: 2.35, altM: 35, speed2dMs: 8, speed3dMs: 9 };
const GPS9_POINT: Gps9Sample = {
    latDeg: 51.5,
    lonDeg: -0.12,
    altM: 100,
    speed2dMs: 10,
    speed3dMs: 11,
    days: 8000,
    secsSinceMidnight: 3661,
    dop: 1.5,
    fix: 3,
};

describe("GPS9-over-GPS5 preference (HERO11 dual-stream)", () => {
    // HERO11 writes BOTH streams over the same fixes (gpmf-parser README
    // HERO11 table: GPS5 "deprecated" + GPS9; corroborated by gopro2gpx
    // _prioritize_gps9). Synthetic payloads only - no real HERO11 sample.

    it("extracts both streams from a dual-STRM DEVC, then the per-file discard keeps GPS9 only", () => {
        const devc = nested(
            "DEVC",
            concat(gps5Strm([GPS5_POINT]), nested("STRM", concat(scalBlock(), gpsfBlock(3), gps9Block([GPS9_POINT])))),
        );
        const out: GpsRecord[] = [];
        const kinds: GpmfGpsStreamKind[] = [];
        extractGpsFromSample(new DataView(devc.buffer), "GH010011.MP4", 1, out, kinds);

        // Both streams extracted - kinds stay parallel to records.
        expect(out).toHaveLength(2);
        expect(kinds).toEqual(["gps5", "gps9"]);

        const filtered = dropGps5WhenGps9Present(out, kinds);
        expect(filtered).toHaveLength(1);
        expect(filtered[0]!.lat).toBeCloseTo(GPS9_POINT.latDeg, 6);
        expect(filtered[0]!.lon).toBeCloseTo(GPS9_POINT.lonDeg, 6);
    });

    it("GPS5-only payload is unchanged by the discard (regression guard for hero5-10 files)", () => {
        const devc = nested("DEVC", gps5Strm([GPS5_POINT, { ...GPS5_POINT, latDeg: 48.86 }]));
        const out: GpsRecord[] = [];
        const kinds: GpmfGpsStreamKind[] = [];
        extractGpsFromSample(new DataView(devc.buffer), "GH010005.MP4", 1, out, kinds);

        expect(out).toHaveLength(2);
        expect(kinds).toEqual(["gps5", "gps5"]);
        expect(out[0]!.lat).toBeCloseTo(48.85, 6);
        // GPSU base time decoded: 2024-01-01 12:00:00 UTC.
        expect(out[0]!.unixSeconds).toBeCloseTo(Date.UTC(2024, 0, 1, 12, 0, 0) / 1000, 3);

        const filtered = dropGps5WhenGps9Present(out, kinds);
        expect(filtered).toEqual(out);
    });

    it("GPS9-only payload is unchanged by the discard", () => {
        const out: GpsRecord[] = [];
        const kinds: GpmfGpsStreamKind[] = [];
        extractGpsFromSample(buildGps9Sample([GPS9_POINT]), "GH010013.MP4", 1, out, kinds);
        expect(kinds).toEqual(["gps9"]);
        expect(dropGps5WhenGps9Present(out, kinds)).toEqual(out);
    });

    it("prefers GPS9 when one STRM pathologically carries both tags", () => {
        // One STRM, one SCAL (the 9-element GPS9 one - its first five divisors
        // cover GPS5's fields too), both payload tags. The within-STRM branch
        // must pick GPS9.
        const strm = nested(
            "STRM",
            concat(
                scalBlock(),
                gpsuBlock("240101120000.000"),
                gpsfBlock(3),
                gps5Block([GPS5_POINT]),
                gps9Block([GPS9_POINT]),
            ),
        );
        const devc = nested("DEVC", strm);
        const out: GpsRecord[] = [];
        extractGpsFromSample(new DataView(devc.buffer), "GH010011.MP4", 1, out);
        expect(out).toHaveLength(1);
        expect(out[0]!.lat).toBeCloseTo(GPS9_POINT.latDeg, 6);
    });

    it("returns input unfiltered on a kinds/records length mismatch (defensive)", () => {
        const records: GpsRecord[] = [];
        extractGpsFromSample(buildGps9Sample([GPS9_POINT]), "x.MP4", 1, records);
        expect(dropGps5WhenGps9Present(records, [])).toBe(records);
    });
});
