#!/usr/bin/env node
// Builds minimal MP4s with a LigoGPS file trailer (Beferich J18 layout) for
// the ligogps-trailer primitive tests. Layout mirrors the real files:
//
//   ftyp + tiny mdat, then past the last box:
//   <zero pad>
//   [u32 BE encSize]["SKIP"]["LIGOGPSINFO"][\0\0\0\0\x05][\xff\xff\0\0]
//     '####' + u32 LE len + encrypted body (zeros here - the parser skips
//     the whole encrypted directory on the first '####')
//   ["****"][u32 BE encSize][u32 BE ptSize]["SKIP"]["LIGOGPSINFO"]["     "]
//   [u32 BE count] then per record a 0x84 slot: u32 BE index + ASCII text,
//   NUL-padded; then '####' + u32 BE ptSize.
//
// Outputs: synthetic-happy.mp4, synthetic-edge.mp4,
// synthetic-encrypted-only.mp4, synthetic-wrong-format.mp4.
//
// Run: node src/parsers/__fixtures__/ligogps-trailer/build-synthetic.mjs

import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SLOT_SIZE = 0x84;

function fourCC(s) {
    return Buffer.from(s, "ascii");
}
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
function box(type, payload) {
    return Buffer.concat([u32be(8 + payload.length), fourCC(type), payload]);
}

// One plaintext 0x84-byte slot: u32 BE index + latin1 text, NUL-padded.
function slot(index, text) {
    const b = Buffer.alloc(SLOT_SIZE);
    u32be(index).copy(b, 0);
    b.write(text, 4, "latin1");
    return b;
}

// Sentinel record text (Baltic Sea, 50.1 N / 30.1 E - not PII).
function record(second, i) {
    const ss = String(second).padStart(2, "0");
    const frac = String(100000 + i).slice(1);
    return `2026/08/03 11:34:${ss} N:50.1${frac} E:030.1${frac} ${19 + i}.0 km/h x:0.00 y:0.00 z:0.00 A:${210 + i}.0 H:173.0 M:0.0`;
}

function encryptedDir(chunkBody = Buffer.alloc(16)) {
    const chunk = Buffer.concat([fourCC("####"), u32le(chunkBody.length), chunkBody]);
    const body = Buffer.concat([
        fourCC("LIGOGPSINFO"),
        Buffer.from([0, 0, 0, 0, 0x05]),
        Buffer.from([0xff, 0xff, 0, 0]),
        chunk,
    ]);
    return { body, size: 4 + body.length }; // size covers "SKIP" + body, like the real files
}

function plaintextDir(slots, declaredCount, encSize) {
    const body = Buffer.concat([fourCC("LIGOGPSINFO"), Buffer.from("     ", "ascii"), u32be(declaredCount), ...slots]);
    const ptSize = 4 + body.length + 8; // "SKIP" + body + trailing '####'+size
    return Buffer.concat([fourCC("****"), u32be(encSize), u32be(ptSize), fourCC("SKIP"), body, fourCC("####"), u32be(ptSize)]);
}

function mp4WithTrailer(trailer) {
    const ftyp = box("ftyp", Buffer.concat([fourCC("isom"), u32be(512), fourCC("isom"), fourCC("mp41")]));
    const mdat = box("mdat", Buffer.alloc(64));
    return Buffer.concat([ftyp, mdat, trailer]);
}

function withPadAndDirs(slots, declaredCount) {
    const enc = encryptedDir();
    return Buffer.concat([
        Buffer.alloc(32), // zero pad before the first directory (varies on real files)
        u32be(enc.size),
        fourCC("SKIP"),
        enc.body,
        plaintextDir(slots, declaredCount, enc.size),
    ]);
}

// Happy: 6 contiguous records.
const happySlots = Array.from({ length: 6 }, (_, i) => slot(i + 1, record(53 + i, i)));
writeFileSync(resolve(HERE, "synthetic-happy.mp4"), mp4WithTrailer(withPadAndDirs(happySlots, 6)));

// Edge: valid + blank slot + garbage text + no-fix '?' + out-of-range lat +
// an index-10 slot (counter byte 0x0a - the regex `s`-flag regression) +
// declared count larger than stored slots (the '####' terminator stops the
// walk). Expect 3 parsed records, 3 skipped slot entries.
const edgeSlots = [
    slot(1, record(53, 0)),
    Buffer.alloc(SLOT_SIZE), // blank - firmware gap, silently skipped
    slot(3, "not a gps record at all"),
    slot(4, "2026/08/03 11:34:56 ?:0.000000 ?:0.000000 0.0 km/h x:0.00 y:0.00 z:0.00"), // no fix
    slot(5, "2026/08/03 11:34:57 N:99.100000 E:030.100000 5.0 km/h"), // lat out of range
    slot(10, record(58, 5)), // u32 BE 10 = counter byte 0x0a
    slot(7, record(59, 6)),
];
writeFileSync(resolve(HERE, "synthetic-edge.mp4"), mp4WithTrailer(withPadAndDirs(edgeSlots, 100)));

// Encrypted-only: the LIGOGPSINFO directory exists but no plaintext twin -
// recognized, zero records, one skipped entry.
const encOnly = encryptedDir();
writeFileSync(
    resolve(HERE, "synthetic-encrypted-only.mp4"),
    mp4WithTrailer(Buffer.concat([Buffer.alloc(32), u32be(encOnly.size), fourCC("SKIP"), encOnly.body])),
);

// Wrong format: a trailing region with no LIGOGPSINFO at all (Kenwood-style
// C-run junk). marker() must reject; parse() must throw WrongFormatError.
writeFileSync(resolve(HERE, "synthetic-wrong-format.mp4"), mp4WithTrailer(Buffer.from("C".repeat(512), "ascii")));

console.log("wrote synthetic-happy/edge/encrypted-only/wrong-format mp4s");
