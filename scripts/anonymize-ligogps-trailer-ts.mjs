#!/usr/bin/env node
// Anonymizes a LigoGPS-trailer MPEG-TS file into a snapshot fixture.
//
// The parser reads ONLY the EOF trailer (src/ts-trailer.ts layout), so the
// fixture's video body carries no real bytes at all: it is generated from
// scratch via ffmpeg testsrc2 + sine (same approach as
// anonymize-ts-generic.mjs), keeping the container that mediabunny and the
// clamp actually care about. The real trailer is appended verbatim except
// the coordinate fractions:
//   - every "N:dd.dddddd" / "E:d.dddddd" (any hemisphere letter, optional
//     minus) gets its fraction digits zeroed - same byte length, so every
//     embedded length field stays valid;
//   - timestamps, speed, course and slot structure are the original camera
//     bytes (without coordinates they are not sensitive, and a preserved
//     cadence gives a meaningful snapshot).
//
// Dependencies: ffmpeg in PATH.
//
// Usage:
//   node scripts/anonymize-ligogps-trailer-ts.mjs <input.ts> <output.TS> [duration=3]

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";

const [, , inputPath, outputPath, durationArg] = process.argv;
if (!inputPath || !outputPath) {
    console.error("usage: anonymize-ligogps-trailer-ts.mjs <input.ts> <output.TS> [duration=3]");
    process.exit(1);
}
if (!existsSync(inputPath)) {
    console.error(`input not found: ${inputPath}`);
    process.exit(1);
}
const durationSec = Number(durationArg ?? 3);

const TS_SIZE = 188;
const SLOT_SIZE = 132;
const SLOTS_OFFSET = 28;
const TRAILER_FIXED_SIZE = 36;
const MAX_TRAILER_BYTES = 16 * 1024 * 1024;
const MAX_TRAILER_SLOTS = Math.floor((MAX_TRAILER_BYTES - TRAILER_FIXED_SIZE) / SLOT_SIZE);

const TRAILER_DIALECTS = [
    { magic: "SKIPLCAIGPSINFO", terminator: 0x23232323, header: "length" },
    { magic: "SKIPLIGOGPSINFO", terminator: 0x23232323, header: "length" },
    { magic: "SKIPLIGOGPSINFO", terminator: 0x26262626, header: "slot-capacity" },
];

// --- Step 1: extract the trailer from the real file (known marker + u32 BE len).
const size = statSync(inputPath).size;
const full = readFileSync(inputPath);
if (size < 8) {
    console.error("input is too small to carry a trailer");
    process.exit(1);
}
const terminator = full.readUInt32BE(size - 8);
if (![0x23232323, 0x26262626].includes(terminator)) {
    console.error("input has no known trailer terminator at EOF");
    process.exit(1);
}
const trailerLen = full.readUInt32BE(size - 4);
if (
    trailerLen < TRAILER_FIXED_SIZE ||
    trailerLen > MAX_TRAILER_BYTES ||
    trailerLen >= size ||
    (size - trailerLen) % TS_SIZE !== 0 ||
    (trailerLen - TRAILER_FIXED_SIZE) % SLOT_SIZE !== 0
) {
    console.error(`implausible trailer length ${trailerLen} for file size ${size}`);
    process.exit(1);
}
const trailer = Buffer.from(full.subarray(size - trailerLen));
if (trailer.readUInt32BE(0) !== trailerLen) {
    console.error("trailer length copies disagree");
    process.exit(1);
}
const magic = trailer.toString("latin1", 4, 19);
const dialect = TRAILER_DIALECTS.find((candidate) => candidate.magic === magic && candidate.terminator === terminator);
if (!dialect) {
    console.error(`unexpected trailer magic: ${JSON.stringify(magic)}`);
    process.exit(1);
}
const slotCount = (trailerLen - TRAILER_FIXED_SIZE) / SLOT_SIZE;
const headerValue = trailer.readUInt32LE(24);
const hasValidHeader =
    dialect.header === "length"
        ? headerValue === trailerLen
        : headerValue >= slotCount && headerValue <= MAX_TRAILER_SLOTS;
if (!hasValidHeader) {
    console.error(`unexpected trailer header value ${headerValue}`);
    process.exit(1);
}
console.error(`trailer: ${trailerLen} bytes, magic ${magic}`);

// --- Step 2: zero the coordinate fractions in every slot, in place.
let slots = 0;
let coordinates = 0;
let unchangedCoordinates = 0;
for (let off = SLOTS_OFFSET; off + SLOT_SIZE <= trailer.length; off += SLOT_SIZE) {
    if (trailer.readUInt32BE(off) === dialect.terminator) break;
    const textStart = off + 4;
    let textEnd = textStart;
    while (textEnd < off + SLOT_SIZE && trailer[textEnd] !== 0) textEnd++;
    if (textEnd === textStart) continue; // blank slot
    const text = trailer.toString("latin1", textStart, textEnd);
    const scrubbed = text.replace(/([NSEW]:-?\d+)\.(\d{4,})/g, (_, head, frac) => {
        coordinates++;
        if (/^0+$/.test(frac)) unchangedCoordinates++;
        return `${head}.${"0".repeat(frac.length)}`;
    });
    if (scrubbed.length !== text.length) {
        console.error(`scrub changed slot length at offset ${off} - aborting`);
        process.exit(1);
    }
    trailer.write(scrubbed, textStart, "latin1");
    slots++;
}
if (coordinates === 0 || unchangedCoordinates > 0) {
    console.error(`cannot prove coordinate scrubbing: fields=${coordinates}, unchanged=${unchangedCoordinates}`);
    process.exit(1);
}
console.error(`scrubbed ${coordinates} coordinate fields in ${slots} slots`);

// --- Step 3: generate a from-scratch TS body (HEVC + AAC, tiny).
const bodyTmp = `${outputPath}.body.ts`;
const ffArgs = [
    "-y",
    "-f",
    "lavfi",
    "-i",
    `testsrc2=size=320x180:rate=15:duration=${durationSec}`,
    "-f",
    "lavfi",
    "-i",
    `sine=frequency=1000:sample_rate=16000:duration=${durationSec}`,
    "-c:v",
    "libx265",
    "-preset",
    "ultrafast",
    "-x265-params",
    "log-level=error:crf=40",
    "-pix_fmt",
    "yuv420p",
    "-tag:v",
    "hvc1",
    "-c:a",
    "aac",
    "-ac",
    "1",
    "-ar",
    "16000",
    "-b:a",
    "32k",
    "-f",
    "mpegts",
    bodyTmp,
];
const res = spawnSync("ffmpeg", ffArgs, { stdio: ["ignore", "inherit", "inherit"] });
if (res.status !== 0) {
    console.error(`ffmpeg exited with status ${res.status}`);
    process.exit(res.status ?? 1);
}
const body = readFileSync(bodyTmp);
unlinkSync(bodyTmp);
if (body.length % TS_SIZE !== 0) {
    console.error(`ffmpeg body is not 188-aligned: ${body.length}`);
    process.exit(1);
}

// --- Step 4: append the scrubbed trailer and write the fixture.
writeFileSync(outputPath, Buffer.concat([body, trailer]));
console.error(`done: ${outputPath} (${body.length} body + ${trailer.length} trailer)`);
