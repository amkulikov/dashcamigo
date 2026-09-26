#!/usr/bin/env node
// Keep two real Viidure PES packets, round coordinates to whole degrees,
// and interleave them into fresh testsrc2/sine media. No source media is copied.
// H.264 keeps GPS/pairing playback checks independent of OS-specific HEVC support.
// Usage: node scripts/anonymize-viidure-ts.mjs <input.ts> <output.ts>
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [, , inputPath, outputPath] = process.argv;
if (!inputPath || !outputPath) throw new Error("usage: anonymize-viidure-ts.mjs <input.ts> <output.ts>");
const input = readFileSync(inputPath);
const packets = [];
for (let off = 0; off + 188 <= input.length && packets.length < 2; off += 188) {
    if (input[off] !== 0x47 || !(input[off + 1] & 0x40)) continue;
    const af = (input[off + 3] >> 4) & 3;
    if (af !== 1 && af !== 3) continue;
    const pes = off + 4 + (af === 3 ? 1 + input[off + 4] : 0);
    if (pes + 6 > off + 188 || !input.subarray(pes, pes + 4).equals(Buffer.from([0, 0, 1, 0xbf]))) continue;
    const start = pes + 6;
    const length = input.readUInt16BE(pes + 4);
    if (start + length > off + 188) continue;
    const body = input.subarray(start, start + length);
    if (!body.subarray(0, 7).equals(Buffer.from("Viidure"))) continue;
    const zero = body.indexOf(0);
    if (zero < 0 || body.subarray(zero).some((byte) => byte !== 0)) throw new Error("unexpected payload padding");
    const original = body.subarray(0, zero).toString("ascii");
    if (
        !/^Viidure20\d{2}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2} [NS]:[\d.]+ [EW]:[\d.]+ [\d.]+ km\/h [\d.]+ [-\d.]+ \d+ x:[-\d.]+ y:[-\d.]+ z:[-\d.]+$/.test(
            original,
        )
    ) {
        throw new Error("unexpected viidure record shape");
    }
    let changed = 0;
    const sanitized = original.replace(/([NSEW]:)(\d+\.\d+)/g, (_, prefix, value) => {
        const rounded = Math.round(Number(value));
        if (rounded === Number(value)) throw new Error("source coordinate is unchanged");
        changed++;
        return prefix + rounded.toFixed(value.split(".")[1].length).padStart(value.length, "0");
    });
    if (changed !== 2 || sanitized.length !== original.length) throw new Error("coordinate rewrite failed");
    // Unknown adaptation metadata could contain identifiers; accept stuffing only.
    if (af === 3 && (input[off + 5] !== 0 || input.subarray(off + 6, pes).some((byte) => byte !== 0xff))) {
        throw new Error("unexpected adaptation metadata");
    }
    const packet = Buffer.from(input.subarray(off, off + 188));
    packet.fill(0, start - off);
    packet.write(sanitized, start - off, "ascii");
    packets.push(packet);
}
if (packets.length !== 2) throw new Error("two viidure records are required");

const temp = mkdtempSync(join(tmpdir(), "viidure-fixture-"));
try {
    const basePath = join(temp, "base.ts");
    const result = spawnSync(
        "ffmpeg",
        [
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            "testsrc2=size=320x180:rate=30:duration=2",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=1000:sample_rate=16000:duration=2",
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-crf",
            "35",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-ac",
            "2",
            "-b:a",
            "32k",
            "-af",
            "volume=0.1",
            "-f",
            "mpegts",
            basePath,
        ],
        { stdio: ["ignore", "ignore", "inherit"] },
    );
    if (result.status !== 0) throw new Error("ffmpeg failed");
    const base = readFileSync(basePath);
    const middle = Math.floor(base.length / 188 / 2) * 188;
    const output = Buffer.concat([
        base.subarray(0, 188 * 3),
        packets[0],
        base.subarray(188 * 3, middle),
        packets[1],
        base.subarray(middle),
    ]);
    writeFileSync(outputPath, output);
    console.error(`sanitized 2 GPS records; synthetic media; ${output.length} bytes`);
} finally {
    rmSync(temp, { recursive: true, force: true });
}
