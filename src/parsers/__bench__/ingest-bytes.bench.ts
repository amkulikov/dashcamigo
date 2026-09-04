import { readFileSync } from "node:fs";
import { bench, describe } from "vitest";
import { findFreeGpsOffsets, hasFreeGpsMarker } from "../internal/freegps.js";
import { findLigoGpsChunkOffset } from "../internal/ligogps.js";
import { loadSamples } from "../internal/mp4-walker.js";

const videoBytes = readFileSync(new URL("../../../tests/testdata/gopro-gpmf/hero8-trimmed.mp4", import.meta.url));
const novatekBytes = readFileSync(
    new URL("../../../tests/testdata/novatek-real-anonymized/2e-drive-730.mp4", import.meta.url),
);
const probe = new Uint8Array(16 * 1024 * 1024);
for (let offset = 0; offset < probe.length; offset += videoBytes.length) {
    probe.set(videoBytes.subarray(0, Math.min(videoBytes.length, probe.length - offset)), offset);
}
probe.set(novatekBytes, 2 * 1024 * 1024);

describe("ingest byte scans", () => {
    bench("freeGPS marker in a 16 MiB probe", () => {
        hasFreeGpsMarker(probe, probe.length);
    });
    bench("freeGPS seeds in a 16 MiB probe", () => {
        findFreeGpsOffsets(probe, 0, probe.length, 8);
    });
    bench("absent LigoGPS marker in a 16 MiB probe", () => {
        findLigoGpsChunkOffset(probe);
    });
});

const video = new File([videoBytes], "samples.mp4");
const samples = Array.from({ length: 2000 }, (_, index) => ({ offset: index * 256, size: 256, index: index + 1 }));

describe("ingest sample reads", () => {
    bench("stream 2000 dense byte ranges", async () => {
        await loadSamples(video, samples, 10);
    });
});
