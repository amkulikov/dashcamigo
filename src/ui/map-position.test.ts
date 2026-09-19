import { describe, expect, it } from "vitest";
import type { GpsRecord } from "../parsers/types.js";
import { mapPositionAt } from "./map-position.js";

function record(time: number, overrides: Partial<GpsRecord> = {}): GpsRecord {
    return {
        unixSeconds: time,
        active: true,
        lat: 50,
        lon: 20,
        bearingDeg: 90,
        speedMs: 10,
        accelXg: 0,
        accelYg: 0,
        accelZg: 0,
        mp4Filename: "trip.mp4",
        ...overrides,
    };
}

describe("mapPositionAt", () => {
    it("interpolates healthy GPS samples and keeps short gaps smooth", () => {
        const position = mapPositionAt([record(100), record(108, { lon: 20.008 })], 104);
        expect(position?.lon).toBeCloseTo(20.004);
    });

    it("hides positions inside long gaps and restores them at the next fix", () => {
        const records = [record(100), record(120, { lon: 20.02 })];
        expect(mapPositionAt(records, 105), "last moment covered by the earlier fix").not.toBeNull();
        expect(mapPositionAt(records, 106), "dropout starts beyond export tolerance").toBeNull();
        expect(mapPositionAt(records, 114), "gap remains uncovered").toBeNull();
        expect(mapPositionAt(records, 120)?.lon, "GPS resumes").toBeCloseTo(20.02);
    });

    it("rejects explicit lost fixes even when valid samples are nearby", () => {
        const records = [record(100), record(101, { active: false }), record(102)];
        expect(mapPositionAt(records, 101)).toBeNull();
        expect(mapPositionAt(records, 102)).not.toBeNull();
    });

    it("uses the same edge tolerance for one fix and longer routes", () => {
        for (const records of [[record(100)], [record(100), record(101)]]) {
            const end = records[records.length - 1]!.unixSeconds;
            expect(mapPositionAt(records, 95), "warm-up tolerance").not.toBeNull();
            expect(mapPositionAt(records, 94.9), "before GPS coverage").toBeNull();
            expect(mapPositionAt(records, end + 5), "tail tolerance").not.toBeNull();
            expect(mapPositionAt(records, end + 5.1), "after GPS coverage").toBeNull();
        }
    });
});
