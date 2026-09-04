import { readFileSync } from "node:fs";
import { bench, describe } from "vitest";
import { mergeAccelSamples } from "../registry-light.js";
import { parse3gfBuffer } from "../sidecars/blackvue-3gf.js";
import type { AccelSample, GpsRecord } from "../types.js";

const fixture = readFileSync(new URL("../__fixtures__/blackvue/real-anonymized.3gf", import.meta.url));
const seed = parse3gfBuffer(Uint8Array.from(fixture).buffer);
const samples: AccelSample[] = [];
const startUtc = 1_700_000_000;
const durationSec = 3600;
for (let index = 0; index < durationSec * 10; index++) {
    samples.push({ ...seed[index % seed.length]!, msSinceStart: index * 100 });
}
const accelByFileKey = new Map([["a.mp4", samples]]);
const starts = new Map([["a.mp4", startUtc]]);

function recordsAtHz(hz: number): GpsRecord[] {
    return Array.from({ length: durationSec * hz }, (_, index) => ({
        unixSeconds: startUtc + index / hz,
        active: true,
        lat: 50,
        lon: 30,
        bearingDeg: 0,
        speedMs: 11,
        accelXg: 0,
        accelYg: 0,
        accelZg: 0,
        mp4Filename: "a.mp4",
    }));
}

const sparse = recordsAtHz(1 / durationSec);
const oneHz = recordsAtHz(1);
const fiveHz = recordsAtHz(5);

describe("ingest accelerometer merge", () => {
    bench("one GPS row against one hour of 10 Hz IMU", () => {
        mergeAccelSamples(sparse, accelByFileKey, starts);
    });
    bench("one hour of 1 Hz GPS and 10 Hz IMU", () => {
        mergeAccelSamples(oneHz, accelByFileKey, starts);
    });
    bench("one hour of 5 Hz GPS and 10 Hz IMU", () => {
        mergeAccelSamples(fiveHz, accelByFileKey, starts);
    });
});
