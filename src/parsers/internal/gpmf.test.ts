// Unit tests for the GPMF KLV parser: iterTokens, decodeNumeric, decodeString,
// parseGpsuTimestamp.
//
// Spec: github.com/gopro/gpmf-parser/blob/main/docs/README.md
// All integer fields are big-endian, 8-byte header, payload padded to a multiple of 4.

import { describe, expect, it } from "vitest";

import { decodeNumeric, decodeString, iterTokens, parseGpsuTimestamp } from "./gpmf.js";

/** Builds one KLV block. payload must be the payload bytes (no header).
 * Appends padding to a multiple of 4. */
function klv(fourCC: string, type: number, sampleSize: number, repeat: number, payload: Uint8Array): Uint8Array {
    const expectedPayload = sampleSize * repeat;
    if (payload.byteLength !== expectedPayload) {
        throw new Error(`payload size mismatch: got ${payload.byteLength}, expected ${expectedPayload}`);
    }
    const padded = (expectedPayload + 3) & ~3;
    const out = new Uint8Array(8 + padded);
    out[0] = fourCC.charCodeAt(0);
    out[1] = fourCC.charCodeAt(1);
    out[2] = fourCC.charCodeAt(2);
    out[3] = fourCC.charCodeAt(3);
    out[4] = type;
    out[5] = sampleSize;
    // repeat: u16 BE
    out[6] = (repeat >> 8) & 0xff;
    out[7] = repeat & 0xff;
    out.set(payload, 8);
    return out;
}

function concat(...parts: Uint8Array[]): Uint8Array {
    let total = 0;
    for (const p of parts) total += p.byteLength;
    const out = new Uint8Array(total);
    let off = 0;
    for (const p of parts) {
        out.set(p, off);
        off += p.byteLength;
    }
    return out;
}

function dv(buf: Uint8Array): DataView {
    return new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
}

describe("iterTokens", () => {
    it("yields single uint32 token", () => {
        const block = klv("DVID", 0x4c, 4, 1, new Uint8Array([0, 0, 0, 42]));
        const tokens = Array.from(iterTokens(dv(block)));
        expect(tokens).toHaveLength(1);
        expect(tokens[0]!.fourCC).toBe("DVID");
        expect(tokens[0]!.type).toBe(0x4c);
        expect(tokens[0]!.sampleSize).toBe(4);
        expect(tokens[0]!.repeat).toBe(1);
        expect(tokens[0]!.payload.byteLength).toBe(4);
        expect(tokens[0]!.payload.getUint32(0)).toBe(42);
    });

    it("yields multiple top-level tokens", () => {
        // Two tokens back-to-back with padding between them (if needed).
        const a = klv("AAAA", 0x4c, 4, 1, new Uint8Array([0, 0, 0, 1]));
        const b = klv("BBBB", 0x4c, 4, 1, new Uint8Array([0, 0, 0, 2]));
        const tokens = Array.from(iterTokens(dv(concat(a, b))));
        expect(tokens).toHaveLength(2);
        expect(tokens[0]!.fourCC).toBe("AAAA");
        expect(tokens[1]!.fourCC).toBe("BBBB");
        expect(tokens[1]!.payload.getUint32(0)).toBe(2);
    });

    it("handles padding correctly for non-multiple-of-4 payloads", () => {
        // String "hi" - 2 bytes payload, padded to 4.
        const a = klv("STNM", 0x63, 1, 2, new Uint8Array([0x68, 0x69])); // "hi"
        const b = klv("AAAA", 0x4c, 4, 1, new Uint8Array([0, 0, 0, 7]));
        const buf = new Uint8Array(8 + 4 + b.byteLength); // padded payload = 4
        buf.set(a.slice(0, 8), 0);
        buf.set(new Uint8Array([0x68, 0x69, 0, 0]), 8); // payload + 2 byte pad
        buf.set(b, 12);
        const tokens = Array.from(iterTokens(dv(buf)));
        expect(tokens).toHaveLength(2);
        expect(tokens[0]!.fourCC).toBe("STNM");
        expect(tokens[1]!.fourCC).toBe("AAAA");
    });

    it("stops on truncated block (payloadStart + payloadSize > end)", () => {
        // Declares sampleSize=4 repeat=10 (40 bytes), but only 8 bytes provided.
        const buf = new Uint8Array(16);
        buf[0] = 0x42;
        buf[1] = 0x42;
        buf[2] = 0x42;
        buf[3] = 0x42; // "BBBB"
        buf[4] = 0x4c; // type 'L'
        buf[5] = 4; // sampleSize
        buf[6] = 0;
        buf[7] = 10; // repeat=10, payload should be 40 bytes
        // We supply 16 bytes - declared 48 (header + padded payload). iterTokens
        // must return immediately.
        const tokens = Array.from(iterTokens(dv(buf)));
        expect(tokens).toEqual([]);
    });

    it("respects start/end range", () => {
        const a = klv("AAAA", 0x4c, 4, 1, new Uint8Array([0, 0, 0, 1]));
        const b = klv("BBBB", 0x4c, 4, 1, new Uint8Array([0, 0, 0, 2]));
        const combined = concat(a, b);
        // Only b - start at offset = length of a.
        const tokens = Array.from(iterTokens(dv(combined), a.byteLength));
        expect(tokens).toHaveLength(1);
        expect(tokens[0]!.fourCC).toBe("BBBB");
    });
});

describe("decodeNumeric", () => {
    it("decodes int32 (type 'l')", () => {
        const tok = Array.from(
            iterTokens(
                dv(
                    klv(
                        "ABCD",
                        0x6c,
                        4,
                        2,
                        new Uint8Array([
                            0,
                            0,
                            0,
                            5,
                            0xff,
                            0xff,
                            0xff,
                            0xfb, // -5
                        ]),
                    ),
                ),
            ),
        )[0]!;
        expect(decodeNumeric(tok)).toEqual([5, -5]);
    });

    it("decodes uint16 (type 'S')", () => {
        const tok = Array.from(
            iterTokens(dv(klv("ABCD", 0x53, 2, 3, new Uint8Array([0, 1, 0, 0xff, 0xff, 0xff])))),
        )[0]!;
        expect(decodeNumeric(tok)).toEqual([1, 255, 65535]);
    });

    it("decodes int16 (type 's') with negatives", () => {
        const tok = Array.from(
            iterTokens(
                dv(
                    klv(
                        "ABCD",
                        0x73,
                        2,
                        2,
                        new Uint8Array([
                            0xff,
                            0xfb, // -5
                            0x00,
                            0x05, // 5
                        ]),
                    ),
                ),
            ),
        )[0]!;
        expect(decodeNumeric(tok)).toEqual([-5, 5]);
    });

    it("decodes int8 / uint8", () => {
        const ti = Array.from(iterTokens(dv(klv("ABCD", 0x62, 1, 2, new Uint8Array([0xff, 0x7f])))))[0]!;
        expect(decodeNumeric(ti)).toEqual([-1, 127]);
        const tu = Array.from(iterTokens(dv(klv("ABCD", 0x42, 1, 2, new Uint8Array([0xff, 0x7f])))))[0]!;
        expect(decodeNumeric(tu)).toEqual([255, 127]);
    });

    it("decodes float32 / float64", () => {
        // float32: 1.0 BE = 0x3F800000
        const tf = Array.from(iterTokens(dv(klv("ABCD", 0x66, 4, 1, new Uint8Array([0x3f, 0x80, 0, 0])))))[0]!;
        expect(decodeNumeric(tf)![0]!).toBeCloseTo(1.0, 6);
        // float64: 2.0 BE = 0x4000000000000000
        const td = Array.from(iterTokens(dv(klv("ABCD", 0x64, 8, 1, new Uint8Array([0x40, 0, 0, 0, 0, 0, 0, 0])))))[0]!;
        expect(decodeNumeric(td)![0]!).toBeCloseTo(2.0, 9);
    });

    it("decodes GPS5-like sampleSize=20 (5 × int32 per sample)", () => {
        // 2 samples × 5 int32. Each sample: lat/lon/alt/speed2d/speed3d.
        const payload = new Uint8Array(40);
        const vw = new DataView(payload.buffer);
        // sample 1: lat=100, lon=200, alt=300, s2d=400, s3d=500.
        vw.setInt32(0, 100);
        vw.setInt32(4, 200);
        vw.setInt32(8, 300);
        vw.setInt32(12, 400);
        vw.setInt32(16, 500);
        // sample 2: same +1.
        vw.setInt32(20, 101);
        vw.setInt32(24, 201);
        vw.setInt32(28, 301);
        vw.setInt32(32, 401);
        vw.setInt32(36, 501);
        const tok = Array.from(iterTokens(dv(klv("GPS5", 0x6c, 20, 2, payload))))[0]!;
        const decoded = decodeNumeric(tok)!;
        expect(decoded).toHaveLength(10); // 2 samples × 5 elems
        expect(decoded.slice(0, 5)).toEqual([100, 200, 300, 400, 500]);
        expect(decoded.slice(5, 10)).toEqual([101, 201, 301, 401, 501]);
    });

    it("returns null for non-numeric type (e.g. 'c' ASCII)", () => {
        const tok = Array.from(iterTokens(dv(klv("STNM", 0x63, 1, 2, new Uint8Array([0x68, 0x69])))))[0]!;
        expect(decodeNumeric(tok)).toBeNull();
    });

    it("returns null when sampleSize is not multiple of elemSize", () => {
        // type 'L' = 4 bytes, sampleSize=3 - not a multiple.
        const buf = new Uint8Array(8 + 12);
        buf[0] = 0x41;
        buf[1] = 0x41;
        buf[2] = 0x41;
        buf[3] = 0x41;
        buf[4] = 0x4c; // 'L'
        buf[5] = 3; // sampleSize - not a multiple of 4
        buf[6] = 0;
        buf[7] = 4; // 4 repeats
        const tok = Array.from(iterTokens(dv(buf)))[0]!;
        expect(decodeNumeric(tok)).toBeNull();
    });
});

describe("decodeString", () => {
    it("decodes ASCII to string", () => {
        const tok = Array.from(
            iterTokens(
                dv(
                    klv(
                        "STNM",
                        0x63,
                        1,
                        7,
                        new Uint8Array([
                            0x47,
                            0x50,
                            0x53,
                            0x20,
                            0x44,
                            0x65,
                            0x76, // "GPS Dev"
                        ]),
                    ),
                ),
            ),
        )[0]!;
        expect(decodeString(tok)).toBe("GPS Dev");
    });

    it("stops at trailing null byte", () => {
        const tok = Array.from(
            iterTokens(
                dv(
                    klv(
                        "STNM",
                        0x63,
                        1,
                        8,
                        new Uint8Array([
                            0x67,
                            0x70,
                            0x73,
                            0x00,
                            0x66,
                            0x6f,
                            0x6f,
                            0x00, // "gps\0foo\0"
                        ]),
                    ),
                ),
            ),
        )[0]!;
        expect(decodeString(tok)).toBe("gps");
    });

    it("returns empty for empty payload", () => {
        const tok = Array.from(iterTokens(dv(klv("STNM", 0x63, 1, 0, new Uint8Array(0)))))[0]!;
        expect(decodeString(tok)).toBe("");
    });
});

describe("parseGpsuTimestamp", () => {
    it("parses YYMMDDhhmmss without sub-second", () => {
        // 240115123456 = 2024-01-15 12:34:56 UTC.
        const ts = parseGpsuTimestamp("240115123456");
        expect(ts).toBeCloseTo(Date.UTC(2024, 0, 15, 12, 34, 56) / 1000, 6);
    });

    it("parses YYMMDDhhmmss.sss with milliseconds", () => {
        const ts = parseGpsuTimestamp("240115123456.500");
        const expected = Date.UTC(2024, 0, 15, 12, 34, 56) / 1000 + 0.5;
        expect(ts).toBeCloseTo(expected, 6);
    });

    it("returns null for malformed input", () => {
        expect(parseGpsuTimestamp("")).toBeNull();
        expect(parseGpsuTimestamp("123")).toBeNull();
        expect(parseGpsuTimestamp("XX0115123456")).toBeNull(); // non-numeric
    });

    it("year 2000+ baseline (YY=24 → 2024)", () => {
        const ts = parseGpsuTimestamp("000101000000")!;
        expect(ts).toBe(Date.UTC(2000, 0, 1) / 1000);
    });
});
