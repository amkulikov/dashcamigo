// Quick measurement: where does mediabunny actually pay the cost on a TS file?
// Test path on a 358 MB Juscar .ts to separate:
//   - new Input             (should be ~0 per docs)
//   - getPrimaryVideoTrack  (PMT scan, expected cheap)
//   - vt.getDecoderConfig   (first SPS, expected cheap)
//   - sink.getKeyPacket(0)  (this might trigger the full sweep)
//   - sink.getNextPacket    (steady-state per-packet)
//   - input.computeDuration (used in indexer.ts:182, likely the real culprit)
//
// One-off diagnostic script, not part of the build.

import { readFile, stat } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { Input, BlobSource, EncodedPacketSink, MP4, QTFF, MPEG_TS } from "mediabunny";

const TS_PATH = "private/incoming/Juscar/video/front/20260512_150820F.ts";
const VIDEO_INPUT_FORMATS = [MP4, QTFF, MPEG_TS];

function pad(s, n) {
    return s.length >= n ? s : s + " ".repeat(n - s.length);
}

async function fileToBlob(path) {
    const buf = await readFile(path);
    return new Blob([buf]);
}

async function timed(label, fn) {
    const t0 = performance.now();
    const result = await fn();
    const dt = performance.now() - t0;
    console.log(pad(label, 38), `${dt.toFixed(1).padStart(8)} ms`);
    return result;
}

async function main() {
    const st = await stat(TS_PATH);
    console.log(`file: ${TS_PATH}`);
    console.log(`size: ${(st.size / 1024 / 1024).toFixed(1)} MiB`);
    console.log("");

    // --- Path A: playback-style (no computeDuration) ---
    {
        const blob = await fileToBlob(TS_PATH);
        console.log("--- playback path (per-file-mse.ts style) ---");
        const input = await timed("new Input(BlobSource)", () => Promise.resolve(new Input({ source: new BlobSource(blob), formats: VIDEO_INPUT_FORMATS })));
        const fmt = await timed("input.getFormat()", () => input.getFormat());
        console.log(`  -> format: ${fmt?.name ?? "<null>"}`);
        const vt = await timed("getPrimaryVideoTrack()", () => input.getPrimaryVideoTrack());
        if (!vt) {
            console.log("no video track");
            return;
        }
        await timed("vt.getCodec()", () => vt.getCodec());
        await timed("vt.getCodecParameterString()", () => vt.getCodecParameterString());
        await timed("vt.getDecoderConfig()", () => vt.getDecoderConfig());
        await timed("vt.getRotation()", () => vt.getRotation());

        const sink = new EncodedPacketSink(vt);
        const key = await timed("sink.getKeyPacket(0)", () => sink.getKeyPacket(0));
        const first = await timed("sink.getFirstPacket()", () => sink.getFirstPacket());

        let cur = key ?? first;
        const N = 100;
        const t0 = performance.now();
        for (let i = 0; i < N && cur; i++) {
            cur = await sink.getNextPacket(cur);
        }
        const dt = performance.now() - t0;
        console.log(pad(`sink.getNextPacket() x${N}`, 38), `${dt.toFixed(1).padStart(8)} ms  (${(dt / N).toFixed(2)} ms/pkt)`);

        // Seek into middle / near end - this is where mediabunny might do
        // a full file sweep to populate its random-access index.
        await timed("sink.getKeyPacket(60)", () => sink.getKeyPacket(60));
        await timed("sink.getKeyPacket(150)", () => sink.getKeyPacket(150));
        await timed("sink.getKeyPacket(280)", () => sink.getKeyPacket(280));
        // Repeat to see if cached.
        await timed("sink.getKeyPacket(150) again", () => sink.getKeyPacket(150));
        input.dispose();
    }

    console.log("");

    // --- Path B: indexer-style (computeDuration) ---
    {
        const blob = await fileToBlob(TS_PATH);
        console.log("--- indexer path (indexer.ts:182 style) ---");
        const input = await timed("new Input(BlobSource)", () => Promise.resolve(new Input({ source: new BlobSource(blob), formats: VIDEO_INPUT_FORMATS })));
        await timed("input.computeDuration()", () => input.computeDuration());
        await timed("getPrimaryVideoTrack()", () => input.getPrimaryVideoTrack());
        input.dispose();
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
