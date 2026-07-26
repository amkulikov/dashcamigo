#!/usr/bin/env node
// Builder for a minimal iBox MOV carrying Ambarella tail-atoms (IDIT + gpsa +
// gps0 + gsea + gsen after moov) - the same layout the Navitel R-series uses,
// parsed by the navitel-tail primitive. Confirmed byte-identical on a real iBox
// iCON sample (gps0 decodes to valid coords, UTC = IDIT-local minus camera TZ).
//
// Coordinates are sentinel-anonymized: 50.0 N / 30.0 E (Baltic Sea, not PII).
// gps0 stores NMEA DDmm.mmmm: 50.0 deg -> 5000.0, 30.0 deg -> 3000.0.
//
// Run: node src/parsers/__fixtures__/ibox/build-ibox.mjs

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

// One 32-byte gps0 record (see internal/navitel-gps0.ts for the layout,
// matching ExifTool Process_gps0: alt@16, speed km/h@20, date @22-27,
// course/2 @28).
function gps0Record({ latDdmm, lonDdmm, altitudeM, speedKmh, year, month, day, hour, min, sec, courseHalf }) {
    const b = Buffer.alloc(32);
    b.writeDoubleLE(latDdmm, 0);
    b.writeDoubleLE(lonDdmm, 8);
    b.writeInt32LE(altitudeM, 16);
    b.writeUInt16LE(speedKmh, 20);
    b.writeUInt8(year, 22); // year - 2000
    b.writeUInt8(month, 23);
    b.writeUInt8(day, 24);
    b.writeUInt8(hour, 25);
    b.writeUInt8(min, 26);
    b.writeUInt8(sec, 27);
    b.writeUInt8(courseHalf, 28); // degrees / 2
    b.writeUInt8(0x01, 29);
    b.writeUInt8(0x01, 30);
    b.writeUInt8(0x00, 31);
    return b;
}

const ftyp = box("ftyp", Buffer.concat([fourCC("qt  "), Buffer.alloc(4), fourCC("qt  ")]));
const moov = box("moov", box("mvhd", Buffer.alloc(108)));

// Local recording start 2023-04-22 15:45:15 (camera TZ); gps0 stamps are UTC
// (here MSK-3h = 12:45). Two records ~50 m apart.
const idit = box("IDIT", Buffer.from("2023-04-22 15:45:15\0", "latin1"));
const gpsa = box("gpsa", Buffer.alloc(4));
const gps0 = box(
    "gps0",
    Buffer.concat([
        // Field values mirror the real iBox sample ranges: altitude ~155 m,
        // speed ~73 km/h, course ~38 deg (raw 19).
        // prettier-ignore
        gps0Record({ latDdmm: 5000.0, lonDdmm: 3000.0, altitudeM: 155, speedKmh: 73, year: 23, month: 4, day: 22, hour: 12, min: 45, sec: 20, courseHalf: 19 }),
        // prettier-ignore
        gps0Record({ latDdmm: 5000.03, lonDdmm: 3000.03, altitudeM: 156, speedKmh: 74, year: 23, month: 4, day: 22, hour: 12, min: 45, sec: 21, courseHalf: 19 }),
    ]),
);
const gsea = box("gsea", Buffer.alloc(4));
const gsen = box("gsen", Buffer.alloc(0));

const file = Buffer.concat([ftyp, moov, idit, gpsa, gps0, gsea, gsen]);

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(__dirname, "synthetic-ibox.MOV");
writeFileSync(outPath, file);
console.error(`wrote ${file.length} bytes to ${outPath}`);
