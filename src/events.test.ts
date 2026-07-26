// Unit tests for the automatic brake event detector.
// Covers: G magnitude, threshold (default 0.5g, user-configurable),
// dedup within 3-second window, event ordering, behavior on empty/null inputs.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { detectEvents, getBrakeThresholdG, gMagnitude, setBrakeThresholdG } from "./events.js";
import type { GpsRecord } from "./parsers/types.js";

function rec(unixSeconds: number, accel: [number, number, number]): GpsRecord {
    return {
        unixSeconds,
        active: true,
        lat: 0,
        lon: 0,
        bearingDeg: 0,
        speedMs: 0,
        accelXg: accel[0],
        accelYg: accel[1],
        accelZg: accel[2],
        mp4Filename: "x.mp4",
    };
}

describe("gMagnitude", () => {
    it("returns 0 for zero vector (gravity-removed at rest)", () => {
        expect(gMagnitude(rec(0, [0, 0, 0]))).toBe(0);
    });

    it("returns axis-aligned magnitude", () => {
        expect(gMagnitude(rec(0, [1, 0, 0]))).toBeCloseTo(1, 9);
        expect(gMagnitude(rec(0, [0, 0.5, 0]))).toBeCloseTo(0.5, 9);
        expect(gMagnitude(rec(0, [0, 0, 0.3]))).toBeCloseTo(0.3, 9);
    });

    it("returns euclidean norm for combined axes", () => {
        // |(0.3, 0.4, 0)| = 0.5
        expect(gMagnitude(rec(0, [0.3, 0.4, 0]))).toBeCloseTo(0.5, 9);
        // |(1, 1, 1)| = sqrt(3)
        expect(gMagnitude(rec(0, [1, 1, 1]))).toBeCloseTo(Math.sqrt(3), 9);
    });

    it("symmetric in sign (|x| of negative components)", () => {
        expect(gMagnitude(rec(0, [-0.3, -0.4, 0]))).toBeCloseTo(0.5, 9);
        expect(gMagnitude(rec(0, [-1, 1, -1]))).toBeCloseTo(Math.sqrt(3), 9);
    });
});

describe("detectEvents - null/empty input", () => {
    it("returns empty array for null", () => {
        expect(detectEvents(null, 0)).toEqual([]);
    });

    it("returns empty array for undefined", () => {
        expect(detectEvents(undefined, 0)).toEqual([]);
    });

    it("returns empty array for empty array", () => {
        expect(detectEvents([], 0)).toEqual([]);
    });
});

describe("detectEvents - brake threshold (HARD_BRAKE_G_THRESHOLD = 0.5)", () => {
    it("fires on g exactly at threshold (strict less-than check uses <)", () => {
        // 0.5g is the boundary. Code uses `g < THRESHOLD continue`, so exactly
        // 0.5 is NOT skipped - an event is produced.
        const records = [rec(100, [0.5, 0, 0])];
        expect(detectEvents(records, 100)).toHaveLength(1);
    });

    it("does NOT fire below threshold (typical bumps 0.3-0.4g)", () => {
        const records = [rec(100, [0.3, 0, 0]), rec(101, [0.4, 0, 0]), rec(102, [0.49, 0, 0])];
        expect(detectEvents(records, 100)).toEqual([]);
    });

    it("fires above threshold", () => {
        const records = [rec(100, [0.6, 0, 0])];
        const events = detectEvents(records, 100);
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({
            kind: "brake",
            unixSeconds: 100,
            relSec: 0,
            recordIndex: 0,
        });
        expect(events[0]!.severity).toBeCloseTo(0.6, 9);
    });

    it("fires on combined-axis magnitude above threshold", () => {
        // |(0.4, 0.4, 0)| = sqrt(0.32) ≈ 0.566 > 0.5
        const records = [rec(100, [0.4, 0.4, 0])];
        expect(detectEvents(records, 100)).toHaveLength(1);
    });

    it("fires on negative-axis magnitude above threshold", () => {
        // |(-0.6, 0, 0)| = 0.6 > 0.5
        const records = [rec(100, [-0.6, 0, 0])];
        expect(detectEvents(records, 100)).toHaveLength(1);
    });
});

describe("detectEvents - dedup window (BRAKE_DEDUPE_WINDOW_SEC = 3)", () => {
    it("collapses pack of brakes within 3 sec into single peak", () => {
        // One long impact: 5 samples above threshold at 0.5s intervals.
        // Dedup keeps the maximum severity.
        const records = [
            rec(100, [0.6, 0, 0]), // 0.6
            rec(100.5, [0.7, 0, 0]), // 0.7
            rec(101, [0.9, 0, 0]), // 0.9 ← peak
            rec(101.5, [0.8, 0, 0]), // 0.8
            rec(102, [0.55, 0, 0]), // 0.55
        ];
        const events = detectEvents(records, 100);
        expect(events).toHaveLength(1);
        expect(events[0]!.severity).toBeCloseTo(0.9, 9);
        expect(events[0]!.unixSeconds).toBe(101); // peak moment, not first trigger
    });

    it("keeps two events separated by more than 3 sec", () => {
        const records = [
            rec(100, [0.7, 0, 0]),
            rec(104, [0.6, 0, 0]), // 4s > 3 - does not merge with first
        ];
        const events = detectEvents(records, 100);
        expect(events).toHaveLength(2);
        expect(events[0]!.unixSeconds).toBe(100);
        expect(events[1]!.unixSeconds).toBe(104);
    });

    it("collapses across exact 3-second boundary (inclusive)", () => {
        // Code: `rec.unixSeconds - pending.unixSeconds <= 3` (inclusive).
        // Two events exactly 3s apart must merge.
        const records = [rec(100, [0.7, 0, 0]), rec(103, [0.8, 0, 0])];
        const events = detectEvents(records, 100);
        expect(events).toHaveLength(1);
        expect(events[0]!.severity).toBeCloseTo(0.8, 9);
    });

    it("three brakes with 2/2 sec gaps merge into one (sliding window relative to peak)", () => {
        // Current implementation: window is "from last pending" (not first),
        // so the window slides as the peak advances.
        // 100, 102, 104 - each neighbor within 2s, all < 3, merge into one.
        const records = [rec(100, [0.6, 0, 0]), rec(102, [0.9, 0, 0]), rec(104, [0.7, 0, 0])];
        const events = detectEvents(records, 100);
        expect(events).toHaveLength(1);
        expect(events[0]!.severity).toBeCloseTo(0.9, 9);
    });
});

describe("detectEvents - relSec and recordIndex", () => {
    it("computes relSec relative to tripStartUtc", () => {
        const TRIP_START = 1_700_000_000;
        const records = [rec(TRIP_START + 42, [0.7, 0, 0])];
        const events = detectEvents(records, TRIP_START);
        expect(events[0]!.relSec).toBe(42);
    });

    it("records correct recordIndex (peak position in dedup)", () => {
        const records = [
            rec(100, [0.6, 0, 0]), // index 0
            rec(101, [0.9, 0, 0]), // index 1 ← peak
            rec(102, [0.7, 0, 0]), // index 2
        ];
        const events = detectEvents(records, 100);
        expect(events).toHaveLength(1);
        expect(events[0]!.recordIndex).toBe(1);
    });
});

describe("detectEvents - sorting", () => {
    it("returns events sorted by unixSeconds (already sorted input)", () => {
        const records = [rec(100, [0.7, 0, 0]), rec(110, [0.6, 0, 0]), rec(120, [0.8, 0, 0])];
        const events = detectEvents(records, 100);
        expect(events.map((e) => e.unixSeconds)).toEqual([100, 110, 120]);
    });
});

// localStorage shim for the user-threshold tests. Node has no localStorage
// global by default; the getter/setter in events.ts swallows the reference
// error and falls back to the default. To exercise the user-configurable
// path we install an in-memory shim for the duration of these tests.
describe("detectEvents - user-configurable threshold via localStorage", () => {
    const memory = new Map<string, string>();
    const shim = {
        getItem: (k: string) => memory.get(k) ?? null,
        setItem: (k: string, v: string) => {
            memory.set(k, v);
        },
        removeItem: (k: string) => {
            memory.delete(k);
        },
    };

    beforeEach(() => {
        memory.clear();
        vi.stubGlobal("localStorage", shim);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("falls back to 0.5g when no value is stored", () => {
        expect(getBrakeThresholdG()).toBeCloseTo(0.5, 9);
    });

    it("respects a raised threshold (0.8g masks a 0.6g spike)", () => {
        setBrakeThresholdG(0.8);
        const records = [rec(100, [0.6, 0, 0])];
        expect(detectEvents(records, 100)).toEqual([]);
    });

    it("respects a lowered threshold (0.3g catches a 0.4g bump)", () => {
        setBrakeThresholdG(0.3);
        const records = [rec(100, [0.4, 0, 0])];
        const events = detectEvents(records, 100);
        expect(events).toHaveLength(1);
        expect(events[0]!.severity).toBeCloseTo(0.4, 9);
    });

    it("disables detection entirely when threshold is +Infinity (off)", () => {
        setBrakeThresholdG(Number.POSITIVE_INFINITY);
        const records = [rec(100, [0.9, 0, 0]), rec(110, [1.5, 0, 0]), rec(120, [2, 0, 0])];
        expect(detectEvents(records, 100)).toEqual([]);
    });

    it("clamps below-min input to BRAKE_G_THRESHOLD_MIN (0.1g)", () => {
        setBrakeThresholdG(0.01);
        expect(getBrakeThresholdG()).toBeCloseTo(0.1, 9);
    });

    it("clamps above-max input to BRAKE_G_THRESHOLD_MAX (2g)", () => {
        setBrakeThresholdG(99);
        expect(getBrakeThresholdG()).toBeCloseTo(2, 9);
    });

    it("ignores stored garbage and returns default", () => {
        memory.set("dashcamigo:events:brakeThresholdG", "not-a-number");
        expect(getBrakeThresholdG()).toBeCloseTo(0.5, 9);
    });
});

describe("detectEvents - real-world patterns", () => {
    it("ignores noise floor (records with accel < 0.5g for entire trip)", () => {
        // Calm driving: acceleration varies 0.1-0.3g.
        const records = Array.from({ length: 100 }, (_, i) => {
            const ax = ((i % 7) - 3) * 0.05; // range -0.15..+0.15
            const ay = ((i % 11) - 5) * 0.03; // range -0.15..+0.15
            return rec(i, [ax, ay, 0]);
        });
        expect(detectEvents(records, 0)).toEqual([]);
    });

    it("detects isolated peak amid noise", () => {
        const records: GpsRecord[] = [];
        for (let i = 0; i < 50; i++) records.push(rec(i, [0.2, 0.1, 0]));
        records.push(rec(50, [0.9, 0, 0])); // peak
        for (let i = 51; i < 100; i++) records.push(rec(i, [0.2, 0.1, 0]));

        const events = detectEvents(records, 0);
        expect(events).toHaveLength(1);
        expect(events[0]!.unixSeconds).toBe(50);
        expect(events[0]!.severity).toBeCloseTo(0.9, 9);
    });
});
