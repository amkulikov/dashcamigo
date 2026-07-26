// Unit tests for the minimal ISOBMFF box writer. Covers:
//  - big-endian for all u16/u32/box-size,
//  - size = 8 + payload contract in box(),
//  - FullBox version+flags (4-byte prefix before payload),
//  - identityMatrix correct 0x40000000 for w-coord (1.0 in 2.30 fixed),
//  - concat does not lose bytes,
//  - fourCC length enforcement.

import { describe, expect, it } from "vitest";

import { ascii, box, concat, fourCC, fullBox, identityMatrix, u16, u32, u8 } from "./iso-write.js";

describe("u8", () => {
    it("returns 1-byte Uint8Array", () => {
        expect(u8(0)).toEqual(new Uint8Array([0]));
        expect(u8(255)).toEqual(new Uint8Array([255]));
        expect(u8(0xab)).toEqual(new Uint8Array([0xab]));
    });

    it("masks to low 8 bits (truncates overflow)", () => {
        // u8(0x100) -> 0x00, u8(0x1ff) -> 0xff. No explicit throw - just masks.
        expect(u8(0x100)).toEqual(new Uint8Array([0x00]));
        expect(u8(0x1ff)).toEqual(new Uint8Array([0xff]));
    });
});

describe("u16", () => {
    it("writes big-endian 2 bytes", () => {
        expect(u16(0)).toEqual(new Uint8Array([0, 0]));
        expect(u16(0x1234)).toEqual(new Uint8Array([0x12, 0x34]));
        expect(u16(0xffff)).toEqual(new Uint8Array([0xff, 0xff]));
    });

    it("LE check: high byte goes first (BE)", () => {
        // 0x00ab BE = [0x00, 0xab]; LE would be [0xab, 0x00].
        expect(u16(0xab)).toEqual(new Uint8Array([0x00, 0xab]));
    });
});

describe("u32", () => {
    it("writes big-endian 4 bytes", () => {
        expect(u32(0)).toEqual(new Uint8Array([0, 0, 0, 0]));
        expect(u32(0x12345678)).toEqual(new Uint8Array([0x12, 0x34, 0x56, 0x78]));
        expect(u32(0xffffffff)).toEqual(new Uint8Array([0xff, 0xff, 0xff, 0xff]));
    });

    it("LE check: most significant byte first (BE)", () => {
        // 0x000000ab BE = [0, 0, 0, 0xab]; LE would have 0xab first.
        expect(u32(0xab)).toEqual(new Uint8Array([0, 0, 0, 0xab]));
    });
});

describe("fourCC", () => {
    it("encodes 4 ASCII chars", () => {
        expect(fourCC("moov")).toEqual(new Uint8Array([0x6d, 0x6f, 0x6f, 0x76]));
        expect(fourCC("gpmd")).toEqual(new Uint8Array([0x67, 0x70, 0x6d, 0x64]));
        expect(fourCC("free")).toEqual(new Uint8Array([0x66, 0x72, 0x65, 0x65]));
    });

    it("throws for code != 4 chars", () => {
        expect(() => fourCC("moo")).toThrow();
        expect(() => fourCC("moovx")).toThrow();
        expect(() => fourCC("")).toThrow();
    });
});

describe("ascii", () => {
    it("encodes without nul", () => {
        expect(ascii("hi", false)).toEqual(new Uint8Array([0x68, 0x69]));
    });

    it("encodes with trailing nul", () => {
        expect(ascii("hi", true)).toEqual(new Uint8Array([0x68, 0x69, 0x00]));
    });

    it("empty string + nul = single zero byte", () => {
        expect(ascii("", true)).toEqual(new Uint8Array([0x00]));
    });

    it("empty string without nul = empty array", () => {
        expect(ascii("", false).byteLength).toBe(0);
    });
});

describe("concat", () => {
    it("returns empty array for empty input", () => {
        expect(concat([]).byteLength).toBe(0);
    });

    it("concatenates multiple parts preserving order", () => {
        const a = new Uint8Array([1, 2]);
        const b = new Uint8Array([3, 4, 5]);
        const c = new Uint8Array([6]);
        expect(concat([a, b, c])).toEqual(new Uint8Array([1, 2, 3, 4, 5, 6]));
    });

    it("works with single part", () => {
        const a = new Uint8Array([42, 100]);
        expect(concat([a])).toEqual(new Uint8Array([42, 100]));
    });
});

describe("box", () => {
    it("writes size BE then 4-byte type then payload", () => {
        const result = box("free", new Uint8Array([0xaa, 0xbb]));
        // size = 8 + 2 = 10.
        expect(result.byteLength).toBe(10);
        expect(Array.from(result.slice(0, 4))).toEqual([0, 0, 0, 10]); // size BE
        expect(Array.from(result.slice(4, 8))).toEqual([0x66, 0x72, 0x65, 0x65]); // 'free'
        expect(Array.from(result.slice(8))).toEqual([0xaa, 0xbb]);
    });

    it("empty payload box has size 8 (header only)", () => {
        const result = box("free", new Uint8Array(0));
        expect(result.byteLength).toBe(8);
        expect(Array.from(result.slice(0, 4))).toEqual([0, 0, 0, 8]);
        expect(Array.from(result.slice(4, 8))).toEqual([0x66, 0x72, 0x65, 0x65]);
    });

    it("accepts array of payloads (auto-concat)", () => {
        const result = box("free", [new Uint8Array([1]), new Uint8Array([2, 3])]);
        expect(Array.from(result.slice(0, 4))).toEqual([0, 0, 0, 11]); // 8 + 3
        expect(Array.from(result.slice(8))).toEqual([1, 2, 3]);
    });

    it("throws for type != 4 chars", () => {
        expect(() => box("xxx", new Uint8Array(0))).toThrow();
    });
});

describe("fullBox", () => {
    it("adds 1-byte version + 3-byte flags before payload", () => {
        const result = fullBox("test", 0, 0, new Uint8Array([0xff]));
        // 8 header + 4 (version+flags) + 1 = 13.
        expect(result.byteLength).toBe(13);
        expect(Array.from(result.slice(0, 4))).toEqual([0, 0, 0, 13]);
        expect(Array.from(result.slice(4, 8))).toEqual([0x74, 0x65, 0x73, 0x74]); // 'test'
        expect(Array.from(result.slice(8, 12))).toEqual([0, 0, 0, 0]); // version 0, flags 0
        expect(result[12]).toBe(0xff);
    });

    it("encodes version 1", () => {
        const result = fullBox("test", 1, 0, new Uint8Array(0));
        expect(result[8]).toBe(1); // version byte
    });

    it("encodes flags BE 24-bit", () => {
        const result = fullBox("test", 0, 0x012345, new Uint8Array(0));
        // flags = 0x012345 -> bytes [0x01, 0x23, 0x45]
        expect(result[9]).toBe(0x01);
        expect(result[10]).toBe(0x23);
        expect(result[11]).toBe(0x45);
    });

    it("flags overflow masks to 24 bits", () => {
        // 0xff012345 -> low 24 bits = 0x012345.
        const result = fullBox("test", 0, 0xff012345, new Uint8Array(0));
        expect(result[9]).toBe(0x01);
        expect(result[10]).toBe(0x23);
        expect(result[11]).toBe(0x45);
    });
});

describe("identityMatrix", () => {
    const matrix = identityMatrix();

    it("is exactly 36 bytes (9 × u32)", () => {
        expect(matrix.byteLength).toBe(36);
    });

    it("a = 0x00010000 (1.0 in 16.16 fixed)", () => {
        // Field a at offset 0..3, BE.
        expect(Array.from(matrix.slice(0, 4))).toEqual([0x00, 0x01, 0x00, 0x00]);
    });

    it("e = 0x00010000 (1.0 in 16.16 fixed) at offset 16", () => {
        expect(Array.from(matrix.slice(16, 20))).toEqual([0x00, 0x01, 0x00, 0x00]);
    });

    it("i = 0x40000000 (1.0 in 2.30 fixed for w-coord) at offset 32", () => {
        // CRITICAL: w-coord uses 2.30 fixed-point, not 16.16.
        // Wrong value here produces a black screen in QuickTime.
        expect(Array.from(matrix.slice(32, 36))).toEqual([0x40, 0x00, 0x00, 0x00]);
    });

    it("other 6 positions are zero (b, c, d, f, g, h)", () => {
        // Offsets 4-15 (b/c/d) and 20-31 (f/g/h).
        for (let i = 4; i < 16; i++) expect(matrix[i]).toBe(0);
        for (let i = 20; i < 32; i++) expect(matrix[i]).toBe(0);
    });
});

describe("nested box composition (realistic use case)", () => {
    it("box-inside-box has correct nested size accounting", () => {
        // Inner box 'free' (header 8 + payload 4 = 12).
        // Outer 'moov' (header 8 + inner 12 = 20).
        const inner = box("free", new Uint8Array([1, 2, 3, 4]));
        const outer = box("moov", inner);
        expect(outer.byteLength).toBe(20);
        expect(Array.from(outer.slice(0, 4))).toEqual([0, 0, 0, 20]); // outer size BE
        expect(Array.from(outer.slice(4, 8))).toEqual([0x6d, 0x6f, 0x6f, 0x76]); // 'moov'
        expect(Array.from(outer.slice(8, 12))).toEqual([0, 0, 0, 12]); // inner size BE
        expect(Array.from(outer.slice(12, 16))).toEqual([0x66, 0x72, 0x65, 0x65]); // 'free'
        expect(Array.from(outer.slice(16))).toEqual([1, 2, 3, 4]);
    });

    it("fullBox inside box: composition is structurally correct", () => {
        const inner = fullBox("mvhd", 0, 0, u32(1000)); // mvhd-like (4 byte body)
        // inner: 8 (box hdr) + 4 (v+f) + 4 (body) = 16.
        expect(inner.byteLength).toBe(16);
        const outer = box("moov", inner);
        // outer: 8 + 16 = 24.
        expect(outer.byteLength).toBe(24);
        // mvhd body after version+flags = u32(1000) = 0x000003e8.
        expect(Array.from(outer.slice(20, 24))).toEqual([0, 0, 0x03, 0xe8]);
    });
});
