#!/usr/bin/env node
// Public-safe playback fixtures: generated pixels, no source recordings or GPS.

import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../tests/testdata/asymmetric-channels");
const start = Date.UTC(2026, 0, 1, 12);
const clips = [
    ["ExteriorView", 0, 26],
    ["ExteriorView", 26, 26],
    ["ExteriorView", 52, 26],
    ["ExteriorView", 78, 26],
    ["InternalView", 0, 92],
    ["InternalView", 92, 12],
];

for (const [view, offset, duration] of clips) {
    const date = new Date(start + offset * 1000);
    const time = date.toISOString().slice(11, 19).replaceAll(":", "");
    const filename = `${time}_123_${String(duration - 1).padStart(3, "0")}_D.mp4`;
    const output = resolve(root, view, "260101", filename);
    mkdirSync(dirname(output), { recursive: true });
    const result = spawnSync("ffmpeg", [
        "-y", "-loglevel", "error",
        "-f", "lavfi", "-i", `testsrc2=size=160x90:rate=5:duration=${duration}`,
        "-vf", `hue=h=${view === "InternalView" ? 90 : 0}`,
        "-an", "-c:v", "libx264", "-profile:v", "baseline", "-preset", "veryfast",
        "-crf", "35", "-pix_fmt", "yuv420p", "-bf", "0", "-g", "5", "-keyint_min", "5",
        "-sc_threshold", "0", "-map_metadata", "-1", "-metadata", `creation_time=${date.toISOString()}`,
        "-movflags", "+faststart", output,
    ], { stdio: ["ignore", "inherit", "inherit"] });
    if (result.status !== 0) throw new Error(`ffmpeg failed for ${filename}`);
}
