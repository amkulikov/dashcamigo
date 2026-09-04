#!/usr/bin/env node
// Builder for the synthetic SStar ssmd fixtures (sentinel coords 50.0N/30.0E,
// field map per internal/sstar-ssmd-extract.ts):
//   synthetic-happy.mp4        - no-fix lead-in + 5 clean fixes
//   synthetic-edge.mp4         - rollover day byte, bad day byte, 0xFFFF speed,
//                                out-of-range latitude, no-fix rows
//   synthetic-wrong-format.mp4 - structurally identical track (meta/ssmd,
//                                constant 40-byte samples) with foreign content
//   synthetic-ktrx-happy.mp4   - 56-byte iZEEKER KTRX rows
//   synthetic-ktrx-edge.mp4    - valid marker plus corrupt KTRX rows
//   synthetic-ktrx-wrong-format.mp4 - constant 56-byte foreign content
//
// MP4 skeleton mirrors wolfbox/build-synthetic.mjs: ftyp + moov(mvhd, trak
// with hdlr='meta' and stsd format 'ssmd') + mdat with N fixed-size samples.
// mvhd creation_time is 0 like the real firmware writes - the extractor must
// take its date anchor from the filename the test supplies.

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

const FLAGS_FIX = 0x057e;
const FLAGS_NO_FIX = 0x047e;
const SENTINEL = Buffer.from([0x00, 0x00, 0xe0, 0xff, 0xff, 0xff, 0xef, 0x41]);
const KTRX_FLAGS_FIX = 0x087e;
const KTRX_FACTORS = [
    15, 25, 36, 63, 82, 13, 12, 15, 21, 31, 21, 57, 16, 29, 47,
    26, 42, 26, 26, 12, 65, 28, 12, 26, 46, 24, 29, 25, 54, 23,
    87, 12, 46, 48, 35, 37, 68, 12, 24, 46, 76, 55, 26, 28, 67,
    24, 43, 46, 68, 87, 23, 56, 78, 34, 16, 48, 27, 81, 53, 82,
];

// One 40-byte fix row. Defaults mimic a real fix (alt-like word, constant
// 01 01 00 at +29, tail flag 1). courseDeg is stored as deg/2 at +28 - keep
// it even so the round-trip is exact.
function fixSample({ lat, lon, speedKmh = 20, day, hour, min, sec, altRaw = 300, courseDeg = 128 }) {
    const b = Buffer.alloc(40);
    b.writeDoubleLE(lat, 0);
    b.writeDoubleLE(lon, 8);
    b.writeInt32LE(altRaw, 16);
    b.writeUInt16LE(speedKmh, 20);
    b.writeUInt16LE(FLAGS_FIX, 22);
    b.writeUInt8(day, 24);
    b.writeUInt8(hour, 25);
    b.writeUInt8(min, 26);
    b.writeUInt8(sec, 27);
    Buffer.from([courseDeg / 2, 0x01, 0x01, 0x00]).copy(b, 28);
    b.writeUInt32LE(1, 32);
    return b;
}

// One 40-byte no-fix row: coordinate sentinels, 0xFFFF fillers, local-RTC
// time bytes (deliberately shifted +3 h from the fixes - the extractor must
// never read them).
function noFixSample({ day, hour, min, sec }) {
    const b = Buffer.alloc(40);
    SENTINEL.copy(b, 0);
    SENTINEL.copy(b, 8);
    b.writeInt32LE(-1, 16);
    b.writeUInt16LE(0xffff, 20);
    b.writeUInt16LE(FLAGS_NO_FIX, 22);
    b.writeUInt8(day, 24);
    b.writeUInt8(hour, 25);
    b.writeUInt8(min, 26);
    b.writeUInt8(sec, 27);
    Buffer.from([0xff, 0x00, 0xff, 0xff]).copy(b, 28);
    b.writeUInt32LE(1, 32);
    return b;
}

function ktrxFixSample({ lat, lon, speedKmh = 20, day, hour, min, sec, courseDeg = 128 }) {
    const b = Buffer.alloc(56);
    b.writeDoubleLE(lat * KTRX_FACTORS[sec] / 10 + 114.712, 0);
    b.writeDoubleLE(lon * KTRX_FACTORS[min] / 10 + 224.222, 8);
    b.writeInt32LE(300, 16);
    b.writeUInt16LE(speedKmh, 20);
    b.writeUInt16LE(KTRX_FLAGS_FIX, 22);
    b.writeUInt8(day, 24);
    b.writeUInt8(hour, 25);
    b.writeUInt8(min, 26);
    b.writeUInt8(sec, 27);
    Buffer.from([courseDeg / 2, 0x01, 0x01, 0x00]).copy(b, 28);
    Buffer.from("0000000000000000KTRX", "ascii").copy(b, 32);
    Buffer.from(`${String(hour).padStart(2, "0")}${String(min).padStart(2, "0")}`, "ascii").copy(b, 52);
    return b;
}

function buildMp4(samples) {
    const n = samples.length;
    const sampleSize = samples[0].length;
    if (!samples.every((sample) => sample.length === sampleSize)) throw new Error("mixed sample sizes");

    const mvhd = (() => {
        const p = Buffer.alloc(108);
        // creation/modification left 0 - matches the real firmware.
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
        p.writeUInt32BE(90000, 12); // timescale (matches the real tracks)
        p.writeUInt32BE(n * 90000, 16);
        return box("mdhd", p);
    })();

    const stsd = (() => {
        const entry = Buffer.alloc(16);
        entry.writeUInt32BE(16, 0);
        fourCC("ssmd").copy(entry, 4);
        return box("stsd", Buffer.concat([Buffer.alloc(4), u32be(1), entry]));
    })();

    const stts = box("stts", Buffer.concat([Buffer.alloc(4), u32be(1), u32be(n), u32be(90000)]));
    const stsc = box("stsc", Buffer.concat([Buffer.alloc(4), u32be(1), u32be(1), u32be(n), u32be(1)]));
    // Header-fixed stsz like the real firmware writes.
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
        p.writeUInt32BE(1, 12); // track_id
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

// Happy path: filename anchor 2026-03-15 local; fixes at 17:39:51..55 UTC on
// the 15th; a no-fix lead-in with RTC-local time bytes (+3 h).
const happy = buildMp4([
    noFixSample({ day: 15, hour: 20, min: 39, sec: 50 }),
    fixSample({ lat: 50.0, lon: 30.0, speedKmh: 20, courseDeg: 76, day: 15, hour: 17, min: 39, sec: 51 }),
    fixSample({ lat: 50.0001, lon: 30.0001, speedKmh: 21, courseDeg: 76, day: 15, hour: 17, min: 39, sec: 52 }),
    fixSample({ lat: 50.0002, lon: 30.0002, speedKmh: 22, courseDeg: 78, day: 15, hour: 17, min: 39, sec: 53 }),
    fixSample({ lat: 50.0003, lon: 30.0003, speedKmh: 23, courseDeg: 78, day: 15, hour: 17, min: 39, sec: 54 }),
    // Course 0 on a moving row - the firmware's "not updated" case.
    fixSample({ lat: 50.0004, lon: 30.0004, speedKmh: 24, courseDeg: 0, day: 15, hour: 17, min: 39, sec: 55 }),
]);

// Edge cases, meant to be loaded as INF20260301-001005-2-F.mp4 (local anchor
// March 1st, 2026):
//   [0] no-fix row
//   [1,2] fixes on UTC day 28 -> anchor-1 -> February 28th (month rollover)
//   [3] fix with day byte 15 - matches no anchor candidate -> skipped
//   [4] fix with 0xFFFF speed -> decoded, speedMs 0
//   [5] fix with lat 95 - out of range -> skipped
const edge = buildMp4([
    noFixSample({ day: 1, hour: 0, min: 10, sec: 4 }),
    fixSample({ lat: 50.0, lon: 30.0, speedKmh: 20, day: 28, hour: 21, min: 10, sec: 5 }),
    fixSample({ lat: 50.0001, lon: 30.0001, speedKmh: 21, day: 28, hour: 21, min: 10, sec: 6 }),
    fixSample({ lat: 50.0002, lon: 30.0002, speedKmh: 22, day: 15, hour: 21, min: 10, sec: 7 }),
    fixSample({ lat: 50.0003, lon: 30.0003, speedKmh: 0xffff, day: 28, hour: 21, min: 10, sec: 8 }),
    fixSample({ lat: 95.0, lon: 30.0004, speedKmh: 24, day: 28, hour: 21, min: 10, sec: 9 }),
]);

// Wrong format: right structure (meta/ssmd, constant 40-byte samples), but
// the content is ASCII junk - flags word never matches.
const junkRow = Buffer.alloc(40);
Buffer.from("LIGOGPSINFO 2026-03-15 17:39:51 junk....", "ascii").copy(junkRow, 0);
const wrongFormat = buildMp4([junkRow, Buffer.from(junkRow), Buffer.from(junkRow)]);

// KTRX happy path: filename-local 23:19:22, GPS UTC 21:19:22 -> exact UTC+2
// grid. Five records exercise the changing second-indexed latitude factor.
const ktrxHappyRows = Array.from({ length: 5 }, (_, i) => ktrxFixSample({
    lat: 50 + i * 0.0001,
    lon: 30 + i * 0.0001,
    speedKmh: 40 + i,
    courseDeg: i === 4 ? 0 : 76 + Math.floor(i / 2) * 2,
    day: 2,
    hour: 21,
    min: 19,
    sec: 22 + i,
}));
const ktrxHappy = buildMp4(ktrxHappyRows);

// KTRX edge path: the first row keeps marker detection positive; later rows
// cover a foreign flags word, a broken KTRX tag and an out-of-range decode.
const ktrxBadFlags = ktrxFixSample({ lat: 50.0001, lon: 30.0001, day: 2, hour: 21, min: 19, sec: 23 });
ktrxBadFlags.writeUInt16LE(0x0000, 22);
const ktrxBadTag = ktrxFixSample({ lat: 50.0002, lon: 30.0002, day: 2, hour: 21, min: 19, sec: 24 });
Buffer.from("NOPE", "ascii").copy(ktrxBadTag, 48);
const ktrxBadLat = ktrxFixSample({ lat: 95, lon: 30.0003, day: 2, hour: 21, min: 19, sec: 25 });
const ktrxEdge = buildMp4([
    ktrxFixSample({ lat: 50, lon: 30, day: 2, hour: 21, min: 19, sec: 22 }),
    ktrxBadFlags,
    ktrxBadTag,
    ktrxBadLat,
]);

const ktrxJunkRow = Buffer.alloc(56, 0x5a);
const ktrxWrongFormat = buildMp4([ktrxJunkRow, Buffer.from(ktrxJunkRow)]);

const __dirname = dirname(fileURLToPath(import.meta.url));
writeFileSync(resolve(__dirname, "synthetic-happy.mp4"), happy);
writeFileSync(resolve(__dirname, "synthetic-edge.mp4"), edge);
writeFileSync(resolve(__dirname, "synthetic-wrong-format.mp4"), wrongFormat);
writeFileSync(resolve(__dirname, "synthetic-ktrx-happy.mp4"), ktrxHappy);
writeFileSync(resolve(__dirname, "synthetic-ktrx-edge.mp4"), ktrxEdge);
writeFileSync(resolve(__dirname, "synthetic-ktrx-wrong-format.mp4"), ktrxWrongFormat);
console.error(
    `wrote ${happy.length} + ${edge.length} + ${wrongFormat.length} + ` +
    `${ktrxHappy.length} + ${ktrxEdge.length} + ${ktrxWrongFormat.length} bytes`,
);
