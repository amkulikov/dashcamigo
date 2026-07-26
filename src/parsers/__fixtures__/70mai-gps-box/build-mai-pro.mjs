#!/usr/bin/env node
// Builder for a minimal MP4 with an older-70mai-Pro `GPS ` box (uppercase 4cc)
// of direct 36-byte records. Record layout cross-checked against freezer52000
// maigps.c and mzdun/dashcam-gps 70mai.cc (both MIT) and validated on a real
// GPS box. Coordinates are sentinel-anonymized: 50.0 N / 30.0 E (Baltic Sea).
//
// 50.0 deg packs as raw=5000000 (deg*100000 + minutes*1000, minutes=0); a
// +0.01 deg step = +0.6 min = +600 raw.
//
// Run: node src/parsers/__fixtures__/70mai-gps-box/build-mai-pro.mjs

import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function fourCC(s) {
    return Buffer.from(s, "ascii");
}
function box(type, payload) {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(8 + payload.length, 0);
    fourCC(type).copy(head, 4);
    return Buffer.concat([head, payload]);
}
// Packs a decimal degree into the 70mai DD MM.mmm u32 (deg*100000 + min*1000).
function packDeg(d) {
    const deg = Math.floor(d);
    const minutes = (d - deg) * 60;
    return deg * 100_000 + Math.round(minutes * 1000);
}
function record({ hasGps, seconds, speedMetresPerHour, ns, latDeg, ew, lonDeg }) {
    const b = Buffer.alloc(36);
    b.writeUInt32LE(1, 0); // has_record
    b.writeUInt32LE(hasGps ? 1 : 0, 4);
    b.writeUInt32LE(seconds, 8);
    b.writeUInt32LE(speedMetresPerHour, 12);
    b.writeUInt8(ns.charCodeAt(0), 16);
    b.writeUInt32LE(packDeg(latDeg), 17);
    b.writeUInt8(ew.charCodeAt(0), 21);
    b.writeUInt32LE(packDeg(lonDeg), 22);
    return b;
}

const recs = [
    record({ hasGps: 1, seconds: 0, speedMetresPerHour: 105300, ns: "N", latDeg: 50.0, ew: "E", lonDeg: 30.0 }),
    record({ hasGps: 1, seconds: 1, speedMetresPerHour: 106000, ns: "N", latDeg: 50.01, ew: "E", lonDeg: 30.01 }),
    record({ hasGps: 1, seconds: 2, speedMetresPerHour: 52400, ns: "N", latDeg: 50.02, ew: "E", lonDeg: 30.02 }),
    // No-fix record (cold start) - skipped by the parser.
    record({ hasGps: 0, seconds: 3, speedMetresPerHour: 0, ns: "N", latDeg: 0, ew: "E", lonDeg: 0 }),
];

const ftyp = box("ftyp", Buffer.concat([fourCC("isom"), Buffer.alloc(4), fourCC("isom"), fourCC("mp41")]));
const moov = box("moov", box("mvhd", Buffer.alloc(108)));
const gpsBox = box("GPS ", Buffer.concat(recs));
const file = Buffer.concat([ftyp, moov, gpsBox]);

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(__dirname, "synthetic-mai-pro.mp4");
writeFileSync(outPath, file);
console.error(`wrote ${file.length} bytes to ${outPath}`);
