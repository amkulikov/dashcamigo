// Unit + integration tests for the Rove R2-4K "RoveGPS" ssmd extractor.
//
// Fixture bytes are SYNTHETIC, reconstructed from the ExifTool 13.59 field
// map and sentinel hex (QuickTimeStream.pl:330-403) - no real sample exists
// yet (waiver, see internal/rove-ssmd.ts header). The in-test MP4 builder
// mirrors __fixtures__/wolfbox/build-synthetic.mjs (ftyp + moov with one
// meta/ssmd trak + mdat).

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { KNOTS_TO_MS } from "../types.js";
import { buildMp4Index } from "./mp4-index.js";
import {
    decodeRoveSsmdSample,
    findRoveSsmdTrack,
    isNoFixSentinel,
    looksLikeRoveSsmdSample,
    ROVE_SSMD_SAMPLE_SIZE,
} from "./rove-ssmd.js";
import { roveSsmdPrimitive } from "../primitives/rove-ssmd.js";
import { ligoGpsPrimitive } from "../primitives/ligogps.js";
import { wolfboxGpmdPrimitive } from "../primitives/wolfbox-gpmd.js";
import { gpmfPrimitive } from "../primitives/gpmf.js";
import { pndmPrimitive } from "../primitives/pndm.js";
import { rvmiPrimitive } from "../primitives/rvmi.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../..");

// ---------------------------------------------------------------------------
// Byte builders

// One 32-byte RoveGPS sample per QuickTimeStream.pl:367-403 (v13.59).
function roveSample(opts: {
    latDdmm: number;
    lonDdmm: number;
    speedKnots?: number;
    year?: number; // full year, written as year-2000
    month?: number;
    day?: number;
    hour?: number;
    min?: number;
    sec?: number;
    status?: readonly number[]; // bytes 28..31; default "good GPS?" ff 01 01 00
}): Buffer {
    const b = Buffer.alloc(ROVE_SSMD_SAMPLE_SIZE);
    b.writeDoubleLE(opts.latDdmm, 0);
    b.writeDoubleLE(opts.lonDdmm, 8);
    // bytes 16..19 left zero (undefined in the spec)
    b.writeUInt16LE(opts.speedKnots ?? 0, 20);
    b.writeUInt8((opts.year ?? 2026) - 2000, 22);
    b.writeUInt8(opts.month ?? 3, 23);
    b.writeUInt8(opts.day ?? 15, 24);
    b.writeUInt8(opts.hour ?? 17, 25);
    b.writeUInt8(opts.min ?? 39, 26);
    b.writeUInt8(opts.sec ?? 51, 27);
    Buffer.from(opts.status ?? [0xff, 0x01, 0x01, 0x00]).copy(b, 28);
    return b;
}

// No-fix sample: exact sentinel hex from QuickTimeStream.pl:332 for the lat
// double, plus the "no GPS?" status bytes observed by ExifTool.
function sentinelSample(): Buffer {
    const b = Buffer.alloc(ROVE_SSMD_SAMPLE_SIZE);
    Buffer.from([0x00, 0x00, 0xe0, 0xff, 0xff, 0xff, 0xef, 0x41]).copy(b, 0);
    Buffer.from([0xff, 0x00, 0xff, 0xff]).copy(b, 28);
    return b;
}

function dv(buf: Buffer): DataView {
    // Standalone copy: Buffer.alloc may pool, so wrap the exact byte range.
    return new DataView(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}

// Minimal MP4: ftyp + moov(mvhd, trak(hdlr, stsd, stts, stsc, stsz, stco)) +
// mdat. Same skeleton as __fixtures__/wolfbox/build-synthetic.mjs, with
// parametrized handler/format so negative shapes can be built too.
function buildMp4(samples: Buffer[], opts: { handler?: string; format?: string } = {}): Buffer {
    const handler = opts.handler ?? "meta";
    const format = opts.format ?? "ssmd";
    const n = samples.length;

    const fourCC = (s: string) => Buffer.from(s, "ascii");
    const u32be = (v: number) => {
        const b = Buffer.alloc(4);
        b.writeUInt32BE(v, 0);
        return b;
    };
    const box = (type: string, payload: Buffer) => {
        const head = Buffer.alloc(8);
        head.writeUInt32BE(8 + payload.length, 0);
        fourCC(type).copy(head, 4);
        return Buffer.concat([head, payload]);
    };

    const mvhd = (() => {
        const p = Buffer.alloc(108);
        p.writeUInt32BE(1000, 12); // timescale
        p.writeUInt32BE(n * 1000, 16); // duration
        return box("mvhd", p);
    })();

    const hdlr = (() => {
        const p = Buffer.alloc(33);
        fourCC(handler).copy(p, 8);
        return box("hdlr", p);
    })();

    const mdhd = (() => {
        const p = Buffer.alloc(24);
        p.writeUInt32BE(1000, 12);
        p.writeUInt32BE(n * 1000, 16);
        return box("mdhd", p);
    })();

    const stsd = (() => {
        const entry = Buffer.alloc(16);
        entry.writeUInt32BE(16, 0);
        fourCC(format).copy(entry, 4);
        return box("stsd", Buffer.concat([Buffer.alloc(4), u32be(1), entry]));
    })();

    const stts = box("stts", Buffer.concat([Buffer.alloc(4), u32be(1), u32be(n), u32be(1000)]));
    const stsc = box("stsc", Buffer.concat([Buffer.alloc(4), u32be(1), u32be(1), u32be(n), u32be(1)]));
    // Per-entry stsz so mixed-size negative shapes are expressible.
    const stsz = box(
        "stsz",
        Buffer.concat([Buffer.alloc(4), u32be(0), u32be(n), ...samples.map((s) => u32be(s.length))]),
    );
    const stcoPlaceholder = box("stco", Buffer.concat([Buffer.alloc(4), u32be(1), u32be(0)]));

    const stbl = box("stbl", Buffer.concat([stsd, stts, stsc, stsz, stcoPlaceholder]));
    const minf = box("minf", stbl);
    const mdia = box("mdia", Buffer.concat([mdhd, hdlr, minf]));
    const tkhd = (() => {
        const p = Buffer.alloc(84);
        p.writeUInt32BE(7, 0);
        p.writeUInt32BE(1, 12);
        return box("tkhd", p);
    })();
    const trak = box("trak", Buffer.concat([tkhd, mdia]));
    const moov = box("moov", Buffer.concat([mvhd, trak]));
    const ftyp = box("ftyp", Buffer.concat([fourCC("isom"), u32be(512), fourCC("isom"), fourCC("mp41")]));
    const mdat = box("mdat", Buffer.concat(samples));

    // Patch the single chunk offset now that sizes are known.
    const mdatPayloadOffset = ftyp.length + moov.length + 8;
    const stcoPos = moov.indexOf(stcoPlaceholder);
    const moovPatched = Buffer.from(moov);
    moovPatched.writeUInt32BE(mdatPayloadOffset, stcoPos + 8 + 4 + 4);

    return Buffer.concat([ftyp, moovPatched, mdat]);
}

async function loadAsVendorFile(bytes: Buffer, name: string) {
    const file = new File([new Uint8Array(bytes)], name);
    const vf = { file, relativePath: name };
    const index = await buildMp4Index(file);
    return { vf, index };
}

// ---------------------------------------------------------------------------

describe("decodeRoveSsmdSample", () => {
    const NAME = "REC_0001.MP4";

    it("decodes the ExifTool field map (DDmm doubles, knots, +2000 date)", () => {
        // Synthetic DDmm values with fractional minutes - exercises the
        // minutes/60 conversion.
        const rec = decodeRoveSsmdSample(
            dv(roveSample({ latDdmm: 5012.3456, lonDdmm: 3009.8765, speedKnots: 20 })),
            NAME,
        );
        expect(rec).not.toBeNull();
        expect(rec!.lat).toBeCloseTo(50.20576, 6);
        expect(rec!.lon).toBeCloseTo(30.164608333, 6);
        expect(rec!.unixSeconds).toBe(Date.UTC(2026, 2, 15, 17, 39, 51) / 1000);
        expect(rec!.speedMs).toBeCloseTo(20 * KNOTS_TO_MS, 6);
        expect(rec!.active).toBe(true);
        expect(rec!.timeUnsynced).toBeUndefined();
        expect(rec!.mp4Filename).toBe(NAME);
    });

    it("preserves sign for S/W (assumed convention - no hemisphere field found)", () => {
        const rec = decodeRoveSsmdSample(dv(roveSample({ latDdmm: -5012.3456, lonDdmm: -3009.8765 })), NAME);
        expect(rec).not.toBeNull();
        expect(rec!.lat).toBeCloseTo(-50.20576, 6);
        expect(rec!.lon).toBeCloseTo(-30.164608333, 6);
    });

    it("returns null for the no-fix sentinel", () => {
        expect(decodeRoveSsmdSample(dv(sentinelSample()), NAME)).toBeNull();
    });

    it("ignores the advisory status bytes (garbage status still decodes)", () => {
        const rec = decodeRoveSsmdSample(
            dv(roveSample({ latDdmm: 5000, lonDdmm: 3000, status: [0xde, 0xad, 0xbe, 0xef] })),
            NAME,
        );
        expect(rec).not.toBeNull();
        expect(rec!.lat).toBeCloseTo(50, 6);
    });

    it("rejects implausible records", () => {
        // empty fix (zeros)
        expect(decodeRoveSsmdSample(dv(roveSample({ latDdmm: 0, lonDdmm: 0 })), NAME)).toBeNull();
        // out-of-range coordinates after conversion
        expect(decodeRoveSsmdSample(dv(roveSample({ latDdmm: 9100, lonDdmm: 3000 })), NAME)).toBeNull();
        expect(decodeRoveSsmdSample(dv(roveSample({ latDdmm: 5000, lonDdmm: 18100 })), NAME)).toBeNull();
        // NaN double
        expect(decodeRoveSsmdSample(dv(roveSample({ latDdmm: Number.NaN, lonDdmm: 3000 })), NAME)).toBeNull();
        // bad date bytes
        expect(decodeRoveSsmdSample(dv(roveSample({ latDdmm: 5000, lonDdmm: 3000, month: 13 })), NAME)).toBeNull();
        expect(decodeRoveSsmdSample(dv(roveSample({ latDdmm: 5000, lonDdmm: 3000, day: 0 })), NAME)).toBeNull();
        expect(decodeRoveSsmdSample(dv(roveSample({ latDdmm: 5000, lonDdmm: 3000, hour: 24 })), NAME)).toBeNull();
        // wrong sample size
        expect(decodeRoveSsmdSample(new DataView(new ArrayBuffer(12)), NAME)).toBeNull();
    });
});

describe("looksLikeRoveSsmdSample", () => {
    it("accepts the sentinel and a plausible fix", () => {
        expect(looksLikeRoveSsmdSample(dv(sentinelSample()))).toBe(true);
        expect(looksLikeRoveSsmdSample(dv(roveSample({ latDdmm: 5000, lonDdmm: 3000 })))).toBe(true);
        expect(isNoFixSentinel(dv(sentinelSample()))).toBe(true);
    });

    it("rejects all-zero, ASCII junk and out-of-range shapes of the right size", () => {
        expect(looksLikeRoveSsmdSample(new DataView(new ArrayBuffer(32)))).toBe(false);
        const ascii = Buffer.alloc(32);
        Buffer.from("LIGOGPSINFO 2025-06-07 18:06:00!", "ascii").copy(ascii, 0);
        expect(looksLikeRoveSsmdSample(dv(ascii))).toBe(false);
        expect(looksLikeRoveSsmdSample(dv(roveSample({ latDdmm: 9100, lonDdmm: 3000 })))).toBe(false);
        expect(looksLikeRoveSsmdSample(dv(roveSample({ latDdmm: 5000, lonDdmm: 3000, month: 0 })))).toBe(false);
    });

    it("rejects any other sample size", () => {
        expect(looksLikeRoveSsmdSample(new DataView(new ArrayBuffer(12)))).toBe(false);
        expect(looksLikeRoveSsmdSample(new DataView(new ArrayBuffer(64)))).toBe(false);
    });
});

describe("rove-ssmd primitive on a synthetic MP4", () => {
    const NAME = "REC_0001.MP4";

    it("marker fires and parse skips the sentinel lead-in", async () => {
        const bytes = buildMp4([
            sentinelSample(),
            roveSample({ latDdmm: 5000.0, lonDdmm: 3000.0, speedKnots: 20, sec: 51 }),
            roveSample({ latDdmm: 5000.01, lonDdmm: 3000.01, speedKnots: 21, sec: 52 }),
            roveSample({ latDdmm: 5000.02, lonDdmm: 3000.02, speedKnots: 22, sec: 53 }),
        ]);
        const { vf, index } = await loadAsVendorFile(bytes, NAME);

        expect(await roveSsmdPrimitive.marker(vf, index)).toBe(true);
        const result = await roveSsmdPrimitive.parse(vf, index);
        expect(result.records).toHaveLength(3);
        expect(result.skipped).toHaveLength(0); // sentinel skip is silent

        const r0 = result.records[0]!;
        expect(r0.lat).toBeCloseTo(50.0, 6);
        expect(r0.lon).toBeCloseTo(30.0, 6);
        expect(r0.unixSeconds).toBe(Date.UTC(2026, 2, 15, 17, 39, 51) / 1000);
        expect(r0.speedMs).toBeCloseTo(20 * KNOTS_TO_MS, 6);
        expect(result.records[2]!.unixSeconds - r0.unixSeconds).toBe(2);
    });

    it("sentinel-only track parses to empty records (format matched, no GPS)", async () => {
        const bytes = buildMp4([sentinelSample(), sentinelSample(), sentinelSample()]);
        const { vf, index } = await loadAsVendorFile(bytes, NAME);
        expect(await roveSsmdPrimitive.marker(vf, index)).toBe(true);
        const result = await roveSsmdPrimitive.parse(vf, index);
        expect(result.records).toHaveLength(0);
    });

    it("existing primitives do not claim the rove fixture", async () => {
        const bytes = buildMp4([sentinelSample(), roveSample({ latDdmm: 5000, lonDdmm: 3000 })]);
        const { vf, index } = await loadAsVendorFile(bytes, NAME);

        expect(await ligoGpsPrimitive.marker(vf, index)).toBe(false);
        expect(await wolfboxGpmdPrimitive.marker(vf, index)).toBe(false);
        expect(await gpmfPrimitive.marker(vf, index)).toBe(false);
        expect(await pndmPrimitive.marker(vf, index)).toBe(false);
        expect(await rvmiPrimitive.marker(vf, index)).toBe(false);
    });
});

describe("rove-ssmd negative matrix (must not claim other formats)", () => {
    it("does not match the 12-byte ssmd accelerometer track (QuickTimeStream.pl:339-343)", async () => {
        const accel = Buffer.alloc(12);
        accel.writeFloatLE(0.01, 0);
        accel.writeFloatLE(-0.02, 4);
        accel.writeFloatLE(0.98, 8);
        const { vf, index } = await loadAsVendorFile(buildMp4([accel, accel, accel]), "REC_0002.MP4");
        expect(findRoveSsmdTrack(index)).toBeNull();
        expect(await roveSsmdPrimitive.marker(vf, index)).toBe(false);
    });

    it("does not match a mixed-size ssmd track (constant-32 gate)", async () => {
        const bytes = buildMp4([roveSample({ latDdmm: 5000, lonDdmm: 3000 }), Buffer.alloc(64)]);
        const { vf, index } = await loadAsVendorFile(bytes, "REC_0003.MP4");
        expect(await roveSsmdPrimitive.marker(vf, index)).toBe(false);
    });

    it("does not match a 32-byte ssmd track with an implausible first sample", async () => {
        const junk = Buffer.alloc(32, 0x41); // "AAAA..." - doubles way out of range
        const { vf, index } = await loadAsVendorFile(buildMp4([junk, junk]), "REC_0004.MP4");
        expect(await roveSsmdPrimitive.marker(vf, index)).toBe(false);
    });

    it("does not match a 32-byte sample track outside meta/ssmd", async () => {
        const sample = roveSample({ latDdmm: 5000, lonDdmm: 3000 });
        const wrongFormat = await loadAsVendorFile(buildMp4([sample], { format: "gpmd" }), "REC_0005.MP4");
        expect(await roveSsmdPrimitive.marker(wrongFormat.vf, wrongFormat.index)).toBe(false);
        const wrongHandler = await loadAsVendorFile(buildMp4([sample], { handler: "sbtl" }), "REC_0006.MP4");
        expect(await roveSsmdPrimitive.marker(wrongHandler.vf, wrongHandler.index)).toBe(false);
    });

    it("does not match the synthetic LigoGPS ssmd fixture", async () => {
        const buf = readFileSync(resolve(HERE, "../__fixtures__/ligogps/synthetic-ligogps.mp4"));
        const { vf, index } = await loadAsVendorFile(buf, "synthetic-ligogps.mp4");
        expect(findRoveSsmdTrack(index)).toBeNull();
        expect(await roveSsmdPrimitive.marker(vf, index)).toBe(false);
    });

    it("does not match the real-anonymized CarCam ssmd fixture", async () => {
        const buf = readFileSync(resolve(REPO_ROOT, "tests/testdata/carcam-real-anonymized/carcam-4ch-front.mp4"));
        const { vf, index } = await loadAsVendorFile(buf, "REC20250607-180600-001-A.mp4");
        expect(findRoveSsmdTrack(index)).toBeNull();
        expect(await roveSsmdPrimitive.marker(vf, index)).toBe(false);
    });

    it("does not match the wolfbox gpmd fixtures", async () => {
        for (const fixture of ["synthetic-wolfbox-b.mp4", "synthetic-wolfbox-a.mp4"]) {
            const buf = readFileSync(resolve(HERE, `../__fixtures__/wolfbox/${fixture}`));
            const { vf, index } = await loadAsVendorFile(buf, fixture);
            expect(findRoveSsmdTrack(index)).toBeNull();
            expect(await roveSsmdPrimitive.marker(vf, index)).toBe(false);
        }
    });
});
