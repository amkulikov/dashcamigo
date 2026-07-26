#!/usr/bin/env node
// Anonymizes a real Thinkware F-series MP4 (GPS in a tx3g subtitle track) into a
// compact parser fixture. Unlike scripts/anonymize-mp4.mjs (which rebuilds the
// VIDEO via testsrc2), the telemetry here lives in the subtitle track, so we:
//
//  1. demux the subtitle cues with ffmpeg (which handles the real container,
//     incl. moov-at-end);
//  2. strip the SRT styling wrappers back to the raw "gsensori,...;GxRMC,...;CAR"
//     cue text;
//  3. replace each GxRMC's lat/lon with a moving 50.0 N / 30.0 E sentinel
//     (~Baltic Sea, not PII) and recompute the NMEA checksum - timestamps,
//     speed, course, and the real gsensori accel counts are kept (not sensitive
//     without coordinates, per the private-zone policy);
//  4. truncate to the first ~10 GPS fixes for a small fixture;
//  5. re-wrap into the same minimal tx3g container the synthetic fixture uses.
//
// Usage: node scripts/anonymize-thinkware-mp4.mjs <input.mp4> <output.mp4>
// Requires ffmpeg in PATH.

import { spawnSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { argv, exit } from "node:process";
import { buildSbtlMp4 } from "../src/parsers/__fixtures__/thinkware/build-synthetic.mjs";

const TARGET_FIXES = 10;

function nmeaChecksum(body) {
    let c = 0;
    for (let i = 0; i < body.length; i++) c ^= body.charCodeAt(i);
    return c.toString(16).toUpperCase().padStart(2, "0");
}

function ddmm(deg) {
    const a = Math.abs(deg);
    return (Math.floor(a) * 100 + (a - Math.floor(a)) * 60).toFixed(5);
}

// Parses ffmpeg SRT output into ordered cue texts, stripping <font>/{\an7} tags.
function srtToCues(srt) {
    const cues = [];
    for (const block of srt.replace(/\r/g, "").split(/\n\n+/)) {
        const lines = block.split("\n");
        if (lines.length < 3) continue; // index + timing + >=1 text line
        const text = lines
            .slice(2)
            .join("\n")
            .replace(/<\/?font[^>]*>/g, "")
            .replace(/\{\\an\d\}/g, "");
        if (text.trim().length > 0) cues.push(text);
    }
    return cues;
}

// Rewrites the GxRMC segment inside a cue with sentinel coordinates. `fixIndex`
// advances the sentinel so the track moves; returns the cue unchanged when it
// carries no active RMC.
function scrubCue(cueText, fixIndex) {
    return cueText.replace(/(G[A-Z]RMC,[^;]*)/, (rmc) => {
        const trimmed = rmc.replace(/\*[0-9A-Fa-f]{2}\s*$/, "").trimEnd();
        const f = trimmed.split(",");
        // f: [GxRMC, time, status, lat, N/S, lon, E/W, speed, course, date, ...]
        if (f[2] !== "A") return rmc; // void fix - nothing to scrub
        f[3] = ddmm(50 + fixIndex * 0.0001);
        f[4] = "N";
        f[5] = ddmm(30 + fixIndex * 0.0001);
        f[6] = "E";
        const body = f.join(",");
        const trailingWs = rmc.match(/\s*$/)?.[0] ?? "";
        return `${body}*${nmeaChecksum(body)}${trailingWs}`;
    });
}

function main() {
    const [, , inputPath, outputPath] = argv;
    if (!inputPath || !outputPath) {
        console.error("usage: node scripts/anonymize-thinkware-mp4.mjs <input.mp4> <output.mp4>");
        exit(1);
    }
    if (!existsSync(inputPath)) {
        console.error(`input not found: ${inputPath}`);
        exit(1);
    }
    const ff = spawnSync("ffmpeg", ["-v", "error", "-i", inputPath, "-map", "0:s:0", "-f", "srt", "-"], {
        encoding: "utf8",
        maxBuffer: 256 * 1024 * 1024,
    });
    if (ff.status !== 0) {
        console.error(`ffmpeg failed: ${ff.stderr || ff.error}`);
        exit(1);
    }

    const cues = srtToCues(ff.stdout);
    const out = [];
    let fixes = 0;
    for (const cue of cues) {
        const hasActiveRmc = /G[A-Z]RMC,[^,]*,A,/.test(cue);
        out.push(scrubCue(cue, fixes));
        if (hasActiveRmc) fixes++;
        if (fixes >= TARGET_FIXES) break;
    }
    if (fixes === 0) {
        console.error("no active GPS fixes found in subtitle track");
        exit(1);
    }

    const mp4 = buildSbtlMp4(out);
    writeFileSync(resolve(outputPath), mp4);
    console.error(`wrote ${mp4.length} bytes (${out.length} cues, ${fixes} fixes) to ${outputPath}`);
}

main();
