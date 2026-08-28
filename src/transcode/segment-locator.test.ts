import { describe, expect, it } from "vitest";

import { locateMonotonicSegment, type MonotonicSegmentCursor, type TimedSegment } from "./segment-locator.js";

const segments: TimedSegment[] = [
    { tripStart: 0, startInFile: 0, endInFile: 1 },
    { tripStart: 2, startInFile: 0.25, endInFile: 1.25 },
];

function cursor(): MonotonicSegmentCursor {
    return { locatorSegmentIdx: 0 };
}

describe("locateMonotonicSegment", () => {
    it("preserves the inclusive epsilon at both ends before advancing", () => {
        const c = cursor();
        expect(locateMonotonicSegment(segments, -0.5e-6, c)).toBe(0);
        expect(locateMonotonicSegment(segments, 1 + 0.5e-6, c)).toBe(0);
        expect(c.locatorSegmentIdx).toBe(0);
        expect(locateMonotonicSegment(segments, 1 + 1.5e-6, c)).toBe(-1);
        expect(c.locatorSegmentIdx).toBe(1);
    });

    it("parks on the next segment through a gap, then activates it", () => {
        const c = cursor();
        expect(locateMonotonicSegment(segments, 1.5, c)).toBe(-1);
        expect(c.locatorSegmentIdx).toBe(1);
        expect(locateMonotonicSegment(segments, 2, c)).toBe(-1);
        expect(c.locatorSegmentIdx).toBe(1);
        expect(locateMonotonicSegment(segments, 2.25, c)).toBe(1);
    });

    it("does not advance while time is before the first segment", () => {
        const c = cursor();
        expect(locateMonotonicSegment(segments, -1, c)).toBe(-1);
        expect(c.locatorSegmentIdx).toBe(0);
    });

    it("advances each exhausted segment once and stays exhausted", () => {
        const c = cursor();
        expect(locateMonotonicSegment(segments, 4, c)).toBe(-1);
        expect(c.locatorSegmentIdx).toBe(segments.length);
        expect(locateMonotonicSegment(segments, 5, c)).toBe(-1);
        expect(c.locatorSegmentIdx).toBe(segments.length);
    });
});
