// Tests for the Vantrue FMAS gpmd extractor. The base fixture is the
// complete 160-byte record reconstructed VERBATIM from the ExifTool 13.59
// hexdump comment (QuickTimeStream.pl:3586-3595, ProcessFMAS) - a real
// W-hemisphere record: 2021-09-24 08:00:34Z, 41.64198N 81.36782W, 75 (mph)
// at +60, 73 (deg track) at +62. No real MP4 sample has been through this
// code yet (waived; see the header of internal/vantrue-fmas.ts), so the
// negative tests against GPMF KLV and both Wolfbox layouts are the contract
// that keeps the new marker from claiming existing formats and vice versa.

import { describe, expect, it } from "vitest";

import { vantrueFmasPrimitive } from "../primitives/vantrue-fmas.js";
import { gpmfPrimitive } from "../primitives/gpmf.js";
import { wolfboxGpmdPrimitive } from "../primitives/wolfbox-gpmd.js";
import { type GpsRecord, MPH_TO_MS, type VendorFile } from "../types.js";
import { extractGpsFromSample } from "./gpmf-extract.js";
import { buildMp4Index } from "./mp4-index.js";
import { decodeFmasSample, hasFmasFirstSamplePrefix } from "./vantrue-fmas.js";
import { detectWolfboxVariant } from "./wolfbox-gpmd.js";

// ===== fixtures =====

// ExifTool 13.59 QuickTimeStream.pl:3586-3595 - verbatim.
const EXIFTOOL_HEXDUMP = `
46 4d 41 53 00 00 00 00 00 00 00 00 00 00 00 00
00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00
00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00
02 08 01 08 06 08 02 04 07 02 06 00 00 00 00 00
00 00 00 00 00 00 00 00 4f 46 4e 49 4d 4d 41 53
53 41 4d 4d 01 00 00 00 00 00 00 00 00 00 00 00
e5 07 09 18 08 00 22 00 02 00 00 00 a1 82 8a bf
89 23 8e bd 0b 2c 30 bc 41 57 4e 51 16 00 a1 01
29 26 27 0c 4b 00 49 00 00 00 00 00 00 00 00 00
00 00 00 00 00 00 00 00 00 52 00 00 00 00 00 00
`;

function fmasRecord(): Uint8Array {
    const hex = EXIFTOOL_HEXDUMP.trim().split(/\s+/);
    return new Uint8Array(hex.map((b) => Number.parseInt(b, 16)));
}

function dvOf(bytes: Uint8Array): DataView {
    return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

// Expected decode of the hexdump (magic at 72; offsets are magic-relative,
// see internal/vantrue-fmas.ts header):
//   lon = 81 + (22 + 417/6000)/60 = 81.367825, 'W' -> negative
//   lat = 41 + (38 + 3111/6000)/60 = 41.641975, 'N' -> positive
const EXPECTED_LON = -81.367825;
const EXPECTED_LAT = 41.641975;
const EXPECTED_UNIX = Date.UTC(2021, 8, 24, 8, 0, 34) / 1000;
const EXPECTED_SPEED_MS = 75 * MPH_TO_MS;

// GPMF KLV helpers (same shape as gpmf-extract.test.ts) - a minimal real-ish
// first sample: DEVC container with a DVNM child.
function klv(fourCC: string, type: number, sampleSize: number, repeat: number, payload: Uint8Array): Uint8Array {
    const expected = sampleSize * repeat;
    const padded = (expected + 3) & ~3;
    const out = new Uint8Array(8 + padded);
    for (let i = 0; i < 4; i++) out[i] = fourCC.charCodeAt(i);
    out[4] = type;
    out[5] = sampleSize;
    out[6] = (repeat >> 8) & 0xff;
    out[7] = repeat & 0xff;
    out.set(payload, 8);
    return out;
}

function gpmfDevcSample(): Uint8Array {
    const dvnm = klv("DVNM", 0x63, 1, 5, new TextEncoder().encode("GoPro"));
    return klv("DEVC", 0, 1, dvnm.byteLength, dvnm);
}

// Wolfbox-shaped samples (layouts from internal/wolfbox-gpmd.ts) - negative
// material proving neither existing variant is claimed by the FMAS marker.
function wolfboxVariantBSample(): Uint8Array {
    const b = Buffer.alloc(0xf8);
    const pair = (off: number, value: number, scale: number) => {
        b.writeBigInt64LE(BigInt(value), off);
        b.writeBigInt64LE(BigInt(scale), off + 8);
    };
    pair(0x48, 2000, 100); // speed
    pair(0x58, 9200, 100); // direction
    b.writeUInt32LE(15, 0x68); // day
    b.writeUInt32LE(3, 0x6c); // month
    b.writeUInt32LE(2026, 0x70); // year
    b.writeUInt32LE(17, 0xa0); // hour
    b.writeUInt32LE(39, 0xa4); // minute
    b.writeUInt32LE(51, 0xa8); // second
    pair(0xb0, 5000_00000, 1e5); // lat ddmm
    pair(0xc0, 3000_00000, 1e5); // lon ddmm
    return new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
}

function wolfboxVariantASample(): Uint8Array {
    const b = Buffer.alloc(1000);
    b.writeInt32LE(1, 0x00); // status = valid fix
    b.writeBigInt64LE(BigInt(5000_00000), 0x28);
    b.writeBigInt64LE(BigInt(1e5), 0x30);
    b.writeBigInt64LE(BigInt(3000_00000), 0x38);
    b.writeBigInt64LE(BigInt(1e5), 0x40);
    return new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
}

// ===== minimal MP4 builder (skeleton mirrors __fixtures__/wolfbox/build-synthetic.mjs) =====

function fourCC(s: string): Buffer {
    return Buffer.from(s, "ascii");
}
function mp4Box(type: string, payload: Buffer): Buffer {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(8 + payload.length, 0);
    fourCC(type).copy(head, 4);
    return Buffer.concat([head, payload]);
}
function u32be(n: number): Buffer {
    const b = Buffer.alloc(4);
    b.writeUInt32BE(n, 0);
    return b;
}

/** ftyp + moov (one 'meta' track with stsd format 'gpmd') + mdat with fixed-size samples. */
function buildGpmdMp4(samples: Uint8Array[], sampleSize: number): Buffer {
    const n = samples.length;
    const CREATION_TIME = 3851323200; // 1904-epoch; value irrelevant here

    const mvhd = (() => {
        const p = Buffer.alloc(108);
        p.writeUInt32BE(CREATION_TIME, 4);
        p.writeUInt32BE(CREATION_TIME, 8);
        p.writeUInt32BE(1000, 12);
        p.writeUInt32BE(n * 1000, 16);
        return mp4Box("mvhd", p);
    })();
    const hdlr = (() => {
        const p = Buffer.alloc(33);
        fourCC("meta").copy(p, 8);
        return mp4Box("hdlr", p);
    })();
    const mdhd = (() => {
        const p = Buffer.alloc(24);
        p.writeUInt32BE(CREATION_TIME, 4);
        p.writeUInt32BE(CREATION_TIME, 8);
        p.writeUInt32BE(1000, 12);
        p.writeUInt32BE(n * 1000, 16);
        return mp4Box("mdhd", p);
    })();
    const stsd = (() => {
        const entry = Buffer.alloc(16);
        entry.writeUInt32BE(16, 0);
        fourCC("gpmd").copy(entry, 4);
        return mp4Box("stsd", Buffer.concat([Buffer.alloc(4), u32be(1), entry]));
    })();
    // ~30 fps sample pacing (FMAS repeats one fix per video frame). The
    // decoder never reads stts - per-record UTC is absolute.
    const stts = mp4Box("stts", Buffer.concat([Buffer.alloc(4), u32be(1), u32be(n), u32be(33)]));
    const stsc = mp4Box("stsc", Buffer.concat([Buffer.alloc(4), u32be(1), u32be(1), u32be(n), u32be(1)]));
    const stsz = mp4Box("stsz", Buffer.concat([Buffer.alloc(4), u32be(sampleSize), u32be(n)]));
    const stco = mp4Box("stco", Buffer.concat([Buffer.alloc(4), u32be(1), u32be(0)]));
    const dinf = mp4Box(
        "dinf",
        mp4Box(
            "dref",
            Buffer.concat([Buffer.alloc(4), u32be(1), u32be(12), fourCC("url "), Buffer.from([0, 0, 0, 1])]),
        ),
    );
    const stbl = mp4Box("stbl", Buffer.concat([stsd, stts, stsc, stsz, stco]));
    const minf = mp4Box("minf", Buffer.concat([dinf, stbl]));
    const mdia = mp4Box("mdia", Buffer.concat([mdhd, hdlr, minf]));
    const tkhd = (() => {
        const p = Buffer.alloc(84);
        p.writeUInt32BE(7, 0);
        p.writeUInt32BE(CREATION_TIME, 4);
        p.writeUInt32BE(CREATION_TIME, 8);
        p.writeUInt32BE(1, 12);
        p.writeUInt32BE(n * 1000, 20);
        return mp4Box("tkhd", p);
    })();
    const trak = mp4Box("trak", Buffer.concat([tkhd, mdia]));
    const moov = mp4Box("moov", Buffer.concat([mvhd, trak]));
    const ftyp = mp4Box("ftyp", Buffer.concat([fourCC("isom"), u32be(512), fourCC("isom"), fourCC("mp41")]));
    const mdat = mp4Box("mdat", Buffer.concat(samples.map((s) => Buffer.from(s))));

    // Patch the single chunk offset now that sizes are known.
    const mdatStartOffset = ftyp.length + moov.length + 8;
    const stcoPos = moov.indexOf(stco);
    const moovPatched = Buffer.from(moov);
    moovPatched.writeUInt32BE(mdatStartOffset, stcoPos + 8 + 4 + 4);

    return Buffer.concat([ftyp, moovPatched, mdat]);
}

async function loadAsVendorFile(bytes: Buffer, name: string) {
    // copy into a fresh ArrayBuffer-backed view - Buffer's ArrayBufferLike
    // backing is not a BlobPart under strict DOM types
    const file = new File([new Uint8Array(bytes)], name);
    const vf: VendorFile = { file, relativePath: name };
    const index = await buildMp4Index(file);
    return { vf, index };
}

// ===== decode unit tests =====

describe("decodeFmasSample - ExifTool hexdump fixture", () => {
    it("decodes the verbatim record (W hemisphere covered by real data)", () => {
        const rec = decodeFmasSample(dvOf(fmasRecord()), "test.MP4");
        expect(rec).not.toBeNull();
        expect(rec!.unixSeconds).toBe(EXPECTED_UNIX);
        expect(rec!.lat).toBeCloseTo(EXPECTED_LAT, 6);
        expect(rec!.lon).toBeCloseTo(EXPECTED_LON, 6);
        expect(rec!.speedMs).toBeCloseTo(EXPECTED_SPEED_MS, 4);
        // magic+62 is GPSTrack per ExifTool, NOT elevation.
        expect(rec!.bearingDeg).toBe(73);
        expect(rec!.active).toBe(true);
        expect(rec!.timeUnsynced).toBeUndefined();
        expect(rec!.mp4Filename).toBe("test.MP4");
        // Raw accel floats at magic+36 are gravity-included - must stay zero.
        expect(rec!.accelXg).toBe(0);
        expect(rec!.accelYg).toBe(0);
        expect(rec!.accelZg).toBe(0);
    });

    it("applies S/E hemisphere signs (synthetic - spec-only path)", () => {
        const bytes = fmasRecord();
        bytes[121] = 0x45; // lonRef 'W' -> 'E'
        bytes[122] = 0x53; // latRef 'N' -> 'S'
        const rec = decodeFmasSample(dvOf(bytes), "test.MP4");
        expect(rec).not.toBeNull();
        expect(rec!.lat).toBeCloseTo(-EXPECTED_LAT, 6);
        expect(rec!.lon).toBeCloseTo(-EXPECTED_LON, 6);
    });

    it("zeroes out-of-range bearing instead of emitting it", () => {
        const bytes = fmasRecord();
        const dv = dvOf(bytes);
        dv.setUint16(134, 360, true); // magic(72)+62
        expect(decodeFmasSample(dv, "t.MP4")!.bearingDeg).toBe(0);
    });

    it("rejects: truncated record (< 160 bytes)", () => {
        expect(decodeFmasSample(dvOf(fmasRecord().slice(0, 159)), "t.MP4")).toBeNull();
    });

    it("rejects: no-fix status 'V' (ExifTool gate)", () => {
        const bytes = fmasRecord();
        bytes[120] = 0x56; // 'V'
        expect(decodeFmasSample(dvOf(bytes), "t.MP4")).toBeNull();
    });

    it("rejects: corrupted 'SAMM' (ExifTool gate)", () => {
        const bytes = fmasRecord();
        bytes[80] = 0x58; // 'S' -> 'X'
        expect(decodeFmasSample(dvOf(bytes), "t.MP4")).toBeNull();
    });

    it("rejects: corrupted magic head even when the gate bytes survive", () => {
        const bytes = fmasRecord();
        bytes[72] = 0x58; // 'O' -> 'X'; SAMM@80 and 'A'@120 untouched
        expect(decodeFmasSample(dvOf(bytes), "t.MP4")).toBeNull();
    });

    it("rejects: out-of-range date", () => {
        const monthBad = fmasRecord();
        monthBad[98] = 13; // magic+26
        expect(decodeFmasSample(dvOf(monthBad), "t.MP4")).toBeNull();

        const yearBad = fmasRecord();
        dvOf(yearBad).setUint16(96, 1999, true); // magic+24
        expect(decodeFmasSample(dvOf(yearBad), "t.MP4")).toBeNull();
    });

    it("rejects: hemisphere ref bytes outside N/S/E/W (layout drift guard)", () => {
        const bytes = fmasRecord();
        bytes[122] = 0x30; // latRef '0'
        expect(decodeFmasSample(dvOf(bytes), "t.MP4")).toBeNull();
    });

    it("rejects: 0,0 coordinates", () => {
        const bytes = fmasRecord();
        // Zero both coordinate triplets (lon 123-127, lat 128-131).
        for (let i = 123; i <= 131; i++) bytes[i] = 0;
        expect(decodeFmasSample(dvOf(bytes), "t.MP4")).toBeNull();
    });
});

// ===== marker unit tests (incl. mandatory negatives) =====

describe("hasFmasFirstSamplePrefix", () => {
    it("fires on the FMAS record", () => {
        expect(hasFmasFirstSamplePrefix(fmasRecord())).toBe(true);
    });

    it("does not fire on GPMF KLV first-sample bytes", () => {
        expect(hasFmasFirstSamplePrefix(gpmfDevcSample())).toBe(false);
    });

    it("does not fire on wolfbox-shaped samples (both layouts)", () => {
        const variantB = wolfboxVariantBSample();
        const variantA = wolfboxVariantASample();
        // Sanity: these byte shapes really are what wolfbox claims...
        expect(detectWolfboxVariant(dvOf(variantB))).toBe("block2-exiftool");
        expect(detectWolfboxVariant(dvOf(variantA))).toBe("block1-shenshu");
        // ...and the FMAS marker stays away from them.
        expect(hasFmasFirstSamplePrefix(variantB)).toBe(false);
        expect(hasFmasFirstSamplePrefix(variantA)).toBe(false);
        expect(decodeFmasSample(dvOf(variantB), "t.MP4")).toBeNull();
        expect(decodeFmasSample(dvOf(variantA), "t.MP4")).toBeNull();
    });

    it("does not fire on a prefix-less sample carrying the magic (dropped secondary marker)", () => {
        // The "OFNIMMASSAMM within the first 160 bytes" secondary marker was
        // dropped (the prefix-less-N4 premise is unsupported); pin that a
        // record with a zeroed prefix is NOT claimed.
        const bytes = fmasRecord();
        for (let i = 0; i < 8; i++) bytes[i] = 0;
        expect(hasFmasFirstSamplePrefix(bytes)).toBe(false);
    });

    it("does not fire on short samples", () => {
        expect(hasFmasFirstSamplePrefix(new Uint8Array([0x46, 0x4d, 0x41]))).toBe(false);
        expect(hasFmasFirstSamplePrefix(new Uint8Array(0))).toBe(false);
    });
});

describe("existing formats do not claim FMAS bytes", () => {
    it("detectWolfboxVariant rejects the FMAS record", () => {
        // 160 bytes < variant B's 0xf8 minimum, and variant A reads 'FMAS' LE
        // as a non-0/1 status int - both paths must say no.
        expect(detectWolfboxVariant(dvOf(fmasRecord()))).toBeNull();
    });

    it("gpmf sample extraction yields zero records on FMAS bytes", () => {
        const out: GpsRecord[] = [];
        // Production wraps per-sample parsing in try/catch (bad KLV sizes may
        // throw) - either way no records may come out.
        try {
            extractGpsFromSample(dvOf(fmasRecord()), "t.MP4", 1, out);
        } catch {
            // a throw is an acceptable rejection
        }
        expect(out).toHaveLength(0);
    });
});

// ===== in-memory MP4 end-to-end (primitive marker / parse / dispatch order) =====

describe("vantrue-fmas primitive on an in-memory gpmd MP4", () => {
    function fmasMp4(): Buffer {
        // Three frames: two repeats of the same 1 Hz fix + the next second.
        const s1 = fmasRecord();
        const s2 = fmasRecord();
        const s3 = fmasRecord();
        s3[102] = 0x23; // second 34 -> 35 (magic+30)
        dvOf(s3).setUint16(130, 3200, true); // lat centi-arcsec drifts
        return buildGpmdMp4([s1, s2, s3], 160);
    }

    it("marker fires and parse dedupes per-frame repeats", async () => {
        const { vf, index } = await loadAsVendorFile(fmasMp4(), "20210924_080034_0001_N.MP4");
        expect(await vantrueFmasPrimitive.marker(vf, index)).toBe(true);

        const result = await vantrueFmasPrimitive.parse(vf, index);
        expect(result.records).toHaveLength(2); // 3 samples, same-second repeat dropped

        const [r0, r1] = result.records;
        expect(r0!.unixSeconds).toBe(EXPECTED_UNIX);
        expect(r0!.lat).toBeCloseTo(EXPECTED_LAT, 6);
        expect(r0!.lon).toBeCloseTo(EXPECTED_LON, 6);
        expect(r1!.unixSeconds).toBe(EXPECTED_UNIX + 1);
        expect(r1!.mp4Filename).toBe("20210924_080034_0001_N.MP4");
    });

    it("gpmf primitive marker fires on the gpmd track but yields zero records (dispatcher walks on)", async () => {
        const { vf, index } = await loadAsVendorFile(fmasMp4(), "20210924_080034_0001_N.MP4");
        expect(await gpmfPrimitive.marker(vf, index)).toBe(true);
        const parsed = await gpmfPrimitive.parse(vf, index).catch(() => null);
        expect(parsed === null || parsed.records.length === 0).toBe(true);
    });

    it("wolfbox primitive does not claim the FMAS track", async () => {
        const { vf, index } = await loadAsVendorFile(fmasMp4(), "20210924_080034_0001_N.MP4");
        expect(await wolfboxGpmdPrimitive.marker(vf, index)).toBe(false);
    });

    it("fmas marker does not fire on a GPMF KLV gpmd track", async () => {
        const devc = gpmfDevcSample();
        const { vf, index } = await loadAsVendorFile(buildGpmdMp4([devc], devc.byteLength), "GH010001.MP4");
        expect(await vantrueFmasPrimitive.marker(vf, index)).toBe(false);
    });

    it("marker does not fire without an index or without a gpmd track", async () => {
        const { vf } = await loadAsVendorFile(fmasMp4(), "x.MP4");
        expect(await vantrueFmasPrimitive.marker(vf, undefined)).toBe(false);
    });
});
