import { describe, expect, it } from "vitest";

import { type FileSegment, rangeSourceBitrateBps, rangeSourceFps } from "./export-range.js";

/**
 * Segment over a synthetic file of `mb` megabytes lasting `fileSec`, of which
 * the range uses [from, to). File.size is stubbed rather than backed by real
 * bytes - allocating tens of megabytes per case buys nothing, and size is the
 * only input the File constructor cannot set directly.
 */
function segWithSize(opts: {
    mb: number;
    fileSec: number;
    from: number;
    to: number;
    fps?: number | null;
}): FileSegment {
    const file = new File([], "clip.mp4", { type: "video/mp4" });
    Object.defineProperty(file, "size", { value: opts.mb * 1_000_000, configurable: true });
    return {
        file,
        startInFile: opts.from,
        endInFile: opts.to,
        tripStart: 0,
        fps: opts.fps === undefined ? 30 : opts.fps,
        fileDurationSec: opts.fileSec,
    };
}

describe("rangeSourceFps", () => {
    it("takes the highest rate among the files the range touches", () => {
        const fps = rangeSourceFps([
            segWithSize({ mb: 60, fileSec: 60, from: 0, to: 60, fps: 30 }),
            segWithSize({ mb: 60, fileSec: 60, from: 0, to: 60, fps: 60 }),
        ]);
        expect(fps).toBe(60);
    });

    it("ignores files whose rate is unknown", () => {
        const fps = rangeSourceFps([
            segWithSize({ mb: 60, fileSec: 60, from: 0, to: 60, fps: null }),
            segWithSize({ mb: 60, fileSec: 60, from: 0, to: 60, fps: 25 }),
        ]);
        expect(fps).toBe(25);
    });

    it("rejects an implausible estimate rather than inflating the budget", () => {
        const fps = rangeSourceFps([
            segWithSize({ mb: 60, fileSec: 60, from: 0, to: 60, fps: 30 }),
            segWithSize({ mb: 60, fileSec: 60, from: 0, to: 60, fps: 100_000 }),
        ]);
        expect(fps).toBe(30);
    });

    it("returns null when no file reports a rate", () => {
        expect(rangeSourceFps([segWithSize({ mb: 60, fileSec: 60, from: 0, to: 60, fps: null })])).toBeNull();
        expect(rangeSourceFps([])).toBeNull();
    });
});

describe("rangeSourceBitrateBps", () => {
    it("reads one file's own average rate", () => {
        // 60 MB over 60 s = 8 Mbps.
        const rate = rangeSourceBitrateBps([segWithSize({ mb: 60, fileSec: 60, from: 0, to: 60 })]);
        expect(rate / 1e6).toBeCloseTo(8, 3);
    });

    it("is unaffected by how much of the file the range slices", () => {
        const whole = rangeSourceBitrateBps([segWithSize({ mb: 60, fileSec: 60, from: 0, to: 60 })]);
        const tenth = rangeSourceBitrateBps([segWithSize({ mb: 60, fileSec: 60, from: 10, to: 16 })]);
        expect(tenth).toBeCloseTo(whole, 3);
    });

    it("weights by used duration, so a brief dip into a thin file barely counts", () => {
        // 30 s of a 24 Mbps file plus 1 s of a 4 Mbps one.
        const rate = rangeSourceBitrateBps([
            segWithSize({ mb: 180, fileSec: 60, from: 0, to: 30 }),
            segWithSize({ mb: 30, fileSec: 60, from: 0, to: 1 }),
        ]);
        expect(rate / 1e6).toBeCloseTo((24 * 30 + 4 * 1) / 31, 2);
    });

    it("tracks the exported stretch rather than the whole trip", () => {
        // The busy file the user trimmed to, against the trip it sits in.
        const busy = segWithSize({ mb: 180, fileSec: 60, from: 0, to: 60 });
        const calm = segWithSize({ mb: 45, fileSec: 60, from: 0, to: 60 });
        const rangeOnly = rangeSourceBitrateBps([busy]);
        const wholeTrip = rangeSourceBitrateBps([busy, calm, calm, calm]);
        expect(rangeOnly).toBeGreaterThan(wholeTrip * 1.5);
    });

    it("returns 0 for a range that covers nothing", () => {
        expect(rangeSourceBitrateBps([])).toBe(0);
        expect(rangeSourceBitrateBps([segWithSize({ mb: 60, fileSec: 60, from: 12, to: 12 })])).toBe(0);
    });

    it("skips a file with no usable duration instead of dividing by zero", () => {
        const rate = rangeSourceBitrateBps([
            segWithSize({ mb: 60, fileSec: 0, from: 0, to: 10 }),
            segWithSize({ mb: 60, fileSec: 60, from: 0, to: 10 }),
        ]);
        expect(rate / 1e6).toBeCloseTo(8, 3);
    });
});
