// End-to-end tests for the kenwood primitive: synthetic MP4 files through
// buildMp4Index -> marker -> parse, covering all three carrier locations
// (top-level udta, moov/udta, CCCC trailer) and the negative gates.

import { describe, expect, it } from "vitest";
import { KENWOOD_UDTA_MARKER } from "../internal/kenwood.js";
import { buildMp4Index } from "../internal/mp4-index.js";
import type { VendorFile } from "../types.js";
import { WrongFormatError } from "../types.js";
import { kenwoodPrimitive } from "./kenwood.js";

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

function vf(bytes: Uint8Array<ArrayBuffer>, name = "kenwood.mp4"): VendorFile {
    return { file: new File([bytes], name), relativePath: name };
}

// Record values verbatim from the public ExifTool hexdump - not a real
// capture (provenance in the internal/kenwood.test.ts header).
const UDTA_RECORDS = `\xfe\xfe20230107111914.20230107111915\x03N47377053W122099014+0058000+006+009+004`;

function trailerRecord(date = "20240711120412"): string {
    return `GPSDATA--${date}N50.6123860677E8.7027180989533.000000000000.0000000000000.019999999553-0.09000000357-0.14000000059`;
}

describe("kenwoodPrimitive: top-level udta carrier", () => {
    const bytes = concatBytes([
        FTYP,
        box("mdat", new Uint8Array(64)),
        box("udta", ascii(KENWOOD_UDTA_MARKER + UDTA_RECORDS)),
    ]);

    it("marker fires and parse decodes the records", async () => {
        const file = vf(bytes);
        const index = await buildMp4Index(file.file, { probeBytes: 0 });
        expect(await kenwoodPrimitive.marker(file, index)).toBe(true);
        const parsed = await kenwoodPrimitive.parse(file, index);
        expect(parsed.records).toHaveLength(1);
        expect(parsed.records[0]!.lat).toBeCloseTo(47 + 37.7053 / 60, 6);
        expect(parsed.records[0]!.timeUnsynced).toBe(true);
        expect(parsed.records[0]!.mp4Filename).toBe("kenwood.mp4");
    });
});

describe("kenwoodPrimitive: multiple top-level udta atoms", () => {
    it("a generic udta BEFORE the VIDEOUUU one does not hide the carrier", async () => {
        // Mux order is firmware whim - ExifTool tests every file-level udta,
        // so a leading non-GPS udta must not shadow the GPS-bearing one.
        const bytes = concatBytes([
            FTYP,
            box("udta", ascii("©too©swr plain metadata, long enough payload")),
            box("mdat", new Uint8Array(64)),
            box("udta", ascii(KENWOOD_UDTA_MARKER + UDTA_RECORDS)),
        ]);
        const file = vf(bytes);
        const index = await buildMp4Index(file.file, { probeBytes: 0 });
        expect(await kenwoodPrimitive.marker(file, index)).toBe(true);
        const parsed = await kenwoodPrimitive.parse(file, index);
        expect(parsed.records).toHaveLength(1);
        expect(parsed.records[0]!.lat).toBeCloseTo(47 + 37.7053 / 60, 6);
    });

    it("two non-matching udta atoms do not fire", async () => {
        const bytes = concatBytes([
            FTYP,
            box("udta", ascii("©too©swr plain metadata, long enough payload")),
            box("mdat", new Uint8Array(64)),
            box("udta", ascii("©nam another ordinary metadata payload here")),
        ]);
        const file = vf(bytes);
        const index = await buildMp4Index(file.file, { probeBytes: 0 });
        expect(await kenwoodPrimitive.marker(file, index)).toBe(false);
    });
});

describe("kenwoodPrimitive: moov/udta carrier", () => {
    it("finds the VIDEOUUU payload nested in moov", async () => {
        const moov = box("moov", box("udta", ascii(KENWOOD_UDTA_MARKER + UDTA_RECORDS)));
        const bytes = concatBytes([FTYP, moov, box("mdat", new Uint8Array(32))]);
        const file = vf(bytes);
        const index = await buildMp4Index(file.file, { probeBytes: 0 });
        expect(await kenwoodPrimitive.marker(file, index)).toBe(true);
        const parsed = await kenwoodPrimitive.parse(file, index);
        expect(parsed.records).toHaveLength(1);
        expect(parsed.records[0]!.lon).toBeCloseTo(-(122 + 9.9014 / 60), 6);
    });
});

describe("kenwoodPrimitive: CCCC trailer carrier", () => {
    it("probes the trailer at last-top-level-box-end and parses the chain", async () => {
        const trailer = ascii("C".repeat(14) + trailerRecord() + trailerRecord("20240711120413"));
        const bytes = concatBytes([FTYP, box("mdat", new Uint8Array(128)), trailer]);
        const file = vf(bytes);
        const index = await buildMp4Index(file.file, { probeBytes: 0 });
        expect(await kenwoodPrimitive.marker(file, index)).toBe(true);
        const parsed = await kenwoodPrimitive.parse(file, index);
        expect(parsed.records).toHaveLength(2);
        expect(parsed.records[0]!.lat).toBeCloseTo(50.6123860677, 9);
        expect(parsed.records[1]!.relStartSeconds).toBe(1);
    });
});

describe("kenwoodPrimitive: negative gates", () => {
    it("ordinary udta (no VIDEOUUU) does not fire", async () => {
        const bytes = concatBytes([FTYP, box("udta", ascii("©too©swr plain metadata, long enough payload"))]);
        const file = vf(bytes);
        const index = await buildMp4Index(file.file, { probeBytes: 0 });
        expect(await kenwoodPrimitive.marker(file, index)).toBe(false);
        await expect(kenwoodPrimitive.parse(file, index)).rejects.toThrow(WrongFormatError);
    });

    it("trailing junk that is not the CCCC trailer does not fire", async () => {
        const junk = ascii(`gpsa\0\0\0\0${"x".repeat(200)}`); // RIFF-trailer-ish, not Kenwood
        const bytes = concatBytes([FTYP, box("mdat", new Uint8Array(32)), junk]);
        const file = vf(bytes);
        const index = await buildMp4Index(file.file, { probeBytes: 0 });
        expect(await kenwoodPrimitive.marker(file, index)).toBe(false);
    });

    it("a clean file with no trailing junk does not fire (no probe IO possible)", async () => {
        const bytes = concatBytes([FTYP, box("mdat", new Uint8Array(64))]);
        const file = vf(bytes);
        const index = await buildMp4Index(file.file, { probeBytes: 0 });
        expect(await kenwoodPrimitive.marker(file, index)).toBe(false);
    });

    it("marker without records parses to empty, not WrongFormatError", async () => {
        const bytes = concatBytes([FTYP, box("udta", ascii(KENWOOD_UDTA_MARKER))]);
        const file = vf(bytes);
        const index = await buildMp4Index(file.file, { probeBytes: 0 });
        expect(await kenwoodPrimitive.marker(file, index)).toBe(true);
        const parsed = await kenwoodPrimitive.parse(file, index);
        expect(parsed.records).toEqual([]);
    });
});
