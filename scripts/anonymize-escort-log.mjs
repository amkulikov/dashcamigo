#!/usr/bin/env node
// Anonymizes a real Escort .map log from private/ for use as a test
// fixture. Keeps exactly the file structure the parser depends on (field
// format, delimiters, flags), but strips location.
//
// What it does:
//  1. Takes the first MAX_LINES records.
//  2. Rounds coordinates to a whole degree (DDMM.MMMM → DD00.0000 in the same
//     NMEA notation). ~110 km precision - region stays undisclosed.
//  3. Leaves timestamps and accelerometer as-is. Without coordinates or video
//     these fields aren't sensitive; shifting them would only hurt debugging
//     given the script's source is kept in the repo.
//  4. Leaves speed as-is - not sensitive without coordinates.
//
// Run:
//   node scripts/anonymize-escort-log.mjs
//
// The script is idempotent: re-running gives the same output for the same input.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const INPUT = resolve(REPO_ROOT, "private/incoming/new/20260511_0016_CAM.map");
const OUTPUT = resolve(REPO_ROOT, "src/parsers/__fixtures__/escort/real-anonymized.map");

const MAX_LINES = 10;

// DDMM.MMMM (lat) or DDDMM.MMMM (lon) → rounded to a whole degree, in the same
// NMEA notation. Input "1234.5678" → output "1200.0000".
function roundCoordToDegree(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return value;
    const deg = Math.floor(num / 100);
    return `${deg.toString().padStart(value.indexOf(".") - 2, "0")}00.0000`;
}

function main() {
    const text = readFileSync(INPUT, "utf8");
    const lines = text.split(/\r?\n/);
    const out = [];

    let kept = 0;
    for (let i = 0; i < lines.length && kept < MAX_LINES; i++) {
        const raw = lines[i];
        if (raw === "") continue;
        // Strip the ";" terminator so split by "," doesn't pull it into the last field.
        const body = raw.endsWith(";") ? raw.slice(0, -1) : raw;
        const parts = body.split(",");
        if (parts.length !== 11) {
            // Malformed line in the source - skip it; edge cases are covered
            // by synthetic-edge.map.
            continue;
        }

        const newParts = [
            parts[0], // A/V
            parts[1], // date DDMMYY
            parts[2], // time HHMMSS
            roundCoordToDegree(parts[3]),
            parts[4], // N/S
            roundCoordToDegree(parts[5]),
            parts[6], // E/W
            parts[7], // speed km/h
            parts[8], // accel X
            parts[9], // accel Y
            parts[10], // accel Z
        ];
        out.push(`${newParts.join(",")};`);
        kept++;
    }

    out.push("");
    mkdirSync(dirname(OUTPUT), { recursive: true });
    writeFileSync(OUTPUT, out.join("\n"));
    console.log(`wrote ${kept} anonymized records to ${OUTPUT}`);
}

main();
