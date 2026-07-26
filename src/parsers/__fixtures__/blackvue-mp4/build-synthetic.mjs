#!/usr/bin/env node
// Builds a minimal DR900X+-like MP4 for the plugin's tests:
// ftyp + free(cprt+gps+...) + minimal moov.
//
// Run: node src/parsers/__fixtures__/blackvue-mp4/build-synthetic.mjs > <output.mp4>
//
// NMEA records are synthetic; coordinates (50, 30) decimal degrees =
// 5000.0/03000.0 in DDmm.mmmm, landing in Eastern Europe (round degrees,
// not a real location).
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

const ftyp = box("ftyp", Buffer.concat([
    fourCC("isom"),
    u32be(512),
    fourCC("isom"),
    fourCC("avc1"),
    fourCC("mp41"),
]));

// Inner "BlackVue boxes" nested inside free.
const cprt = box("cprt", Buffer.from(
    `{"model":"DR900X Plus","ver":1.000,"GPS":1}\0`,
    "ascii",
));
const sttm = box("sttm", Buffer.alloc(8)); // dummy
const ptnm = box("ptnm", Buffer.from("20211011_141314_NF.mp4\0", "ascii"));
const thum = box("thum", Buffer.alloc(64)); // dummy thumbnail

// gps-box with 5 valid NMEA records. Coordinates (50.0, 30.0) decimal =
// 5000.0/03000.0 in DDmm.mmmm.
const nmeaLines = [
    "[1633961700000]$GNRMC,181500.00,A,5000.0000,N,03000.0000,E,5.0,90.0,111021,,,A*5C",
    "[1633961701000]$GNRMC,181501.00,A,5000.0010,N,03000.0020,E,5.5,91.0,111021,,,A*5F",
    "[1633961702000]$GNRMC,181502.00,A,5000.0020,N,03000.0040,E,6.0,92.0,111021,,,A*5C",
    "[1633961703000]$GNGGA,181502.00,5000.0020,N,03000.0040,E,1,12,0.5,123.4,M,46.0,M,,*4C",
    "[1633961704000]$GNRMC,181504.00,V,,,,,,,111021,,,N*52",
    "[1633961705000]$GNRMC,181505.00,A,5000.0040,N,03000.0080,E,7.0,94.0,111021,,,A*5A",
];
const gpsPayload = Buffer.from(nmeaLines.join("\n\n") + "\n", "ascii");
const gps = box("gps ", gpsPayload);

const free = box("free", Buffer.concat([cprt, sttm, ptnm, thum, gps]));

// Minimal moov - mvhd only. There is no real trak structure, so mediabunny
// cannot parse it, but our plugin does not care - it reads the free-box
// directly. Everything else is ignored.
const mvhdPayload = Buffer.alloc(108); // version=0 + flags + 100 zero bytes
const mvhd = box("mvhd", mvhdPayload);
const moov = box("moov", mvhd);

const file = Buffer.concat([ftyp, free, moov]);

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(__dirname, "synthetic.mp4");
writeFileSync(outPath, file);
console.error(`wrote ${file.length} bytes to ${outPath}`);
