#!/usr/bin/env node
// Builder for two minimal MP4s with a Wolfbox-family `gpmd` meta-track, one
// per known struct layout (see internal/wolfbox-gpmd.ts):
//   synthetic-wolfbox-b.mp4 - "block2" layout (ExifTool ProcessWolfbox,
//                             Wolfbox G900 / Redtiger F9 4K), 0xf8-byte samples
//   synthetic-wolfbox-a.mp4 - "block1"/ShenShu layout (trip-viewer, 2026
//                             3-channel Wolfbox), 1000-byte samples, no date
// Both are SYNTHETIC (sentinel coords 50.0N/30.0E) - built from the byte
// specs, not from a real recording; the hard rule waiver is documented in
// docs/gps-format-coverage.md.
//
// MP4 skeleton mirrors garmin/build-synthetic.mjs: ftyp + moov(mvhd, trak
// with hdlr='meta' and stsd format 'gpmd') + mdat with N fixed-size samples.

import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function fourCC(s) { return Buffer.from(s, "ascii"); }
function box(type, payload) {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(8 + payload.length, 0);
    fourCC(type).copy(head, 4);
    return Buffer.concat([head, payload]);
}
function u32be(n) { const b = Buffer.alloc(4); b.writeUInt32BE(n, 0); return b; }

// 1904-epoch creation time, value irrelevant for these tests.
const CREATION_TIME = 3851323200;

// value/scale int64 LE pair at a fixed offset.
function writePair(buf, off, value, scale) {
    buf.writeBigInt64LE(BigInt(value), off);
    buf.writeBigInt64LE(BigInt(scale), off + 8);
}

// Variant B sample: 0xf8 bytes. Coords as signed NMEA ddmm * 1e5.
function sampleB({ latDdmm, lonDdmm, speedKnots, dirDeg, day, month, year, hour, min, sec }) {
    const b = Buffer.alloc(0xf8);
    writePair(b, 0x48, Math.round(speedKnots * 100), 100);
    writePair(b, 0x58, Math.round(dirDeg * 100), 100);
    b.writeUInt32LE(day, 0x68);
    b.writeUInt32LE(month, 0x6c);
    b.writeUInt32LE(year, 0x70);
    b.writeUInt32LE(hour, 0xa0);
    b.writeUInt32LE(min, 0xa4);
    b.writeUInt32LE(sec, 0xa8);
    writePair(b, 0xb0, Math.round(latDdmm * 1e5), 1e5);
    writePair(b, 0xc0, Math.round(lonDdmm * 1e5), 1e5);
    return b;
}

// Variant A sample: 1000 bytes, status flag, h/m/s clock, no date.
function sampleA({ status, latDdmm, lonDdmm, speedKnots, dirDeg, hour, min, sec }) {
    const b = Buffer.alloc(1000);
    b.writeInt32LE(status, 0x00);
    b.writeUInt32LE(hour, 0x10);
    b.writeUInt32LE(min, 0x14);
    b.writeUInt32LE(sec, 0x18);
    writePair(b, 0x28, Math.round(latDdmm * 1e5), 1e5);
    writePair(b, 0x38, Math.round(lonDdmm * 1e5), 1e5);
    writePair(b, 0x48, Math.round(speedKnots * 100), 100);
    writePair(b, 0x58, Math.round(dirDeg * 100), 100);
    return b;
}

function buildMp4(samples, sampleSize) {
    const n = samples.length;

    const mvhd = (() => {
        const p = Buffer.alloc(108);
        p.writeUInt32BE(CREATION_TIME, 4);
        p.writeUInt32BE(CREATION_TIME, 8);
        p.writeUInt32BE(1000, 12); // timescale
        p.writeUInt32BE(n * 1000, 16); // duration
        return box("mvhd", p);
    })();

    const hdlr = (() => {
        const p = Buffer.alloc(33);
        fourCC("meta").copy(p, 8); // handler_type
        return box("hdlr", p);
    })();

    const mdhd = (() => {
        const p = Buffer.alloc(24);
        p.writeUInt32BE(CREATION_TIME, 4);
        p.writeUInt32BE(CREATION_TIME, 8);
        p.writeUInt32BE(1000, 12);
        p.writeUInt32BE(n * 1000, 16);
        return box("mdhd", p);
    })();

    const stsd = (() => {
        const entry = Buffer.alloc(16);
        entry.writeUInt32BE(16, 0);
        fourCC("gpmd").copy(entry, 4);
        return box("stsd", Buffer.concat([Buffer.alloc(4), u32be(1), entry]));
    })();

    // stts deliberately claims 5 Hz (sample_delta 200 at timescale 1000) for
    // variant A realism - the ShenShu track header lies about the rate and
    // the parser must not trust it. Harmless for variant B (full UTC per
    // sample).
    const stts = box("stts", Buffer.concat([Buffer.alloc(4), u32be(1), u32be(n), u32be(200)]));
    const stsc = box("stsc", Buffer.concat([Buffer.alloc(4), u32be(1), u32be(1), u32be(n), u32be(1)]));
    const stsz = box("stsz", Buffer.concat([Buffer.alloc(4), u32be(sampleSize), u32be(n)]));
    const stcoPlaceholder = box("stco", Buffer.concat([Buffer.alloc(4), u32be(1), u32be(0)]));

    const dinf = box(
        "dinf",
        box("dref", Buffer.concat([Buffer.alloc(4), u32be(1), u32be(12), fourCC("url "), Buffer.from([0, 0, 0, 1])])),
    );
    const stbl = box("stbl", Buffer.concat([stsd, stts, stsc, stsz, stcoPlaceholder]));
    const minf = box("minf", Buffer.concat([dinf, stbl]));
    const mdia = box("mdia", Buffer.concat([mdhd, hdlr, minf]));

    const tkhd = (() => {
        const p = Buffer.alloc(84);
        p.writeUInt32BE(7, 0);
        p.writeUInt32BE(CREATION_TIME, 4);
        p.writeUInt32BE(CREATION_TIME, 8);
        p.writeUInt32BE(1, 12);
        p.writeUInt32BE(n * 1000, 20);
        return box("tkhd", p);
    })();

    const trak = box("trak", Buffer.concat([tkhd, mdia]));
    const moov = box("moov", Buffer.concat([mvhd, trak]));
    const ftyp = box("ftyp", Buffer.concat([fourCC("isom"), u32be(512), fourCC("isom"), fourCC("mp41")]));
    const mdat = box("mdat", Buffer.concat(samples));

    // Patch the single chunk offset now that sizes are known.
    const mdatStartOffset = ftyp.length + moov.length + 8;
    const stcoPos = moov.indexOf(stcoPlaceholder);
    const moovPatched = Buffer.from(moov);
    moovPatched.writeUInt32BE(mdatStartOffset, stcoPos + 8 + 4 + 4);

    return Buffer.concat([ftyp, moovPatched, mdat]);
}

// Sentinel track: 50.0N/30.0E drifting north-east, 20 -> 22 knots, course 92 deg.
const COMMON = { latDdmm: 5000.0, lonDdmm: 3000.0, speedKnots: 20, dirDeg: 92 };

const fileB = buildMp4(
    [
        sampleB({ ...COMMON, day: 15, month: 3, year: 2026, hour: 17, min: 39, sec: 51 }),
        sampleB({ ...COMMON, latDdmm: 5000.01, lonDdmm: 3000.01, speedKnots: 21, day: 15, month: 3, year: 2026, hour: 17, min: 39, sec: 52 }),
        sampleB({ ...COMMON, latDdmm: 5000.02, lonDdmm: 3000.02, speedKnots: 22, day: 15, month: 3, year: 2026, hour: 17, min: 39, sec: 53 }),
    ],
    0xf8,
);

// Variant A: a no-fix lead-in sample (status 0, unsynced 0:0:0 clock) before
// three fixes whose clock skips a second between samples 2 and 3 - exercises
// the "anchor on first fix" and "clock over index" paths.
const fileA = buildMp4(
    [
        sampleA({ status: 0, latDdmm: 0, lonDdmm: 0, speedKnots: 0, dirDeg: 0, hour: 0, min: 0, sec: 0 }),
        sampleA({ ...COMMON, status: 1, hour: 17, min: 39, sec: 51 }),
        sampleA({ ...COMMON, status: 1, latDdmm: 5000.01, lonDdmm: 3000.01, speedKnots: 21, hour: 17, min: 39, sec: 52 }),
        sampleA({ ...COMMON, status: 1, latDdmm: 5000.02, lonDdmm: 3000.02, speedKnots: 22, hour: 17, min: 39, sec: 54 }),
    ],
    1000,
);

const __dirname = dirname(fileURLToPath(import.meta.url));
writeFileSync(resolve(__dirname, "synthetic-wolfbox-b.mp4"), fileB);
writeFileSync(resolve(__dirname, "synthetic-wolfbox-a.mp4"), fileA);
console.error(`wrote ${fileB.length} + ${fileA.length} bytes`);
