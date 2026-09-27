// Real-anonymized N/W and N/E recordings retain the original TXET cadence,
// terminator, hemisphere codes, accel, speed, altitude and timestamps.
// Coordinates use sentinels around 50 N / 30 W or E.
//
// Source: scripts/anonymize-vueroid-mp4.mjs.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { buildMp4Index } from "../../internal/mp4-index.js";
import { classifyFiles, dispatchParseVideoEmbeddedGps } from "../../registry.js";
import { decodeVueroidTxetRow, findVueroidTxetTrack } from "../../internal/vueroid-txet-extract.js";
import { readSampleTable } from "../../internal/mp4-walker.js";
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

describe("real-anonymized Vueroid N/E fixture", () => {
    function loadFile() {
        const buf = readFileSync(resolve(dirname(FIXTURE), "real-anonymized-ne.mp4"));
        const file = new File([buf], "20260923_134906_INF_F_N.mp4");
        return { file, relativePath: `INF/${file.name}` };
    }

    it("dispatches eastern-longitude fixes with the real media cadence", async () => {
        const result = await dispatchParseVideoEmbeddedGps(await classifyFiles([loadFile()]));
        expect(result.appliedExtractors).toEqual(["vueroid-txet"]);
        expect(result.errors).toEqual([]);
        expect(result.skipped).toEqual([]);
        expect(result.records).toHaveLength(38);
        const first = result.records[0]!;
        expect(first.lat).toBeCloseTo(50, 5);
        expect(first.lon).toBeCloseTo(30, 5);
        expect(first.speedMs).toBeCloseTo(82 / 3.6, 5);
        expect(first.unixSeconds).toBe(Date.UTC(2026, 8, 23, 13, 49, 5) / 1000);
        for (const [i, record] of result.records.entries()) {
            expect(record.timeUnsynced).toBe(true);
            expect(record.lat).toBeGreaterThanOrEqual(50);
            expect(record.lat).toBeLessThan(50.001);
            expect(record.lon).toBeGreaterThanOrEqual(30);
            expect(record.lon).toBeLessThan(30.001);
            expect(record.speedMs).toBeGreaterThan(0);
            expect(record.speedMs).toBeLessThan(30);
            if (i === 0) continue;
            const previous = result.records[i - 1]!;
            expect(record.unixSeconds - previous.unixSeconds).toBeGreaterThan(0.04);
            expect(record.unixSeconds - previous.unixSeconds).toBeLessThan(0.06);
            expect(record.relStartSeconds! - previous.relStartSeconds!).toBeCloseTo(
                record.unixSeconds - previous.unixSeconds,
                5,
            );
        }
    });

    it.each([0x0000, 0x0002, 0x0004, 0x0006, 0x0101, 0xffff])("rejects unverified hemisphere code %i", async (code) => {
        const { file } = loadFile();
        const index = await buildMp4Index(file);
        const track = findVueroidTxetTrack(index)!;
        const sample = readSampleTable(index.moovView!, track.trakBox)![0]!;
        const row = new DataView(await file.slice(sample.offset, sample.offset + sample.size).arrayBuffer());
        row.setUint16(0x34, code, true);
        expect(decodeVueroidTxetRow(row)).toBeNull();
    });
});
