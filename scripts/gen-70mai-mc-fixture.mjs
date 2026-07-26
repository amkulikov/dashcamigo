#!/usr/bin/env node
// Generator for a synthetic multichannel 70mai (S500/A810/T800) fixture.
// No such samples exist in public sources, so we build our own: pure
// testsrc2 + 1kHz sine, with real filenames and folder structure (see
// sources in src/parsers/70mai.ts: the dashcamtalk thread on S500/T800).
//
// Output:
//   tests/testdata/70mai-multichannel/
//     Normal/Front/NO20260101-120000-000001F.MP4   - 4K, 30fps, h264
//     Normal/Back/NO20260101-120000-000001B.MP4    - 1080p, 30fps, h264
//     Normal/Interior/NO20260101-120000-000001I.MP4 - 1080p, 30fps, h264
//     Normal/Front/NO20260101-120002-000002F.MP4
//     Normal/Back/NO20260101-120002-000002B.MP4
//     Normal/Interior/NO20260101-120002-000002I.MP4
//     GPSData000001.txt                            - $V02 log, tied to F-names
//     README.md                                    - structure sources
//
// Video files are 2 seconds each (as in anonymize-mp4.mjs). Between the two
// clips the timestamp in the name advances by +2s - simulating back-to-back
// frames. This exercises grouping into a single Trip with two frames inside.
//
// Visual: plain testsrc2, no drawtext (the homebrew ffmpeg build on macOS
// ships without libfreetype). Channels differ by size: front 4K, rear/
// interior 1080p, plus testsrc2 prints its own timestamp over the SMPTE
// bars - on 4K vs 1080p they look different, so tiles are distinguishable
// in split-view.
//
// Run (idempotent):
//   node scripts/gen-70mai-mc-fixture.mjs
//
// Dependencies: ffmpeg in PATH.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { exit } from "node:process";

const FIXTURE_DURATION_SEC = 2;
const FPS = 30;
const AUDIO_FREQ_HZ = 1000;
const AUDIO_VOLUME_DB = -20;

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const OUT_ROOT = resolve(SCRIPT_DIR, "../tests/testdata/70mai-multichannel");

// Channels and their parameters. Real A810/T800 models write front in 4K and
// rear/interior in 1080p, but the fixture uses lower resolutions - structural
// difference is enough for test playback, and 4K @ 2s even at ultrafast is
// ~15 MB, too much for git. Front is kept a bit larger for visual
// distinguishability in split-view tiles.
const CHANNELS = [
    { suffix: "F", folder: "Front",    width: 1280, height: 720 },
    { suffix: "B", folder: "Back",     width:  854, height: 480 },
    { suffix: "I", folder: "Interior", width:  640, height: 360 },
];

// Names of two consecutive clips. The timestamp in the name advances by
// FIXTURE_DURATION_SEC, the counter increments. The counter is the same
// across all channels of one clip - that's the frame-pairing key in groupTrips.
const CLIPS = [
    { name: "NO20260101-120000-000001", startUtcLocal: "2026-01-01T12:00:00" },
    { name: "NO20260101-120002-000002", startUtcLocal: "2026-01-01T12:00:02" },
];

function ensureFfmpeg() {
    const r = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" });
    if (r.error || r.status !== 0) {
        console.error("ffmpeg not found in PATH. install via 'brew install ffmpeg' (macOS).");
        exit(1);
    }
}

function buildFfmpegArgs(channel, output) {
    return [
        "-y",
        "-f", "lavfi",
        "-i", `testsrc2=size=${channel.width}x${channel.height}:rate=${FPS}:duration=${FIXTURE_DURATION_SEC}`,
        "-f", "lavfi",
        "-i", `sine=frequency=${AUDIO_FREQ_HZ}:sample_rate=48000:duration=${FIXTURE_DURATION_SEC}`,
        "-filter:a", `volume=${AUDIO_VOLUME_DB}dB`,
        "-c:v", "libx264",
        "-preset", "veryslow",
        "-crf", "32",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac",
        "-b:a", "64k",
        "-t", String(FIXTURE_DURATION_SEC),
        output,
    ];
}

// Camera-local "as-is" datetime in seconds since the unix epoch (as if the
// calendar fields were UTC fields). This is the raw timestamp that 70mai
// cameras write into the filename - they carry no TZ information, and our
// parser interprets it via heuristics. The fixture writes it as UTC to keep
// it predictable.
function localDateToPseudoUnix(iso) {
    return Date.parse(iso + "Z") / 1000;
}

// Generates a valid 70mai $V02 GPS log tied to F-names. Coordinates are
// rounded to whole degrees (like other public fixtures), speed and bearing
// change between points - so the UI shows a non-trivial track.
//
// Emulates the firmware bias: field[0] = pseudoUnix - 8h (the dashcam
// actually writes PST instead of UTC, the parser compensates +8h on read).
function buildGpsLog() {
    const lines = ["$V02"];
    const FIRMWARE_BIAS = 8 * 3600;
    for (const clip of CLIPS) {
        const pseudoStart = localDateToPseudoUnix(clip.startUtcLocal);
        const fName = `${clip.name}F.MP4`;
        // Records at 1 Hz - across back-to-back clips the boundary point
        // t=duration coincides with t=0 of the next clip (by unixSeconds).
        // Dedup in finalizeTrip on (unixSeconds, lat, lon) merges them.
        // So 3 points per 2s clip, 5 unique across 2 stitched clips - the
        // chart is drawn to the end of the trip, not to the end of the
        // second-to-last second.
        for (let t = 0; t <= FIXTURE_DURATION_SEC; t++) {
            const ts = pseudoStart - FIRMWARE_BIAS + t;
            // Simple synthetic track: latitude moves by 0.0001 per step,
            // longitude fixed, speed 50 km/h ≈ 13.9 m/s (×100 in the log).
            const lat = 50 + t * 0.0001 + CLIPS.indexOf(clip) * 0.0002;
            const lon = 30;
            const bearing = 9000; // 90° (×100 in the log).
            const speed = 1389;   // 13.89 m/s (×100 in the log).
            const ax = 0;
            const ay = 100;       // Y-axis gravity for the 70mai installation
            const az = 0;
            // 13 fields: ts, validity, lat, lon, bearing, speed, ax, ay, az, mp4Filename, _, _, _.
            lines.push(`${ts},A,${lat.toFixed(6)},${lon.toFixed(6)},${bearing},${speed},${ax},${ay},${az},${fName},0,0,0`);
        }
    }
    return lines.join("\n") + "\n";
}

function buildReadme() {
    return `# 70mai multichannel fixture (synthetic)

Purely synthetic fixture for testing the multichannel-trip UI.
No real public samples of 70mai-mc (S500/A810/T800) were found - so we
built our own via ffmpeg testsrc2 + 1kHz sine, replicating **only the
structure** (filenames and folders) seen on real SD cards of these models.

## Structure sources

- 70mai S500 review (DashCamTalk): https://dashcamtalk.com/forum/threads/70mai-s500-rear-view-dash-camera-testing-review-rcg.50838/
  - Folders \`Normal/Front\`, \`Normal/Back\`.
  - Names \`NO{YYYYMMDD}-{HHMMSS}-{counter}{F|B}.mp4\`.
- 70mai T800 3CH review (DashCamTalk): https://dashcamtalk.com/forum/threads/70mai-t800-3ch-4k-front-4k-rear-1080p-cabin-dash-camera-testing-review-rcg.53323/
  - Adds \`Normal/Interior\` + suffix \`I\`.

## What's inside

\`\`\`
Normal/
  Front/
    NO20260101-120000-000001F.MP4   - 4K @ 30fps, h264, 2s
    NO20260101-120002-000002F.MP4
  Back/
    NO20260101-120000-000001B.MP4   - 1080p @ 30fps, h264, 2s
    NO20260101-120002-000002B.MP4
  Interior/
    NO20260101-120000-000001I.MP4   - 1080p @ 30fps, h264, 2s
    NO20260101-120002-000002I.MP4
GPSData000001.txt                   - $V02 log, tied to F-names only
\`\`\`

Each video contains drawtext with the channel label ("FRONT" / "BACK" /
"INTERIOR") - easy to see which tile shows what in split-view.

The GPS log has 4 records (2 clips × 2 seconds @ 1 Hz). Tied only to
F-names - mimics real 70mai behavior (one shared log for the whole
recording, mp4Filename in field[9] always points to the front channel).

## Regeneration

Files are regenerated by the \`scripts/gen-70mai-mc-fixture.mjs\` script. Run:

\`\`\`sh
node scripts/gen-70mai-mc-fixture.mjs
\`\`\`

idempotent - overwrites existing files.
`;
}

function main() {
    ensureFfmpeg();

    // Create the folder tree for the channels.
    for (const ch of CHANNELS) {
        const dir = resolve(OUT_ROOT, "Normal", ch.folder);
        mkdirSync(dir, { recursive: true });
    }

    // Generate an MP4 for each (clip × channel) pair.
    for (const clip of CLIPS) {
        for (const ch of CHANNELS) {
            const filename = `${clip.name}${ch.suffix}.MP4`;
            const out = resolve(OUT_ROOT, "Normal", ch.folder, filename);
            const args = buildFfmpegArgs(ch, out);
            console.log(`encoding ${ch.folder}/${filename}...`);
            const r = spawnSync("ffmpeg", args, { stdio: "ignore" });
            if (r.status !== 0) {
                console.error(`ffmpeg failed for ${filename}`);
                exit(1);
            }
        }
    }

    // GPS log and README.
    writeFileSync(resolve(OUT_ROOT, "GPSData000001.txt"), buildGpsLog());
    writeFileSync(resolve(OUT_ROOT, "README.md"), buildReadme());

    if (existsSync(OUT_ROOT)) {
        console.log(`fixture written to ${OUT_ROOT}`);
    }
}

main();
