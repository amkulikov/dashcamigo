// End-to-end tests for the ligo-json primitive: synthetic MP4 files through
// buildMp4Index -> marker -> parse, covering the direct LigoJSON udta (in
// trailer position after mdat), the GKU u32-LE indirection, and the
// negative gates that keep ordinary/encrypted files out.

import { describe, expect, it } from "vitest";
import { GKU_MARKER } from "../internal/ligo-json.js";
import { buildMp4Index } from "../internal/mp4-index.js";
import type { VendorFile } from "../types.js";
import { WrongFormatError } from "../types.js";
import { ligoJsonPrimitive } from "./ligo-json.js";

const ascii = (text: string): Uint8Array => Uint8Array.from(text, (ch) => ch.charCodeAt(0) & 0xff);

function box(type: string, payload: Uint8Array): Uint8Array<ArrayBuffer> {
    const out = new Uint8Array(8 + payload.length);
    new DataView(out.buffer).setUint32(0, out.length, false);
    out.set(ascii(type), 4);
    out.set(payload, 8);
    return out;
}

function concatBytes(parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
    const total = parts.reduce((n, p) => n + p.length, 0);
    const out = new Uint8Array(total);
    let pos = 0;
    for (const p of parts) {
        out.set(p, pos);
        pos += p.length;
    }
    return out;
}

const FTYP = box("ftyp", ascii("mp42\0\0\0\0mp42isom"));

function vf(bytes: Uint8Array<ArrayBuffer>, name = "yada.mp4"): VendorFile {
    return { file: new File([bytes], name), relativePath: name };
}

const JSON_RECORD =
    '{"Hour": "23", "Minute": "10", "Second": "22", "Year": "2023", "Month": "12", "Day": "28", ' +
    '"status": "A", "NS": "N", "EW": "E", "Latitude": "37.123456", "Longitude": "122.654321", ' +
    '"Speed": "10.5", "GsensorX": "000", "GsensorY": "000", "GsensorZ": "000"}';

/** 512-byte chained record blob, as the upstream sample describes. */
function recordBlob(json = JSON_RECORD): string {
    return `LIGOGPSINFO ${json}`.padEnd(512, "\0");
}

describe("ligoJsonPrimitive: direct LigoJSON udta (trailer position)", () => {
    const udtaPayload = ascii(recordBlob() + recordBlob(JSON_RECORD.replace('"Second": "22"', '"Second": "23"')));
    const bytes = concatBytes([FTYP, box("mdat", new Uint8Array(256)), box("udta", udtaPayload)]);

    it("marker fires off the udta head and parse decodes the chain", async () => {
        const file = vf(bytes);
        const index = await buildMp4Index(file.file, { probeBytes: 0 });
        expect(await ligoJsonPrimitive.marker(file, index)).toBe(true);
        const parsed = await ligoJsonPrimitive.parse(file, index);
        expect(parsed.records).toHaveLength(2);
        expect(parsed.records[0]!.lat).toBeCloseTo(37.123456, 6);
        expect(parsed.records[0]!.lon).toBeCloseTo(122.654321, 6);
        expect(parsed.records[0]!.unixSeconds).toBe(Date.UTC(2023, 11, 28, 23, 10, 22) / 1000);
        expect(parsed.records[1]!.unixSeconds).toBe(Date.UTC(2023, 11, 28, 23, 10, 23) / 1000);
        expect(parsed.records[0]!.mp4Filename).toBe("yada.mp4");
    });
});

describe("ligoJsonPrimitive: multiple top-level udta atoms", () => {
    it("a generic udta BEFORE the LigoJSON one does not hide the carrier", async () => {
        // Mux order is firmware whim - ExifTool tests every file-level udta,
        // so a leading non-GPS udta must not shadow the GPS-bearing one.
        const bytes = concatBytes([
            FTYP,
            box("udta", ascii("©nam some ordinary metadata payload here")),
            box("mdat", new Uint8Array(256)),
            box("udta", ascii(recordBlob())),
        ]);
        const file = vf(bytes);
        const index = await buildMp4Index(file.file, { probeBytes: 0 });
        expect(await ligoJsonPrimitive.marker(file, index)).toBe(true);
        const parsed = await ligoJsonPrimitive.parse(file, index);
        expect(parsed.records).toHaveLength(1);
        expect(parsed.records[0]!.lat).toBeCloseTo(37.123456, 6);
    });

    it("two non-matching udta atoms do not fire", async () => {
        const bytes = concatBytes([
            FTYP,
            box("udta", ascii("©nam some ordinary metadata payload here")),
            box("udta", ascii("©too another ordinary metadata payload")),
        ]);
        const file = vf(bytes);
        const index = await buildMp4Index(file.file, { probeBytes: 0 });
        expect(await ligoJsonPrimitive.marker(file, index)).toBe(false);
        await expect(ligoJsonPrimitive.parse(file, index)).rejects.toThrow(WrongFormatError);
    });
});

describe("ligoJsonPrimitive: GKU __V35AX_QVDATA__ indirection", () => {
    function gkuPayload(jsonStart: number, withLiteralAtTarget = true): Uint8Array {
        const payload = new Uint8Array(jsonStart + 600);
        new DataView(payload.buffer).setUint32(0, jsonStart, true);
        payload.set(ascii(GKU_MARKER), 8);
        if (withLiteralAtTarget) payload.set(ascii(recordBlob()), jsonStart);
        return payload;
    }

    it("follows the u32 LE offset, verifies the literal, parses", async () => {
        const bytes = concatBytes([FTYP, box("mdat", new Uint8Array(64)), box("udta", gkuPayload(0x80))]);
        const file = vf(bytes, "gku.mp4");
        const index = await buildMp4Index(file.file, { probeBytes: 0 });
        expect(await ligoJsonPrimitive.marker(file, index)).toBe(true);
        const parsed = await ligoJsonPrimitive.parse(file, index);
        expect(parsed.records).toHaveLength(1);
        expect(parsed.records[0]!.lat).toBeCloseTo(37.123456, 6);
    });

    it("rejects a GKU whose offset does not point at the literal", async () => {
        const bytes = concatBytes([FTYP, box("udta", gkuPayload(0x80, false))]);
        const file = vf(bytes, "gku.mp4");
        const index = await buildMp4Index(file.file, { probeBytes: 0 });
        expect(await ligoJsonPrimitive.marker(file, index)).toBe(true); // head looks right
        await expect(ligoJsonPrimitive.parse(file, index)).rejects.toThrow(WrongFormatError);
    });

    it("rejects a GKU offset outside the udta payload", async () => {
        const payload = new Uint8Array(64);
        new DataView(payload.buffer).setUint32(0, 0x7fffffff, true);
        payload.set(ascii(GKU_MARKER), 8);
        const bytes = concatBytes([FTYP, box("udta", payload)]);
        const file = vf(bytes, "gku.mp4");
        const index = await buildMp4Index(file.file, { probeBytes: 0 });
        await expect(ligoJsonPrimitive.parse(file, index)).rejects.toThrow(WrongFormatError);
    });
});

describe("ligoJsonPrimitive: negative gates", () => {
    it("ordinary udta payload does not fire", async () => {
        const bytes = concatBytes([FTYP, box("udta", ascii("©nam some ordinary metadata payload here"))]);
        const file = vf(bytes);
        const index = await buildMp4Index(file.file, { probeBytes: 0 });
        expect(await ligoJsonPrimitive.marker(file, index)).toBe(false);
        await expect(ligoJsonPrimitive.parse(file, index)).rejects.toThrow(WrongFormatError);
    });

    it("the encrypted-chunk literal (LIGOGPSINFO\\0, no json brace) does not fire", async () => {
        // The '####'-chunk LigoGPS format opens with 'LIGOGPSINFO\0' - that
        // belongs to the ligogps primitive, not this one.
        const bytes = concatBytes([FTYP, box("udta", ascii("LIGOGPSINFO\0\0\0\0\0####encrypted-chunk-data"))]);
        const file = vf(bytes);
        const index = await buildMp4Index(file.file, { probeBytes: 0 });
        expect(await ligoJsonPrimitive.marker(file, index)).toBe(false);
    });

    it("file without a top-level udta does not fire", async () => {
        const bytes = concatBytes([FTYP, box("mdat", new Uint8Array(64))]);
        const file = vf(bytes);
        const index = await buildMp4Index(file.file, { probeBytes: 0 });
        expect(await ligoJsonPrimitive.marker(file, index)).toBe(false);
    });
});
