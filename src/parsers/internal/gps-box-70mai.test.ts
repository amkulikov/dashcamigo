// Unit tests for the older-70mai-Pro `GPS ` box parser (direct 36-byte records).
import { describe, it, expect } from "vitest";
import { _internal, parseMaiGpsBox } from "./gps-box-70mai.js";

const { packedDdmmToDegrees } = _internal;

// Builds a `GPS ` box (8-byte header + N x 36-byte records) for the parser.
function gpsBox(
    recs: Array<{
        hasGps?: number;
        seconds?: number;
        speedMetresPerHour?: number;
        ns?: string;
        lat?: number;
        ew?: string;
        lon?: number;
    }>,
): Uint8Array {
    function packDeg(d: number): number {
        const deg = Math.floor(d);
        return deg * 100_000 + Math.round((d - deg) * 60 * 1000);
    }
    const body = new Uint8Array(recs.length * 36);
    const dv = new DataView(body.buffer);
    recs.forEach((r, i) => {
        const o = i * 36;
        dv.setUint32(o, 1, true);
        dv.setUint32(o + 4, r.hasGps ?? 1, true);
        dv.setUint32(o + 8, r.seconds ?? i, true);
        dv.setUint32(o + 12, r.speedMetresPerHour ?? 100000, true);
        dv.setUint8(o + 16, (r.ns ?? "N").charCodeAt(0));
        dv.setUint32(o + 17, packDeg(r.lat ?? 50), true);
        dv.setUint8(o + 21, (r.ew ?? "E").charCodeAt(0));
        dv.setUint32(o + 22, packDeg(r.lon ?? 30), true);
    });
    const box = new Uint8Array(8 + body.byteLength);
    new DataView(box.buffer).setUint32(0, box.byteLength, false);
    box.set([0x47, 0x50, 0x53, 0x20], 4); // "GPS "
    box.set(body, 8);
    return box;
}

describe("packedDdmmToDegrees", () => {
    it("decodes DD MM.mmm packed integer to decimal degrees", () => {
        expect(packedDdmmToDegrees(5000000)).toBeCloseTo(50.0, 6); // 50 deg 00.000 min
        expect(packedDdmmToDegrees(5211400)).toBeCloseTo(52.19, 6); // 52 deg 11.400 min
        expect(packedDdmmToDegrees(3000600)).toBeCloseTo(30.01, 6); // 30 deg 00.600 min
    });
});

describe("parseMaiGpsBox", () => {
    it("decodes records with sentinel coords, real speed, timeUnsynced", () => {
        const box = gpsBox([
            { seconds: 0, speedMetresPerHour: 105300, lat: 50.0, lon: 30.0 },
            { seconds: 1, speedMetresPerHour: 106000, lat: 50.01, lon: 30.01 },
            { hasGps: 0, lat: 0, lon: 0 }, // no fix - skipped
        ]);
        const { records } = parseMaiGpsBox(box, "NO.MP4");
        expect(records).toHaveLength(2);
        expect(records[0]!.lat).toBeCloseTo(50.0, 5);
        expect(records[0]!.lon).toBeCloseTo(30.0, 5);
        expect(records[1]!.lat).toBeCloseTo(50.01, 5);
        // 105300 m/h -> 29.25 m/s -> 105.3 km/h.
        expect(records[0]!.speedMs * 3.6).toBeCloseTo(105.3, 1);
        expect(records.every((r) => r.timeUnsynced === true && r.active === true)).toBe(true);
        expect(records[0]!.mp4Filename).toBe("NO.MP4");
        // Per-record `seconds` (offset 8) is read so reanchor can place each fix
        // at startUtc+offset instead of spreading evenly.
        expect(records[0]!.relStartSeconds).toBe(0);
        expect(records[1]!.relStartSeconds).toBe(1);
    });

    it("preserves S/W hemisphere signs", () => {
        const box = gpsBox([{ ns: "S", lat: 33.86, ew: "W", lon: 70.65 }]);
        const { records } = parseMaiGpsBox(box, "x");
        expect(records[0]!.lat).toBeCloseTo(-33.86, 4);
        expect(records[0]!.lon).toBeCloseTo(-70.65, 4);
    });

    it("returns no records for an empty/garbage box", () => {
        expect(parseMaiGpsBox(new Uint8Array(8), "x").records).toHaveLength(0);
        // Bad hemisphere bytes -> skipped, not crash.
        const bad = gpsBox([{ ns: "X" as string, lat: 50, lon: 30 }]);
        expect(parseMaiGpsBox(bad, "x").records).toHaveLength(0);
    });
});
