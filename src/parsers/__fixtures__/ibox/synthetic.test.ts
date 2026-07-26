// Integration test: an iBox MOV (Ambarella tail-atoms, same layout as Navitel)
// routes through the navitel-tail primitive. Confirms the source-hint flip
// (iBox -> embedded) plus the full Mp4Index -> navitel-tail path. Fixture
// builder: build-ibox.mjs.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildMp4Index } from "../../internal/mp4-index.js";
import { navitelTailPrimitive } from "../../primitives/navitel-tail.js";
import { classifyGpsSource } from "../../gps-source-hints.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const NAME = "FILE230422-154515F.MOV"; // real iBox iCON naming

describe("iBox tail-atom gps0 - synthetic fixture", () => {
    it("hint is embedded and navitel-tail decodes the sentinel coords", async () => {
        expect(classifyGpsSource({ file: new File([], NAME), relativePath: NAME })).toBe("embedded");

        const buf = readFileSync(resolve(HERE, "synthetic-ibox.MOV"));
        const file = new File([buf], NAME);
        const index = await buildMp4Index(file);
        const vf = { file, relativePath: NAME };

        expect(await navitelTailPrimitive.marker(vf, index)).toBe(true);

        const result = await navitelTailPrimitive.parse(vf, index);
        expect(result.records).toHaveLength(2);

        // Sentinel coords (50.0 N / 30.0 E).
        expect(result.records[0]!.lat).toBeCloseTo(50.0, 4);
        expect(result.records[0]!.lon).toBeCloseTo(30.0, 4);
        expect(result.records[0]!.active).toBe(true);

        // gps0 records are UTC and self-describe year/month (bytes 22-23).
        const t = new Date(result.records[0]!.unixSeconds * 1000);
        expect(t.getUTCFullYear()).toBe(2023);
        expect(t.getUTCMonth()).toBe(3); // April (0-based)
        expect(t.getUTCDate()).toBe(22);
        expect(t.getUTCHours()).toBe(12);

        // Speed 73 km/h -> ~20.3 m/s (u16 @20, plain km/h - NOT the altitude i32 @16).
        expect(result.records[0]!.speedMs).toBeCloseTo(73 / 3.6, 1);

        // Course byte 19 -> 38 deg.
        expect(result.records[0]!.bearingDeg).toBe(38);
    });
});
