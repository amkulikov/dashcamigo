// Integration test: the gps-box-70mai primitive against a synthetic MP4 with a
// top-level `GPS ` box (older 70mai Pro). Exercises Mp4Index `GPS `-box
// detection + the primitive. Fixture builder: build-mai-pro.mjs.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildMp4Index } from "../../internal/mp4-index.js";
import { gpsBox70maiPrimitive } from "../../primitives/gps-box-70mai.js";
import { classifyGpsSource } from "../../gps-source-hints.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const NAME = "NO20191130-120156-000121.MP4"; // real old-70mai-Pro naming

describe("70mai Pro GPS box - synthetic fixture", () => {
    it("hint embedded, Mp4Index detects the GPS box, primitive decodes 3 fixes", async () => {
        expect(classifyGpsSource({ file: new File([], NAME), relativePath: NAME })).toBe("embedded");

        const buf = readFileSync(resolve(HERE, "synthetic-mai-pro.mp4"));
        const file = new File([buf], NAME);
        const index = await buildMp4Index(file);
        expect(index.maiGpsBox).not.toBeNull();

        const vf = { file, relativePath: NAME };
        expect(await gpsBox70maiPrimitive.marker(vf, index)).toBe(true);

        const result = await gpsBox70maiPrimitive.parse(vf, index);
        // 3 valid fixes + 1 no-fix -> 3 records.
        expect(result.records).toHaveLength(3);
        expect(result.records[0]!.lat).toBeCloseTo(50.0, 4);
        expect(result.records[0]!.lon).toBeCloseTo(30.0, 4);
        expect(result.records[2]!.lat).toBeCloseTo(50.02, 4);
        expect(result.records[0]!.speedMs * 3.6).toBeCloseTo(105.3, 1);
        expect(result.records.every((r) => r.timeUnsynced === true)).toBe(true);
    });
});
