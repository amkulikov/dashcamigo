#!/usr/bin/env node
// Generate synthetic local-only tracking inputs and exact per-frame boxes.
// Usage: node scripts/make-tracker-motion-fixture.mjs

import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const outputDir = resolve(dirname(fileURLToPath(import.meta.url)), "../tests/testdata/tracker-motion");
const fps = 30;
const segments = [
    { name: "motion-960.mp4", width: 960, height: 540, tripStart: 0, durationSec: 2 },
    { name: "motion-640.mp4", width: 640, height: 360, tripStart: 2, durationSec: 2 },
];
const frames = [];
mkdirSync(outputDir, { recursive: true });

for (const segment of segments) {
    const encoder = spawn("ffmpeg", [
        "-y", "-hide_banner", "-loglevel", "error",
        "-f", "rawvideo", "-pixel_format", "rgb24", "-video_size", `${segment.width}x${segment.height}`,
        "-framerate", String(fps), "-i", "pipe:0",
        "-an", "-c:v", "libx264", "-profile:v", "main", "-pix_fmt", "yuv420p",
        "-crf", "15", "-preset", "slow", "-g", String(fps), "-bf", "0",
        "-movflags", "+faststart", resolve(outputDir, segment.name),
    ], { stdio: ["pipe", "ignore", "inherit"] });
    const completion = once(encoder, "close");
    for (let index = 0; index < segment.durationSec * fps; index++) {
        const contentSec = segment.tripStart + index / fps;
        const { width, height } = segment;
        const x0 = Math.round((0.15 + contentSec * 0.12) * width);
        const y0 = Math.round((0.22 + Math.sin(contentSec * Math.PI) * 0.025) * height);
        const objectW = Math.round(0.05 * width);
        const objectH = Math.round(0.07 * height);
        const pixels = Buffer.alloc(width * height * 3);
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const i = (y * width + x) * 3;
                const background = 28 + Math.floor(10 * x / width) + Math.floor(10 * y / height);
                let r = background;
                let g = background + 6;
                let b = background + 12;
                if (x >= x0 && x < x0 + objectW && y >= y0 && y < y0 + objectH) {
                    const u = (x - x0) / objectW;
                    const v = (y - y0) / objectH;
                    const cell = (Math.floor(u * 8) * 13 + Math.floor(v * 6) * 7) % 5;
                    [r, g, b] = [
                        [232, 195, 45],
                        [32, 88, 190],
                        [225, 65, 52],
                        [215, 224, 235],
                        [26, 35, 45],
                    ][cell];
                    if (u < 0.05 || u > 0.95 || v < 0.06 || v > 0.94) [r, g, b] = [240, 240, 240];
                }
                pixels[i] = r;
                pixels[i + 1] = g;
                pixels[i + 2] = b;
            }
        }
        frames.push({
            contentSec,
            rect: { xPct: x0 / width, yPct: y0 / height, wPct: objectW / width, hPct: objectH / height },
        });
        if (!encoder.stdin.write(pixels)) await once(encoder.stdin, "drain");
    }
    encoder.stdin.end();
    const [exitCode] = await completion;
    if (exitCode !== 0) throw new Error(`ffmpeg failed with exit code ${exitCode}`);
    writeFileSync(resolve(outputDir, `${segment.name}.source.md`),
        "# Synthetic tracking fixture\n\n" +
        "Source: [fixture generator](../../../scripts/make-tracker-motion-fixture.mjs).\n\n" +
        "Generated entirely from mathematical colors and shapes; contains no camera footage, people, plates, GPS, or external source material. The repository license applies.\n");
}
writeFileSync(resolve(outputDir, "motion.json"), `${JSON.stringify({ fps, segments, frames }, null, 2)}\n`);
