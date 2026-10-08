import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseNmeaText } from "../../internal/nmea.js";
import { ddpaiGpxSidecar } from "../../sidecars/nmea-sidecar.js";
import { expectPlausibleGpsTrack, makeVendorFile } from "../helpers.js";

function fixture(name: string): Uint8Array<ArrayBuffer> {
    return new Uint8Array(readFileSync(new URL(name, import.meta.url)));
}

describe("DDPAI preallocated GPS files", () => {
    it("reads real fixes in UTC and excludes the separate sensor block", async () => {
        const name = "20261006214554_0060.gpx";
        // The sensor block must be present for the exclusion below to prove anything.
        expect(new TextDecoder().decode(fixture("valid.gpx"))).toMatch(/^\$GSENSOR,-?\d+,/m);
        const records = await ddpaiGpxSidecar.parse(makeVendorFile(`203gps/${name}`, fixture("valid.gpx")), name.replace("gpx", "mp4"));
        expectPlausibleGpsTrack(records, { minCount: 30 });
        expect(records).toHaveLength(30);
        expect(records[0]!.unixSeconds).toBe(Date.UTC(2026, 9, 6, 18, 44, 16) / 1000);
        for (const record of records) {
            expect(Number.isInteger(record.lat) && Number.isInteger(record.lon), "whole-degree coordinates").toBe(true);
            expect(record.speedMs).toBeGreaterThanOrEqual(0);
            expect(record.speedMs).toBeLessThan(80);
            expect([record.accelXg, record.accelYg, record.accelZg]).toEqual([0, 0, 0]);
        }
    });

    it("does not assign stale tail fixes to a nine-second clip without a fix", async () => {
        const text = new TextDecoder().decode(fixture("stale-tail.gpx"));
        expect(parseNmeaText(text, "clip.mp4").records).toHaveLength(15);
        const file = makeVendorFile("203gps/20261006213217_0009_D.gpx", text);
        expect(await ddpaiGpxSidecar.parse(file, "20261006213217_0009.mp4")).toEqual([]);
    });

    it("rejects a reused temporary file whose header belongs to another clip", async () => {
        const file = makeVendorFile("203gps/tmp/20261006151617_0060_T.gpx", fixture("reused.gpx"));
        expect(ddpaiGpxSidecar.matches(file, new Set(["20261006151617_0060.mp4"]))).toBe("20261006151617_0060.mp4");
        expect(await ddpaiGpxSidecar.parse(file, "20261006151617_0060.mp4")).toEqual([]);
    });

    it("rejects fixes from another date inside the current GPS section", async () => {
        const file = makeVendorFile("203gps/20260913141341_0060.gpx", fixture("stale-date.gpx"));
        expect(await ddpaiGpxSidecar.parse(file, "20260913141341_0060.mp4")).toEqual([]);
    });
});
