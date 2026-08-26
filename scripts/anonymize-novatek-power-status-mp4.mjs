#!/usr/bin/env node
// Preserves the real Novatek power-status blocks from a GPS-less source MOV.
// The handler copies a block only after an allowlist check proves it contains
// PWRS/ACC/PwrKey state plus zeros and therefore cannot carry coordinates,
// timestamps, audio, or video from the source recording.
//
// Used through scripts/anonymize-mp4.mjs:
//   --embedded-gps-handler scripts/anonymize-novatek-power-status-mp4.mjs

// The generic anonymizer replaces the media tracks. This handler appends two
// genuine 512-byte status records so the fixture still pins the `freeGPS`
// false-positive that the embedded probe must reject without inventing fixes.

import { appendFileSync, readFileSync } from "node:fs";

const MAGIC = Buffer.from("freeGPS ");
const BLOCK_BYTES = 512;
const FIXTURE_BLOCKS = 2;
const STATUS_TEXT = /^PWRS=\d,ACC=\d\r\n\0\0PwrKey=\d \r\n\0{5}$/;

function freeBox(payload) {
    const header = Buffer.alloc(8);
    header.writeUInt32BE(header.length + payload.length, 0);
    header.write("free", 4, "ascii");
    return Buffer.concat([header, payload]);
}

function safeStatusBlock(source, literalOffset) {
    const start = literalOffset - 4;
    if (start < 0 || start + BLOCK_BYTES > source.length) return null;
    const block = source.subarray(start, start + BLOCK_BYTES);
    if (block.readUInt32LE(0) !== BLOCK_BYTES) return null;
    if (!block.subarray(4, 12).equals(MAGIC)) return null;
    if (block.readUInt32LE(12) !== 100) return null;
    if (!STATUS_TEXT.test(block.subarray(16, 48).toString("latin1"))) return null;
    for (let i = 48; i < block.length; i++) {
        if (block[i] !== 0) return null;
    }
    return block;
}

export default async function preserveNovatekPowerStatus({ originalInput, fixtureOutput }) {
    const source = readFileSync(originalInput);
    const blocks = [];
    let offset = 0;
    while (blocks.length < FIXTURE_BLOCKS) {
        const literalOffset = source.indexOf(MAGIC, offset);
        if (literalOffset < 0) break;
        const block = safeStatusBlock(source, literalOffset);
        if (block) blocks.push(block);
        offset = literalOffset + MAGIC.length;
    }
    if (blocks.length < FIXTURE_BLOCKS) {
        throw new Error(`expected ${FIXTURE_BLOCKS} safe Novatek power-status blocks, found ${blocks.length}`);
    }
    appendFileSync(fixtureOutput, Buffer.concat(blocks.map(freeBox)));
}
