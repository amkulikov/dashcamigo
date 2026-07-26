#!/usr/bin/env node
// Trims a BlackVue `.3gf` G-sensor sidecar down to a small fixture snapshot.
//
// The `.3gf` carries NO location and NO absolute time - only relative
// accelerometer samples (10-byte BE records: u32 ms-since-start + 3x i16 axes)
// and an ms offset from the clip start. There is nothing sensitive to mask, so
// "anonymize" here means only: keep the head, drop the rest, so the committed
// fixture is a readable few-second snapshot instead of a full minute.
//
// Records are copied byte-for-byte (the layout is what the test validates).
// Iteration stops at the 0xFFFFFFFF end-of-data sentinel if one appears inside
// the window, mirroring the parser.
//
// Run:
//   node scripts/anonymize-blackvue-3gf.mjs <input.3gf> <output.3gf>

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { argv, exit } from "node:process";

const RECORD_SIZE = 10;
const SENTINEL_MS = 0xffffffff;
const MAX_RECORDS = 50;

function usage() {
    console.error("usage: node scripts/anonymize-blackvue-3gf.mjs <input.3gf> <output.3gf>");
    exit(1);
}

function main() {
    const args = argv.slice(2);
    if (args.length < 2) usage();

    const input = resolve(args[0]);
    const output = resolve(args[1]);

    const buf = readFileSync(input);
    const total = Math.floor(buf.length / RECORD_SIZE);

    let kept = 0;
    for (let i = 0; i < total && kept < MAX_RECORDS; i++) {
        if (buf.readUInt32BE(i * RECORD_SIZE) === SENTINEL_MS) break;
        kept++;
    }

    const out = buf.subarray(0, kept * RECORD_SIZE);
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, out);
    console.log(`wrote ${kept} records (${out.length} bytes) to ${output}`);
}

main();
