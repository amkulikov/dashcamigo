// Importing the shim is safe in node: its worker pool spawns lazily, and this
// test exercises only the pure batch-width calculation.

import { describe, expect, it } from "vitest";

import { dispatchParseVideoEmbeddedGpsViaWorker, gpsExtractShardCount } from "./gps-extract-shim.js";

describe("gpsExtractShardCount", () => {
    it("keeps responsive-storage reads serial even when the pool is wider", () => {
        expect(gpsExtractShardCount(203, 1, 4)).toBe(1);
    });

    it("caps throughput by both available workers and files", () => {
        expect(gpsExtractShardCount(203, 8, 4)).toBe(4);
        expect(gpsExtractShardCount(2, 8, 4)).toBe(2);
        expect(gpsExtractShardCount(0, 8, 4)).toBe(0);
    });

    it("returns no failure evidence for an empty extraction request", async () => {
        const result = await dispatchParseVideoEmbeddedGpsViaWorker([]);
        expect(result.records).toHaveLength(0);
        expect(result.failedFileKeys.size).toBe(0);
    });
});
