#!/usr/bin/env node
// Anonymizes real 70mai $V02 GPS logs from private/ into committed
// test fixtures. Keeps exactly the structure the parser depends on (format,
// delimiters, validity flags, column order, accel columns) but strips location
// by rounding lat/lon to whole degrees (~110 km - the region stays undisclosed).
//
// Two models are onboarded on purpose: the accelerometer's gravity-bearing
// axis is MODEL-DEPENDENT - x800 carries ~1g on field6/ay (column 7), A810 on
// field5/ax (column 6). Both fixtures exist so the regression test can prove
// gravity removal is model-agnostic (see csv-70mai.ts and real-anonymized.test.ts).
//
// Timestamps and MP4 filenames carry over as-is: recording time without
// coordinates or video content isn't sensitive, and shifting it would only
// confuse debugging given this script ships in the repo.
//
// Run:
//   node scripts/anonymize-70mai-log.mjs
//
// Idempotent w.r.t. its inputs: re-running gives the same output (determined
// only by input content + the constants below).

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// input -> output. Inputs live in the gitignored private/ (never
// committed); outputs are the committed fixtures.
const SAMPLES = [
    {
        input: "private/samples/70mai-x800-GPSData000001.txt",
        output: "src/parsers/__fixtures__/70mai/real-anonymized-x800.txt",
    },
    {
        input: "private/samples/70mai-a810-GPSData000001.txt",
        output: "src/parsers/__fixtures__/70mai/real-anonymized-a810.txt",
    },
];

// Records per fixture: enough to show the accel axis and a session, small
// enough to keep the diff readable.
const MAX_LINES = 50;
const FIELDS_PER_ROW = 13;

// Rounds one log's records to whole-degree coordinates, keeping the first
// MAX_LINES well-formed rows. Malformed rows are skipped here (parser edge
// cases are covered by synthetic-edge.txt, not the real fixture).
function anonymizeLog(text) {
    const lines = text.split(/\r?\n/);
    const out = [];
    // The $V02 signature is the first line and carries over 1-to-1.
    out.push(lines[0]);

    let kept = 0;
    for (let i = 1; i < lines.length && kept < MAX_LINES; i++) {
        const raw = lines[i];
        if (raw === "") continue;
        const parts = raw.split(",");
        if (parts.length !== FIELDS_PER_ROW) continue;

        const lat = Math.round(Number(parts[2])).toFixed(6);
        const lon = Math.round(Number(parts[3])).toFixed(6);

        out.push(
            [
                parts[0],
                parts[1],
                lat,
                lon,
                parts[4],
                parts[5],
                parts[6],
                parts[7],
                parts[8],
                parts[9],
                parts[10],
                parts[11],
                parts[12],
            ].join(","),
        );
        kept++;
    }

    out.push("");
    return { text: out.join("\n"), kept };
}

function main() {
    for (const { input, output } of SAMPLES) {
        const { text, kept } = anonymizeLog(readFileSync(resolve(REPO_ROOT, input), "utf8"));
        const outPath = resolve(REPO_ROOT, output);
        mkdirSync(dirname(outPath), { recursive: true });
        writeFileSync(outPath, text);
        console.log(`wrote ${kept} anonymized records -> ${output}`);
    }
}

main();
