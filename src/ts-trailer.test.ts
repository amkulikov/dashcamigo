import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BlobSource, Input, MPEG_TS } from "mediabunny";
import { describe, expect, it } from "vitest";

import { clampTsGpsTrailer, findTsGpsTrailer } from "./ts-trailer.js";

const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), "parsers/__fixtures__/ligogps-trailer-ts");
const happy = readFileSync(resolve(FIXTURES, "synthetic-happy.TS"));
const wrongFormat = readFileSync(resolve(FIXTURES, "synthetic-wrong-format.TS"));
const realAnonymized = readFileSync(resolve(FIXTURES, "real-anonymized.TS"));
const realAmpersand = readFileSync(resolve(FIXTURES, "real-anonymized-ampersand.TS"));

// happy = 2 null TS packets + trailer (see build-synthetic.mjs).
const HAPPY_CLEAN = 2 * 188;

function blobOf(buf: Buffer): Blob {
    return new Blob([Uint8Array.from(buf)]);
}

describe("findTsGpsTrailer", () => {
    it("detects the LCAI trailer and reports the clean 188-aligned prefix", async () => {
        const t = await findTsGpsTrailer(blobOf(happy));
        expect(t).not.toBeNull();
        expect(t!.cleanLength).toBe(HAPPY_CLEAN);
        expect(t!.trailerLength).toBe(happy.length - HAPPY_CLEAN);
    });

    it("accepts the classic LIGO magic spelling with the length-header dialect", async () => {
        const patched = Buffer.from(happy);
        patched.write("SKIPLIGOGPSINFO", HAPPY_CLEAN + 4, "latin1");
        expect(await findTsGpsTrailer(blobOf(patched))).not.toBeNull();
    });

    it("rejects the ampersand terminator paired with LCAI magic", async () => {
        const lcaiWithAmpersands = Buffer.from(happy);
        lcaiWithAmpersands.write("&&&&", lcaiWithAmpersands.length - 8, "latin1");
        expect(await findTsGpsTrailer(blobOf(lcaiWithAmpersands))).toBeNull();
    });

    it("rejects invalid dialect header values", async () => {
        const lcaiWithSlotCount = Buffer.from(happy);
        lcaiWithSlotCount.writeUInt32LE(3, HAPPY_CLEAN + 24);
        expect(await findTsGpsTrailer(blobOf(lcaiWithSlotCount))).toBeNull();

        const ligoWithUndersizedCapacity = Buffer.from(realAmpersand);
        const ligoTrailerLength = ligoWithUndersizedCapacity.readUInt32BE(ligoWithUndersizedCapacity.length - 4);
        ligoWithUndersizedCapacity.writeUInt32LE(59, ligoWithUndersizedCapacity.length - ligoTrailerLength + 24);
        expect(await findTsGpsTrailer(blobOf(ligoWithUndersizedCapacity))).toBeNull();
    });

    it("rejects a foreign magic even with valid structure", async () => {
        expect(await findTsGpsTrailer(blobOf(wrongFormat))).toBeNull();
    });

    it("rejects a foreign terminator even with valid lengths and magic", async () => {
        const patched = Buffer.from(happy);
        patched.write("!!!!", patched.length - 8, "latin1");
        expect(await findTsGpsTrailer(blobOf(patched))).toBeNull();
    });

    it("rejects a file with no known terminator", async () => {
        expect(await findTsGpsTrailer(blobOf(happy.subarray(0, HAPPY_CLEAN)))).toBeNull();
    });

    it("rejects a trailer whose slot region is not 132-byte aligned", async () => {
        const patched = Buffer.concat([happy.subarray(0, -8), Buffer.alloc(1), happy.subarray(-8)]);
        const trailerLength = patched.length - HAPPY_CLEAN;
        patched.writeUInt32BE(trailerLength, HAPPY_CLEAN);
        patched.writeUInt32BE(trailerLength, patched.length - 4);
        expect(await findTsGpsTrailer(blobOf(patched))).toBeNull();
    });

    it("rejects when the clean prefix falls off the 188 grid", async () => {
        // One junk byte before the trailer shifts the grid; the trailer
        // length no longer lands the prefix on a packet boundary.
        const shifted = Buffer.concat([
            happy.subarray(0, HAPPY_CLEAN),
            Buffer.from([0xaa]),
            happy.subarray(HAPPY_CLEAN),
        ]);
        expect(await findTsGpsTrailer(blobOf(shifted))).toBeNull();
    });

    it("rejects when the leading length copy disagrees with the terminator", async () => {
        const patched = Buffer.from(happy);
        patched.writeUInt32BE(0xdeadbeef >>> 0, HAPPY_CLEAN);
        expect(await findTsGpsTrailer(blobOf(patched))).toBeNull();
    });

    it("rejects blobs smaller than a packet plus an empty trailer", async () => {
        expect(await findTsGpsTrailer(blobOf(happy.subarray(0, 64)))).toBeNull();
    });

    it("detects the trailer on the real-anonymized fixture", async () => {
        const t = await findTsGpsTrailer(blobOf(realAnonymized));
        expect(t).not.toBeNull();
        expect(t!.cleanLength % 188).toBe(0);
        expect(t!.trailerLength).toBe(7956);
    });

    it("detects the ampersand dialect on its real-anonymized fixture", async () => {
        const t = await findTsGpsTrailer(blobOf(realAmpersand));
        expect(t).not.toBeNull();
        expect(t!.cleanLength % 188).toBe(0);
        expect(t!.trailerLength).toBe(7956);
    });

    it("accepts an ampersand trailer whose capacity exceeds its written slots", async () => {
        const patched = Buffer.from(realAmpersand);
        const trailerLength = patched.readUInt32BE(patched.length - 4);
        patched.writeUInt32LE(61, patched.length - trailerLength + 24);
        expect(await findTsGpsTrailer(blobOf(patched))).not.toBeNull();
    });
});

describe("clampTsGpsTrailer", () => {
    it("clamps a .ts File to the clean stream", async () => {
        const file = new File([Uint8Array.from(happy)], "20260813211138_0000002F.ts");
        const clamped = await clampTsGpsTrailer(file);
        expect(clamped.size).toBe(HAPPY_CLEAN);
    });

    it("passes a trailer-less .ts File through unchanged", async () => {
        const file = new File([Uint8Array.from(happy.subarray(0, HAPPY_CLEAN))], "clean.ts");
        expect(await clampTsGpsTrailer(file)).toBe(file);
    });

    it("never probes a non-TS name even with trailer bytes present", async () => {
        const file = new File([Uint8Array.from(happy)], "movie.mp4");
        expect(await clampTsGpsTrailer(file)).toBe(file);
    });

    it("passes a nameless Blob through unchanged", async () => {
        const blob = blobOf(happy);
        expect(await clampTsGpsTrailer(blob)).toBe(blob);
    });

    it("mediabunny chokes on the raw trailer and computes duration on the clamped stream", async () => {
        // The original bug: computeDuration scans the whole container, loses
        // packet sync on the off-grid trailer and throws - every file of the
        // card read as unindexable ("empty folder").
        const file = new File([Uint8Array.from(realAnonymized)], "20260813211138_0000002F.ts");
        const raw = new Input({ source: new BlobSource(file), formats: [MPEG_TS] });
        try {
            await expect(raw.computeDuration()).rejects.toThrow(/sync byte/i);
        } finally {
            raw.dispose();
        }
        const clamped = new Input({ source: new BlobSource(await clampTsGpsTrailer(file)), formats: [MPEG_TS] });
        try {
            expect(await clamped.computeDuration()).toBeGreaterThan(1);
        } finally {
            clamped.dispose();
        }
    });
});
