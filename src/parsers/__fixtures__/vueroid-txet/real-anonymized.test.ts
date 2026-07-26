// Regression test on a real-anonymized Vueroid S1 4K Infinite fixture:
// actual container structure (freeRECO config boxes + tvxt/mp4s track with
// the real 50/51 ms stts cadence and the zeroed terminator row), coordinates
// replaced with a sentinel (50.0 N / 30.0 W - the file's own N/W hemisphere
// flags are kept), accel/speed/altitude/timestamps kept verbatim.
//
// Source: scripts/anonymize-vueroid-mp4.mjs.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { buildMp4Index } from "../../internal/mp4-index.js";
import { vueroidTxetPrimitive } from "../../primitives/vueroid-txet.js";

const FIXTURE = resolve(dirname(fileURLToPath(import.meta.url)), "real-anonymized.mp4");

// The camera-local wall clock the real firmware wrote into the first fix row
// (2025-11-11T08:54:23 local stored as fake-UTC unix) - kept by the
// anonymizer, must round-trip verbatim.
const FIRST_ROW_LOCAL_UNIX = Date.UTC(2025, 10, 11, 8, 54, 23) / 1000;

describe("real-anonymized Vueroid S1 4K Infinite fixture", () => {
    async function parseFixture() {
        const buf = readFileSync(FIXTURE);
        const file = new File([buf], "20251111_085423_INF_F_N.mp4");
        const vf = { file, relativePath: "20251111_085423_INF_F_N.mp4" };
        const index = await buildMp4Index(file);
        return { vf, index };
    }

    it("marker fires on the real container structure", async () => {
        const { vf, index } = await parseFixture();
        expect(await vueroidTxetPrimitive.marker(vf, index)).toBe(true);
    });

    it("parses 60 sentinel fixes at ~20 Hz, terminator row skipped silently", async () => {
        const { vf, index } = await parseFixture();
        const result = await vueroidTxetPrimitive.parse(vf, index);

        // 61 samples in the fixture: 60 fixes + the zeroed terminator.
        expect(result.records).toHaveLength(60);
        expect(result.skipped).toHaveLength(0);

        const first = result.records[0]!;
        // Sentinel coords with the file's own N/W hemisphere flags.
        expect(first.lat).toBeCloseTo(50.0, 4);
        expect(first.lon).toBeCloseTo(-30.0, 4);
        // Real firmware speed of the first row (27.0 km/h in the source clip).
        expect(first.speedMs).toBeCloseTo(27 / 3.6, 5);
        expect(first.active).toBe(true);

        // Local-clock quarantine: unsynced + media-time offsets, absolute
        // value = the camera-local stamp.
        expect(first.unixSeconds).toBe(FIRST_ROW_LOCAL_UNIX);
        for (const r of result.records) {
            expect(r.timeUnsynced).toBe(true);
            expect(Number.isFinite(r.relStartSeconds)).toBe(true);
        }

        // Real 50/51 ms stts cadence: strictly monotonic, ~20 Hz, 60 samples
        // span ~3 s.
        for (let i = 1; i < result.records.length; i++) {
            const dt = result.records[i]!.unixSeconds - result.records[i - 1]!.unixSeconds;
            expect(dt).toBeGreaterThan(0.04);
            expect(dt).toBeLessThan(0.06);
        }

        // Sentinel track advances +0.0001 deg per clock second (1 Hz fix
        // cadence) - the last records sit ~3 s after the first.
        const last = result.records[59]!;
        expect(last.lat).toBeGreaterThan(50.0);
        expect(last.lat).toBeLessThan(50.001);
        expect(last.lon).toBeLessThan(-30.0);
        expect(last.lon).toBeGreaterThan(-30.001);

        // Accel is real firmware data with the static component removed:
        // per-axis mean over the clip ~0, dynamics stay sub-g.
        const meanX = result.records.reduce((a, r) => a + r.accelXg, 0) / result.records.length;
        const meanY = result.records.reduce((a, r) => a + r.accelYg, 0) / result.records.length;
        const meanZ = result.records.reduce((a, r) => a + r.accelZg, 0) / result.records.length;
        expect(Math.abs(meanX)).toBeLessThan(1e-6);
        expect(Math.abs(meanY)).toBeLessThan(1e-6);
        expect(Math.abs(meanZ)).toBeLessThan(1e-6);
        for (const r of result.records) {
            expect(Math.hypot(r.accelXg, r.accelYg, r.accelZg)).toBeLessThan(1);
        }
    });
});
