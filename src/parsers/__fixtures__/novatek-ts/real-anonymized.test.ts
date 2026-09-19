// Regression test on the real-anonymized Novatek-TS fixture (VIOFO A119 V3
// in TS recording mode, filename family YYYYMMDDHHMMSS_NNNNNN.TS). Coordinates
// replaced with the moving sentinel 50 N / 30 E (+ i*0.0001 deg); timestamps,
// PES structure (stream_id 0xbf, 1008-byte body, 6-packet split) and
// speed/course are the original camera bytes.
//
// Source: scripts/anonymize-novatek-ts.mjs.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { buildMp4Index } from "../../internal/mp4-index.js";
import { findNovatekTsGpsPid } from "../../internal/novatek-ts-extract.js";
import { pesBodyOffset, TS_SIZE } from "../../internal/ts-walk.js";
import { novatekTsPrimitive } from "../../primitives/novatek-ts.js";
import { WrongFormatError } from "../../types.js";

const FIXTURE = resolve(dirname(fileURLToPath(import.meta.url)), "real-anonymized.TS");
const NO_FIX_FIXTURE = resolve(dirname(fileURLToPath(import.meta.url)), "real-no-fix-anonymized.TS");
// The real camera's filename shape; the recording clock in the fixture
// structs is the camera-LOCAL 2021-03-18 15:39:xx.
const NAME = "20210318153933_000188.TS";

function noFixPacket() {
    const bytes = readFileSync(NO_FIX_FIXTURE);
    for (let off = 0; off + TS_SIZE <= bytes.length; off += TS_SIZE) {
        if ((bytes[off + 1]! & 0x40) === 0) continue;
        const bodyOff = pesBodyOffset(bytes, off);
        if (bodyOff !== null && bytes[bodyOff + 24] === 0x56) {
            return bytes.subarray(off, off + TS_SIZE);
        }
    }
    throw new Error("no no-fix packet in fixture");
}

describe("real-anonymized Novatek-TS fixture", () => {
    it("recognizes a renamed stream before the first gps fix", async () => {
        const packet = noFixPacket();
        const file = new File([packet], "renamed.ts");
        const index = await buildMp4Index(file);
        const vf = { file, relativePath: file.name };

        expect(findNovatekTsGpsPid(packet)).toBe(0x300);
        expect(await novatekTsPrimitive.marker(vf, index)).toBe(true);
        await expect(novatekTsPrimitive.parse(vf, index)).rejects.toThrow(WrongFormatError);
    });

    it("rejects a no-fix signature with a nonzero coordinate tail", () => {
        const packet = noFixPacket();
        const bodyOff = pesBodyOffset(packet, 0)!;
        packet[bodyOff + 28] = 1;

        expect(findNovatekTsGpsPid(packet)).toBeNull();
    });

    it("marker + parse end-to-end through a real Mp4Index", async () => {
        const buf = readFileSync(FIXTURE);
        const file = new File([buf], NAME);
        // buildMp4Index degrades gracefully on MPEG-TS (no boxes) but still
        // populates headerBytes via the marker probe - the path production uses.
        const index = await buildMp4Index(file);
        const vf = { file, relativePath: NAME };

        expect(await novatekTsPrimitive.marker(vf, index)).toBe(true);

        const result = await novatekTsPrimitive.parse(vf, index);
        expect(result.records).toHaveLength(10);
        expect(result.skipped).toHaveLength(0);

        const first = result.records[0]!;
        // Camera-local wall clock parsed as if UTC, then quarantined.
        expect(first.unixSeconds).toBe(Date.UTC(2021, 2, 18, 15, 39, 34) / 1000);

        for (let i = 0; i < result.records.length; i++) {
            const r = result.records[i]!;
            // Sentinel coords - whole-degree anchored, never the real track.
            expect(r.lat).toBeCloseTo(50 + i * 0.0001, 4);
            expect(r.lon).toBeCloseTo(30 + i * 0.0001, 4);
            expect(r.active).toBe(true);
            // Local-clock quarantine contract: unsynced + per-record offset.
            expect(r.timeUnsynced).toBe(true);
            expect(r.relStartSeconds).toBe(i); // 1 Hz cadence from the real stream
            // Real speed/course bytes survive anonymization - sanity ranges
            // only (a stationary-to-slow city start on the source clip).
            expect(r.speedMs).toBeGreaterThanOrEqual(0);
            expect(r.speedMs).toBeLessThan(60);
            expect(r.bearingDeg).toBeGreaterThanOrEqual(0);
            expect(r.bearingDeg).toBeLessThan(360);
            expect(r.mp4Filename).toBe(NAME);
        }

        // Monotonic local time across the fixture.
        for (let i = 1; i < result.records.length; i++) {
            expect(result.records[i]!.unixSeconds).toBeGreaterThan(result.records[i - 1]!.unixSeconds);
        }
    });

    it("keeps scanning when no-fix rows precede four-digit-year fixes", async () => {
        const buf = readFileSync(NO_FIX_FIXTURE);
        const name = "20260902155745_000230.TS";
        const file = new File([buf], name);
        const index = await buildMp4Index(file);
        const vf = { file, relativePath: `DCIM/VIDEO/${name}` };

        expect(await novatekTsPrimitive.marker(vf, index)).toBe(true);

        const result = await novatekTsPrimitive.parse(vf, index);
        expect(result.records).toHaveLength(7);
        expect(result.skipped).toHaveLength(3);
        expect(result.skipped.every((row) => row.reason === "no gps fix (status V)")).toBe(true);

        for (let i = 0; i < result.records.length; i++) {
            const record = result.records[i]!;
            expect(record.lat).toBeCloseTo(50 + i * 0.0001, 4);
            expect(record.lon).toBeCloseTo(30 + i * 0.0001, 4);
            expect(record.unixSeconds).toBe(Date.UTC(2026, 8, 2, 15, 59, 25 + i) / 1000);
            expect(record.relStartSeconds).toBe(3 + i);
            expect(record.timeUnsynced).toBe(true);
        }
    });
});
