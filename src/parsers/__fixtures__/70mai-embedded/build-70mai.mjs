#!/usr/bin/env node
// Builder for a minimal MP4 carrying 70mai-dialect freeGPS blocks (the layout
// newer 4K 70mai models - A810, M500 - embed instead of the $V02 CSV sidecar).
// The block header bytes mirror a real A810 block so the parser's signature
// check (u16@8 == u16@14, u16@10 == 0, 'A' at 26) exercises the real path.
//
// Coordinates are sentinel-anonymized: 50.0 N / 30.0 E (Baltic Sea, not PII),
// drifting ~50 m per fix. Each fix is written 3x in a row to reproduce the
// per-frame repeats the real firmware emits; finalize70maiRecords collapses
// them. One trailing 'V' (void) block checks the no-fix skip.
//
// Block layout (offsets from the `freeGPS ` magic):
//   [8..9] tag, [10..11]=0, [12..13]=type, [14..15]=tag mirror,
//   [16..25] opaque filler, [26] 'A'/'V', [27..30] lat ddmm.mmmm*1e5 i32 LE,
//   [31..34] lon ddmm.mmmm*1e5 i32 LE, [35..38] heading i32 LE,
//   [39..42] speed km/h i32 LE.
//
// Run: node src/parsers/__fixtures__/70mai-embedded/build-70mai.mjs

import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Decimal degrees -> the firmware's int32: NMEA ddmm.mmmm * 1e5, sign = hemisphere.
function encodeDdmm(degrees) {
    const abs = Math.abs(degrees);
    const dd = Math.floor(abs);
    const minutes = (abs - dd) * 60;
    return Math.round(Math.sign(degrees) * (dd * 100 + minutes) * 1e5);
}

function fourCC(s) {
    return Buffer.from(s, "ascii");
}
function box(type, payload) {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(8 + payload.length, 0);
    fourCC(type).copy(head, 4);
    return Buffer.concat([head, payload]);
}
function u32be(n) {
    const b = Buffer.alloc(4);
    b.writeUInt32BE(n, 0);
    return b;
}

const FILLER = Buffer.from([0x00, 0x00, 0x00, 0x0f, 0x00, 0x00, 0x70, 0x08, 0x00, 0x00]);

function build70maiBlock({ latDeg, lonDeg, heading, speedKmh = 0, active = true }) {
    const b = Buffer.alloc(256);
    b.write("freeGPS ", 0, 8, "ascii");
    b.writeUInt16LE(0x01ed, 8); // tag
    b.writeUInt16LE(0x0000, 10); // signature zero
    b.writeUInt16LE(0x0003, 12); // type
    b.writeUInt16LE(0x01ed, 14); // tag mirror (== offset 8)
    FILLER.copy(b, 16);
    b.writeUInt8(active ? 0x41 : 0x56, 26); // 'A' / 'V'
    b.writeInt32LE(encodeDdmm(latDeg), 27);
    b.writeInt32LE(encodeDdmm(lonDeg), 31);
    b.writeInt32LE(heading, 35);
    b.writeInt32LE(speedKmh, 39);
    return b;
}

const ftyp = box(
    "ftyp",
    Buffer.concat([fourCC("isom"), u32be(512), fourCC("isom"), fourCC("mp41")]),
);

// 3 fixes, each repeated 3x, then 1 void block.
const fixes = [
    { latDeg: 50.0, lonDeg: 30.0, heading: 45, speedKmh: 43 },
    { latDeg: 50.0005, lonDeg: 30.0005, heading: 46, speedKmh: 45 },
    { latDeg: 50.001, lonDeg: 30.001, heading: 47, speedKmh: 47 },
];
const blocks = [];
for (const f of fixes) {
    for (let i = 0; i < 3; i++) blocks.push(box("free", build70maiBlock(f)));
}
blocks.push(box("free", build70maiBlock({ latDeg: 50.5, lonDeg: 30.5, heading: 0, active: false })));

const moov = box("moov", box("mvhd", Buffer.alloc(108)));
const file = Buffer.concat([ftyp, ...blocks, moov]);

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(__dirname, "synthetic-70mai.mp4");
writeFileSync(outPath, file);
console.error(`wrote ${file.length} bytes to ${outPath}`);
