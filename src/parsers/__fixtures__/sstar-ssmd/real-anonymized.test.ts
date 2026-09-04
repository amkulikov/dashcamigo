// Regression tests on real-anonymized SStar firmware fixtures: actual
// 40-byte Neoline and 56-byte iZEEKER ssmd GPS track bytes with fix-row
// coordinates rounded to whole degrees. Timestamps, speed, course and the
// fix/no-fix interleaving are the real firmware output. The
// mirror-cam pair pins BOTH sides of the phantom-track quality gate on
// real bytes; the 4K-front-cam clip pins the 0x067E flags base.
//
// Source: scripts/anonymize-sstar-ssmd-mp4.mjs.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildMp4Index } from "../../internal/mp4-index.js";
import { sstarSsmdPrimitive } from "../../primitives/sstar-ssmd.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const PUBLIC_FIXTURES = resolve(REPO_ROOT, "tests/testdata/sstar-ssmd-real-anonymized");

// Every fixture keeps the original recording's filename-borne local date
// (UTC+3 cameras); the fix rows carry the GPS clock in UTC.
async function load(fixture: string, name: string) {
    const buf = readFileSync(resolve(PUBLIC_FIXTURES, fixture));
    const file = new File([buf], name);
    const vf = { file, relativePath: name };
    const index = await buildMp4Index(file);
    return { vf, index };
}

describe("real-anonymized Neoline Spectrum sstar-ssmd fixture (phantom night clip)", () => {
    // The PHANTOM-TRACK sample: the car was parked/crawling (video ground
    // truth), yet the receiver wrote fully-flagged fixes with a smooth
    // 113-137 km/h fictional trajectory and a correct GPS clock (192
    // samples: 72 fixes interleaved with 120 no-fix rows). The parse must
    // drop every fix through the quality gate and keep only the frame-0
    // clock hint. The whole-degree anonymization degrades pair geometry,
    // but both gate conjuncts fire from the real signal: the no-fix share
    // (120/192) and the speed-vs-position mismatch are properties of the
    // original data, not of the rounding.
    const NAME = "INF20260520-214526-1-F.mp4";
    const FIXTURE = "neoline-spectrum-front.mp4";

    it("marker fires on the real track structure", async () => {
        const { vf, index } = await load(FIXTURE, NAME);
        expect(await sstarSsmdPrimitive.marker(vf, index)).toBe(true);
    });

    it("phantom-track gate drops all 72 fabricated fixes, keeps the frame-0 clock hint", async () => {
        const { vf, index } = await load(FIXTURE, NAME);
        const result = await sstarSsmdPrimitive.parse(vf, index);

        expect(result.records).toHaveLength(0);
        expect(result.skipped).toHaveLength(72);
        for (const s of result.skipped) expect(s.reason).toContain("phantom-track quality gate");

        // The GPS clock is the one honest field of a phantom file: the first
        // fix (21:45:27 camera-local = 18:45:27 UTC) sits at media time 0, so
        // frame 0 anchors there - within 1 s of the filename RTC, as verified
        // against the baked-in OSD of the original clip.
        expect(result.videoStartUtcHint).toBe(Date.UTC(2026, 4, 20, 18, 45, 27) / 1000);
    });
});

describe("real-anonymized Neoline Spectrum sstar-ssmd fixture (good-signal day clip)", () => {
    // The gate's false-positive boundary plus the decode path on real bytes:
    // a genuine highway drive (181 samples: 179 fixes, 2 no-fix rows) must
    // parse in full - anchored, monotonic, plausible speeds.
    const NAME = "INF20260520-143412-26-F.mp4";
    const FIXTURE = "neoline-spectrum-front-good-signal.mp4";

    it("179 fix rows parse to anonymized, monotonic, plausible records - no gate", async () => {
        const { vf, index } = await load(FIXTURE, NAME);
        expect(await sstarSsmdPrimitive.marker(vf, index)).toBe(true);
        const result = await sstarSsmdPrimitive.parse(vf, index);

        expect(result.records).toHaveLength(179);
        expect(result.skipped).toHaveLength(0);

        let prev = Number.NEGATIVE_INFINITY;
        let sawMotion = false;
        for (const r of result.records) {
            // Anonymized: whole degrees only.
            expect(Number.isInteger(r.lat)).toBe(true);
            expect(Number.isInteger(r.lon)).toBe(true);
            expect(Math.abs(r.lat)).toBeLessThanOrEqual(90);
            expect(Math.abs(r.lon)).toBeLessThanOrEqual(180);
            // Real GPS-clock seconds, strictly increasing across this clip.
            expect(r.unixSeconds).toBeGreaterThan(prev);
            prev = r.unixSeconds;
            // Plausible driving speed and a decoded course.
            expect(r.speedMs).toBeGreaterThanOrEqual(0);
            expect(r.speedMs).toBeLessThan(200 / 3.6);
            if (r.speedMs > 50 / 3.6) sawMotion = true;
            expect(r.bearingDeg).toBeGreaterThanOrEqual(0);
            expect(r.bearingDeg).toBeLessThan(360);
            expect(r.timeUnsynced).toBeUndefined();
            expect(r.mp4Filename).toBe(NAME);
        }
        // The clip is a real drive - the speed field must show it.
        expect(sawMotion).toBe(true);

        // Frame-0 hint from the first fix's clock minus its media offset:
        // 14:34:12 camera-local = 11:34:12 UTC at media ~1 s -> 11:34:11.
        expect(result.videoStartUtcHint).toBe(Date.UTC(2026, 4, 20, 11, 34, 11) / 1000);
    });
});

describe("real-anonymized Neoline Spectrum sstar-ssmd fixture (4K front cam)", () => {
    // The 0x067E flags base on real bytes: a day drive with a ~63 s no-fix
    // acquisition lead-in (301 samples: 64 no-fix, 237 fixes at exactly
    // 1 Hz). Everything else matches the mirror-cam dialect, so the full
    // decode + anchor path must work unchanged.
    const NAME = "INF20260725-120324-105-F.mp4";
    const FIXTURE = "neoline-spectrum-4k-front.mp4";

    it("marker fires on the 0x067E-base track", async () => {
        const { vf, index } = await load(FIXTURE, NAME);
        expect(await sstarSsmdPrimitive.marker(vf, index)).toBe(true);
    });

    it("237 fix rows parse anchored, monotonic and plausible - no gate, no skips", async () => {
        const { vf, index } = await load(FIXTURE, NAME);
        const result = await sstarSsmdPrimitive.parse(vf, index);

        expect(result.records).toHaveLength(237);
        expect(result.skipped).toHaveLength(0);

        // First fix: 12:04:25 camera-local = 09:04:25 UTC.
        expect(result.records[0]!.unixSeconds).toBe(Date.UTC(2026, 6, 25, 9, 4, 25) / 1000);

        let prev = Number.NEGATIVE_INFINITY;
        let sawMotion = false;
        for (const r of result.records) {
            // Anonymized: whole degrees only.
            expect(Number.isInteger(r.lat)).toBe(true);
            expect(Number.isInteger(r.lon)).toBe(true);
            expect(r.unixSeconds).toBeGreaterThan(prev);
            prev = r.unixSeconds;
            expect(r.speedMs).toBeGreaterThanOrEqual(0);
            expect(r.speedMs).toBeLessThan(200 / 3.6);
            if (r.speedMs > 50 / 3.6) sawMotion = true;
            expect(r.timeUnsynced).toBeUndefined();
            expect(r.mp4Filename).toBe(NAME);
        }
        expect(sawMotion).toBe(true);

        // Frame-0 hint: first fix (09:04:25 UTC) at media 5669405/90000 s ~=
        // 62.99 s -> ~09:03:22 UTC, within 2 s of the filename RTC.
        expect(result.videoStartUtcHint).toBeCloseTo(Date.UTC(2026, 6, 25, 9, 4, 25) / 1000 - 5669405 / 90000, 6);
    });
});

describe("real-anonymized iZEEKER iD300 KTRX fixture", () => {
    const NAME = "REC20260902-231922-1.mp4";
    const FIXTURE = "izeeker-id300-front.mp4";

    it("marks the real constant-56 track and contains only the scrubbed identifier", async () => {
        const buf = readFileSync(resolve(PUBLIC_FIXTURES, FIXTURE));
        const identifiers = buf.toString("latin1").match(/[0-9A-F]{16}KTRX/g) ?? [];
        expect(identifiers).toHaveLength(180);
        expect(new Set(identifiers)).toEqual(new Set(["0000000000000000KTRX"]));

        const { vf, index } = await load(FIXTURE, NAME);
        expect(await sstarSsmdPrimitive.marker(vf, index)).toBe(true);
    });

    it("decodes all 180 real rows and demotes the stale GPS clock", async () => {
        const { vf, index } = await load(FIXTURE, NAME);
        const result = await sstarSsmdPrimitive.parse(vf, index);

        expect(result.records).toHaveLength(180);
        expect(result.skipped).toHaveLength(0);
        expect(result.videoStartUtcHint).toBeUndefined();

        let previousMediaTime = Number.NEGATIVE_INFINITY;
        let sawMotion = false;
        for (const record of result.records) {
            expect(record.lat).toBeCloseTo(Math.round(record.lat), 9);
            expect(record.lon).toBeCloseTo(Math.round(record.lon), 9);
            expect(Math.abs(record.lat)).toBeLessThanOrEqual(90);
            expect(Math.abs(record.lon)).toBeLessThanOrEqual(180);
            expect(record.timeUnsynced).toBe(true);
            expect(record.unixSeconds).toBe(0);
            expect(record.relStartSeconds).toBeGreaterThan(previousMediaTime);
            previousMediaTime = record.relStartSeconds!;
            expect(record.speedMs).toBeGreaterThanOrEqual(0);
            expect(record.speedMs).toBeLessThan(160 / 3.6);
            if (record.speedMs > 30 / 3.6) sawMotion = true;
            expect(record.bearingDeg).toBeGreaterThanOrEqual(0);
            expect(record.bearingDeg).toBeLessThan(360);
            expect(record.mp4Filename).toBe(NAME);
        }
        expect(sawMotion).toBe(true);
    });
});
