#!/usr/bin/env node
// Synthesize a public-safe MPEG-TS fixture for the generic plugin's .ts
// branch (4K HEVC sticks with an unidentified vendor).
//
// Unlike the other anonymize-*.mjs scripts in this folder, the source file
// here carries no GPS payload, no embedded metadata and no telemetry stream -
// only HEVC + AAC. There is nothing to "extract and rewrite"; instead we
// generate the fixture from scratch via ffmpeg testsrc2 + sine, keeping the
// container (MPEG-TS), codecs (HEVC Main / AAC LC mono) and frame rate that
// the parser pipeline actually cares about. Resolution is downsized to
// 1280x720 - mediabunny demux and our indexer treat dimensions as opaque, so
// a smaller fixture saves git weight (the original 4K sample is ~130 MB/min).
//
// Output naming: keep the exact filename from the incoming sample so the
// filename-time test exercises the real-world pattern.
//
// Usage:
//   node scripts/anonymize-ts-generic.mjs <output.ts> [duration=5]
//
// Re-run after changing duration/resolution to regenerate the committed
// fixture under src/parsers/__fixtures__/generic/. 5 s at CRF 35 yields a
// ~250 KB file - small enough for git, long enough for mediabunny to
// resolve duration (it samples PCR around the end of the file).

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

const [, , outputPath, durationArg] = process.argv;
if (!outputPath) {
    console.error("usage: anonymize-ts-generic.mjs <output.ts> [duration=60]");
    process.exit(1);
}
const durationSec = Number(durationArg ?? 5);
if (!Number.isFinite(durationSec) || durationSec <= 0) {
    console.error(`invalid duration: ${durationArg}`);
    process.exit(1);
}

const args = [
    "-y",
    "-f", "lavfi", "-i", `testsrc2=size=1280x720:rate=30:duration=${durationSec}`,
    "-f", "lavfi", "-i", `sine=frequency=1000:sample_rate=16000:duration=${durationSec}`,
    "-c:v", "libx265",
    "-preset", "ultrafast",
    "-x265-params", "log-level=error:crf=35",
    "-pix_fmt", "yuv420p",
    "-tag:v", "hvc1",
    "-c:a", "aac",
    "-ac", "1",
    "-ar", "16000",
    "-b:a", "64k",
    "-f", "mpegts",
    outputPath,
];

console.error(`generating ${durationSec}s HEVC+AAC MPEG-TS fixture -> ${outputPath}`);
const res = spawnSync("ffmpeg", args, { stdio: ["ignore", "inherit", "inherit"] });
if (res.status !== 0) {
    console.error(`ffmpeg exited with status ${res.status}`);
    process.exit(res.status ?? 1);
}
if (!existsSync(outputPath)) {
    console.error("ffmpeg reported success but output is missing");
    process.exit(1);
}
console.error("done");
