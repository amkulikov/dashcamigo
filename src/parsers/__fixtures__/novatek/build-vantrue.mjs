#!/usr/bin/env node
// Builds a minimal MP4 with an embedded freeGPS block in the NMEA variant
// (Vantrue N2X). The real Vantrue freeGPS block is 0x8000 bytes large; here
// we pack compact ~256-byte blocks with a single NMEA line each.
//
// Layout of one block:
//   [0..7]    "freeGPS " magic
//   [8..119]  zero padding (binary "header" in the real file - the parser
//             just searches for the $G*RMC substring, exact bytes do not matter)
//   [120..]   ASCII NMEA line `$GNRMC,...,*XX\r\n`
//   tail      zero padding up to 256 bytes
//
// Coordinates anonymized to whole degrees: lat 47.0, lon 27.0 (for a
// correct DDmm.mmmm form we write "4700.00000,N,02700.00000,E").
//
// Run: node src/parsers/__fixtures__/novatek/build-vantrue.mjs

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

// Computes the NMEA checksum (XOR of all bytes between $ and *).
function nmeaChecksum(body) {
    let xor = 0;
    for (let i = 0; i < body.length; i++) xor ^= body.charCodeAt(i);
    return xor.toString(16).toUpperCase().padStart(2, "0");
}

function buildVantrueBlock({ time, date, lat, lon, speedKn, course }) {
    const block = Buffer.alloc(256);
    block.write("freeGPS ", 0, 8, "ascii");
    // bytes 8..119 - padding (zeros). The real Vantrue has several
    // u32 LE binary fields here, but our parser ignores them.
    const body = `GNRMC,${time},A,${lat},N,${lon},E,${speedKn},${course},${date},,,A`;
    const sentence = `$${body}*${nmeaChecksum(body)}\r\n`;
    block.write(sentence, 120, "ascii");
    return block;
}

const ftyp = box("ftyp", Buffer.concat([
    fourCC("isom"),
    u32be(512),
    fourCC("isom"),
    fourCC("avc1"),
    fourCC("mp41"),
]));

// 3 blocks, each one second later. Coordinates move by small fractional
// values (0.00001 deg ~ 1m).
const block1 = buildVantrueBlock({
    time: "175136.000",
    date: "231224", // 23 Dec 2024
    lat: "4700.00000", lon: "02700.00000",
    speedKn: "32.85", course: "45.45",
});
const block2 = buildVantrueBlock({
    time: "175137.000",
    date: "231224",
    lat: "4700.00010", lon: "02700.00010",
    speedKn: "33.20", course: "45.50",
});
const block3 = buildVantrueBlock({
    time: "175138.000",
    date: "231224",
    lat: "4700.00020", lon: "02700.00020",
    speedKn: "33.55", course: "45.55",
});

const free1 = box("free", block1);
const free2 = box("free", block2);
const free3 = box("free", block3);

const mvhd = box("mvhd", Buffer.alloc(108));
const moov = box("moov", mvhd);

const file = Buffer.concat([ftyp, free1, free2, free3, moov]);

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(__dirname, "synthetic-vantrue.mp4");
writeFileSync(outPath, file);
console.error(`wrote ${file.length} bytes to ${outPath}`);
