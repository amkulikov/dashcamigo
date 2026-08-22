// Tests for the Escort M2 `.map` sidecar handler. Covers basename pairing,
// happy-path parsing, edge-line segregation, gravity removal contract, and
// rejection of foreign formats. Fixture files live in __fixtures__/escort/
// and are reused from the pre-refactor vendor-plugin test suite.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { makeVendorFile } from "../__fixtures__/helpers.js";
import { escortMapSidecar, parseMapText } from "./escort-map.js";

const FIXTURES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../__fixtures__/escort");

describe("escortMapSidecar.matches", () => {
    it("pairs .map to .MP4 by exact basename", () => {
        const sidecar = makeVendorFile("Normal/20260511_0016_CAM.map", "");
        const known = new Set(["20260511_0016_CAM.MP4"]);
        expect(escortMapSidecar.matches(sidecar, known)).toBe("20260511_0016_CAM.MP4");
    });

    it("pairs .map to .mp4 (lowercase ext) too", () => {
        const sidecar = makeVendorFile("Normal/20260511_0016_CAM.map", "");
        const known = new Set(["20260511_0016_CAM.mp4"]);
        expect(escortMapSidecar.matches(sidecar, known)).toBe("20260511_0016_CAM.mp4");
    });

    it("returns null when no matching MP4 is known", () => {
        const sidecar = makeVendorFile("20260511_0016_CAM.map", "");
        expect(escortMapSidecar.matches(sidecar, new Set(["other.mp4"]))).toBeNull();
    });

    it("returns null for non-.map extensions", () => {
        const sidecar = makeVendorFile("20260511_0016_CAM.gpx", "");
        const known = new Set(["20260511_0016_CAM.MP4"]);
        expect(escortMapSidecar.matches(sidecar, known)).toBeNull();
    });
});

describe("parseMapText: happy path (synthetic)", () => {
    it("parses 5 valid lines, computes bearing from neighbours", () => {
        const text = readFileSync(resolve(FIXTURES_DIR, "synthetic-happy.map"), "utf8");
        const { records, skipped } = parseMapText(text, "20260511_0016_CAM.MP4");
        expect(skipped).toHaveLength(0);
        expect(records).toHaveLength(5);
        // First record's bearing is back-filled from neighbour (0->1), not zero.
        expect(records[0]!.bearingDeg).toBeGreaterThan(0);
        expect(records[0]!.bearingDeg).toBeLessThan(360);
        // Speed 100 km/h -> 100/3.6 ~= 27.78 m/s.
        expect(records[0]!.speedMs).toBeCloseTo(100 / 3.6, 4);
        // Active fix.
        expect(records[0]!.active).toBe(true);
        // mp4Filename is propagated to every record.
        expect(records.every((r) => r.mp4Filename === "20260511_0016_CAM.MP4")).toBe(true);
    });
});

describe("parseMapText: edge cases (synthetic)", () => {
    it("segregates malformed lines into skipped, parses valid ones", () => {
        const text = readFileSync(resolve(FIXTURES_DIR, "synthetic-edge.map"), "utf8");
        const { records, skipped } = parseMapText(text, "20260511_0016_CAM.MP4");
        // The fixture has 9 lines. Parsed into records (4):
        //   line 1: active fix; line 2: void fix (active=false, parsed, not
        //   skipped); line 3: S/W hemisphere variant; line 9: trailing fix.
        // Skipped (5):
        //   line 4: junk text; line 5: impossible latitude; line 6: time
        //   25:60:60; line 7: negative speed; line 8: "nan" accel (fails the strict
        //   numeric signature, so it is a signature mismatch, not a NaN check).
        expect(records).toHaveLength(4);
        expect(skipped).toHaveLength(5);
        const reasons = skipped.map((s) => s.reason).sort();
        expect(reasons).toEqual([
            "invalid coordinates",
            "invalid date or time",
            "invalid speed",
            "line did not match escort .map signature",
            "line did not match escort .map signature",
        ]);
        // The void record is still parsed (active=false), not skipped.
        expect(records.some((r) => r.active === false)).toBe(true);
        // S/W record (fixture line 3, third parsed): both hemisphere flags
        // must survive as negative decimal degrees (DDMM.MMMM decoding).
        const sw = records[2]!;
        expect(sw.lat).toBeCloseTo(-(1 + 0.03 / 60), 6);
        expect(sw.lon).toBeCloseTo(-(2 + 0.02 / 60), 6);
    });
});

describe("parseMapText: foreign format rejection", () => {
    it("returns no records for NMEA-style content", () => {
        const text = readFileSync(resolve(FIXTURES_DIR, "synthetic-not-escort.map"), "utf8");
        const { records, skipped } = parseMapText(text, "20260511_0016_CAM.MP4");
        expect(records).toHaveLength(0);
        expect(skipped.length).toBeGreaterThan(0);
        expect(skipped[0]!.reason).toMatch(/did not match/);
    });
});

describe("parseMapText: gravity removal contract", () => {
    it("per-axis mean is ~0 after gravity removal", () => {
        const text = readFileSync(resolve(FIXTURES_DIR, "real-anonymized.map"), "utf8");
        const { records } = parseMapText(text, "20260511_0016_CAM.MP4");
        expect(records.length).toBeGreaterThan(0);
        // Algorithm subtracts per-axis mean by construction. Pin the contract
        // so a future "skip outliers" change is forced to update this test.
        const n = records.length;
        const meanX = records.reduce((s, r) => s + r.accelXg, 0) / n;
        const meanY = records.reduce((s, r) => s + r.accelYg, 0) / n;
        const meanZ = records.reduce((s, r) => s + r.accelZg, 0) / n;
        expect(Math.abs(meanX)).toBeLessThan(1e-9);
        expect(Math.abs(meanY)).toBeLessThan(1e-9);
        expect(Math.abs(meanZ)).toBeLessThan(1e-9);
    });
});

describe("escortMapSidecar.parse", () => {
    it("reads the file and returns records bound to the given mp4Filename", async () => {
        const text = readFileSync(resolve(FIXTURES_DIR, "synthetic-happy.map"), "utf8");
        const sidecar = makeVendorFile("20260511_0016_CAM.map", text);
        const records = await escortMapSidecar.parse(sidecar, "20260511_0016_CAM.MP4");
        expect(records).toHaveLength(5);
        expect(records[0]!.mp4Filename).toBe("20260511_0016_CAM.MP4");
    });
});
