import { describe, expect, it } from "vitest";

import {
    candidatesInRange,
    type FileSegment,
    rangeSourceBitrateBps,
    rangeSourceFps,
    sliceCandidatesForRange,
} from "./export-range.js";
import { buildTripTimeline, type TripFrame, type VideoCandidate } from "./trips.js";

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

/** Minimal candidate for slicing tests - only placement inputs matter here. */
function makeCandidate(opts: {
    name: string;
    startUtc: number;
    durationSec: number;
    driftLeadSec?: number | null;
}): VideoCandidate {
    return {
        file: new File([new Uint8Array(16)], opts.name),
        relativePath: opts.name,
        fingerprint: "fp:cam",
        appliedExtractors: [],
        classifierMatches: { time: null, channel: null, mode: null, sequence: null },
        channel: "rear",
        channelConfident: true,
        sequence: null,
        recordingMode: null,
        isTimelapse: false,
        startUtc: opts.startUtc,
        durationSec: opts.durationSec,
        wallDurationSec: null,
        driftLeadSec: opts.driftLeadSec ?? null,
        startSource: "mp4",
        cameraTzSec: null,
        createdUtc: null,
        records: [],
        codec: null,
        codecParam: null,
        videoCodecString: null,
        rotation: 0,
        width: null,
        height: null,
        fps: null,
        audio: null,
        canPlay: true,
        needsHevcRemux: false,
        isTransportStream: false,
        isMatroska: false,
        audioNeedsTranscode: false,
        embeddedStartUtcHint: null,
        localClockOffsetHintSec: null,
    };
}

function frameOf(startUtc: number, durationSec: number, candidate: VideoCandidate): TripFrame {
    return { startUtc, durationSec, wallDurationSec: durationSec, channels: { rear: candidate } };
}

describe("sliceCandidatesForRange", () => {
    it("places files back-to-back and slices the overlap of each", () => {
        const a = makeCandidate({ name: "a.mp4", startUtc: 0, durationSec: 60 });
        const b = makeCandidate({ name: "b.mp4", startUtc: 60, durationSec: 60 });
        const timeline = buildTripTimeline([frameOf(0, 60, a), frameOf(60, 60, b)]);
        const segs = sliceCandidatesForRange([a, b], timeline, 30, 90);
        expect(segs).toHaveLength(2);
        expect(segs[0]!.startInFile).toBeCloseTo(30, 6);
        expect(segs[0]!.endInFile).toBeCloseTo(60, 6);
        expect(segs[1]!.startInFile).toBeCloseTo(0, 6);
        expect(segs[1]!.endInFile).toBeCloseTo(30, 6);
    });

    it("a drift lead shifts the file later, so the same range reads earlier file positions", () => {
        // Rear channel 2s ahead of its names (see channel-drift.ts): content for
        // trip time t lives at file position t - lead, and the first 2s of each
        // minute live in the PREVIOUS file's tail.
        const a = makeCandidate({ name: "a.mp4", startUtc: 0, durationSec: 60, driftLeadSec: 2.0 });
        const b = makeCandidate({ name: "b.mp4", startUtc: 60, durationSec: 60, driftLeadSec: 2.018 });
        const timeline = buildTripTimeline([frameOf(0, 60, a), frameOf(60, 60, b)]);
        const segs = sliceCandidatesForRange([a, b], timeline, 30, 90);
        expect(segs).toHaveLength(2);
        expect(segs[0]!.startInFile, "content for trip 30s sits 2s earlier in the file").toBeCloseTo(28, 6);
        expect(segs[0]!.endInFile, "previous file covers up to its shifted end").toBeCloseTo(60, 6);
        expect(segs[1]!.startInFile).toBeCloseTo(0, 6);
        expect(segs[1]!.endInFile).toBeCloseTo(90 - 62.018, 6);
    });

    it("candidatesInRange returns the overlapping candidates themselves", () => {
        // The export decode preflight walks candidates (not file slices) to
        // find an undecodable source - the selection must match the slicer's.
        const a = makeCandidate({ name: "a.mp4", startUtc: 0, durationSec: 60 });
        const b = makeCandidate({ name: "b.mp4", startUtc: 60, durationSec: 60 });
        const timeline = buildTripTimeline([frameOf(0, 60, a), frameOf(60, 60, b)]);
        const before = candidatesInRange([a, b], timeline, 0, 50);
        expect(before.map((e) => e.candidate)).toEqual([a]);
        const spanning = candidatesInRange([a, b], timeline, 30, 90);
        expect(spanning.map((e) => e.candidate)).toEqual([a, b]);
        expect(spanning[1]!.fileStart).toBeCloseTo(60, 6);
    });

    it("the shifted tail file ends exactly where the other channel's tail ends", () => {
        // The session tail pair: front 23s, rear 19s with a 4s lead - both
        // channels stopped at the same wall instant, so on the content axis the
        // shifted rear tail must end at the same point as the front tail (83s).
        const full = makeCandidate({ name: "r0.mp4", startUtc: 0, durationSec: 60, driftLeadSec: 3.98 });
        const tail = makeCandidate({ name: "r1.mp4", startUtc: 60, durationSec: 19, driftLeadSec: 4 });
        const timeline = buildTripTimeline([frameOf(0, 60, full), frameOf(60, 23, tail)]);
        expect(timeline.contentDurationSec, "front-anchored axis ends at the front tail").toBeCloseTo(83, 6);
        const segs = sliceCandidatesForRange([full, tail], timeline, 73, 83);
        expect(segs).toHaveLength(1);
        expect(segs[0]!.startInFile).toBeCloseTo(9, 6);
        expect(segs[0]!.endInFile, "last rear content second aligns with the stop instant").toBeCloseTo(19, 6);
    });
});
