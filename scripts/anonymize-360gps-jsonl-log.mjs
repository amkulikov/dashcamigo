#!/usr/bin/env node
// Anonymizes a preallocated 360GPSINFO JSONL log into a committed fixture.
// Keeps the local timestamp, five-second row cadence, numeric telemetry, NUL
// padding and footer, but rounds valid coordinates to whole degrees and trims
// the stream to a short multi-clip run.
//
// Run:
//   node scripts/anonymize-360gps-jsonl-log.mjs [input.TXT] [output.TXT]

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_INPUT =
    "private/incoming/Botslab G300H 2K/G300H/360CARDVR/GPS/20260824205434_000001GPS.TXT";
const DEFAULT_OUTPUT = "src/parsers/__fixtures__/360gps-jsonl/real-anonymized.TXT";
const MAX_RECORDS = 50;
const FOOTER_SIZE = 64;
const FOOTER_MAGIC = "360GPSINFO";

function isFiniteNumber(value) {
    return typeof value === "number" && Number.isFinite(value);
}

function main() {
    const input = resolve(REPO_ROOT, process.argv[2] ?? DEFAULT_INPUT);
    const output = resolve(REPO_ROOT, process.argv[3] ?? DEFAULT_OUTPUT);
    const source = readFileSync(input);
    const firstNul = source.indexOf(0);
    const used = source.subarray(0, firstNul < 0 ? source.length : firstNul).toString("utf8");
    const rows = used
        .split(/\r?\n/)
        .filter(Boolean)
        .slice(0, MAX_RECORDS)
        .map((line) => JSON.parse(line));
    if (rows.length !== MAX_RECORDS) throw new Error("not enough GPS records for fixture");

    let changedCoordinates = 0;
    const anonymized = rows.map((row) => {
        if (![row.a, row.o, row.s, row.d].every(isFiniteNumber)) throw new Error("bad source row");
        const isNoFix = row.a === 99 && row.o === 999 && row.s === 99;
        const a = isNoFix ? row.a : Math.round(row.a);
        const o = isNoFix ? row.o : Math.round(row.o);
        if (!isNoFix) {
            if (!Number.isInteger(a) || !Number.isInteger(o)) throw new Error("coordinate was not rounded");
            if (a === row.a && o === row.o) throw new Error("coordinate did not change");
            changedCoordinates++;
        }
        return JSON.stringify({ a, o, s: row.s, d: row.d, ...(row.t === undefined ? {} : { t: row.t }) });
    });
    if (changedCoordinates === 0) throw new Error("fixture contains no changed coordinates");
    if (anonymized.filter((line) => line.includes('"t":')).length !== 1) {
        throw new Error("fixture must keep exactly one timestamp anchor");
    }

    const text = Buffer.from(`${anonymized.join("\n")}\n`, "utf8");
    const outputSize = Math.max(source.length, text.length + FOOTER_SIZE);
    const bytes = Buffer.alloc(outputSize);
    text.copy(bytes);
    bytes.write(FOOTER_MAGIC, outputSize - FOOTER_SIZE, "ascii");
    bytes.writeUInt32LE(text.length, outputSize - FOOTER_SIZE + 16);

    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, bytes);
    console.log(`wrote ${rows.length} anonymized records (${text.length} used bytes)`);
}

main();
