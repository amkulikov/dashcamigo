// Integration test: Wolfbox-family gpmd struct tracks route through the
// wolfbox-gpmd primitive in both known layouts. Fixture builder:
// build-synthetic.mjs. SYNTHETIC fixtures (built from byte specs, no real
// sample yet) - see docs/gps-format-coverage.md for the waiver.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildMp4Index } from "../../internal/mp4-index.js";
import { gpmfPrimitive } from "../../primitives/gpmf.js";
import { wolfboxGpmdPrimitive } from "../../primitives/wolfbox-gpmd.js";
import { KNOTS_TO_MS } from "../../types.js";

const HERE = dirname(fileURLToPath(import.meta.url));

async function load(fixture: string, name: string) {
    const buf = readFileSync(resolve(HERE, fixture));
    const file = new File([buf], name);
    const vf = { file, relativePath: name };
    const index = await buildMp4Index(file);
    return { vf, index };
}

describe("wolfbox-gpmd - variant B (ExifTool block2, G900/Redtiger)", () => {
    const NAME = "2026_03_15_173951_00_F.MP4";

    it("marker fires and full-UTC records decode", async () => {
        const { vf, index } = await load("synthetic-wolfbox-b.mp4", NAME);
        expect(await wolfboxGpmdPrimitive.marker(vf, index)).toBe(true);

        const result = await wolfboxGpmdPrimitive.parse(vf, index);
        expect(result.records).toHaveLength(3);

        const r0 = result.records[0]!;
        expect(r0.lat).toBeCloseTo(50.0, 6);
        expect(r0.lon).toBeCloseTo(30.0, 6);
        expect(r0.unixSeconds).toBe(Date.UTC(2026, 2, 15, 17, 39, 51) / 1000);
        expect(r0.timeUnsynced).toBeUndefined();
        expect(r0.speedMs).toBeCloseTo(20 * KNOTS_TO_MS, 4);
        expect(r0.bearingDeg).toBeCloseTo(92, 4);

        // Per-sample UTC, 1 s apart.
        expect(result.records[2]!.unixSeconds - r0.unixSeconds).toBe(2);
    });

    it("gpmf primitive does not steal the track (zero records on non-KLV)", async () => {
        const { vf, index } = await load("synthetic-wolfbox-b.mp4", NAME);
        // gpmf marker fires on the gpmd sample format - that is fine; the
        // dispatcher moves on when parse yields zero records.
        expect(await gpmfPrimitive.marker(vf, index)).toBe(true);
        const parsed = await gpmfPrimitive.parse(vf, index).catch(() => null);
        expect(parsed === null || parsed.records.length === 0).toBe(true);
    });
});

describe("wolfbox-gpmd - variant A (ShenShu block1, 2026 3-channel)", () => {
    const NAME = "2026_03_15_173951_02_I.MP4";

    it("marker fires, no-fix lead-in skipped, clock beats the lying 5 Hz stts", async () => {
        const { vf, index } = await load("synthetic-wolfbox-a.mp4", NAME);
        expect(await wolfboxGpmdPrimitive.marker(vf, index)).toBe(true);

        const result = await wolfboxGpmdPrimitive.parse(vf, index);
        // 4 samples, first is status=0 no-fix.
        expect(result.records).toHaveLength(3);

        const r0 = result.records[0]!;
        expect(r0.lat).toBeCloseTo(50.0, 6);
        expect(r0.lon).toBeCloseTo(30.0, 6);
        expect(r0.timeUnsynced).toBe(true);
        expect(r0.speedMs).toBeCloseTo(20 * KNOTS_TO_MS, 4);
        expect(r0.bearingDeg).toBeCloseTo(92, 4);

        // First fix is sample index 1 (1 Hz lead-in assumption), and the
        // in-sample clock paces the rest: +1 s, then a skipped second (+3 s
        // total) - NOT the 0.2 s the 5 Hz stts would suggest.
        expect(result.records.map((r) => r.relStartSeconds)).toEqual([1, 2, 4]);
    });
});
