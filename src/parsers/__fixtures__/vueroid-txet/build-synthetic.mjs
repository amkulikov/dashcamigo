#!/usr/bin/env node
// Builder for the synthetic Vueroid TXET fixtures (sentinel coords around
// 50N/30E, field map per internal/vueroid-txet-extract.ts):
//   synthetic-happy.mp4        - 5 clean N/E fixes + the zeroed terminator
//                                row real firmware writes as the last sample
//   synthetic-edge.mp4         - mid-file zero row, all four hemisphere
//                                combos, minutes>=60, lon>180, junk flag
//                                byte, out-of-century clock, NaN speed,
//                                negative raw latitude
//   synthetic-wrong-format.mp4 - structurally identical track (tvxt/mp4s,
//                                constant 72-byte samples) with ASCII junk
//
// MP4 skeleton mirrors sstar-ssmd/build-synthetic.mjs: ftyp + moov(mvhd,
// trak with hdlr='tvxt' and stsd format 'mp4s') + mdat with N fixed-size
// samples. The tvxt media timescale is 1000 like the real firmware; the
// happy fixture uses 500 ms sample spacing with the 1 Hz clock field
// advancing every other row - pins the media-time-derived fractional
// timestamps without needing 20 rows per second.

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

const SAMPLE_SIZE = 72;
// 2026-03-15T10:00:00 camera-local written as fake-UTC unix (the real
// firmware stores local wall-clock; see the extractor header).
const BASE_LOCAL_UNIX = Date.UTC(2026, 2, 15, 10, 0, 0) / 1000;

// Decimal degrees -> NMEA DDmm.mmmm.
function degToDdmm(deg) {
    const whole = Math.floor(deg);
    return whole * 100 + (deg - whole) * 60;
}

// One 72-byte row. lat/lon are UNSIGNED decimal degrees; hemispheres come
// from the flag pair like the real layout.
function row({ latDeg, lonDeg, north = 1, east = 1, altM = 55, speedKmh = 27, unix = BASE_LOCAL_UNIX, ax = 0.6, ay = 0.0, az = 0.2, rawLatDdmm = null, rawLonDdmm = null, rawSpeedBits = null }) {
    const b = Buffer.alloc(SAMPLE_SIZE);
    b.writeFloatLE(ax, 0x28);
    b.writeFloatLE(ay, 0x2c);
    b.writeFloatLE(az, 0x30);
    b.writeUInt8(north, 0x34);
    b.writeUInt8(east, 0x35);
    b.writeUInt16LE(altM, 0x36);
    if (rawSpeedBits !== null) b.writeUInt32LE(rawSpeedBits, 0x38);
    else b.writeFloatLE(speedKmh, 0x38);
    b.writeFloatLE(rawLatDdmm ?? degToDdmm(latDeg), 0x3c);
    b.writeFloatLE(rawLonDdmm ?? degToDdmm(lonDeg), 0x40);
    b.writeUInt32LE(unix, 0x44);
    return b;
}

// The zeroed row: no-fix, and what the real firmware writes as the final
// sample of every clip.
function zeroRow() { return Buffer.alloc(SAMPLE_SIZE); }

function buildMp4(samples, tickDeltaMs) {
    const n = samples.length;

    const mvhd = (() => {
        const p = Buffer.alloc(108);
        p.writeUInt32BE(1000, 12); // timescale
        p.writeUInt32BE(n * tickDeltaMs, 16); // duration
        return box("mvhd", p);
    })();

    const hdlr = (() => {
        const p = Buffer.alloc(33);
        fourCC("tvxt").copy(p, 8); // handler_type - the structural gate
        return box("hdlr", p);
    })();

    const mdhd = (() => {
        const p = Buffer.alloc(24);
        p.writeUInt32BE(1000, 12); // timescale - matches the real track
        p.writeUInt32BE(n * tickDeltaMs, 16);
        return box("mdhd", p);
    })();

    const stsd = (() => {
        const entry = Buffer.alloc(16);
        entry.writeUInt32BE(16, 0);
        fourCC("mp4s").copy(entry, 4);
        return box("stsd", Buffer.concat([Buffer.alloc(4), u32be(1), entry]));
    })();

    const stts = box("stts", Buffer.concat([Buffer.alloc(4), u32be(1), u32be(n), u32be(tickDeltaMs)]));
    const stsc = box("stsc", Buffer.concat([Buffer.alloc(4), u32be(1), u32be(1), u32be(n), u32be(1)]));
    // Header-fixed stsz (sample_size = 72) like the real firmware writes.
    const stsz = box("stsz", Buffer.concat([Buffer.alloc(4), u32be(SAMPLE_SIZE), u32be(n)]));
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
        p.writeUInt32BE(n * tickDeltaMs, 20);
        return box("tkhd", p);
    })();

    const trak = box("trak", Buffer.concat([tkhd, mdia]));
    const moov = box("moov", Buffer.concat([mvhd, trak]));
    const ftyp = box("ftyp", Buffer.concat([fourCC("mp41"), u32be(1), fourCC("isom"), fourCC("avc1"), fourCC("mp41")]));
    const mdat = box("mdat", Buffer.concat(samples));

    // Patch the single chunk offset now that sizes are known.
    const mdatStartOffset = ftyp.length + moov.length + 8;
    const stcoPos = moov.indexOf(stcoPlaceholder);
    const moovPatched = Buffer.from(moov);
    moovPatched.writeUInt32BE(mdatStartOffset, stcoPos + 8 + 4 + 4);

    return Buffer.concat([ftyp, moovPatched, mdat]);
}

// Happy path: N/E fixes 500 ms apart, clock advancing at 1 Hz (every other
// row shares a second like the real 20 Hz stream does), accel with a static
// bias (0.6, 0, 0.2) plus a small dynamic wobble on axis A, then the zeroed
// terminator row.
const happy = buildMp4(
    [
        row({ latDeg: 50.0, lonDeg: 30.0, speedKmh: 27, unix: BASE_LOCAL_UNIX, ax: 0.55, altM: 55 }),
        row({ latDeg: 50.0001, lonDeg: 30.0001, speedKmh: 28, unix: BASE_LOCAL_UNIX, ax: 0.65, altM: 55 }),
        row({ latDeg: 50.0002, lonDeg: 30.0002, speedKmh: 29, unix: BASE_LOCAL_UNIX + 1, ax: 0.6, altM: 56 }),
        row({ latDeg: 50.0003, lonDeg: 30.0003, speedKmh: 30, unix: BASE_LOCAL_UNIX + 1, ax: 0.6, altM: 56 }),
        row({ latDeg: 50.0004, lonDeg: 30.0004, speedKmh: 31, unix: BASE_LOCAL_UNIX + 2, ax: 0.6, altM: 56 }),
        zeroRow(),
    ],
    500,
);

// Edge cases:
//   [0] zeroed row mid-file (no-fix) - silent skip
//   [1] N/W fix   [2] S/E fix   [3] S/W fix - hemisphere combos
//   [4] minutes >= 60 in lat (50 deg 75 min) - skipped
//   [5] lon > 180 after conversion (181.5 deg) - skipped
//   [6] flag byte 2 - skipped
//   [7] clock before 2000 - skipped
//   [8] NaN speed - skipped
//   [9] negative raw lat - skipped
const edge = buildMp4(
    [
        zeroRow(),
        row({ latDeg: 50.0, lonDeg: 30.0, north: 1, east: 0, unix: BASE_LOCAL_UNIX }),
        row({ latDeg: 50.0001, lonDeg: 30.0001, north: 0, east: 1, unix: BASE_LOCAL_UNIX + 1 }),
        row({ latDeg: 50.0002, lonDeg: 30.0002, north: 0, east: 0, unix: BASE_LOCAL_UNIX + 1 }),
        row({ latDeg: 50.0, lonDeg: 30.0, rawLatDdmm: 5075.0, unix: BASE_LOCAL_UNIX + 2 }),
        row({ latDeg: 50.0, lonDeg: 30.0, rawLonDdmm: 18130.0, unix: BASE_LOCAL_UNIX + 2 }),
        row({ latDeg: 50.0, lonDeg: 30.0, north: 2, unix: BASE_LOCAL_UNIX + 3 }),
        row({ latDeg: 50.0, lonDeg: 30.0, unix: 100 }),
        row({ latDeg: 50.0, lonDeg: 30.0, rawSpeedBits: 0x7fc00000, unix: BASE_LOCAL_UNIX + 3 }),
        row({ latDeg: 50.0, lonDeg: 30.0, rawLatDdmm: -5000.0, unix: BASE_LOCAL_UNIX + 4 }),
    ],
    500,
);

// Wrong format: right structure (tvxt/mp4s, constant 72-byte samples), but
// ASCII content - the hemisphere flag bytes read 0x41 and every row fails
// plausibility, with no zeroed rows to excuse it.
const junkRow = Buffer.alloc(SAMPLE_SIZE, 0x41);
const wrongFormat = buildMp4([junkRow, Buffer.from(junkRow), Buffer.from(junkRow)], 500);

const __dirname = dirname(fileURLToPath(import.meta.url));
writeFileSync(resolve(__dirname, "synthetic-happy.mp4"), happy);
writeFileSync(resolve(__dirname, "synthetic-edge.mp4"), edge);
writeFileSync(resolve(__dirname, "synthetic-wrong-format.mp4"), wrongFormat);
console.error(`wrote ${happy.length} + ${edge.length} + ${wrongFormat.length} bytes`);
