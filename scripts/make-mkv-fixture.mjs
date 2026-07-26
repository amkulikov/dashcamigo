#!/usr/bin/env node
// Synthesize a public-safe Matroska (.mkv) fixture for the MKV playback/export
// path. Like anonymize-ts-generic.mjs, there is no real sample to scrub: the
// file is generated from scratch via ffmpeg testsrc2 + sine, keeping only the
// characteristics the pipeline cares about - the Matroska container plus a
// browser-decodable video codec (H.264). Browsers do not play .mkv through
// <video>.src, so the app routes it through the mediabunny MSE-remux backend;
// H.264 decodes everywhere (incl. Linux CI Chrome), so the e2e can run
// unconditionally, unlike the HEVC fixture.
//
// Audio is AAC-LC so the fixture also exercises the "stream-copy the audio
// track out of MKV" path (the common case for viewer/tool re-exports). ADPCM
// audio - the codec mediabunny cannot read - is deliberately NOT covered here:
// that track drops gracefully (video plays silent), which needs no fixture.
//
// Usage:
//   node scripts/make-mkv-fixture.mjs <output.mkv> [duration=3]
//
// Re-run to regenerate the committed fixtures under
// src/parsers/__fixtures__/generic/ and tests/testdata/mkv-h264/.

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

const [, , outputPath, durationArg] = process.argv;
if (!outputPath) {
    console.error("usage: make-mkv-fixture.mjs <output.mkv> [duration=3]");
    process.exit(1);
}
const durationSec = Number(durationArg ?? 3);
if (!Number.isFinite(durationSec) || durationSec <= 0) {
    console.error(`invalid duration: ${durationArg}`);
    process.exit(1);
}

const args = [
    "-y",
    "-f", "lavfi", "-i", `testsrc2=size=640x360:rate=30:duration=${durationSec}`,
    "-f", "lavfi", "-i", `sine=frequency=1000:sample_rate=48000:duration=${durationSec}`,
    "-c:v", "libx264",
    "-profile:v", "main",
    "-preset", "ultrafast",
    "-pix_fmt", "yuv420p",
    "-g", "30",
    "-c:a", "aac",
    "-ac", "2",
    "-b:a", "64k",
    "-f", "matroska",
    outputPath,
];

console.error(`generating ${durationSec}s H.264+AAC Matroska fixture -> ${outputPath}`);
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
