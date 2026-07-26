#!/usr/bin/env node
// Anonymize a real Navitel R-series .MOV into a public-safe fixture for the
// gps0-tail extractor test.
//
// Real file structure (Navitel R600 sample):
//   ftyp / skip / mdat / moov / IDIT / gpsa / gps0 / gsea / gsen
//
// Anonymization:
//   1. Find IDIT and gps0 top-level boxes by forward-walk.
//   2. Redact gps0 records: round lat/lon DDmm.mmmm doubles to integer
//      degrees (50.0 N / 30.0 E sentinel coords). Keep first N records.
//   3. Wrap into a minimal MP4: ftyp + tiny moov-stub + IDIT (real bytes)
//      + gps0 (with redacted records). gpsa/gsea/gsen dropped - our extractor
//      doesn't need them.
//
// Real fields kept (not PII): IDIT date string, gps0 record speed/day/hour/
// minute/second/sub-second, padding bytes. Only the lat/lon doubles are
// overwritten.
//
// Usage:
//   node scripts/anonymize-navitel-mov.mjs <input.mov> <output.mov> [numRecords=5]

import { openSync, readSync, closeSync, statSync, writeFileSync } from "node:fs";

const HEADER_PROBE = 16;
const GPS0_RECORD_SIZE = 32;

function readBoxHeader(fd, offset, fileSize) {
    const buf = Buffer.alloc(Math.min(HEADER_PROBE, fileSize - offset));
    readSync(fd, buf, 0, buf.length, offset);
    if (buf.length < 8) return null;
    let size = buf.readUInt32BE(0);
    const type = buf.toString("ascii", 4, 8);
    let headerSize = 8;
    if (size === 1) {
        if (buf.length < 16) return null;
        const hi = buf.readUInt32BE(8);
        const lo = buf.readUInt32BE(12);
        size = hi * 0x100000000 + lo;
        headerSize = 16;
    } else if (size === 0) {
        size = fileSize - offset;
    }
    if (size < headerSize || offset + size > fileSize) return null;
    return { type, size, headerSize };
}

function findTopLevel(fd, fileSize, wantedTypes) {
    const out = new Map();
    let pos = 0;
    while (pos + 8 <= fileSize) {
        const h = readBoxHeader(fd, pos, fileSize);
        if (!h) break;
        if (wantedTypes.has(h.type) && !out.has(h.type)) {
            out.set(h.type, { offset: pos, size: h.size, headerSize: h.headerSize });
        }
        pos += h.size;
    }
    return out;
}

function fourCC(s) { return Buffer.from(s, "ascii"); }
function box(type, payload) {
    const size = 8 + payload.length;
    const head = Buffer.alloc(8);
    head.writeUInt32BE(size, 0);
    fourCC(type).copy(head, 4);
    return Buffer.concat([head, payload]);
}
function u32be(n) { const b = Buffer.alloc(4); b.writeUInt32BE(n, 0); return b; }

// Convert decimal degrees -> NMEA DDmm.mmmm double.
function degToDDmm(deg) {
    const sign = deg < 0 ? -1 : 1;
    const abs = Math.abs(deg);
    const d = Math.floor(abs);
    const m = (abs - d) * 60;
    return sign * (d * 100 + m);
}

const [, , inputPath, outputPath, numRecArg] = process.argv;
if (!inputPath || !outputPath) {
    console.error("usage: anonymize-navitel-mov.mjs <input.mov> <output.mov> [numRecords=5]");
    process.exit(1);
}
const numRecords = Number(numRecArg ?? 5);

const stat = statSync(inputPath);
const fd = openSync(inputPath, "r");

const boxes = findTopLevel(fd, stat.size, new Set(["IDIT", "gps0"]));
const iditBox = boxes.get("IDIT");
const gps0Box = boxes.get("gps0");

if (!iditBox || !gps0Box) {
    console.error(`missing tail atoms: IDIT=${!!iditBox} gps0=${!!gps0Box}`);
    process.exit(1);
}

const iditBuf = Buffer.alloc(iditBox.size);
readSync(fd, iditBuf, 0, iditBox.size, iditBox.offset);

const gps0Buf = Buffer.alloc(gps0Box.size);
readSync(fd, gps0Buf, 0, gps0Box.size, gps0Box.offset);

closeSync(fd);

// Redact gps0 records: keep first numRecords with overwritten lat/lon.
const payloadStart = gps0Box.headerSize;
const payloadLen = gps0Box.size - payloadStart;
const recordCount = Math.floor(payloadLen / GPS0_RECORD_SIZE);
const keepCount = Math.min(numRecords, recordCount);

const baseLatDeg = 50.0;
const baseLonDeg = 30.0;
for (let i = 0; i < keepCount; i++) {
    const off = payloadStart + i * GPS0_RECORD_SIZE;
    const latDeg = baseLatDeg + i * 0.0001;
    const lonDeg = baseLonDeg + i * 0.0001;
    gps0Buf.writeDoubleLE(degToDDmm(latDeg), off);
    gps0Buf.writeDoubleLE(degToDDmm(lonDeg), off + 8);
}

// Trim gps0 to keepCount records.
const trimmedPayloadLen = keepCount * GPS0_RECORD_SIZE;
const newGps0Size = payloadStart + trimmedPayloadLen;
const gps0Header = Buffer.alloc(8);
gps0Header.writeUInt32BE(newGps0Size, 0);
fourCC("gps0").copy(gps0Header, 4);
const gps0Final = Buffer.concat([gps0Header, gps0Buf.subarray(payloadStart, payloadStart + trimmedPayloadLen)]);

// Minimal MP4 wrapper: ftyp + tiny-moov-stub + IDIT + gps0.
const ftyp = box("ftyp", Buffer.concat([fourCC("qt  "), u32be(0), fourCC("qt  ")]));
// Minimal moov with empty mvhd payload - our extractor doesn't touch moov,
// this is only here so Mp4Index doesn't choke.
const mvhd = box("mvhd", Buffer.alloc(108));
const moov = box("moov", mvhd);

const out = Buffer.concat([ftyp, moov, iditBuf, gps0Final]);
writeFileSync(outputPath, out);
console.error(`wrote ${out.length} bytes (${keepCount} gps0 records) to ${outputPath}`);
