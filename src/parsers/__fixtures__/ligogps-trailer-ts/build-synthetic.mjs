#!/usr/bin/env node
// Builds minimal MPEG-TS files with a LigoGPS trailer (LCAI magic variant)
// for the ligogps-trailer-ts primitive and ts-trailer clamp tests. Layout
// mirrors the real files (see src/ts-trailer.ts):
//
//   two null TS packets (a valid 188-grid body), then:
//   [u32 BE len]["SKIPLCAIGPSINFO"][5 flag bytes][u32 LE len]
//   [132-byte slots: u32 index + ASCII record, NUL-padded]
//   ["####"][u32 BE len]
//
// Outputs: synthetic-happy.TS, synthetic-edge.TS, synthetic-wrong-format.TS.
// The .TS extension (upper case) keeps the binaries out of the tsc glob.
//
// Run: node src/parsers/__fixtures__/ligogps-trailer-ts/build-synthetic.mjs

import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SLOT_SIZE = 132;

function u32be(n) {
    const b = Buffer.alloc(4);
    b.writeUInt32BE(n, 0);
    return b;
}
function u32le(n) {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(n, 0);
    return b;
}

// One 132-byte slot: u32 index + latin1 text, NUL-padded. `raw` substitutes
// the whole slot body for edge cases.
function slot(index, text) {
    const b = Buffer.alloc(SLOT_SIZE);
    u32be(index).copy(b, 0);
    b.write(text, 4, "latin1");
    return b;
}

// A valid-enough TS body: null packets (PID 0x1fff, adaptation-free).
function tsBody(packets) {
    const out = Buffer.alloc(188 * packets, 0xff);
    for (let i = 0; i < packets; i++) {
        out[i * 188] = 0x47;
        out[i * 188 + 1] = 0x1f;
        out[i * 188 + 2] = 0xff;
        out[i * 188 + 3] = 0x10;
    }
    return out;
}

function trailer(magic, slots) {
    const len = 4 + 15 + 5 + 4 + SLOT_SIZE * slots.length + 8;
    return Buffer.concat([
        u32be(len),
        Buffer.from(magic, "latin1"),
        Buffer.alloc(5),
        u32le(len),
        ...slots,
        Buffer.from("####", "latin1"),
        u32be(len),
    ]);
}

const rec = (hh, mm, ss, lat, lon, kmh, course) =>
    `2026/08/13 ${hh}:${mm}:${ss} N:${lat} E:${lon} ${kmh} km/h - - - A:${course} - - `;

// happy: three clean 1 Hz records.
writeFileSync(
    resolve(HERE, "synthetic-happy.TS"),
    Buffer.concat([
        tsBody(2),
        trailer("SKIPLCAIGPSINFO", [
            slot(0, rec("21", "11", "39", "45.000000", "9.000000", "0.00", "0.00")),
            slot(1, rec("21", "11", "40", "45.000010", "9.000010", "3.60", "90.00")),
            slot(2, rec("21", "11", "41", "45.000020", "9.000020", "7.20", "180.00")),
        ]),
    ]),
);

// edge: a blank slot (firmware gap), a garbage slot, an early '####'
// terminator - the two slots after it must never be parsed.
writeFileSync(
    resolve(HERE, "synthetic-edge.TS"),
    Buffer.concat([
        tsBody(2),
        trailer("SKIPLCAIGPSINFO", [
            slot(0, rec("21", "11", "39", "45.000000", "9.000000", "0.00", "0.00")),
            Buffer.alloc(SLOT_SIZE), // blank
            slot(2, "not a gps record at all"),
            slot(3, rec("21", "11", "42", "45.000030", "9.000030", "0.00", "0.00")),
            Buffer.concat([Buffer.from("####", "latin1"), Buffer.alloc(SLOT_SIZE - 4)]), // early terminator
            slot(5, rec("21", "11", "44", "45.000050", "9.000050", "0.00", "0.00")),
        ]),
    ]),
);

// wrong-format: the terminator and length copies are structurally valid but
// the magic is foreign - detection must reject the whole trailer.
writeFileSync(
    resolve(HERE, "synthetic-wrong-format.TS"),
    Buffer.concat([
        tsBody(2),
        trailer("SKIPWXYZGPSINFO", [slot(0, rec("21", "11", "39", "45.000000", "9.000000", "0.00", "0.00"))]),
    ]),
);

console.error("done: synthetic-happy.TS, synthetic-edge.TS, synthetic-wrong-format.TS");
