import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { makeVendorFile, expectPlausibleGpsTrack } from "../__fixtures__/helpers.js";
import { nmeaTarPrimitive } from "./nmea-tar.js";
import { WrongFormatError } from "../types.js";
import { classifyFiles } from "../registry.js";

function bytes(): Uint8Array<ArrayBuffer> {
    return new Uint8Array(readFileSync(new URL("../__fixtures__/ddpai-gps/real-anonymized.git", import.meta.url)));
}

const name = "203gps/tar/20261006163238_0057.git";

describe("NMEA TAR archives", () => {
    it("classifies a real archive and binds each GPS section to its member filename", async () => {
        const file = makeVendorFile(name, bytes());
        const classified = await classifyFiles([file]);
        expect(classified[0]!.logExtractorId).toBe("nmea-tar");
        expect(await nmeaTarPrimitive.marker(file)).toBe(true);
        const result = await nmeaTarPrimitive.parse(file);
        expectPlausibleGpsTrack(result.records, { minCount: 30 });
        expect(result.records).toHaveLength(30);
        expect(new Set(result.records.map((record) => record.mp4Filename))).toEqual(
            new Set(["20261006163238_0057.mp4"]),
        );
    });

    it("matches a rear-only selection and omits absent recordings", async () => {
        const file = makeVendorFile(name, bytes());
        const result = await nmeaTarPrimitive.parse(file, undefined, undefined, {
            knownVideos: [
                { name: "20261006163238_0057_A.mp4", relativePath: "200video/rear/20261006163238_0057_A.mp4" },
            ],
        });
        expect(result.records).toHaveLength(30);
        expect(result.records[0]!.mp4Filename).toBe("20261006163238_0057_A.mp4");
        expect((await nmeaTarPrimitive.parse(file, undefined, undefined, { knownVideos: [] })).records).toEqual([]);
    });

    it("reads all recordings in a multi-member archive without mixing their clocks", async () => {
        const content = new Uint8Array(
            readFileSync(new URL("../__fixtures__/ddpai-gps/multiple-anonymized.git", import.meta.url)),
        );
        const result = await nmeaTarPrimitive.parse(makeVendorFile("203gps/tar/20261006162438_0480.git", content));
        expectPlausibleGpsTrack(result.records, { minCount: 236 });
        expect(result.records).toHaveLength(236);
        expect(new Set(result.records.map((record) => record.mp4Filename)).size).toBe(8);
        expect(result.records[0]!.unixSeconds).toBe(Date.UTC(2026, 9, 6, 13, 23, 6) / 1000);
        expect(result.records.at(-1)!.mp4Filename).toBe("20261006163138_0060.mp4");
    });

    it("prefers this card's rear over a different card's front", async () => {
        for (const separateSources of [false, true]) {
            const file = { ...makeVendorFile(`card-a/${name}`, bytes()), sourceKey: "a" };
            const result = await nmeaTarPrimitive.parse(file, undefined, undefined, {
                knownVideos: [
                    {
                        name: "20261006163238_0057.mp4",
                        relativePath: "card-b/200video/front/20261006163238_0057.mp4",
                        sourceKey: separateSources ? "b" : "a",
                    },
                    {
                        name: "20261006163238_0057_A.mp4",
                        relativePath: "card-a/200video/rear/20261006163238_0057_A.mp4",
                        sourceKey: "a",
                    },
                ],
            });
            expect(result.records).toHaveLength(30);
            expect(result.records[0]!.mp4Filename).toBe("20261006163238_0057_A.mp4");
        }
    });

    it("rejects unrelated files, bad checksums, and truncated members", async () => {
        expect(await nmeaTarPrimitive.marker(makeVendorFile("other.git", bytes()))).toBe(false);
        expect(await nmeaTarPrimitive.marker(makeVendorFile(name, "not a tar archive"))).toBe(false);
        const corrupt = bytes();
        corrupt[0] = 88;
        expect(await nmeaTarPrimitive.marker(makeVendorFile(name, corrupt))).toBe(false);
        await expect(nmeaTarPrimitive.parse(makeVendorFile(name, corrupt))).rejects.toThrow(WrongFormatError);
        await expect(nmeaTarPrimitive.parse(makeVendorFile(name, bytes().slice(0, 600)))).rejects.toThrow(/truncated/);
    });

    it("stops at archive padding even when recycled data follows", async () => {
        const original = bytes();
        const joined = new Uint8Array(original.length * 2);
        joined.set(original);
        joined.set(original, original.length);
        expect((await nmeaTarPrimitive.parse(makeVendorFile(name, joined))).records).toHaveLength(30);
    });

    it("propagates cancellation", async () => {
        const controller = new AbortController();
        controller.abort();
        await expect(
            nmeaTarPrimitive.parse(makeVendorFile(name, bytes()), undefined, controller.signal),
        ).rejects.toMatchObject({ name: "AbortError" });
    });
});
