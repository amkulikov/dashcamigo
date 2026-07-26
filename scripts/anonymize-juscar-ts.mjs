#!/usr/bin/env node
// Anonymizes a Juscar MPEG-TS file into a snapshot fixture.
//
// What it does:
//   1. Trim the source .ts to N bytes (5 MB by default) - drops the bulk of
//      the data, leaving enough for a handful of GPS points.
//   2. ffmpeg re-encodes video into a testsrc2-like H.264 + audio into sine AAC.
//      The data stream (Juscar GPS PID) is copied as-is via -c:d copy - ffmpeg
//      has no timeline concept for data streams and just copies whatever it read.
//   3. Post-process: walk the TS packets, and in data PES with a GPS payload
//      zero out sensitive fields:
//      - plaintext (`normal:YYYY/MM/DD HH:MM:SS N:lat W:lon speed km/h ...`):
//        every number matching `\d+\.\d+` (lat, lon, speed, accel, bearing,
//        altitude) becomes `0...0.0...0` of the same length - PES length
//        stays intact, the parser reads lat=lon=speed=0.
//      - encrypted (`####<u32 LE len><body>`): body zeroed in full.
//        The current plugin doesn't parse the encrypted branch, but a future
//        implementation of decryptLigoGps would decode garbage, not real coords.
//   Timestamps and filenames are NOT touched - without coordinates and video
//   they aren't sensitive, and a preserved timestamp gives a meaningful snapshot.
//
// Dependencies: ffmpeg in PATH.
//
// Usage:
//   node scripts/anonymize-juscar-ts.mjs <input.ts> <output.ts> [trimBytes=5242880]

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, unlinkSync, existsSync } from "node:fs";

const [, , inputPath, outputPath, trimBytesArg] = process.argv;
if (!inputPath || !outputPath) {
    console.error("usage: anonymize-juscar-ts.mjs <input.ts> <output.ts> [trimBytes=5242880]");
    process.exit(1);
}
if (!existsSync(inputPath)) {
    console.error(`input not found: ${inputPath}`);
    process.exit(1);
}
const trimBytes = Number(trimBytesArg ?? 5 * 1024 * 1024);
if (!Number.isFinite(trimBytes) || trimBytes <= 0) {
    console.error(`invalid trimBytes: ${trimBytesArg}`);
    process.exit(1);
}

const TS_SIZE = 188;
const TS_SYNC = 0x47;

// Step 1: trim
const fullBuf = readFileSync(inputPath);
const trimmed = fullBuf.subarray(0, Math.min(trimBytes, fullBuf.length));
const trimmedTmp = `${outputPath}.trim.ts`;
writeFileSync(trimmedTmp, trimmed);
console.error(`trimmed ${trimmed.length} bytes -> ${trimmedTmp}`);

// Step 2: ffmpeg recode. Video -> 320x180 H.264 ultrafast CRF 35 (~10 KB/s),
// audio -> 16k mono AAC, data -> copy (ffmpeg ignores -t for data streams, but
// the source is already trimmed by step 1).
const recodedTmp = `${outputPath}.recode.ts`;
const ffArgs = [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    trimmedTmp,
    "-map",
    "0:v:0",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-crf",
    "35",
    "-s",
    "320x180",
    "-r",
    "30",
    "-pix_fmt",
    "yuv420p",
    "-map",
    "0:a:0",
    "-c:a",
    "aac",
    "-b:a",
    "16k",
    "-ar",
    "16000",
    "-ac",
    "1",
    "-map",
    "0:d:0",
    "-c:d",
    "copy",
    "-f",
    "mpegts",
    recodedTmp,
];
const ff = spawnSync("ffmpeg", ffArgs, { stdio: ["ignore", "ignore", "inherit"] });
if (ff.status !== 0) {
    console.error("ffmpeg failed");
    process.exit(1);
}
console.error(`recoded -> ${recodedTmp}`);

// Step 3: zero out coordinates in data PES.
const out = Buffer.from(readFileSync(recodedTmp));

// Auto-detect GPS PID: the first PUSI packet whose body starts with "LIGOGPSINFO"
// or a lowercase prefix + ":". Same logic as the extractor probe.
const gpsPid = detectGpsPid(out);
if (gpsPid === null) {
    console.error("could not auto-detect GPS PID in recoded file");
    process.exit(1);
}
console.error(`gps PID = 0x${gpsPid.toString(16)}`);

let plainZeroed = 0;
let encZeroed = 0;
for (let off = 0; off + TS_SIZE <= out.length; off += TS_SIZE) {
    if (out[off] !== TS_SYNC) continue;
    const b1 = out[off + 1];
    const pid = ((b1 & 0x1f) << 8) | out[off + 2];
    if (pid !== gpsPid) continue;
    if ((b1 & 0x40) === 0) continue;
    const b3 = out[off + 3];
    const af = (b3 & 0x30) >> 4;
    if (af === 2) continue;
    let payOff = off + 4;
    if (af === 3) payOff += 1 + out[payOff];
    if (out[payOff] !== 0 || out[payOff + 1] !== 0 || out[payOff + 2] !== 1) continue;
    const streamId = out[payOff + 3];
    const pesLen = (out[payOff + 4] << 8) | out[payOff + 5];
    let bodyOff;
    let bodyLen;
    if (streamId === 0xbf) {
        bodyOff = payOff + 6;
        bodyLen = pesLen;
    } else {
        const ph = out[payOff + 8];
        bodyOff = payOff + 9 + ph;
        bodyLen = pesLen - 3 - ph;
    }
    const tsEnd = off + TS_SIZE;
    const bodyEnd = Math.min(bodyOff + bodyLen, tsEnd);
    if (bodyOff >= bodyEnd) continue;

    const first = out[bodyOff];
    if (first === 0x4c /* 'L' */) {
        // ENC: ####<u32 LE len><body>. Zero the body, keep the header.
        const bodySlice = out.subarray(bodyOff, bodyEnd);
        const hashLocal = bodySlice.indexOf(Buffer.from("####"));
        if (hashLocal >= 0 && hashLocal + 8 <= bodySlice.length) {
            const hashAt = bodyOff + hashLocal;
            const cipherLen = out.readUInt32LE(hashAt + 4);
            const cipherStart = hashAt + 8;
            const cipherEnd = Math.min(cipherStart + cipherLen, bodyEnd);
            out.fill(0, cipherStart, cipherEnd);
            encZeroed++;
        }
        continue;
    }
    if (first >= 0x61 && first <= 0x7a /* a-z */) {
        // PLN: zero out floats keeping length.
        let lineEnd = bodyOff;
        while (lineEnd < bodyEnd && out[lineEnd] !== 0) lineEnd++;
        const line = out.subarray(bodyOff, lineEnd).toString("latin1");
        const zeroed = line.replace(/\d+\.\d+/g, (match) => match.replace(/\d/g, "0"));
        if (zeroed.length !== line.length) {
            console.error(`length mismatch at offset ${off}: ${line.length} -> ${zeroed.length}`);
            process.exit(1);
        }
        out.write(zeroed, bodyOff, "latin1");
        plainZeroed++;
    }
}

console.error(`zeroed ${plainZeroed} plaintext PES, ${encZeroed} encrypted PES`);
writeFileSync(outputPath, out);
unlinkSync(trimmedTmp);
unlinkSync(recodedTmp);
console.error(`done -> ${outputPath}`);

// --------- helpers ---------

function detectGpsPid(buf) {
    const limit = buf.length - TS_SIZE;
    for (let off = 0; off <= limit; off += TS_SIZE) {
        if (buf[off] !== TS_SYNC) continue;
        const b1 = buf[off + 1];
        if ((b1 & 0x40) === 0) continue;
        const pid = ((b1 & 0x1f) << 8) | buf[off + 2];
        const b3 = buf[off + 3];
        const af = (b3 & 0x30) >> 4;
        if (af === 2) continue;
        let payOff = off + 4;
        if (af === 3) payOff += 1 + buf[payOff];
        if (buf[payOff] !== 0 || buf[payOff + 1] !== 0 || buf[payOff + 2] !== 1) continue;
        const streamId = buf[payOff + 3];
        const bodyOff = streamId === 0xbf ? payOff + 6 : payOff + 9 + buf[payOff + 8];
        if (bodyOff + 11 >= off + TS_SIZE) continue;
        const head = buf.subarray(bodyOff, bodyOff + 11).toString("latin1");
        if (head === "LIGOGPSINFO") return pid;
        const c0 = buf[bodyOff];
        if (c0 >= 0x61 && c0 <= 0x7a && buf[bodyOff + 1] >= 0x61 && buf[bodyOff + 1] <= 0x7a) {
            // crude plaintext check
            for (let i = bodyOff + 1; i < bodyOff + 10; i++) {
                if (buf[i] === 0x3a /* ':' */) return pid;
            }
        }
    }
    return null;
}
