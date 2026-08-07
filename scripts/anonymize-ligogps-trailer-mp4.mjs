#!/usr/bin/env node
// Anonymizes a LigoGPS-trailer MP4 (Beferich J18 and relatives) into a
// public-safe fixture:
//  1. Rebuilds the video part via scripts/anonymize-mp4.mjs (testsrc2 + sine).
//  2. Carries the REAL trailer over byte-for-byte in length and structure:
//     - encrypted LIGOGPSINFO directory: chunk bodies zeroed (the '####' +
//       length framing stays, so the parser still sees and skips the block;
//       the weak XOR cipher would otherwise leak the coordinates);
//     - plaintext LIGOGPSINFO table: the fractional part of every coordinate
//       is replaced by a synthetic per-record counter, integer degrees kept
//       (whole-degree precision, ~110 km). Field widths are preserved, so no
//       size bookkeeping in the trailer shifts. Timestamps, speed, course,
//       altitude and accel stay - not sensitive without coordinates.
//  3. Verifies no original coordinate string survived before writing.
//
// Usage: node scripts/anonymize-ligogps-trailer-mp4.mjs <input.mp4> <output.mp4>
// Requires ffmpeg + ffprobe in PATH.

import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, openSync, readSync, statSync, closeSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { argv, exit } from "node:process";

const SLOT_SIZE = 0x84;
const DIR_HEADER = 0x14; // LIGOGPSINFO magic (11) + 9 header bytes

// Walks top-level boxes and returns the offset where the box structure ends
// (= where the trailer begins). Mirrors listTopLevelBoxes in
// src/parsers/internal/mp4-walker.ts including the printable-type stop.
function findTrailerStart(fd, fileSize) {
    let pos = 0;
    const hdr = Buffer.alloc(16);
    while (pos + 8 <= fileSize) {
        readSync(fd, hdr, 0, 16, pos);
        let size = hdr.readUInt32BE(0);
        const type = hdr.toString("latin1", 4, 8);
        let header = 8;
        if (!/^[\x20-\x7e]{4}$/.test(type)) break;
        if (size === 1) {
            size = Number(hdr.readBigUInt64BE(8));
            header = 16;
        } else if (size === 0) {
            size = fileSize - pos;
        }
        if (size < header || pos + size > fileSize) break;
        pos += size;
    }
    return pos;
}

function findMagicOffsets(buf) {
    const hits = [];
    let i = 0;
    while ((i = buf.indexOf("LIGOGPSINFO", i, "latin1")) !== -1) {
        hits.push(i);
        i++;
    }
    return hits;
}

function isHashMarker(buf, off) {
    return off + 4 <= buf.length && buf.readUInt32BE(off) === 0x23232323;
}

// Zeroes the whole encrypted directory body in place, keeping only the first
// chunk's '####' + u32 LE length framing (that marker is what makes the
// parser recognize and skip the directory). Chunk strides vary per record
// (cipher output is variable-length), so a per-chunk walk is fragile - and
// the parser never reads past the first marker anyway.
function scrubEncryptedDir(trailer, recordsStart, dirEnd) {
    trailer.fill(0, recordsStart + 8, dirEnd);
    return dirEnd - recordsStart - 8;
}

// Rewrites the coordinates of every plaintext slot in place. The fractional
// digits become a synthetic counter of the same width; integer degrees stay.
function scrubPlaintextDir(trailer, magicOff) {
    const recordsStart = magicOff + DIR_HEADER;
    const declaredCount = trailer.readUInt32BE(magicOff + 0x10);
    let slots = 0;
    for (let i = 0; i < declaredCount; i++) {
        const slotStart = recordsStart + i * SLOT_SIZE;
        if (slotStart + SLOT_SIZE > trailer.length || isHashMarker(trailer, slotStart)) break;
        const text = trailer.toString("latin1", slotStart + 4, slotStart + SLOT_SIZE);
        if (!/^\d{4}\//.test(text)) continue; // blank slot
        const scrubbed = text.replace(/([NSEW]):(-?\d+)\.(\d+)/g, (_, ref, intPart, frac) => {
            const counter = String(100000 + slots).slice(0, frac.length).padStart(frac.length, "0");
            return `${ref}:${intPart}.${counter}`;
        });
        if (scrubbed.length !== text.length) {
            console.error(`slot ${i + 1}: scrub changed record length - aborting`);
            exit(1);
        }
        trailer.write(scrubbed, slotStart + 4, "latin1");
        slots++;
    }
    return slots;
}

function main() {
    const [, , inputArg, outputArg] = argv;
    if (!inputArg || !outputArg) {
        console.error("usage: node scripts/anonymize-ligogps-trailer-mp4.mjs <input.mp4> <output.mp4>");
        exit(1);
    }
    const input = resolve(inputArg);
    const output = resolve(outputArg);
    if (!existsSync(input)) {
        console.error(`input not found: ${input}`);
        exit(1);
    }

    // 1. Synthetic video part.
    const scriptsDir = dirname(fileURLToPath(import.meta.url));
    // CRF 35: the 2K/4K testsrc2 pattern at default rate control busts the
    // 5 MB fixture budget; the video content itself is irrelevant here.
    const base = spawnSync("node", [join(scriptsDir, "anonymize-mp4.mjs"), input, output, "--crf", "35"], {
        stdio: "inherit",
    });
    if (base.status !== 0) {
        console.error("anonymize-mp4.mjs failed");
        exit(1);
    }

    // 2. Real trailer, scrubbed.
    const fileSize = statSync(input).size;
    const fd = openSync(input, "r");
    const trailerStart = findTrailerStart(fd, fileSize);
    if (trailerStart >= fileSize) {
        console.error("no trailer after the last top-level box");
        exit(1);
    }
    const trailer = Buffer.alloc(fileSize - trailerStart);
    readSync(fd, trailer, 0, trailer.length, trailerStart);
    closeSync(fd);

    const originalCoords = new Set();
    for (const m of trailer.toString("latin1").matchAll(/[NSEW]:-?\d+\.(\d{4,})/g)) {
        originalCoords.add(m[1]);
    }

    let encrypted = 0;
    let plaintext = 0;
    const magicOffsets = findMagicOffsets(trailer);
    for (let k = 0; k < magicOffsets.length; k++) {
        const magicOff = magicOffsets[k];
        const recordsStart = magicOff + DIR_HEADER;
        if (isHashMarker(trailer, recordsStart)) {
            // Directory ends where the next one's 16-byte '****'+sizes+SKIP
            // prefix begins (or at the trailer end for a lone directory).
            const next = magicOffsets[k + 1];
            const dirEnd = next !== undefined ? next - 16 : trailer.length;
            if (next !== undefined && trailer.readUInt32BE(dirEnd) !== 0x2a2a2a2a) {
                console.error(`no '****' prefix before directory at ${next} - unexpected layout, aborting`);
                exit(1);
            }
            encrypted += scrubEncryptedDir(trailer, recordsStart, dirEnd);
        } else {
            plaintext += scrubPlaintextDir(trailer, magicOff);
        }
    }
    if (plaintext === 0) {
        console.error("no plaintext LIGOGPSINFO records found - wrong input?");
        exit(1);
    }

    // 3. Verify: no original fractional coordinate survives anywhere in the
    // scrubbed trailer (covers the zeroed cipher bodies too - they are binary,
    // but a missed slot would keep its ASCII twin).
    const scrubbedAscii = trailer.toString("latin1");
    for (const frac of originalCoords) {
        if (scrubbedAscii.includes(frac)) {
            console.error(`original coordinate fraction ${frac} survived scrubbing - aborting`);
            exit(1);
        }
    }

    appendFileSync(output, trailer);
    console.log(
        `appended ${trailer.length}-byte trailer: ${plaintext} plaintext records scrubbed, ${encrypted} encrypted chunk bodies zeroed`,
    );
}

main();
