#!/usr/bin/env node
// Builds a minimal MP4 with an embedded freeGPS block. Used for the
// unit test of the variantViofoType3 parser (see _internal/freegps.ts).
//
// Real 2E Drive 730 / SilverStone F1 A80 samples confirmed
// LAYOUT_DEFAULT: datetime@44, active@68, lat@72. ExifTool 37-prefix
// Type 3 (Sergei A119) - LAYOUT_LEGACY: datetime@16, active@40, lat@44,
// accel@60. EgorKin alt (A129 Plus / A229 newer FW) - LAYOUT_ALT:
// datetime@12, active@36, lat@40. The pick is done via a signature check.
//
// Run: node src/parsers/__fixtures__/novatek/build-synthetic.mjs

import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function fourCC(s) {
    return Buffer.from(s, "ascii");
}
function box(type, payload) {
    const size = 8 + payload.length;
    const head = Buffer.alloc(8);
    head.writeUInt32BE(size, 0);
    fourCC(type).copy(head, 4);
    return Buffer.concat([head, payload]);
}
function u32be(n) {
    const b = Buffer.alloc(4);
    b.writeUInt32BE(n, 0);
    return b;
}
function ddmm(deg) {
    const abs = Math.abs(deg);
    return Math.floor(abs) * 100 + (abs - Math.floor(abs)) * 60;
}

// Layout config: field positions for each variant. Matches
// FieldLayout in _internal/freegps.ts.
const LAYOUTS = {
    default: { datetime: 44, status: 68, floats: 72, accel: null },
    legacy: { datetime: 16, status: 40, floats: 44, accel: 60 },
    alt: { datetime: 12, status: 36, floats: 40, accel: null },
};

function buildFreeGpsBlock(fields, { variant = "default", accel = null } = {}) {
    const layout = LAYOUTS[variant];
    const block = Buffer.alloc(0x100);
    block.write("freeGPS ", 0, 8, "ascii");
    block.writeUInt32LE(0x100, 8); // block size LE (informational)

    block.writeUInt32LE(fields.h, layout.datetime);
    block.writeUInt32LE(fields.m, layout.datetime + 4);
    block.writeUInt32LE(fields.s, layout.datetime + 8);
    block.writeUInt32LE(fields.year - 2000, layout.datetime + 12);
    block.writeUInt32LE(fields.month, layout.datetime + 16);
    block.writeUInt32LE(fields.day, layout.datetime + 20);

    block[layout.status] = "A".charCodeAt(0);
    block[layout.status + 1] = fields.lat >= 0 ? "N".charCodeAt(0) : "S".charCodeAt(0);
    block[layout.status + 2] = fields.lon >= 0 ? "E".charCodeAt(0) : "W".charCodeAt(0);
    block[layout.status + 3] = 0x00;

    block.writeFloatLE(ddmm(fields.lat), layout.floats);
    block.writeFloatLE(ddmm(fields.lon), layout.floats + 4);
    block.writeFloatLE(fields.speedKnots, layout.floats + 8);
    block.writeFloatLE(fields.heading, layout.floats + 12);

    if (layout.accel !== null && accel) {
        block.writeInt32LE(Math.round(accel.x * 256), layout.accel);
        block.writeInt32LE(Math.round(accel.y * 256), layout.accel + 4);
        block.writeInt32LE(Math.round(accel.z * 256), layout.accel + 8);
    }

    return block;
}

const ftyp = box("ftyp", Buffer.concat([
    fourCC("isom"),
    u32be(512),
    fourCC("isom"),
    fourCC("avc1"),
    fourCC("mp41"),
]));

// Block 1: LAYOUT_DEFAULT (2E Drive / SilverStone / VIOFO A229).
const block1 = buildFreeGpsBlock({
    h: 12, m: 0, s: 0, year: 2026, month: 1, day: 15,
    lat: 50.123456, lon: 30.654321,
    speedKnots: 30.0, heading: 90.0,
}, { variant: "default" });
// Block 2: LAYOUT_LEGACY with accelerometer (older VIOFO A119 / Sergei).
const block2 = buildFreeGpsBlock({
    h: 12, m: 0, s: 1, year: 2026, month: 1, day: 15,
    lat: 50.124, lon: 30.655,
    speedKnots: 31.5, heading: 91.0,
}, { variant: "legacy", accel: { x: 0.05, y: 0.98, z: -0.02 } });
// Block 3: LAYOUT_ALT (VIOFO A129 Plus / A229 newer FW).
const block3 = buildFreeGpsBlock({
    h: 12, m: 0, s: 2, year: 2026, month: 1, day: 15,
    lat: 50.125, lon: 30.656,
    speedKnots: 32.8, heading: 92.5,
}, { variant: "alt" });

const free1 = box("free", block1);
const free2 = box("free", block2);
const free3 = box("free", block3);

const mvhd = box("mvhd", Buffer.alloc(108));
const moov = box("moov", mvhd);

const file = Buffer.concat([ftyp, free1, free2, free3, moov]);

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(__dirname, "synthetic-viofo.mp4");
writeFileSync(outPath, file);
console.error(`wrote ${file.length} bytes to ${outPath}`);
