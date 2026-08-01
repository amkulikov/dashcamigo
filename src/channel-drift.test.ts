import { describe, expect, it } from "vitest";

import { applyChannelDriftLead } from "./channel-drift.js";
import { groupTrips, tripCandidatesByChannel, type TripFrame, type VideoCandidate } from "./trips.js";
import type { Channel } from "./parsers/types.js";

const MAI_FP = "70mai|G:|NO#-#-#.MP#";

function makeCandidate(opts: {
    name: string;
    startUtc: number;
    durationSec?: number;
    channel?: Channel | null;
    fingerprint?: string;
    wallDurationSec?: number | null;
}): VideoCandidate {
    return {
        file: new File([new Uint8Array(16)], opts.name),
        relativePath: opts.name,
        fingerprint: opts.fingerprint ?? MAI_FP,
        appliedExtractors: [],
        classifierMatches: { time: null, channel: null, mode: null, sequence: null },
        channel: opts.channel ?? null,
        channelConfident: true,
        sequence: null,
        recordingMode: null,
        isTimelapse: false,
        startUtc: opts.startUtc,
        durationSec: opts.durationSec ?? 60,
        wallDurationSec: opts.wallDurationSec ?? null,
        driftLeadSec: null,
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

/** A two-channel frame at `startUtc`; per-channel durations via opts. */
function makePairFrame(
    startUtc: number,
    opts: { frontDur?: number; rearDur?: number; fingerprint?: string } = {},
): TripFrame {
    const front = makeCandidate({
        name: `t${startUtc}F.mp4`,
        startUtc,
        durationSec: opts.frontDur ?? 60,
        channel: "front",
        fingerprint: opts.fingerprint,
    });
    const rear = makeCandidate({
        name: `t${startUtc}R.mp4`,
        startUtc,
        durationSec: opts.rearDur ?? 60,
        channel: "rear",
        fingerprint: opts.fingerprint,
    });
    const durationSec = Math.max(front.durationSec, rear.durationSec);
    return { startUtc, durationSec, wallDurationSec: durationSec, channels: { front, rear } };
}

/** A session of back-to-back 60s pairs starting at `startUtc`, tail pair with the given durations. */
function makeSession(
    startUtc: number,
    fullFrames: number,
    tail: { frontDur: number; rearDur: number },
    fingerprint?: string,
): TripFrame[] {
    const frames: TripFrame[] = [];
    for (let i = 0; i < fullFrames; i++) frames.push(makePairFrame(startUtc + i * 60, { fingerprint }));
    frames.push(makePairFrame(startUtc + fullFrames * 60, { ...tail, fingerprint }));
    return frames;
}

function rearLeads(frames: readonly TripFrame[]): (number | null)[] {
    return frames.map((f) => f.channels.rear?.driftLeadSec ?? null);
}

describe("applyChannelDriftLead", () => {
    it("ramps the tail-pair delta linearly across the session on the drifting channel", () => {
        // 3h session: 180 full pairs, tail pair F=23.0 / R=19.7 -> rear content
        // leads by 3.3s at the tail, accumulated linearly from the start.
        const frames = makeSession(1000, 180, { frontDur: 23.0, rearDur: 19.7 });
        applyChannelDriftLead(frames);
        const sessionSec = 180 * 60;
        expect(frames[0]!.channels.rear!.driftLeadSec, "session start has no accumulated lead").toBeCloseTo(0, 5);
        expect(frames[90]!.channels.rear!.driftLeadSec, "mid-session lead is half the tail delta").toBeCloseTo(
            3.3 * ((90 * 60) / sessionSec),
            5,
        );
        expect(frames[180]!.channels.rear!.driftLeadSec, "tail carries the full measured delta").toBeCloseTo(3.3, 5);
        expect(
            frames.every((f) => f.channels.front!.driftLeadSec === null),
            "front is the anchor channel and never gets a lead",
        ).toBe(true);
    });

    it("leaves a healthy camera untouched when the tail delta is within noise", () => {
        const frames = makeSession(1000, 60, { frontDur: 23.0, rearDur: 22.8 });
        applyChannelDriftLead(frames);
        expect(rearLeads(frames)).toEqual(Array(61).fill(null));
    });

    it("skips fingerprints outside the known frame-count-cut muxer family", () => {
        const frames = makeSession(1000, 180, { frontDur: 23.0, rearDur: 19.7 }, "fp:other-cam");
        applyChannelDriftLead(frames);
        expect(rearLeads(frames)).toEqual(Array(181).fill(null));
    });

    it("skips a delta whose apparent rate exceeds plausible sensor drift", () => {
        // 15 min session with a 10s tail delta = 40 s/h - a broken tail, not drift.
        const frames = makeSession(1000, 15, { frontDur: 40, rearDur: 30 });
        applyChannelDriftLead(frames);
        expect(rearLeads(frames)).toEqual(Array(16).fill(null));
    });

    it("skips a session too short to measure", () => {
        const frames = makeSession(1000, 5, { frontDur: 23.0, rearDur: 22.0 });
        applyChannelDriftLead(frames);
        expect(rearLeads(frames)).toEqual(Array(6).fill(null));
    });

    it("skips when the tail frame lacks the paired channel", () => {
        const frames = makeSession(1000, 60, { frontDur: 23.0, rearDur: 19.7 });
        delete frames[60]!.channels.rear;
        applyChannelDriftLead(frames);
        expect(rearLeads(frames.slice(0, 60))).toEqual(Array(60).fill(null));
    });

    it("clears a stale lead when a re-run no longer measures drift", () => {
        const frames = makeSession(1000, 60, { frontDur: 23.0, rearDur: 20.7 });
        applyChannelDriftLead(frames);
        expect(frames[60]!.channels.rear!.driftLeadSec, "first run measures the delta").toBeCloseTo(2.3, 5);
        frames[60]!.channels.rear!.durationSec = 23.0;
        applyChannelDriftLead(frames);
        expect(rearLeads(frames)).toEqual(Array(61).fill(null));
    });

    it("keeps an overlapping protected copy inside the session and ramps it by position", () => {
        const frames = makeSession(1000, 60, { frontDur: 23.0, rearDur: 20.7 });
        // A protected copy overlapping the loop mid-session: starts inside the
        // covered span, must neither break the chain nor shift its end.
        const copy = makePairFrame(1000 + 30 * 60 + 10);
        const withCopy = [...frames.slice(0, 31), copy, ...frames.slice(31)];
        applyChannelDriftLead(withCopy);
        expect(copy.channels.rear!.driftLeadSec, "copy gets the lead of its wall position").toBeCloseTo(
            2.3 * ((30 * 60 + 10) / (60 * 60)),
            5,
        );
        expect(frames[60]!.channels.rear!.driftLeadSec, "tail still carries the full delta").toBeCloseTo(2.3, 5);
    });

    it("leaves a mid-session time-lapse clip uncorrected while ramping its neighbours", () => {
        const frames = makeSession(1000, 60, { frontDur: 23.0, rearDur: 20.7 });
        // A parking time-lapse minute inside the session: 4s of footage covering
        // 60s of wall time. The lead is wall seconds, the clip's content axis is
        // compressed - applying it there would over-correct by the cadence
        // factor, so the clip stays null while the chain around it still ramps.
        const lapseStart = 1000 + 30 * 60;
        const lapseFront = makeCandidate({
            name: "lapseF.mp4",
            startUtc: lapseStart,
            durationSec: 4,
            channel: "front",
            wallDurationSec: 60,
        });
        const lapseRear = makeCandidate({
            name: "lapseR.mp4",
            startUtc: lapseStart,
            durationSec: 4,
            channel: "rear",
            wallDurationSec: 60,
        });
        frames[30] = {
            startUtc: lapseStart,
            durationSec: 4,
            wallDurationSec: 60,
            channels: { front: lapseFront, rear: lapseRear },
        };
        applyChannelDriftLead(frames);
        expect(lapseRear.driftLeadSec, "time-lapse clip carries no lead").toBeNull();
        expect(frames[31]!.channels.rear!.driftLeadSec, "the frame after the lapse still ramps").toBeCloseTo(
            2.3 * ((31 * 60) / (60 * 60)),
            5,
        );
        expect(frames[60]!.channels.rear!.driftLeadSec, "tail still carries the full delta").toBeCloseTo(2.3, 5);
    });

    it("measures each session independently across a recording pause", () => {
        const drifting = makeSession(1000, 60, { frontDur: 23.0, rearDur: 20.7 });
        const healthyStart = 1000 + 61 * 60 + 3600; // an hour after the first session ends
        const healthy = makeSession(healthyStart, 60, { frontDur: 23.0, rearDur: 23.0 });
        const frames = [...drifting, ...healthy];
        applyChannelDriftLead(frames);
        expect(drifting[60]!.channels.rear!.driftLeadSec, "first session tail").toBeCloseTo(2.3, 5);
        expect(rearLeads(healthy), "healthy session stays untouched").toEqual(Array(61).fill(null));
    });

    it("carries a negative delta when the front channel is the one that leads", () => {
        const frames = makeSession(1000, 60, { frontDur: 19.7, rearDur: 23.0 });
        applyChannelDriftLead(frames);
        expect(frames[60]!.channels.rear!.driftLeadSec).toBeCloseTo(-3.3, 5);
    });
});

describe("groupTrips: channel drift wiring", () => {
    it("regrouping writes leads onto rear candidates through the per-fingerprint pass", () => {
        const candidates: VideoCandidate[] = [];
        for (let i = 0; i <= 60; i++) {
            const startUtc = 1000 + i * 60;
            const isTail = i === 60;
            candidates.push(
                makeCandidate({
                    name: `f${i}.mp4`,
                    startUtc,
                    durationSec: isTail ? 23.0 : 60,
                    channel: "front",
                }),
                makeCandidate({
                    name: `r${i}.mp4`,
                    startUtc,
                    durationSec: isTail ? 20.7 : 60,
                    channel: "rear",
                }),
            );
        }
        const trips = groupTrips(candidates, 30);
        expect(trips, "contiguous pairs group into one trip").toHaveLength(1);
        const rears = tripCandidatesByChannel(trips[0]!, "rear");
        expect(rears[0]!.driftLeadSec).toBeCloseTo(0, 5);
        expect(rears[60]!.driftLeadSec).toBeCloseTo(2.3, 5);
    });
});
