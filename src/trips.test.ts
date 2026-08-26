// Unit tests for the two-pass grouper in trips.ts. Covers three key Phase 20
// scenarios:
//   - single-channel files (pre-mc) - one frame per file, trips split on gaps;
//   - synchronized F/B pairs - one frame with two channels;
//   - orphan files (rear or interior only) - frame without front, trip stays valid.
// Also: a mixed folder (1ch + 2ch files) does not crash and trips stay separate.

import { describe, it, expect } from "vitest";
import {
    applyTimelapseCadenceWallSpans,
    deriveStartUtc,
    deriveWallDurationSec,
    displayClockDate,
    displayTzSec,
    estimatePreciseClockOffsetByFingerprint,
    estimateProvisionalDurationByFingerprint,
    estimateTzByFingerprint,
    groupTrips,
    pickFrameChannel,
    reanchorUnsyncedTimes,
    rederiveStartUtcForCandidates,
    resolvePreciseClockOffsetForFile,
    tripChannels,
    tripCandidatesByChannel,
    tripAllCandidates,
    wallToContentSec,
    contentToWallUtc,
    contentToFrame,
    type TzSample,
    type VideoCandidate,
} from "./trips.js";
import { cameraFingerprint } from "./parsers/camera-fingerprint.js";
import { classifyFilenameTime } from "./parsers/filename/index.js";
import type { Channel, GpsRecord, RecordingMode, VendorFile } from "./parsers/types.js";

// Default fingerprint: a shared constant, NOT per-name. groupTrips partitions
// trips by fingerprint (one camera = one trip), so most tests - which model a
// single camera - must share it. Tests that model distinct cameras pass an
// explicit fingerprint. (Real same-camera clips share a fingerprint too: the
// camera-key library strips the channel/sequence, returning a stable per-camera
// key.)
const DEFAULT_FP = "fp:default-cam";

// Minimal VideoCandidate constructor for tests. Fields the grouper doesn't
// use are filled with stubs.
function makeCandidate(opts: {
    name: string;
    startUtc: number;
    durationSec?: number;
    channel?: Channel | null;
    channelConfident?: boolean;
    sequence?: number | null;
    fingerprint?: string;
    bytes?: number;
    records?: GpsRecord[];
    recordingMode?: RecordingMode | null;
    relativePath?: string;
    wallDurationSec?: number | null;
    isTimelapse?: boolean;
}): VideoCandidate {
    const file = new File([new Uint8Array(opts.bytes ?? 1024)], opts.name);
    return {
        file,
        relativePath: opts.relativePath ?? opts.name,
        fingerprint: opts.fingerprint ?? DEFAULT_FP,
        appliedExtractors: [],
        classifierMatches: { time: null, channel: null, mode: null, sequence: null },
        channel: opts.channel ?? null,
        channelConfident: opts.channelConfident ?? true,
        sequence: opts.sequence ?? null,
        recordingMode: opts.recordingMode ?? null,
        isTimelapse: opts.isTimelapse ?? false,
        startUtc: opts.startUtc,
        durationSec: opts.durationSec ?? 60,
        wallDurationSec: opts.wallDurationSec ?? null,
        driftLeadSec: null,
        startSource: "mp4",
        cameraTzSec: null,
        createdUtc: null,
        records: opts.records ?? [],
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

describe("groupTrips: single-channel (legacy x800)", () => {
    it("two adjacent files → one trip with two single-channel frames", () => {
        const a = makeCandidate({ name: "a.mp4", startUtc: 1000, channel: null });
        const b = makeCandidate({ name: "b.mp4", startUtc: 1060, channel: null });
        const trips = groupTrips([a, b]);
        expect(trips).toHaveLength(1);
        const trip = trips[0]!;
        expect(trip.frames).toHaveLength(2);
        // channel=null is treated as front (DEFAULT_CHANNEL).
        expect(Object.keys(trip.frames[0]!.channels)).toEqual(["front"]);
        expect(trip.frames[0]!.channels.front?.file.name).toBe("a.mp4");
        expect(trip.frames[1]!.channels.front?.file.name).toBe("b.mp4");
    });

    it("gap > threshold splits into two trips", () => {
        const a = makeCandidate({ name: "a.mp4", startUtc: 1000 });
        // 60 + 60 = end of a at 1120; b at 2000 - gap 880 > threshold 30.
        const b = makeCandidate({ name: "b.mp4", startUtc: 2000 });
        const trips = groupTrips([a, b]);
        expect(trips).toHaveLength(2);
        expect(trips[0]!.frames).toHaveLength(1);
        expect(trips[1]!.frames).toHaveLength(1);
    });
});

describe("groupTrips: dual-channel pairs", () => {
    // F/B pairs of one physical camera share a cameraFingerprint (the
    // camera-key library strips channel letter / folder). Tests inject the
    // same `fingerprint` to mirror real-world behavior; without it the
    // grouper correctly keeps them in separate frames.
    const SAME_CAM = "cam-x";

    it("F/B pair with same startUtc and sequence → one frame with two channels", () => {
        const f = makeCandidate({
            name: "NO20260101-120000-000001F.MP4",
            startUtc: 1000,
            channel: "front",
            sequence: 1,
            fingerprint: SAME_CAM,
        });
        const b = makeCandidate({
            name: "NO20260101-120000-000001B.MP4",
            startUtc: 1000,
            channel: "rear",
            sequence: 1,
            fingerprint: SAME_CAM,
        });
        const trips = groupTrips([f, b]);
        expect(trips).toHaveLength(1);
        const trip = trips[0]!;
        expect(trip.frames).toHaveLength(1);
        const frame = trip.frames[0]!;
        expect(Object.keys(frame.channels).sort()).toEqual(["front", "rear"]);
        expect(frame.channels.front?.file.name).toBe("NO20260101-120000-000001F.MP4");
        expect(frame.channels.rear?.file.name).toBe("NO20260101-120000-000001B.MP4");
    });

    it("F/B/I triple → one frame with three channels", () => {
        const f = makeCandidate({
            name: "f.mp4",
            startUtc: 1000,
            channel: "front",
            sequence: 1,
            fingerprint: SAME_CAM,
        });
        const b = makeCandidate({ name: "b.mp4", startUtc: 1000, channel: "rear", sequence: 1, fingerprint: SAME_CAM });
        const i = makeCandidate({
            name: "i.mp4",
            startUtc: 1000,
            channel: "interior",
            sequence: 1,
            fingerprint: SAME_CAM,
        });
        const trips = groupTrips([f, b, i]);
        expect(trips).toHaveLength(1);
        const frame = trips[0]!.frames[0]!;
        expect(Object.keys(frame.channels).sort()).toEqual(["front", "interior", "rear"]);
    });

    it("two F/B pairs → one trip with two frames, each with both channels", () => {
        const f1 = makeCandidate({
            name: "f1.mp4",
            startUtc: 1000,
            channel: "front",
            sequence: 1,
            fingerprint: SAME_CAM,
        });
        const b1 = makeCandidate({
            name: "b1.mp4",
            startUtc: 1000,
            channel: "rear",
            sequence: 1,
            fingerprint: SAME_CAM,
        });
        const f2 = makeCandidate({
            name: "f2.mp4",
            startUtc: 1060,
            channel: "front",
            sequence: 2,
            fingerprint: SAME_CAM,
        });
        const b2 = makeCandidate({
            name: "b2.mp4",
            startUtc: 1060,
            channel: "rear",
            sequence: 2,
            fingerprint: SAME_CAM,
        });
        const trips = groupTrips([f1, b1, f2, b2]);
        expect(trips).toHaveLength(1);
        const trip = trips[0]!;
        expect(trip.frames).toHaveLength(2);
        expect(Object.keys(trip.frames[0]!.channels).sort()).toEqual(["front", "rear"]);
        expect(Object.keys(trip.frames[1]!.channels).sort()).toEqual(["front", "rear"]);
    });

    // Regression guard for the BlackVue "GPS on the front channel only" bug: a
    // shared .gps bound to just the front made the front anchor on its (delayed)
    // GPS fix while the rear anchored on the filename. The gap exceeds the frame
    // snap's half-window (FRAME_TIMESTAMP_SNAP_SEC/2 = 15 s), so the channels
    // tear into separate single-channel frames - the trip shows front, then
    // rear. cloneRecordsAcrossChannels removes the divergence by giving both
    // channels the same GPS.
    it("channel startUtc divergence past the snap splits front from rear", () => {
        const front = makeCandidate({
            name: "20260718_070333_NF.mp4",
            startUtc: 1020, // anchored on the delayed GPS fix
            channel: "front",
            sequence: 1,
            fingerprint: SAME_CAM,
        });
        const rear = makeCandidate({
            name: "20260718_070333_NR.mp4",
            startUtc: 1000, // anchored on the filename, 20 s earlier
            channel: "rear",
            sequence: 1,
            fingerprint: SAME_CAM,
        });
        // The symptom: no single frame carries both channels (they tear apart
        // however the frame/trip split falls out).
        const frames = groupTrips([front, rear]).flatMap((t) => t.frames);
        const paired = frames.some((fr) => fr.channels.front && fr.channels.rear);
        expect(paired).toBe(false);
    });

    it("identical channel startUtc (post-clone) keeps front and rear in one frame", () => {
        const front = makeCandidate({
            name: "20260718_070333_NF.mp4",
            startUtc: 1020,
            channel: "front",
            sequence: 1,
            fingerprint: SAME_CAM,
        });
        const rear = makeCandidate({
            name: "20260718_070333_NR.mp4",
            startUtc: 1020, // rear now shares the front's GPS-derived anchor
            channel: "rear",
            sequence: 1,
            fingerprint: SAME_CAM,
        });
        const trips = groupTrips([front, rear]);
        expect(trips).toHaveLength(1);
        expect(trips[0]!.frames).toHaveLength(1);
        expect(Object.keys(trips[0]!.frames[0]!.channels).sort()).toEqual(["front", "rear"]);
    });

    it("totalBytes summed across all channels of all frames", () => {
        const f = makeCandidate({
            name: "f.mp4",
            startUtc: 1000,
            channel: "front",
            sequence: 1,
            bytes: 500,
            fingerprint: SAME_CAM,
        });
        const b = makeCandidate({
            name: "b.mp4",
            startUtc: 1000,
            channel: "rear",
            sequence: 1,
            bytes: 700,
            fingerprint: SAME_CAM,
        });
        const trip = groupTrips([f, b])[0]!;
        expect(trip.totalBytes).toBe(1200);
    });

    it("micro-second drift between F and B startUtc (same camera) → still one frame", () => {
        // F derives startUtc from the first GPS record; B from mvhd+vendor-tz -
        // they can differ by 1-2 s. Snap to the 30s grid + shared fingerprint
        // → merged into one frame.
        const f = makeCandidate({
            name: "f.mp4",
            startUtc: 1000,
            channel: "front",
            sequence: 1,
            fingerprint: SAME_CAM,
        });
        const b = makeCandidate({
            name: "b.mp4",
            startUtc: 1000.4,
            channel: "rear",
            sequence: 1,
            fingerprint: SAME_CAM,
        });
        const trip = groupTrips([f, b])[0]!;
        expect(trip.frames).toHaveLength(1);
        expect(Object.keys(trip.frames[0]!.channels).sort()).toEqual(["front", "rear"]);
    });

    it("F/B startUtc straddling a 30s snap boundary → still one frame", () => {
        // Regression: round-snapping alone puts 1004.8 into bucket 990 and
        // 1005.2 into bucket 1020 - a 0.4 s inter-channel delta split into two
        // single-channel frames whenever it crossed a bucket midpoint
        // (~delta/30 of all multichannel clips). The neighbour-bucket rescue
        // in groupTrips must merge them.
        const f = makeCandidate({
            name: "f.mp4",
            startUtc: 1004.8,
            channel: "front",
            sequence: 1,
            fingerprint: SAME_CAM,
        });
        const b = makeCandidate({
            name: "b.mp4",
            startUtc: 1005.2,
            channel: "rear",
            sequence: 1,
            fingerprint: SAME_CAM,
        });
        const trip = groupTrips([f, b])[0]!;
        expect(trip.frames).toHaveLength(1);
        expect(Object.keys(trip.frames[0]!.channels).sort()).toEqual(["front", "rear"]);
    });

    it("same-channel clips 30s apart across a snap boundary stay separate frames", () => {
        // The rescue must NOT merge consecutive single-channel clips: the
        // channel slot is already taken AND the anchor distance exceeds SNAP/2.
        // Short (20s) clips so the 30s spacing leaves a real gap - sequential
        // clips of one camera do not overlap, so the overlap-split keeps them in
        // one trip (we are asserting frame separation here, not trip splitting).
        const a = makeCandidate({
            name: "a.mp4",
            startUtc: 1004,
            durationSec: 20,
            channel: "front",
            sequence: 1,
            fingerprint: SAME_CAM,
        });
        const b = makeCandidate({
            name: "b.mp4",
            startUtc: 1034,
            durationSec: 20,
            channel: "front",
            sequence: 2,
            fingerprint: SAME_CAM,
        });
        const trip = groupTrips([a, b])[0]!;
        expect(trip.frames).toHaveLength(2);
    });

    it("two distinct cameras with overlapping timestamps → separate trips", () => {
        // The bug: a big folder mixing dumps of two recorders.
        // cam1 and cam2 record the same moment; they must NOT collapse into one
        // frame (different fingerprints) NOR into one trip (groupTrips partitions
        // trips by fingerprint - the old global gap-walk glued them by time).
        const cam1Front = makeCandidate({
            name: "f.mp4",
            startUtc: 1000,
            channel: "front",
            sequence: 1,
            fingerprint: "cam-1",
        });
        const cam2Rear = makeCandidate({
            name: "b.mp4",
            startUtc: 1000,
            channel: "rear",
            sequence: 1,
            fingerprint: "cam-2",
        });
        const trips = groupTrips([cam1Front, cam2Rear]);
        // Two trips, one per camera, each a single single-channel frame.
        expect(trips).toHaveLength(2);
        expect(trips[0]!.frames).toHaveLength(1);
        expect(trips[1]!.frames).toHaveLength(1);
    });
});

describe("groupTrips: fingerprint partition + overlap-split", () => {
    it("two recorders interleaved in time → one trip per camera", () => {
        // The same bug at full scale: a big folder mixes two dumps. Each
        // camera's clips are back-to-back; the two cameras run concurrently so
        // their clips interleave in the global time order. Partitioning by
        // fingerprint keeps each camera's run whole instead of gluing them.
        const a1 = makeCandidate({ name: "a1.mp4", startUtc: 1000, channel: null, fingerprint: "camA" });
        const a2 = makeCandidate({ name: "a2.mp4", startUtc: 1060, channel: null, fingerprint: "camA" });
        const b1 = makeCandidate({ name: "b1.mp4", startUtc: 1010, channel: null, fingerprint: "camB" });
        const b2 = makeCandidate({ name: "b2.mp4", startUtc: 1070, channel: null, fingerprint: "camB" });
        const trips = groupTrips([a1, b1, a2, b2]);
        expect(trips).toHaveLength(2);
        // Sorted by startUtc: camA (1000) before camB (1010).
        const names = (t: (typeof trips)[number]) =>
            tripCandidatesByChannel(t, "front")
                .map((c) => c.file.name)
                .sort();
        expect(names(trips[0]!)).toEqual(["a1.mp4", "a2.mp4"]);
        expect(names(trips[1]!)).toEqual(["b1.mp4", "b2.mp4"]);
    });

    it("same fingerprint, two normal clips that overlap in time → separate trips", () => {
        // Clock reset (or two identical cameras hashing to one fingerprint):
        // wall-clock ranges collide, which one camera cannot produce - split.
        const a = makeCandidate({ name: "a.mp4", startUtc: 1000, durationSec: 60, recordingMode: "normal" });
        // Starts 5s after a starts → 55s overlap, well over the 15s tolerance.
        const b = makeCandidate({ name: "b.mp4", startUtc: 1005, durationSec: 60, recordingMode: "normal" });
        const trips = groupTrips([a, b]);
        expect(trips).toHaveLength(2);
    });

    it("an event clip overlapping the normal loop stays in the trip", () => {
        // event/parking clips are protected copies of a moment also in the normal
        // loop, so they overlap by design. The overlap-split is gated to
        // normal↔normal, so the event clip does NOT spawn its own trip.
        const normal = makeCandidate({ name: "n.mp4", startUtc: 1000, durationSec: 60, recordingMode: "normal" });
        const event = makeCandidate({ name: "e.mp4", startUtc: 1010, durationSec: 30, recordingMode: "event" });
        const trips = groupTrips([normal, event]);
        expect(trips).toHaveLength(1);
        expect(trips[0]!.frames).toHaveLength(2);
    });

    it("interleaved NO/EV/NO back-to-back (one fingerprint) → one trip, three frames in order", () => {
        // A810 lite interleave: when an event fires the camera writes the EV clip
        // INSTEAD of the normal segment, so clips chain back-to-back (zero gap,
        // zero overlap) with alternating modes. Fingerprints here come from the
        // REAL cameraFingerprint over the real card layout, so this test breaks
        // if camera-key stops folding EV/Event onto the normal identity - not
        // only if groupTrips regresses. Nothing overlaps, so the overlap-split
        // never fires; the copy-style overlapping-event guard is the test above.
        const t0 = 1000;
        const cardFile = (relativePath: string): { name: string; fingerprint: string; relativePath: string } => {
            const name = relativePath.split("/").pop()!;
            const fingerprint = cameraFingerprint({ file: new File([], name), relativePath });
            return { name, fingerprint, relativePath };
        };
        const n1 = makeCandidate({
            ...cardFile("Normal/Front/NO20260101-120000F.MP4"),
            startUtc: t0,
            durationSec: 60,
            recordingMode: "normal",
        });
        const ev = makeCandidate({
            ...cardFile("Event/Front/EV20260101-120100F.MP4"),
            startUtc: t0 + 60,
            durationSec: 72,
            recordingMode: "event",
        });
        const n2 = makeCandidate({
            ...cardFile("Normal/Front/NO20260101-120212F.MP4"),
            startUtc: t0 + 132,
            durationSec: 60,
            recordingMode: "normal",
        });
        // The premise everything below rides on: one camera identity across modes.
        expect(ev.fingerprint).toBe(n1.fingerprint);
        expect(n2.fingerprint).toBe(n1.fingerprint);
        const trips = groupTrips([n1, ev, n2]);
        expect(trips).toHaveLength(1);
        const trip = trips[0]!;
        expect(trip.frames).toHaveLength(3);
        // Frames ordered by startUtc: NO, EV, NO.
        const names = trip.frames.map((f) => f.channels.front?.file.name);
        expect(names).toEqual(["NO20260101-120000F.MP4", "EV20260101-120100F.MP4", "NO20260101-120212F.MP4"]);
    });

    it("small sub-tolerance overlap from startUtc jitter → still one trip", () => {
        // Adjacent same-camera clips can overlap by a few seconds when their
        // startUtc comes from different sources (mvhd vs GPS-first). Below the
        // tolerance this must NOT split - it is the same continuous run.
        const a = makeCandidate({ name: "a.mp4", startUtc: 1000, durationSec: 60, recordingMode: "normal" });
        // Ends at 1060; b starts at 1055 → 5s overlap, under the 15s tolerance.
        const b = makeCandidate({ name: "b.mp4", startUtc: 1055, durationSec: 60, recordingMode: "normal" });
        const trips = groupTrips([a, b]);
        expect(trips).toHaveLength(1);
        expect(trips[0]!.frames).toHaveLength(2);
    });
});

describe("groupTrips: gap measured from the trip's max end (A5 sibling, trips.ts:697)", () => {
    it("a short event clip mid-loop does not fake a pause and split the trip", () => {
        // normal n1 [1000,1060); event e [1005,1035] kept in-trip by the mode gate;
        // next normal n2 at 1085 after a genuine 25s sub-threshold pause. The gap
        // walk must measure from the furthest end (n1's 1060), not the last-sorted
        // frame e's 1035: e->n2 measured from 1035 is 50s > 30 and wrongly splits.
        const n1 = makeCandidate({ name: "n1.mp4", startUtc: 1000, durationSec: 60, recordingMode: "normal" });
        const e = makeCandidate({ name: "e.mp4", startUtc: 1005, durationSec: 30, recordingMode: "event" });
        const n2 = makeCandidate({ name: "n2.mp4", startUtc: 1085, durationSec: 60, recordingMode: "normal" });
        const trips = groupTrips([n1, e, n2]);
        expect(trips).toHaveLength(1);
        expect(trips[0]!.frames).toHaveLength(3);
    });

    it("verifier's stronger case: event copy ending >gap before its parent's end, ZERO real pause", () => {
        // 20s event copy [1002,1022] inside a 60s loop clip [1000,1060); n2 is
        // back-to-back at 1060 (real pause 0). Measured from the event's end 1022,
        // 1060-1022 = 38s > 30 splits at zero pause; from the max end 1060 the gap
        // is 0 and the trip stays whole.
        const n1 = makeCandidate({ name: "n1.mp4", startUtc: 1000, durationSec: 60, recordingMode: "normal" });
        const e = makeCandidate({ name: "e.mp4", startUtc: 1002, durationSec: 20, recordingMode: "event" });
        const n2 = makeCandidate({ name: "n2.mp4", startUtc: 1060, durationSec: 60, recordingMode: "normal" });
        const trips = groupTrips([n1, e, n2]);
        expect(trips).toHaveLength(1);
        expect(trips[0]!.frames).toHaveLength(3);
    });

    it("control: a genuine pause over the threshold still splits", () => {
        // Same shape, but n2 starts 100s after n1's end - a real engine-off pause.
        const n1 = makeCandidate({ name: "n1.mp4", startUtc: 1000, durationSec: 60, recordingMode: "normal" });
        const e = makeCandidate({ name: "e.mp4", startUtc: 1005, durationSec: 30, recordingMode: "event" });
        const n2 = makeCandidate({ name: "n2.mp4", startUtc: 1160, durationSec: 60, recordingMode: "normal" });
        const trips = groupTrips([n1, e, n2]);
        expect(trips).toHaveLength(2);
    });
});

describe("groupTrips: driving<->parking mode-class split (70mai A810 field case)", () => {
    it("a parking time-lapse walling the engine-off pause splits drives and parking apart", () => {
        // The wallDurationSec fix made the parking time-lapse cover the whole
        // engine-off pause, so the gap test alone sees zero gap across the day:
        // drive -> parking -> drive glued into one endless trip. The class
        // split must cut at both transitions even with zero gap.
        const drive1 = makeCandidate({ name: "n1.mp4", startUtc: 1000, durationSec: 60, recordingMode: "normal" });
        const lapse = makeCandidate({
            name: "la.mp4",
            startUtc: 1060,
            durationSec: 60,
            wallDurationSec: 900,
            recordingMode: "parking",
            isTimelapse: true,
        });
        const drive2 = makeCandidate({ name: "n2.mp4", startUtc: 1960, durationSec: 60, recordingMode: "normal" });
        const trips = groupTrips([drive1, lapse, drive2]);
        expect(trips).toHaveLength(3);
        expect(trips.map((t) => t.isParking)).toEqual([false, true, false]);
        expect(trips[1]!.frames[0]!.channels.front?.file.name).toBe("la.mp4");
    });

    it("a parked g-sensor capture (event mode) stays inside the parking session", () => {
        // 70mai PA maps to "event" (an incident, not the parked loop). It fires
        // MID-parking, so the class split must not tear the session around it:
        // event/manual frames define no class and stick to the surrounding trip.
        const la1 = makeCandidate({
            name: "la1.mp4",
            startUtc: 1000,
            durationSec: 20,
            wallDurationSec: 300,
            recordingMode: "parking",
            isTimelapse: true,
        });
        const pa = makeCandidate({ name: "pa.mp4", startUtc: 1100, durationSec: 30, recordingMode: "event" });
        const la2 = makeCandidate({
            name: "la2.mp4",
            startUtc: 1300,
            durationSec: 20,
            wallDurationSec: 300,
            recordingMode: "parking",
            isTimelapse: true,
        });
        const trips = groupTrips([la1, pa, la2]);
        expect(trips).toHaveLength(1);
        expect(trips[0]!.frames).toHaveLength(3);
        expect(trips[0]!.isParking).toBe(true);
    });

    it("a sticky frame ahead of the first class-defining one joins its trip", () => {
        // Trip opens with an event (class null) and the parking clip arrives
        // second: the trip's class is backfilled, not lost - a following drive
        // still splits off.
        const pa = makeCandidate({ name: "pa.mp4", startUtc: 1000, durationSec: 30, recordingMode: "event" });
        const la = makeCandidate({
            name: "la.mp4",
            startUtc: 1030,
            durationSec: 20,
            wallDurationSec: 600,
            recordingMode: "parking",
            isTimelapse: true,
        });
        const drive = makeCandidate({ name: "n.mp4", startUtc: 1630, durationSec: 60, recordingMode: "normal" });
        const trips = groupTrips([pa, la, drive]);
        expect(trips).toHaveLength(2);
        expect(trips[0]!.frames).toHaveLength(2);
        expect(trips[0]!.isParking).toBe(true);
        expect(trips[1]!.isParking).toBe(false);
    });

    it("time-lapse without a reported mode still counts as parking-class", () => {
        // DDPai-style: isTimelapse from the filename, recordingMode null. The
        // class rule treats any time-lapse as the parked loop (today every
        // isTimelapse format is a parking feature).
        const drive = makeCandidate({ name: "n.mp4", startUtc: 1000, durationSec: 60, recordingMode: "normal" });
        const lapse = makeCandidate({
            name: "s.mp4",
            startUtc: 1060,
            durationSec: 20,
            wallDurationSec: 600,
            isTimelapse: true,
        });
        const trips = groupTrips([drive, lapse]);
        expect(trips).toHaveLength(2);
        expect(trips.map((t) => t.isParking)).toEqual([false, true]);
    });
});

describe("groupTrips: orphan channels", () => {
    it("rear-only file (front lost) → frame with only rear", () => {
        const b = makeCandidate({ name: "b.mp4", startUtc: 1000, channel: "rear", sequence: 1 });
        const trip = groupTrips([b])[0]!;
        expect(trip.frames).toHaveLength(1);
        expect(Object.keys(trip.frames[0]!.channels)).toEqual(["rear"]);
        expect(trip.frames[0]!.channels.front).toBeUndefined();
    });

    it("pickFrameChannel falls back to rear when front absent", () => {
        const b = makeCandidate({ name: "b.mp4", startUtc: 1000, channel: "rear", sequence: 1 });
        const trip = groupTrips([b])[0]!;
        const picked = pickFrameChannel(trip.frames[0]!, "front");
        expect(picked?.channel).toBe("rear");
        expect(picked?.candidate.file.name).toBe("b.mp4");
    });
});

describe("groupTrips: anomalies", () => {
    it("two F-files with same (startUtc, sequence) → separate trips, no data lost", () => {
        // Anomaly (should not occur in practice): two front files of one camera
        // claiming the same moment. They fully overlap in wall-clock time, which
        // one camera cannot produce on a channel, so the overlap-split puts them
        // in separate trips. groupTrips must not lose data - both survive.
        const f1 = makeCandidate({ name: "f1.mp4", startUtc: 1000, channel: "front", sequence: 1 });
        const f2 = makeCandidate({ name: "f2.mp4", startUtc: 1000, channel: "front", sequence: 1 });
        const trips = groupTrips([f1, f2]);
        expect(trips).toHaveLength(2);
        const names = trips.flatMap((t) => t.frames.map((f) => f.channels.front?.file.name)).sort();
        expect(names).toEqual(["f1.mp4", "f2.mp4"]);
    });

    it("mixed bag: 1ch trip + 2ch trip, separated by gap → two trips, ingest does not crash", () => {
        // Trip 1: single-channel x800 file.
        const x = makeCandidate({ name: "x.mp4", startUtc: 1000, channel: null });
        // Trip 2: 70mai-mc F/B pair after a large gap. Same camera = same fingerprint.
        const f = makeCandidate({
            name: "f.mp4",
            startUtc: 5000,
            channel: "front",
            sequence: 1,
            fingerprint: "cam-mc",
        });
        const b = makeCandidate({ name: "b.mp4", startUtc: 5000, channel: "rear", sequence: 1, fingerprint: "cam-mc" });
        const trips = groupTrips([x, f, b]);
        expect(trips).toHaveLength(2);
        // First trip - single-channel, one frame.
        expect(trips[0]!.frames).toHaveLength(1);
        expect(Object.keys(trips[0]!.frames[0]!.channels)).toEqual(["front"]);
        // Second - multi-channel, one frame with two channels.
        expect(trips[1]!.frames).toHaveLength(1);
        expect(Object.keys(trips[1]!.frames[0]!.channels).sort()).toEqual(["front", "rear"]);
    });

    it("empty input → empty trips array", () => {
        expect(groupTrips([])).toEqual([]);
    });
});

describe("groupTrips: confidentChannels aggregation", () => {
    it("collects channels whose every file was confidently classified", () => {
        const f = makeCandidate({
            name: "f.mp4",
            startUtc: 1000,
            channel: "front",
            channelConfident: true,
            sequence: 1,
        });
        const r = makeCandidate({
            name: "r.mp4",
            startUtc: 1000,
            channel: "rear",
            channelConfident: true,
            sequence: 1,
        });
        const trip = groupTrips([f, r])[0]!;
        expect([...trip.confidentChannels].sort()).toEqual(["front", "rear"]);
    });

    it("a guessed channel (CarCam A/B/C/D) is omitted - shown as 'Channel N'", () => {
        // front confident, rear guessed: only front is trusted.
        const f = makeCandidate({
            name: "f.mp4",
            startUtc: 1000,
            channel: "front",
            channelConfident: true,
            sequence: 1,
        });
        const r = makeCandidate({
            name: "r.mp4",
            startUtc: 1000,
            channel: "rear",
            channelConfident: false,
            sequence: 1,
        });
        const trip = groupTrips([f, r])[0]!;
        expect([...trip.confidentChannels]).toEqual(["front"]);
    });

    it("one guessed file demotes the whole channel across frames", () => {
        // Same channel across two frames; one file is a guess -> channel not trusted.
        const cam = "cam-mc";
        const f1 = makeCandidate({
            name: "f1.mp4",
            startUtc: 1000,
            channel: "front",
            channelConfident: true,
            sequence: 1,
            fingerprint: cam,
        });
        const f2 = makeCandidate({
            name: "f2.mp4",
            startUtc: 1060,
            channel: "front",
            channelConfident: false,
            sequence: 2,
            fingerprint: cam,
        });
        const trip = groupTrips([f1, f2])[0]!;
        expect(trip.confidentChannels.has("front")).toBe(false);
    });
});

describe("trip helpers", () => {
    it("tripChannels returns all distinct channels across frames in priority order", () => {
        const f1 = makeCandidate({ name: "f1.mp4", startUtc: 1000, channel: "front", sequence: 1 });
        const b1 = makeCandidate({ name: "b1.mp4", startUtc: 1000, channel: "rear", sequence: 1 });
        const f2 = makeCandidate({ name: "f2.mp4", startUtc: 1060, channel: "front", sequence: 2 });
        const trip = groupTrips([f1, b1, f2])[0]!;
        // Second frame has only front; first has front+rear. Union = [front, rear]
        // in priority order.
        expect(tripChannels(trip)).toEqual(["front", "rear"]);
    });

    it("tripCandidatesByChannel returns only files of that channel in frame order", () => {
        const f1 = makeCandidate({ name: "f1.mp4", startUtc: 1000, channel: "front", sequence: 1 });
        const b1 = makeCandidate({ name: "b1.mp4", startUtc: 1000, channel: "rear", sequence: 1 });
        const f2 = makeCandidate({ name: "f2.mp4", startUtc: 1060, channel: "front", sequence: 2 });
        const trip = groupTrips([f1, b1, f2])[0]!;
        const fronts = tripCandidatesByChannel(trip, "front").map((c) => c.file.name);
        expect(fronts).toEqual(["f1.mp4", "f2.mp4"]);
        const rears = tripCandidatesByChannel(trip, "rear").map((c) => c.file.name);
        expect(rears).toEqual(["b1.mp4"]);
    });

    it("tripAllCandidates returns every file across all channels", () => {
        const f1 = makeCandidate({ name: "f1.mp4", startUtc: 1000, channel: "front", sequence: 1 });
        const b1 = makeCandidate({ name: "b1.mp4", startUtc: 1000, channel: "rear", sequence: 1 });
        const trip = groupTrips([f1, b1])[0]!;
        const names = tripAllCandidates(trip)
            .map((c) => c.file.name)
            .sort();
        expect(names).toEqual(["b1.mp4", "f1.mp4"]);
    });
});

describe("TripTimeline (footage-time projection)", () => {
    // Force everything into one trip regardless of gaps - the timeline math is
    // what we test, not the trip-splitting threshold.
    const ONE_TRIP = Number.POSITIVE_INFINITY;

    it("contiguous files: content axis equals wall-clock relative time, no gaps", () => {
        const a = makeCandidate({ name: "a.mp4", startUtc: 1000, durationSec: 60 });
        const b = makeCandidate({ name: "b.mp4", startUtc: 1060, durationSec: 60 }); // back-to-back
        const trip = groupTrips([a, b], ONE_TRIP)[0]!;
        const tl = trip.timeline;
        expect(tl.contentDurationSec).toBe(120);
        expect(tl.gaps).toHaveLength(0);
        // identity: for a gapless trip wallToContentSec(u) === u - trip.startUtc
        for (const u of [1000, 1030, 1090, 1119]) {
            expect(wallToContentSec(tl, u)).toBeCloseTo(u - trip.startUtc, 6);
        }
        expect(contentToWallUtc(tl, 70)).toBe(1070);
        expect(contentToFrame(tl, 70).index).toBe(1);
        expect(contentToFrame(tl, 70).offsetInFrame).toBe(10);
    });

    it("trip with a 5-minute pause: gap removed from axis, surfaced as a divider", () => {
        const a = makeCandidate({ name: "a.mp4", startUtc: 1000, durationSec: 60 });
        // a ends at 1060; b starts 300s later -> a 5-min pause inside one trip.
        const b = makeCandidate({ name: "b.mp4", startUtc: 1360, durationSec: 60 });
        const trip = groupTrips([a, b], ONE_TRIP)[0]!;
        const tl = trip.timeline;

        // Footage axis is 120s (gap NOT counted), but the wall-clock span is 420s.
        expect(tl.contentDurationSec).toBe(120);
        expect(trip.durationSec).toBe(420);

        expect(tl.gaps).toHaveLength(1);
        const gap = tl.gaps[0]!;
        expect(gap.durationSec).toBe(300);
        expect(gap.contentPos).toBe(60); // sits at the end of the first segment
        expect(gap.wallStart).toBe(1060);

        // A record inside the second file projects onto the second segment.
        expect(wallToContentSec(tl, 1370)).toBe(70);
        // contentToWallUtc skips the pause: footage-second 70 is real UTC 1370.
        expect(contentToWallUtc(tl, 70)).toBe(1370);
        expect(contentToFrame(tl, 70).index).toBe(1);
        expect(contentToFrame(tl, 70).offsetInFrame).toBe(10);
    });

    it("record inside a pause clamps to the divider, not dropped", () => {
        const a = makeCandidate({ name: "a.mp4", startUtc: 1000, durationSec: 60 });
        const b = makeCandidate({ name: "b.mp4", startUtc: 1360, durationSec: 60 });
        const tl = groupTrips([a, b], ONE_TRIP)[0]!.timeline;
        // 1200 is inside the [1060, 1360) pause - clamp to the divider at 60.
        expect(wallToContentSec(tl, 1200)).toBe(60);
        // boundary: exactly at the pause end maps to the start of the 2nd segment.
        expect(wallToContentSec(tl, 1360)).toBe(60);
    });

    it("records before the first frame / after the last clamp to [0, contentDuration]", () => {
        const a = makeCandidate({ name: "a.mp4", startUtc: 1000, durationSec: 60 });
        const b = makeCandidate({ name: "b.mp4", startUtc: 1360, durationSec: 60 });
        const tl = groupTrips([a, b], ONE_TRIP)[0]!.timeline;
        expect(wallToContentSec(tl, 500)).toBe(0);
        expect(wallToContentSec(tl, 1000)).toBe(0);
        expect(wallToContentSec(tl, 99999)).toBe(120);
        // contentToFrame clamps a past-end value to the last frame's end.
        expect(contentToFrame(tl, 99999).index).toBe(1);
        expect(contentToFrame(tl, 99999).offsetInFrame).toBe(60);
    });

    it("single-frame trip: content axis is the file duration, no gaps", () => {
        const a = makeCandidate({ name: "a.mp4", startUtc: 1000, durationSec: 90 });
        const tl = groupTrips([a], ONE_TRIP)[0]!.timeline;
        expect(tl.contentDurationSec).toBe(90);
        expect(tl.gaps).toHaveLength(0);
        expect(wallToContentSec(tl, 1045)).toBe(45);
        expect(contentToWallUtc(tl, 45)).toBe(1045);
    });

    it("sub-second inter-file overhead is coalesced - no spurious divider", () => {
        const a = makeCandidate({ name: "a.mp4", startUtc: 1000, durationSec: 60 });
        // 0.5s gap - file close/open overhead, below GAP_DIVIDER_MIN_SEC.
        const b = makeCandidate({ name: "b.mp4", startUtc: 1060.5, durationSec: 60 });
        const tl = groupTrips([a, b], ONE_TRIP)[0]!.timeline;
        expect(tl.gaps).toHaveLength(0);
        expect(tl.contentDurationSec).toBe(120);
    });
});

// ===== deriveStartUtc =====
//
// Regressions on mvhd semantics. Cameras write creation_time in two ways:
// at RECORDING START (70mai family) or at FILE FINALIZATION (Vantrue, GoPro).
// Without knowing the vendor, the correct startUtc is selected by the test
// "GPS window fits inside the video window". Covers both variants plus the
// edge case "mvhd is off by more than duration" → fallback to firstGps.

function makeRecord(unixSeconds: number, lat = 0, lon = 0): GpsRecord {
    return {
        unixSeconds,
        active: true,
        lat,
        lon,
        bearingDeg: 0,
        speedMs: 0,
        accelXg: 0,
        accelYg: 0,
        accelZg: 0,
        mp4Filename: "x.mp4",
    };
}

function makeVendorFile(name: string): VendorFile {
    return { file: new File([new Uint8Array(8)], name), relativePath: name };
}

const noFilenameTime = (): Date | null => null;

describe("deriveStartUtc: mvhd start vs finalize semantics", () => {
    // Base case: 70mai-style, mvhd = local-as-UTC recording start,
    // GPS arrives 5 s after start. TZ=0 (camera in London).
    it("mvhd as recording start (70mai semantics) → startUtc = mvhd - tz", () => {
        const startReal = 1_700_000_000; // actual recording start in UTC
        const tzOffsetSec = 0;
        const durationSec = 60;
        const records = [makeRecord(startReal + 5), makeRecord(startReal + 30), makeRecord(startReal + 55)];
        const result = deriveStartUtc({
            file: makeVendorFile("a.mp4"),
            fingerprint: "fp:70mai",
            createdUtc: new Date((startReal + tzOffsetSec) * 1000),
            durationSec,
            records,
            fingerprintTz: { filenameTzSec: 0, mvhdTzSec: 0 },
            parseFilenameLocalTime: noFilenameTime,
            preciseFilenameOffsetSec: null,
            embeddedStartUtcHint: null,
            isTimelapse: false,
            wallDurationSec: null,
        });
        expect(result.source).toBe("mp4");
        expect(result.startUtc).toBe(startReal);
    });

    // Vantrue-style: TZ=+2h (EET), 180 s clip, mvhd = finalize time.
    // Without the fix, startUtc was 17:54:36 UTC (180 s late), the GPS window
    // [17:51:36..17:54:02] didn't overlap the video window [17:54:36..17:57:36]
    // and the map marker got stuck.
    it("mvhd as finalize time (Vantrue) → startUtc = mvhd - tz - duration", () => {
        const startReal = 1_734_976_296; // 2024-12-23 17:51:36 UTC
        const tzOffsetSec = 7200; // EET, +2h
        const durationSec = 180;
        const finalizeLocal = startReal + durationSec + tzOffsetSec; // mvhd_naive
        const records = [
            makeRecord(startReal),
            makeRecord(startReal + 90),
            makeRecord(startReal + durationSec - 4), // last point just before the end
        ];
        const result = deriveStartUtc({
            file: makeVendorFile("vantrue.mp4"),
            fingerprint: "fp:novatek",
            createdUtc: new Date(finalizeLocal * 1000),
            durationSec,
            records,
            fingerprintTz: { filenameTzSec: tzOffsetSec, mvhdTzSec: tzOffsetSec },
            parseFilenameLocalTime: noFilenameTime,
            preciseFilenameOffsetSec: null,
            embeddedStartUtcHint: null,
            isTimelapse: false,
            wallDurationSec: null,
        });
        expect(result.source).toBe("mp4");
        expect(result.startUtc).toBe(startReal);
    });

    // GoPro HERO5-style: TZ=-7h (PDT), 34.6 s clip, mvhd = finalize.
    // GPS arrives almost immediately (action cameras get a fix faster);
    // startB should place the GPS window exactly inside the video.
    it("mvhd as finalize, negative TZ (GoPro PDT) → startUtc = startB", () => {
        const startReal = 1_492_450_268; // 2017-04-17 17:31:08 UTC
        const tzOffsetSec = -25200; // PDT, -7h
        const durationSec = 34.6;
        const finalizeLocal = startReal + durationSec + tzOffsetSec;
        const records = [
            makeRecord(startReal - 5), // GPS 5 s ahead of start (within tolerance)
            makeRecord(startReal + 15),
            makeRecord(startReal + 28.94),
        ];
        const result = deriveStartUtc({
            file: makeVendorFile("hero5.mp4"),
            fingerprint: "fp:gopro",
            createdUtc: new Date(finalizeLocal * 1000),
            durationSec,
            records,
            fingerprintTz: { filenameTzSec: tzOffsetSec, mvhdTzSec: tzOffsetSec },
            parseFilenameLocalTime: noFilenameTime,
            preciseFilenameOffsetSec: null,
            embeddedStartUtcHint: null,
            isTimelapse: false,
            wallDurationSec: null,
        });
        expect(result.source).toBe("mp4");
        expect(result.startUtc).toBeCloseTo(startReal, 5);
    });

    // mvhd is off by more than duration - neither startA nor startB places
    // the GPS window inside the video window. Fallback: use firstGps as startUtc.
    it("mvhd off by more than duration → fallback to firstGps", () => {
        const startReal = 1_700_000_000;
        const tzOffsetSec = 0;
        const durationSec = 60;
        const firstGps = startReal + 3;
        const records = [makeRecord(firstGps), makeRecord(firstGps + 50)];
        // mvhd is ~5 minutes ahead - after the 15-min TZ snap both startA (+300)
        // and startB (+240) miss the real start.
        const mvhdFakeUtc = startReal + 300 + tzOffsetSec;
        const result = deriveStartUtc({
            file: makeVendorFile("broken.mp4"),
            fingerprint: "fp:unknown",
            createdUtc: new Date(mvhdFakeUtc * 1000),
            durationSec,
            records,
            fingerprintTz: { filenameTzSec: 0, mvhdTzSec: 0 },
            parseFilenameLocalTime: noFilenameTime,
            preciseFilenameOffsetSec: null,
            embeddedStartUtcHint: null,
            isTimelapse: false,
            wallDurationSec: null,
        });
        expect(result.source).toBe("gps");
        expect(result.startUtc).toBe(firstGps);
    });

    // File with no GPS at all: GPS branch is skipped, falls through to mvhd +
    // per-vendor TZ as before.
    it("no GPS - mvhd + per-vendor TZ works as before", () => {
        const startReal = 1_700_000_000;
        const tzOffsetSec = 7200;
        const result = deriveStartUtc({
            file: makeVendorFile("nogps.mp4"),
            fingerprint: "fp:novatek",
            createdUtc: new Date((startReal + tzOffsetSec) * 1000),
            durationSec: 60,
            records: [],
            fingerprintTz: { filenameTzSec: tzOffsetSec, mvhdTzSec: tzOffsetSec },
            parseFilenameLocalTime: noFilenameTime,
            preciseFilenameOffsetSec: null,
            embeddedStartUtcHint: null,
            isTimelapse: false,
            wallDurationSec: null,
        });
        expect(result.source).toBe("mp4");
        expect(result.startUtc).toBe(startReal);
    });

    // No mvhd (creation_time=0, 70mai writes none) + GPS that only fixed deep
    // into the file (cold start). The filename names the true t=0; firstGps lags
    // by ~49 s. Anchoring on firstGps used to (a) shift the whole track 49 s and
    // (b) push the clip past the trip-gap threshold so it failed to glue to the
    // previous file. The filename candidate SELF-CALIBRATES from its own GPS
    // delta - fingerprintTz is null here on purpose to prove a lone clip with no
    // sibling files still resolves. Numbers are from the real private sample
    // (NO...004042F).
    it("no mvhd, cold-start GPS - self-calibrated filename beats firstGps (lone clip)", () => {
        const trueStart = 1_781_633_099; // 2026-06-16 18:04:59 UTC = 23:04:59 +05
        const durationSec = 60.032;
        const firstGps = trueStart + 49; // GPS fixed 49 s into the clip
        const records = [makeRecord(firstGps), makeRecord(firstGps + 14)];
        const result = deriveStartUtc({
            file: makeVendorFile("NO20260616-230459-004042F.mp4"),
            fingerprint: "fp:70mai",
            createdUtc: null,
            durationSec,
            records,
            fingerprintTz: null, // no sibling estimate - candidate self-calibrates
            parseFilenameLocalTime: () => new Date(Date.UTC(2026, 5, 16, 23, 4, 59)),
            preciseFilenameOffsetSec: null,
            embeddedStartUtcHint: null,
            isTimelapse: false,
            wallDurationSec: null,
        });
        expect(result.source).toBe("name");
        expect(result.startUtc).toBe(trueStart); // not firstGps (49 s late)
    });

    // Guard the regression in the other direction: if the filename clock drifted
    // by more than a file length, its self-calibrated window will not contain the
    // GPS, so we must still fall back to firstGps rather than trust a bogus time.
    it("no mvhd, filename clock off by minutes - falls back to firstGps", () => {
        const firstGps = 1_781_633_148;
        const durationSec = 60;
        const records = [makeRecord(firstGps), makeRecord(firstGps + 30)];
        const result = deriveStartUtc({
            file: makeVendorFile("NO20260616-230459-004042F.mp4"),
            fingerprint: "fp:70mai",
            createdUtc: null,
            durationSec,
            records,
            fingerprintTz: null,
            // filename says 23:14:59 but real GPS is ~10 min earlier -> window misses.
            parseFilenameLocalTime: () => new Date(Date.UTC(2026, 5, 16, 23, 14, 59)),
            preciseFilenameOffsetSec: null,
            embeddedStartUtcHint: null,
            isTimelapse: false,
            wallDurationSec: null,
        });
        expect(result.source).toBe("gps");
        expect(result.startUtc).toBe(firstGps);
    });

    // Similar case closed for free: a file that DOES have mvhd, but mvhd is
    // garbage (off by more than the clip length), while the filename is good.
    // The unified validator now tries the filename candidate before giving up to
    // firstGps - so the start is the true t=0, not t=0 + fix delay.
    it("garbage mvhd + good filename + GPS - filename wins over firstGps", () => {
        const trueStart = 1_700_000_000;
        const durationSec = 60;
        const firstGps = trueStart + 8; // 8 s fix delay
        const records = [makeRecord(firstGps), makeRecord(firstGps + 40)];
        const result = deriveStartUtc({
            file: makeVendorFile("a.mp4"),
            fingerprint: "fp:x",
            // mvhd 200 s off - NOT a clean TZ-grid multiple, so self-calibration
            // cannot absorb it and both start/finalize windows miss the GPS.
            createdUtc: new Date((trueStart + 200) * 1000),
            durationSec,
            records,
            fingerprintTz: null,
            parseFilenameLocalTime: () => new Date(trueStart * 1000), // TZ 0, names t=0
            preciseFilenameOffsetSec: null,
            embeddedStartUtcHint: null,
            isTimelapse: false,
            wallDurationSec: null,
        });
        expect(result.source).toBe("name");
        expect(result.startUtc).toBe(trueStart);
    });

    // file1 half of the same real bug: no mvhd, NO GPS of its own (cold start
    // never fixed during this clip), but a sibling supplied a filename TZ. Must
    // anchor on filename + vendor TZ so it glues to the GPS-carrying neighbour.
    it("no mvhd, no GPS, sibling TZ - filename + vendor TZ anchors the clip", () => {
        const result = deriveStartUtc({
            file: makeVendorFile("NO20260616-230359-004041F.mp4"),
            fingerprint: "fp:70mai",
            createdUtc: null,
            durationSec: 60.096,
            records: [],
            fingerprintTz: { filenameTzSec: 18000, mvhdTzSec: null },
            parseFilenameLocalTime: () => new Date(Date.UTC(2026, 5, 16, 23, 3, 59)),
            preciseFilenameOffsetSec: null,
            embeddedStartUtcHint: null,
            isTimelapse: false,
            wallDurationSec: null,
        });
        expect(result.source).toBe("name");
        expect(result.startUtc).toBe(1_781_633_039); // 18:03:59 UTC = 23:03:59 +05
    });
});

describe("deriveStartUtc: mvhd-vs-GPS tripwire", () => {
    const startReal = 1_700_000_000;
    const durationSec = 60;
    const records = [makeRecord(startReal + 5), makeRecord(startReal + 55)];

    it("flags a container stamp no reading can reconcile with the track", () => {
        // mvhd 65 min off the GPS: the 15-min TZ grid cannot absorb the odd 5
        // min, so neither reading (start, finalize, snapped) lands the window -
        // one of the two clocks is stamped in a zone the other does not share.
        // The anchor still comes from elsewhere; the flag only tells the caller.
        const result = deriveStartUtc({
            file: makeVendorFile("skewed.mp4"),
            fingerprint: "fp:skewed",
            createdUtc: new Date((startReal + 3900) * 1000),
            durationSec,
            records,
            fingerprintTz: { filenameTzSec: 0, mvhdTzSec: 0 },
            parseFilenameLocalTime: noFilenameTime,
            preciseFilenameOffsetSec: null,
            embeddedStartUtcHint: null,
            isTimelapse: false,
            wallDurationSec: null,
        });
        expect(result.mvhdRejected).toBe(true);
        expect(result.source).toBe("gps");
    });

    it("stays silent when a reading does fit", () => {
        const result = deriveStartUtc({
            file: makeVendorFile("ok.mp4"),
            fingerprint: "fp:ok",
            createdUtc: new Date(startReal * 1000),
            durationSec,
            records,
            fingerprintTz: { filenameTzSec: 0, mvhdTzSec: 0 },
            parseFilenameLocalTime: noFilenameTime,
            preciseFilenameOffsetSec: null,
            embeddedStartUtcHint: null,
            isTimelapse: false,
            wallDurationSec: null,
        });
        expect(result.mvhdRejected).toBeFalsy();
        expect(result.source).toBe("mp4");
    });
});

// ITEM 1 (audit A5): on a clip longer than half the 15-min TZ grid (>7.5 min:
// 10-min loop options, GoPro chapters) the per-file self-calibration folds THIS
// clip's GPS residual (cold-start fix lag, or a GPS track that ends early) into
// snapTz(mvhd - firstGps). The residual can then cross the 450s snap midpoint and
// mis-round by a full 900s, so the window check accepts the WRONG start/finalize
// candidate and anchors the clip ~5 min off - tearing it out of its trip. The fix
// tries the residual-free fleet mvhd TZ (fingerprintTz.mvhdTzSec) first; the same
// window check still guards a wrong fleet value. Numbers are the exact adversarial
// repro from the audit (T = +5h on the 900 grid, D = 600s).
describe("deriveStartUtc: fleet mvhd TZ disambiguates >7.5min clips (A5)", () => {
    const S = 1_700_000_000; // true recording start (UTC)
    const T = 18_000; // +5h TZ, a 900-grid multiple
    const durationSec = 600; // 10-min loop clip - past the 7.5-min snap midpoint

    // Scenario (1): mvhd stamped at recording START, cold-start GPS fix lag 480s.
    // Self-calibration: candidate1 snapTz(T-480)=T-900 -> S+900 (rejected);
    // candidate2 finalize snapTz(T-1080)=T-900 -> S+300, window passes -> 300s LATE.
    describe("scenario 1: start semantics, cold-start fix lag", () => {
        const firstGps = S + 480; // GPS fixed 480s into the clip
        const lastGps = S + 595;
        const records = [makeRecord(firstGps), makeRecord(lastGps)];

        it("fleet mvhd TZ anchors at the true start, not 300s late", () => {
            const result = deriveStartUtc({
                file: makeVendorFile("start.mp4"),
                fingerprint: "fp:start",
                createdUtc: new Date((S + T) * 1000), // start semantics: mvhd = S + T
                durationSec,
                records,
                fingerprintTz: { filenameTzSec: T, mvhdTzSec: T },
                parseFilenameLocalTime: noFilenameTime,
                preciseFilenameOffsetSec: null,
                embeddedStartUtcHint: null,
                isTimelapse: false,
                wallDurationSec: null,
            });
            expect(result.source).toBe("mp4");
            expect(result.startUtc).toBe(S);
        });

        it("no fleet estimate (lone clip): self-calibration still mis-snaps 300s late", () => {
            // Pins the inherent lone-clip limitation the fleet estimate pre-empts:
            // with no sibling files there is nothing residual-free to fall back on,
            // so the >7.5min self-calibration mis-rounds the finalize TZ. This is
            // also the pre-fix behavior the fleet path fixes when siblings exist.
            const result = deriveStartUtc({
                file: makeVendorFile("start.mp4"),
                fingerprint: "fp:start",
                createdUtc: new Date((S + T) * 1000),
                durationSec,
                records,
                fingerprintTz: null,
                parseFilenameLocalTime: noFilenameTime,
                preciseFilenameOffsetSec: null,
                embeddedStartUtcHint: null,
                isTimelapse: false,
                wallDurationSec: null,
            });
            expect(result.startUtc).toBe(S + 300);
        });
    });

    // Scenario (2): mvhd stamped at FINALIZATION, warm GPS (lag 10s) but the GPS
    // track dies ~5 min in (tunnel/garage at the clip end). Self-calibration:
    // candidate1 start snapTz(T+590)=T+900 -> S-300, window passes (lastGps<=S+305)
    // and the WRONG candidate returns before the correct finalize -> 300s EARLY.
    describe("scenario 2: finalize semantics, GPS ends early", () => {
        const firstGps = S + 10; // warm GPS
        const lastGps = S + 300; // GPS dies ~5 min into the clip
        const records = [makeRecord(firstGps), makeRecord(lastGps)];

        it("fleet mvhd TZ anchors at the true start, not 300s early", () => {
            const result = deriveStartUtc({
                file: makeVendorFile("finalize.mp4"),
                fingerprint: "fp:finalize",
                createdUtc: new Date((S + durationSec + T) * 1000), // finalize: mvhd = S + D + T
                durationSec,
                records,
                fingerprintTz: { filenameTzSec: T, mvhdTzSec: T },
                parseFilenameLocalTime: noFilenameTime,
                preciseFilenameOffsetSec: null,
                embeddedStartUtcHint: null,
                isTimelapse: false,
                wallDurationSec: null,
            });
            expect(result.source).toBe("mp4");
            expect(result.startUtc).toBe(S);
        });

        it("no fleet estimate (lone clip): the wrong start candidate wins, 300s early", () => {
            const result = deriveStartUtc({
                file: makeVendorFile("finalize.mp4"),
                fingerprint: "fp:finalize",
                createdUtc: new Date((S + durationSec + T) * 1000),
                durationSec,
                records,
                fingerprintTz: null,
                parseFilenameLocalTime: noFilenameTime,
                preciseFilenameOffsetSec: null,
                embeddedStartUtcHint: null,
                isTimelapse: false,
                wallDurationSec: null,
            });
            expect(result.startUtc).toBe(S - 300);
        });
    });

    it("a wrong fleet TZ (off by a full grid step) is rejected by the window, falls through", () => {
        // The fleet candidate is 900s off the truth - far past the 5s window
        // tolerance - so it must NOT anchor; the correct self-calibrated candidate
        // still wins. Short clip so self-calibration is unaffected by the residual.
        const shortDur = 60;
        const firstGps = S + 5;
        const result = deriveStartUtc({
            file: makeVendorFile("badfleet.mp4"),
            fingerprint: "fp:badfleet",
            createdUtc: new Date((S + T) * 1000), // start semantics, true TZ = T
            durationSec: shortDur,
            records: [makeRecord(firstGps), makeRecord(S + 55)],
            fingerprintTz: { filenameTzSec: T + 900, mvhdTzSec: T + 900 }, // corrupt: 900s off
            parseFilenameLocalTime: noFilenameTime,
            preciseFilenameOffsetSec: null,
            embeddedStartUtcHint: null,
            isTimelapse: false,
            wallDurationSec: null,
        });
        expect(result.source).toBe("mp4");
        expect(result.startUtc).toBe(S); // self-calibrated recovered the real start
    });
});

// Regression for the real private sample (NO20260611-...-003699F/003700F): two
// back-to-back 70mai clips, no mvhd, GPS from a $V02 sidecar log whose per-file
// tail overshoots the clip end by ~8s (RTC runs ~8s behind GPS). Per-file window
// validation rejected the filename anchor and fell to firstGps; the first clip's
// cold-start lag (~15s) then inflated its window into an artificial 15s overlap
// that the overlap-split tore into TWO trips. The fleet-measured clock offset
// fixes it: the warmer second clip reveals the true offset, anchoring both clips
// on the filename so they glue back into one trip - and onto their true t=0, so
// the marker no longer leads the video by the cold-start lag.
describe("deriveStartUtc: run clock offset anchors back-to-back no-mvhd clips", () => {
    // Real numbers from private/incoming.
    const NAME_699 = "NO20260611-221618-003699F.MP4";
    const NAME_700 = "NO20260611-221718-003700F.MP4";
    const FIRST_GPS_699 = 1_781_169_403;
    const LAST_GPS_699 = 1_781_169_446;
    const FIRST_GPS_700 = 1_781_169_448;
    const LAST_GPS_700 = 1_781_169_506;
    const DUR_699 = 60.032;
    const DUR_700 = 60.096;
    // filename naive UTC (classifyFilenameTime parses NO-prefix via Date.UTC).
    const NAME_NAIVE_699 = Date.UTC(2026, 5, 11, 22, 16, 18) / 1000;
    const NAME_NAIVE_700 = Date.UTC(2026, 5, 11, 22, 17, 18) / 1000;

    const samples: TzSample[] = [
        {
            file: makeVendorFile(NAME_699),
            fingerprint: "fp:70mai",
            firstGpsUnix: FIRST_GPS_699,
            mvhdNaiveUnix: null,
            durationSec: DUR_699,
        },
        {
            file: makeVendorFile(NAME_700),
            fingerprint: "fp:70mai",
            firstGpsUnix: FIRST_GPS_700,
            mvhdNaiveUnix: null,
            durationSec: DUR_700,
        },
    ];

    /** Runs estimator + resolver the way production call sites do. */
    function estimateAndResolve(tzSamples: TzSample[], fingerprint: string, name: string): number | null {
        const runs = estimatePreciseClockOffsetByFingerprint(tzSamples, classifyFilenameTime);
        return resolvePreciseClockOffsetForFile(runs, fingerprint, makeVendorFile(name), classifyFilenameTime);
    }

    it("max-based offset is pinned by the warmer (smaller-lag) second clip", () => {
        const offset = estimateAndResolve(samples, "fp:70mai", NAME_699);
        // delta_699 = 46775, delta_700 = 46790; max picks 700 (GPS already warm).
        expect(offset).toBe(NAME_NAIVE_700 - FIRST_GPS_700);
        expect(offset).toBe(46_790);
    });

    it("lone clip gets NO precise offset (cannot separate offset from cold-start lag)", () => {
        expect(estimateAndResolve([samples[0]!], "fp:70mai", NAME_699)).toBeNull();
    });

    function derive(name: string, firstGps: number, lastGps: number, dur: number, offset: number) {
        return deriveStartUtc({
            file: makeVendorFile(name),
            fingerprint: "fp:70mai",
            createdUtc: null,
            durationSec: dur,
            records: [makeRecord(firstGps), makeRecord(lastGps)],
            fingerprintTz: null,
            parseFilenameLocalTime: classifyFilenameTime,
            preciseFilenameOffsetSec: offset,
            embeddedStartUtcHint: null,
            isTimelapse: false,
            wallDurationSec: null,
        });
    }

    it("both clips anchor on the filename (not firstGps) and glue into ONE trip", () => {
        const offset = estimateAndResolve(samples, "fp:70mai", NAME_699)!;
        const r699 = derive(NAME_699, FIRST_GPS_699, LAST_GPS_699, DUR_699, offset);
        const r700 = derive(NAME_700, FIRST_GPS_700, LAST_GPS_700, DUR_700, offset);

        // Anchored on the filename, NOT on the cold-start-late firstGps.
        expect(r699.source).toBe("name");
        expect(r700.source).toBe("name");
        expect(r699.startUtc).toBe(NAME_NAIVE_699 - offset); // 1781169388
        expect(r700.startUtc).toBe(NAME_NAIVE_700 - offset); // 1781169448
        // Clip 699's true start is ~15s before its first GPS fix (the cold-start
        // lag we removed); had we fallen to firstGps it would have been 1781169403.
        expect(r699.startUtc).toBeLessThan(FIRST_GPS_699);

        const c699 = makeCandidate({
            name: NAME_699,
            startUtc: r699.startUtc,
            durationSec: DUR_699,
            sequence: 3699,
            fingerprint: "fp:70mai",
        });
        const c700 = makeCandidate({
            name: NAME_700,
            startUtc: r700.startUtc,
            durationSec: DUR_700,
            sequence: 3700,
            fingerprint: "fp:70mai",
        });
        const trips = groupTrips([c699, c700]);
        expect(trips).toHaveLength(1);
        expect(trips[0]!.frames).toHaveLength(2);
    });
});

// Guards for the review findings on the fleet-offset change: multichannel
// no-GPS siblings must share the GPS sibling's exact anchor; a corrupt/pooled
// offset must not anchor blindly; the estimator must shrug off a gross outlier.
describe("deriveStartUtc: run offset robustness", () => {
    // 70mai-mc: GPS only on the front. Clock offset = 5h TZ + 40s RTC drift; the
    // 40s is NOT a 900-multiple and exceeds the 15s frame-snap radius, so before
    // the fix the precise (unsnapped) front and the 15-min-snapped rear diverged
    // by 40s and tore F/B into separate frames. The fix routes the no-GPS rear
    // through the SAME precise offset.
    const CLOCK_OFFSET = 18_040;
    const trueF1 = 1_700_000_000;
    const trueF2 = 1_700_000_060;
    const nameOf = (vf: VendorFile): Date =>
        new Date(((vf.file.name.includes("002") ? trueF2 : trueF1) + CLOCK_OFFSET) * 1000);

    const samples: TzSample[] = [
        {
            file: makeVendorFile("NO-001F.MP4"),
            fingerprint: "fp:mc",
            firstGpsUnix: trueF1,
            mvhdNaiveUnix: null,
            durationSec: 60,
        },
        {
            file: makeVendorFile("NO-002F.MP4"),
            fingerprint: "fp:mc",
            firstGpsUnix: trueF2,
            mvhdNaiveUnix: null,
            durationSec: 60,
        },
    ];

    function deriveChannel(name: string, records: GpsRecord[], offset: number | null) {
        return deriveStartUtc({
            file: makeVendorFile(name),
            fingerprint: "fp:mc",
            createdUtc: null,
            durationSec: 60,
            records,
            // snapped median = 18000 (drift rounded away) - the OLD rear path.
            fingerprintTz: { filenameTzSec: 18_000, mvhdTzSec: null },
            parseFilenameLocalTime: nameOf,
            preciseFilenameOffsetSec: offset,
            embeddedStartUtcHint: null,
            isTimelapse: false,
            wallDurationSec: null,
        });
    }

    it("no-GPS rear lands on the SAME t=0 as the GPS front, so F/B stay one frame", () => {
        const runs = estimatePreciseClockOffsetByFingerprint(samples, nameOf);
        // Rear carries no GPS, so it is absent from the samples - it must still
        // resolve to the same run (and offset) as its front twin via name time.
        const offset = resolvePreciseClockOffsetForFile(runs, "fp:mc", makeVendorFile("NO-001F.MP4"), nameOf)!;
        expect(offset).toBe(CLOCK_OFFSET); // unsnapped, keeps the 40s drift
        expect(resolvePreciseClockOffsetForFile(runs, "fp:mc", makeVendorFile("NO-001B.MP4"), nameOf)).toBe(offset);

        const front = deriveChannel("NO-001F.MP4", [makeRecord(trueF1), makeRecord(trueF1 + 58)], offset);
        const rear = deriveChannel("NO-001B.MP4", [], offset); // rear carries no GPS
        expect(front.source).toBe("name");
        expect(rear.source).toBe("name");
        expect(rear.startUtc).toBe(front.startUtc); // the fix: identical anchor

        const trips = groupTrips([
            makeCandidate({ name: "NO-001F.MP4", startUtc: front.startUtc, channel: "front", fingerprint: "fp:mc" }),
            makeCandidate({ name: "NO-001B.MP4", startUtc: rear.startUtc, channel: "rear", fingerprint: "fp:mc" }),
        ]);
        expect(trips).toHaveLength(1);
        expect(trips[0]!.frames).toHaveLength(1);
        expect(Object.keys(trips[0]!.frames[0]!.channels).sort()).toEqual(["front", "rear"]);
    });

    it("regression direction: a 15-min-snapped rear (no precise offset) diverges by the drift and tears the frame", () => {
        const front = deriveChannel("NO-001F.MP4", [makeRecord(trueF1), makeRecord(trueF1 + 58)], CLOCK_OFFSET);
        const rear = deriveChannel("NO-001B.MP4", [], null); // OLD behavior: falls to snapped filenameTzSec
        expect(rear.startUtc - front.startUtc).toBe(40); // 18040 - 18000
        const trips = groupTrips([
            makeCandidate({ name: "NO-001F.MP4", startUtc: front.startUtc, channel: "front", fingerprint: "fp:mc" }),
            makeCandidate({ name: "NO-001B.MP4", startUtc: rear.startUtc, channel: "rear", fingerprint: "fp:mc" }),
        ]);
        expect(trips[0]!.frames[0]!.channels.rear).toBeUndefined(); // F and B torn apart
    });

    it("a corrupt/pooled offset is rejected by the per-file firstGps gate (falls back, not anchored blindly)", () => {
        const trueStart = 1_700_000_000;
        const firstGps = trueStart + 5;
        const result = deriveStartUtc({
            file: makeVendorFile("x.mp4"),
            fingerprint: "fp",
            createdUtc: null,
            durationSec: 60,
            records: [makeRecord(firstGps), makeRecord(firstGps + 50)],
            fingerprintTz: null,
            parseFilenameLocalTime: () => new Date(trueStart * 1000), // TZ 0, names t=0
            preciseFilenameOffsetSec: 100_000, // absurd - would anchor at trueStart-100000
            embeddedStartUtcHint: null,
            isTimelapse: false,
            wallDurationSec: null,
        });
        expect(result.startUtc).not.toBe(trueStart - 100_000); // corrupt anchor refused
        expect(result.source).toBe("name");
        expect(result.startUtc).toBe(trueStart); // self-calibrated recovered the real start
    });

    it("estimator drops a gross outlier delta from the in-run MAX (one corrupt row can't drag the run)", () => {
        // Three clips chained 60s apart (one run); the middle one's firstGps is
        // decoded 2h wrong-early, inflating its delta far past the run median.
        const base = 1_700_000_000;
        const nameByFile = (vf: VendorFile): Date => {
            const idx = Number(vf.file.name[0]); // "0.mp4" | "1.mp4" | "2.mp4"
            return new Date((base + 18_040 + idx * 60) * 1000);
        };
        const mkSample = (idx: number, delta: number): TzSample => ({
            file: makeVendorFile(`${idx}.mp4`),
            fingerprint: "fp",
            // firstGps = nameNaive - delta.
            firstGpsUnix: base + 18_040 + idx * 60 - delta,
            mvhdNaiveUnix: null,
            durationSec: 60,
        });
        const runs = estimatePreciseClockOffsetByFingerprint(
            [mkSample(0, 18_040), mkSample(1, 25_240), mkSample(2, 18_040)],
            nameByFile,
        );
        const offset = resolvePreciseClockOffsetForFile(runs, "fp", makeVendorFile("0.mp4"), nameByFile);
        expect(offset).toBe(18_040); // 25240 excluded as >1h from the run median, not max=25240
    });
});

// The A810 regression: the RTC offset is NOT constant across a multi-day
// card (drift + occasional resync), so one camera-wide MAX anchored every other
// session wrong by the spread - chart/map lagged the camera's burnt-in overlay
// by ~11s on the ride whose true offset was smaller. The estimator must scope
// the MAX to a recording run and let neighbors inherit only within a bounded
// name-time distance.
describe("estimatePreciseClockOffsetByFingerprint: per-run offsets", () => {
    const DAY = 86_400;
    const base = 1_780_000_000;
    // Two sessions a week apart on one camera. Session A: RTC +8s ahead of GPS;
    // session B: +19s (a week of drift). Names chain 60s apart inside each.
    const nameUnixByFile = new Map<string, number>([
        ["a1.mp4", base],
        ["a2.mp4", base + 60],
        ["b1.mp4", base + 7 * DAY],
        ["b2.mp4", base + 7 * DAY + 60],
    ]);
    const nameOf = (vf: VendorFile): Date | null => {
        const nameUnix = nameUnixByFile.get(vf.file.name);
        return nameUnix === undefined ? null : new Date(nameUnix * 1000);
    };
    const mkSample = (name: string, offset: number, lag: number): TzSample => ({
        file: makeVendorFile(name),
        fingerprint: "fp",
        // firstGps = trueStart + lag = (nameUnix - offset) + lag.
        firstGpsUnix: nameUnixByFile.get(name)! - offset + lag,
        mvhdNaiveUnix: null,
        durationSec: 60,
    });
    const samples = [
        mkSample("a1.mp4", 8, 15), // cold start: 15s fix lag understates the offset
        mkSample("a2.mp4", 8, 0), // warm: reveals session A's true offset
        mkSample("b1.mp4", 19, 12),
        mkSample("b2.mp4", 19, 0),
    ];
    const runs = estimatePreciseClockOffsetByFingerprint(samples, nameOf);
    const resolve = (name: string) => resolvePreciseClockOffsetForFile(runs, "fp", makeVendorFile(name), nameOf);

    it("each session gets its OWN offset - the max is not shared across the card", () => {
        expect(resolve("a1.mp4")).toBe(8);
        expect(resolve("a2.mp4")).toBe(8);
        expect(resolve("b1.mp4")).toBe(19);
        expect(resolve("b2.mp4")).toBe(19);
    });

    it("a clip near a run (parking clip minutes later) inherits that run's offset", () => {
        // 10 minutes after session A's last clip: no run of its own, nearest is A.
        nameUnixByFile.set("stray.mp4", base + 60 + 600);
        expect(resolve("stray.mp4")).toBe(8);
    });

    it("a clip too far from every run (stale offset) gets null, not an inherited guess", () => {
        // 3 days from either session - past OFFSET_INHERIT_MAX_GAP_SEC; drift
        // makes any inherited value worse than per-file self-calibration.
        nameUnixByFile.set("far.mp4", base + 3 * DAY);
        expect(resolve("far.mp4")).toBeNull();
    });

    it("a file with no parseable name time resolves to null", () => {
        expect(resolve("unknown.mp4")).toBeNull();
    });
});

// ITEM 3 (audit trips.ts:1053): snappedMedianTz must not average the two middle
// values on an even-count bucket. A camera clock change mid-dump (DST on
// local-as-UTC firmware shifts deltas by exactly 3600s) with an even split lands
// the average tz+1800 - a value belonging to NEITHER cluster - which survives the
// 15-min snap and throws every no-GPS sibling channel 30 min off its GPS front.
// snappedMedianTz is internal, so it is exercised through estimateTzByFingerprint,
// which feeds it the (mvhdNaive - firstGps) deltas.
describe("estimateTzByFingerprint: snappedMedianTz lower-median + outlier guard (A5 sibling)", () => {
    const noName = (): Date | null => null;
    // mvhd-source samples with exact (mvhdNaive - firstGps) = delta.
    function mvhdSamples(fingerprint: string, firstGps: number, deltas: number[]): TzSample[] {
        return deltas.map((d, i) => ({
            file: makeVendorFile(`${fingerprint}-${i}.mp4`),
            fingerprint,
            firstGpsUnix: firstGps,
            mvhdNaiveUnix: firstGps + d,
            durationSec: null,
        }));
    }

    const F = 1_700_000_000;
    const tz = 18_000; // +5h, a 900-grid multiple

    it("even-count bimodal (clock change mid-dump) picks a real cluster, not the tz+1800 average", () => {
        // [tz, tz, tz+3600, tz+3600]: the old midpoint average = tz+1800 = 19800,
        // which survives the snap. The lower median picks the observed tz.
        const est = estimateTzByFingerprint(mvhdSamples("fp", F, [tz, tz, tz + 3600, tz + 3600]), noName);
        expect(est.get("fp")!.mvhdTzSec).toBe(tz);
    });

    it("odd-count median is unchanged", () => {
        const est = estimateTzByFingerprint(mvhdSamples("fp", F, [tz, tz + 900, tz + 1800]), noName);
        expect(est.get("fp")!.mvhdTzSec).toBe(tz + 900);
    });

    it("singleton delta snaps to itself", () => {
        // 18050 -> nearest 900 grid = 18000.
        const est = estimateTzByFingerprint(mvhdSamples("fp", F, [tz + 50]), noName);
        expect(est.get("fp")!.mvhdTzSec).toBe(tz);
    });

    it("a wild outlier is dropped, not folded into the estimate", () => {
        // Three good deltas at tz plus one corrupt 10h-off row. The lower median
        // is already robust here; the >1h outlier drop mirrors the precise-offset
        // guard so a mean-based regression would be caught.
        const est = estimateTzByFingerprint(mvhdSamples("fp", F, [tz, tz, tz, tz + 36_000]), noName);
        expect(est.get("fp")!.mvhdTzSec).toBe(tz);
    });

    it("a fingerprint with no usable delta yields no entry (null median filtered out)", () => {
        const est = estimateTzByFingerprint(
            [
                {
                    file: makeVendorFile("x.mp4"),
                    fingerprint: "fp",
                    firstGpsUnix: F,
                    mvhdNaiveUnix: null,
                    durationSec: null,
                },
            ],
            noName,
        );
        expect(est.has("fp")).toBe(false);
    });
});

// Cold-start records: valid position, GPS clock not yet synced (timeUnsynced).
function makeUnsynced(lat = 0, lon = 0): GpsRecord {
    return { ...makeRecord(-1, lat, lon), timeUnsynced: true };
}

describe("deriveStartUtc: cold-start (timeUnsynced) records", () => {
    // The bug this guards: a 70mai file whose every GPS row was written before
    // the clock synced (all unixSeconds ~ -1). Trusting record[0] threw the
    // file onto 1970. firstSyncedRecord returns null, so we fall through to the
    // filename clock instead.
    it("all-unsynced file is not anchored to 1970 - falls through to filename", () => {
        const filenameLocal = () => new Date(Date.UTC(2026, 0, 1, 12, 0, 0));
        const result = deriveStartUtc({
            file: makeVendorFile("NO20260101-120000F.mp4"),
            fingerprint: "fp:70mai",
            createdUtc: null,
            durationSec: 60,
            records: [makeUnsynced(50.1, 30.1), makeUnsynced(50.2, 30.1)],
            fingerprintTz: null,
            parseFilenameLocalTime: filenameLocal,
            preciseFilenameOffsetSec: null,
            embeddedStartUtcHint: null,
            isTimelapse: false,
            wallDurationSec: null,
        });
        expect(result.source).toBe("name");
        expect(result.startUtc).toBeGreaterThan(1_600_000_000); // 2020+, not -1/epoch
    });

    it("mixed file: cold-start prefix ignored, synced record drives the start", () => {
        const startReal = 1_780_000_000;
        const records = [makeUnsynced(50.1, 30.1), makeRecord(startReal + 5), makeRecord(startReal + 30)];
        const result = deriveStartUtc({
            file: makeVendorFile("a.mp4"),
            fingerprint: "fp:70mai",
            createdUtc: new Date(startReal * 1000),
            durationSec: 60,
            records,
            fingerprintTz: { filenameTzSec: 0, mvhdTzSec: 0 },
            parseFilenameLocalTime: noFilenameTime,
            preciseFilenameOffsetSec: null,
            embeddedStartUtcHint: null,
            isTimelapse: false,
            wallDurationSec: null,
        });
        expect(result.source).toBe("mp4");
        expect(result.startUtc).toBe(startReal); // not -1
    });
});

describe("reanchorUnsyncedTimes", () => {
    it("pure cold-start file: spreads records evenly across [start, start+duration)", () => {
        const recs = [makeUnsynced(50.1, 30.1), makeUnsynced(50.2, 30.1), makeUnsynced(50.3, 30.1)];
        reanchorUnsyncedTimes(recs, 1000, 60);
        // (k + 0.5) * 60 / 3 + 1000
        expect(recs.map((r) => r.unixSeconds)).toEqual([1010, 1030, 1050]);
        // Flag stays set so a later derive/TZ pass keeps ignoring them.
        for (const r of recs) expect(r.timeUnsynced).toBe(true);
    });

    it("mixed file: unsynced placed strictly before the first synced record", () => {
        const recs = [makeUnsynced(50.1, 30.1), makeUnsynced(50.2, 30.1), makeRecord(2000)];
        reanchorUnsyncedTimes(recs, 1000, 60);
        // window [1000, 2000), 2 points -> 1250, 1750; synced row untouched.
        expect(recs[0]!.unixSeconds).toBe(1250);
        expect(recs[1]!.unixSeconds).toBe(1750);
        expect(recs[2]!.unixSeconds).toBe(2000);
        expect(recs[1]!.unixSeconds).toBeLessThan(recs[2]!.unixSeconds);
    });

    it("no unsynced records: no-op", () => {
        const recs = [makeRecord(2000), makeRecord(2001)];
        reanchorUnsyncedTimes(recs, 1000, 60);
        expect(recs.map((r) => r.unixSeconds)).toEqual([2000, 2001]);
    });

    it("idempotent: re-running with the same start reproduces the same times", () => {
        const recs = [makeUnsynced(50.1), makeUnsynced(50.2)];
        reanchorUnsyncedTimes(recs, 1000, 60);
        const once = recs.map((r) => r.unixSeconds);
        reanchorUnsyncedTimes(recs, 1000, 60);
        expect(recs.map((r) => r.unixSeconds)).toEqual(once);
    });

    it("zero/invalid duration falls back to a 1s window - monotonic, finite", () => {
        const recs = [makeUnsynced(50.1), makeUnsynced(50.2)];
        reanchorUnsyncedTimes(recs, 1000, 0);
        expect(recs[0]!.unixSeconds).toBeCloseTo(1000.25, 6);
        expect(recs[1]!.unixSeconds).toBeCloseTo(1000.75, 6);
    });

    // relStartSeconds path (70mai Pro `GPS ` box): a trustworthy per-record
    // offset places each fix at startUtc+offset instead of evenly by index.
    const withOffset = (off: number, lat = 50.1): GpsRecord => ({ ...makeUnsynced(lat), relStartSeconds: off });

    it("relStartSeconds present: places each fix at startUtc+offset, not evenly", () => {
        // Cold start dropped the first 10 s of no-fix rows, so the survivors
        // carry offsets 10,11,12 - they must sit at the START of the window, not
        // be smeared across it the way even spacing (1010/1030/1050) would.
        const recs = [withOffset(10), withOffset(11), withOffset(12)];
        reanchorUnsyncedTimes(recs, 1000, 60);
        expect(recs.map((r) => r.unixSeconds)).toEqual([1010, 1011, 1012]);
        for (const r of recs) expect(r.timeUnsynced).toBe(true); // flag stays set
    });

    it("relStartSeconds overshooting the window clamps below windowEnd, stays sorted", () => {
        const recs = [withOffset(0), withOffset(30), withOffset(1000)];
        reanchorUnsyncedTimes(recs, 1000, 60); // windowEnd 1060, epsilon min(0.5, 0.06)
        expect(recs[0]!.unixSeconds).toBe(1000);
        expect(recs[1]!.unixSeconds).toBe(1030);
        expect(recs[2]!.unixSeconds).toBeCloseTo(1059.94, 6);
        expect(recs[1]!.unixSeconds).toBeLessThan(recs[2]!.unixSeconds);
    });

    it("falls back to even spacing if any unsynced record lacks an offset", () => {
        // Mixed offsets -> not all present -> even spacing (no partial offset).
        const recs = [withOffset(5), makeUnsynced(50.2)];
        reanchorUnsyncedTimes(recs, 1000, 60);
        expect(recs.map((r) => r.unixSeconds)).toEqual([1015, 1045]);
    });
});

describe("finalizeTrip: teleport outlier filter", () => {
    // The shared dropTeleportOutliers pass (unit-tested in parser.test.ts)
    // must run inside the trip funnel: after the cross-channel merge+sort,
    // before distance/event computation. This asserts the wiring, not the
    // algorithm.
    function gps(unixSeconds: number, lat: number, lon: number): GpsRecord {
        return {
            unixSeconds,
            active: true,
            lat,
            lon,
            bearingDeg: 0,
            speedMs: 11,
            accelXg: 0,
            accelYg: 0,
            accelZg: 0,
            mp4Filename: "a.mp4",
        };
    }

    it("filters a teleport spike out of trip.records and the distance", () => {
        // 1 Hz track with a single ~5.5 km spike that returns to the track.
        const records = [
            gps(1000, 50.0, 30.0),
            gps(1001, 50.0001, 30.0),
            gps(1002, 50.05, 30.0), // spike
            gps(1003, 50.0003, 30.0),
            gps(1004, 50.0004, 30.0),
        ];
        const trip = groupTrips([makeCandidate({ name: "a.mp4", startUtc: 1000, records })])[0]!;

        expect(trip.records).toHaveLength(4);
        expect(trip.records.some((r) => r.lat > 50.01)).toBe(false);
        // Without the filter the spike adds ~11 km (out and back); the
        // filtered distance is the ~44 m of actual driving.
        expect(trip.distanceKm).toBeLessThan(0.1);
        // Event positions index into the FILTERED trip.records - they must
        // all stay resolvable.
        for (const ev of trip.events) {
            expect(trip.records[ev.recordIndex]).toBeDefined();
        }
    });

    it("leaves a clean track untouched", () => {
        const records = [gps(1000, 50.0, 30.0), gps(1001, 50.0001, 30.0), gps(1002, 50.0002, 30.0)];
        const trip = groupTrips([makeCandidate({ name: "a.mp4", startUtc: 1000, records })])[0]!;
        expect(trip.records).toHaveLength(3);
    });
});

describe("finalizeTrip: cross-channel accel transplant (per-channel IMU)", () => {
    // A multi-GPS-channel camera can carry its own IMU per channel. Two records
    // at the same time+position collapse in the cross-channel dedup; front wins
    // (CHANNEL_PRIORITY), so a rear/interior-only impact spike must be
    // transplanted onto the survivor or it is lost before detectEvents.
    const SAME_CAM = "cam-imu";

    it("keeps a rear-channel spike that collides with the front record's time+position", () => {
        const frontRec: GpsRecord = { ...makeRecord(1000, 50, 30), accelXg: 0.01, mp4Filename: "f.mp4" };
        const rearRec: GpsRecord = { ...makeRecord(1000, 50, 30), accelXg: 1.2, mp4Filename: "r.mp4" };
        const f = makeCandidate({
            name: "f.mp4",
            startUtc: 1000,
            channel: "front",
            sequence: 1,
            fingerprint: SAME_CAM,
            records: [frontRec],
        });
        const r = makeCandidate({
            name: "r.mp4",
            startUtc: 1000,
            channel: "rear",
            sequence: 1,
            fingerprint: SAME_CAM,
            records: [rearRec],
        });
        const trip = groupTrips([f, r])[0]!;
        // One survivor (front), carrying the rear's stronger accel triple.
        expect(trip.records).toHaveLength(1);
        expect(trip.records[0]!.accelXg).toBe(1.2);
        expect(trip.events.some((e) => e.kind === "brake")).toBe(true);
        // Clone, not in-place: the input candidate records are untouched.
        expect(frontRec.accelXg).toBe(0.01);
        expect(rearRec.accelXg).toBe(1.2);
    });
});

describe("estimateProvisionalDurationByFingerprint", () => {
    const fp = (fingerprint: string, startUtc: number) => ({ fingerprint, startUtc });

    it("single-channel 60s segments → 60", () => {
        const cands = [0, 60, 120, 180, 240].map((t) => fp("cam", 1000 + t));
        expect(estimateProvisionalDurationByFingerprint(cands).get("cam")).toBe(60);
    });

    it("multi-channel F+R at the same instants does NOT yield 0 (the modal-0 trap)", () => {
        // Front and rear recorded together every 60s. Raw deltas would be
        // [0,60,0,60,...] whose mode is 0; collapsing same-instant clips fixes it.
        const cands: { fingerprint: string; startUtc: number }[] = [];
        for (const t of [0, 60, 120, 180]) {
            cands.push(fp("cam", 1000 + t)); // front
            cands.push(fp("cam", 1000 + t + 0.3)); // rear, ~0.3s skew
        }
        expect(estimateProvisionalDurationByFingerprint(cands).get("cam")).toBe(60);
    });

    it("uses channel and sequence evidence to preserve adjacent short moments", () => {
        const cands = [0, 2].flatMap((startUtc, sequence) =>
            (["front", "rear", "interior"] as const).map((channel) => ({
                fingerprint: "cam",
                startUtc,
                channel,
                sequence,
            })),
        );
        expect(estimateProvisionalDurationByFingerprint(cands).get("cam")).toBe(2);
    });

    it("non-30-multiple segment is NOT quantized to the 30s grid", () => {
        // 100s segments must estimate ~100, not snap to 90/120 (overshoot would
        // spuriously overlap-split a contiguous run).
        const cands = [0, 100, 200, 300, 400].map((t) => fp("cam", 1000 + t));
        expect(estimateProvisionalDurationByFingerprint(cands).get("cam")).toBe(100);
    });

    it("single distinct moment (lone clip) → default 60", () => {
        expect(estimateProvisionalDurationByFingerprint([fp("cam", 1000)]).get("cam")).toBe(60);
    });

    it("engine-off pause within a fingerprint does not define the segment length", () => {
        // Two 60s runs separated by a 30-min pause. The 1800s delta is excluded.
        const cands = [0, 60, 120, 1920, 1980, 2040].map((t) => fp("cam", 1000 + t));
        expect(estimateProvisionalDurationByFingerprint(cands).get("cam")).toBe(60);
    });

    it("bimodal normal+event interleave → mode lands on the dominant segment", () => {
        // Mostly 120s normal clips plus a couple of short event deltas; 120 dominates.
        const cands = [0, 120, 240, 360, 480, 500, 620].map((t) => fp("cam", 1000 + t));
        expect(estimateProvisionalDurationByFingerprint(cands).get("cam")).toBe(120);
    });

    it("ties break toward the smaller delta (overshoot is the dangerous direction)", () => {
        // Genuine 1:1 tie - deltas 60 and 90 each once → pick the smaller (60).
        const cands = [0, 60, 150].map((t) => fp("cam", 1000 + t));
        expect(estimateProvisionalDurationByFingerprint(cands).get("cam")).toBe(60);
    });

    it("sub-second jitter rounds to whole seconds and stays positive", () => {
        const cands = [0, 59.96, 120.04, 179.98].map((t) => fp("cam", 1000 + t));
        expect(estimateProvisionalDurationByFingerprint(cands).get("cam")).toBe(60);
    });

    it("estimates each fingerprint independently", () => {
        const cands = [
            ...[0, 60, 120].map((t) => fp("camA", 1000 + t)),
            ...[0, 120, 240].map((t) => fp("camB", 5000 + t)),
        ];
        const out = estimateProvisionalDurationByFingerprint(cands);
        expect(out.get("camA")).toBe(60);
        expect(out.get("camB")).toBe(120);
    });

    it("clamps into [1, 600]; an all-pause fingerprint falls back to default", () => {
        // Two clips 2h apart: the single delta exceeds MAX, so no delta votes →
        // default 60 (inside the band).
        const cands = [0, 7200].map((t) => fp("cam", 1000 + t));
        expect(estimateProvisionalDurationByFingerprint(cands).get("cam")).toBe(60);
    });
});

// ITEM 4 (audit basename-keying sweep, trips.ts:1572): rederiveStartUtcForCandidates
// deduped TZ samples by File.name. Two DISTINCT files sharing a basename (a Viofo
// RO/ protected copy vs its Movie/ sibling, or the same folder layout on two SD
// cards) collapsed into one sample - and below the 2-file floor that suppressed the
// precise clock offset entirely, so the filename anchor lost its residual-free
// offset and fell back to the 15-min-snapped self-calibration. Keying by File
// identity keeps distinct physical files apart.
describe("rederiveStartUtcForCandidates: TZ-sample dedup keyed by File identity", () => {
    // A single 70mai recording duplicated (RO copy + Movie original): same
    // basename, same relativePath, DISTINCT File objects, same fingerprint, same
    // GPS. The precise offset (46790, NOT a 900 multiple) needs both samples to
    // clear PRECISE_OFFSET_MIN_FILES=2; name-keyed dedup drops one and forces the
    // snapped self-calibration (46800), anchoring the clip 10s off.
    const NAME = "NO20260611-221618-003699F.MP4";
    const NAME_NAIVE = Date.UTC(2026, 5, 11, 22, 16, 18) / 1000;
    const OFFSET = 46_790; // filename-naive minus firstGps; snapTz(46790) = 46800
    const FIRST_GPS = NAME_NAIVE - OFFSET;

    function makeSameNameCandidate(): VideoCandidate {
        return makeCandidate({
            name: NAME,
            startUtc: 0, // provisional; rederive overwrites it
            durationSec: 60,
            fingerprint: "fp:70mai",
            records: [makeRecord(FIRST_GPS), makeRecord(FIRST_GPS + 40)],
        });
    }

    it("two distinct files with the same basename both feed the precise offset", () => {
        const a = makeSameNameCandidate();
        const b = makeSameNameCandidate();
        // Sanity: distinct File objects that a basename key would have merged.
        expect(a.file).not.toBe(b.file);
        expect(a.file.name).toBe(b.file.name);
        expect(a.relativePath).toBe(b.relativePath);

        rederiveStartUtcForCandidates([a, b], classifyFilenameTime);

        // With both samples counted, the precise offset (46790) anchors t=0 at the
        // exact filename time minus offset = FIRST_GPS; the name-keyed collapse
        // would have used the snapped self-calibration (NAME_NAIVE - 46800).
        for (const c of [a, b]) {
            expect(c.startSource).toBe("name");
            expect(c.startUtc).toBe(NAME_NAIVE - OFFSET); // == FIRST_GPS, not NAME_NAIVE - 46800
        }
    });
});

// ===== display clock (camera clock when known) =====
//
// These run under the TZ=UTC pin (package.json test script), so the browser
// offset is 0 and the two displayTzSec paths are cleanly separable.

describe("displayTzSec / displayClockDate", () => {
    it("applies the camera zone when the estimate exists", () => {
        expect(displayTzSec(0, 10_800)).toBe(10_800);
        expect(displayClockDate(1_000, 10_800).getTime()).toBe((1_000 + 10_800) * 1000);
    });

    it("falls back to the per-instant browser offset when unknown", () => {
        // toBeCloseTo, not toBe: -offset*60 yields -0 under the TZ=UTC pin.
        expect(displayTzSec(1_000, null)).toBeCloseTo(0);
        expect(displayClockDate(1_000, null).getTime()).toBe(1_000_000);
    });
});

describe("rederiveStartUtcForCandidates: camera-clock zone snapshot", () => {
    it("stores the fingerprint's filenameTzSec on every candidate", () => {
        // Filename clock 3h ahead of the GPS clock - the honest-UTC layout.
        const nameNaive = Date.UTC(2026, 5, 11, 22, 16, 18) / 1000;
        const c = makeCandidate({
            name: "NO20260611-221618-003699F.MP4",
            startUtc: 0,
            records: [makeRecord(nameNaive - 10_800), makeRecord(nameNaive - 10_800 + 40)],
        });
        rederiveStartUtcForCandidates([c], classifyFilenameTime);
        expect(c.cameraTzSec).toBe(10_800);
    });

    it("stays null when no filename time parses anywhere in the fleet", () => {
        const c = makeCandidate({ name: "clip.mp4", startUtc: 0, records: [makeRecord(1_700_000_000)] });
        rederiveStartUtcForCandidates([c], classifyFilenameTime);
        expect(c.cameraTzSec).toBeNull();
    });
});

describe("groupTrips: cameraTzSec lift", () => {
    it("lifts the first non-null candidate estimate onto the trip", () => {
        const a = makeCandidate({ name: "a.mp4", startUtc: 1000 });
        a.cameraTzSec = 10_800;
        const trips = groupTrips([a]);
        expect(trips[0]!.cameraTzSec).toBe(10_800);
    });

    it("stays null when no candidate carries an estimate", () => {
        const a = makeCandidate({ name: "a.mp4", startUtc: 1000 });
        const trips = groupTrips([a]);
        expect(trips[0]!.cameraTzSec).toBeNull();
    });
});

// ===== local-as-UTC record-axis correction (A119 Mini 2 firmware) =====

describe("applyLocalClockCorrections (via rederiveStartUtcForCandidates)", () => {
    // Local-as-UTC camera in a +3h zone: the filename clock and the GPS
    // record clocks agree (both local), true UTC is 3h behind both. The
    // cold-start hint carries the measured +10800.
    const NAME = "20260406142122_000022.MP4";
    const NAME_NAIVE = Date.UTC(2026, 3, 6, 14, 21, 22) / 1000;
    const ZONE = 10_800;

    function makeLocalStampCandidate(): VideoCandidate {
        const c = makeCandidate({
            name: NAME,
            startUtc: 0,
            durationSec: 60,
            records: [makeRecord(NAME_NAIVE + 43), makeRecord(NAME_NAIVE + 57)],
        });
        c.appliedExtractors = ["freegps"];
        return c;
    }

    it("subtracts the measured offset and re-anchors on true UTC", () => {
        const c = makeLocalStampCandidate();
        c.localClockOffsetHintSec = ZONE;
        rederiveStartUtcForCandidates([c], classifyFilenameTime);

        expect(c.records[0]!.unixSeconds).toBe(NAME_NAIVE + 43 - ZONE);
        expect(c.records[0]!.localClockOffsetAppliedSec).toBe(ZONE);
        // Filename self-calibration over the corrected records: t=0 lands a
        // full zone behind the (local) filename clock.
        expect(c.startUtc).toBe(NAME_NAIVE - ZONE);
        expect(c.startSource).toBe("name");
        // Display estimate now reports the real zone, so the camera clock
        // shown to the user stays 14:21 - same screen, honest axis.
        expect(c.cameraTzSec).toBe(ZONE);
    });

    it("is idempotent across repeated sweeps", () => {
        const c = makeLocalStampCandidate();
        c.localClockOffsetHintSec = ZONE;
        rederiveStartUtcForCandidates([c], classifyFilenameTime);
        rederiveStartUtcForCandidates([c], classifyFilenameTime);
        expect(c.records[0]!.unixSeconds).toBe(NAME_NAIVE + 43 - ZONE);
        expect(c.startUtc).toBe(NAME_NAIVE - ZONE);
    });

    it("propagates the offset to same-fingerprint siblings without evidence", () => {
        const c = makeLocalStampCandidate();
        c.localClockOffsetHintSec = ZONE;
        const siblingNaive = NAME_NAIVE + 60;
        const sibling = makeCandidate({
            name: "20260406142222_000023.MP4",
            startUtc: 0,
            durationSec: 60,
            records: [makeRecord(siblingNaive + 43)],
        });
        sibling.appliedExtractors = ["freegps"];
        rederiveStartUtcForCandidates([c, sibling], classifyFilenameTime);
        expect(sibling.records[0]!.unixSeconds).toBe(siblingNaive + 43 - ZONE);
    });

    it("leaves records from other extractors on the same fingerprint alone", () => {
        const c = makeLocalStampCandidate();
        c.localClockOffsetHintSec = ZONE;
        // A GPX-fed sibling already carries honest UTC - the freegps clock
        // offset does not describe it.
        const honest = makeCandidate({
            name: "clip-gpx.mp4",
            startUtc: 0,
            durationSec: 60,
            records: [makeRecord(NAME_NAIVE - ZONE + 200)],
        });
        honest.appliedExtractors = ["gpx"];
        rederiveStartUtcForCandidates([c, honest], classifyFilenameTime);
        expect(honest.records[0]!.unixSeconds).toBe(NAME_NAIVE - ZONE + 200);
        expect(honest.records[0]!.localClockOffsetAppliedSec).toBeUndefined();
    });

    it("keeps an applied offset when a later sweep sees no evidence", () => {
        // Per-trip refinement sees only one trip's candidates; the clip that
        // measured the offset routinely sits in another trip. Reverting there
        // would undo a correct axis - permanently if the fill is cancelled
        // before the final full sweep.
        const c = makeLocalStampCandidate();
        c.localClockOffsetHintSec = ZONE;
        rederiveStartUtcForCandidates([c], classifyFilenameTime);
        expect(c.records[0]!.unixSeconds).toBe(NAME_NAIVE + 43 - ZONE);

        c.localClockOffsetHintSec = null;
        rederiveStartUtcForCandidates([c], classifyFilenameTime);
        expect(c.records[0]!.unixSeconds).toBe(NAME_NAIVE + 43 - ZONE);
        expect(c.records[0]!.localClockOffsetAppliedSec).toBe(ZONE);
    });
});

// ===== time-lapse wall span (70mai A510 LA clips) =====
//
// Ground truth from real A510 samples: LA clips capture 1 frame per real
// second and play at 15 fps (15x), the filename carries the recording START
// and mvhd creation_time the file CLOSE - so mvhd-name == the real wall span
// (98 s for a 6.53 s video). PA/NO clips are realtime with the same finalize
// mvhd semantics (mvhd-name == duration).

describe("deriveWallDurationSec", () => {
    const LA_NAME_NAIVE = Date.UTC(2024, 4, 22, 10, 52, 33) / 1000;

    it("returns null for a non-time-lapse clip even with stretching evidence", () => {
        expect(
            deriveWallDurationSec({
                isTimelapse: false,
                durationSec: 6.533,
                createdUtc: new Date((LA_NAME_NAIVE + 98) * 1000),
                records: [],
                filenameNaiveSec: LA_NAME_NAIVE,
            }),
        ).toBeNull();
    });

    it("reads the wall span from finalize-mvhd minus filename (A510 LA)", () => {
        expect(
            deriveWallDurationSec({
                isTimelapse: true,
                durationSec: 6.533,
                createdUtc: new Date((LA_NAME_NAIVE + 98) * 1000),
                records: [],
                filenameNaiveSec: LA_NAME_NAIVE,
            }),
        ).toBe(98);
    });

    it("reads the wall span from the synced GPS record span", () => {
        expect(
            deriveWallDurationSec({
                isTimelapse: true,
                durationSec: 9.267,
                createdUtc: null,
                records: [makeRecord(1000), makeRecord(1063), makeRecord(1126)],
                filenameNaiveSec: null,
            }),
        ).toBe(126);
    });

    it("takes the larger of the two evidence sources", () => {
        expect(
            deriveWallDurationSec({
                isTimelapse: true,
                durationSec: 9.267,
                createdUtc: new Date((LA_NAME_NAIVE + 139) * 1000),
                records: [makeRecord(LA_NAME_NAIVE), makeRecord(LA_NAME_NAIVE + 126)],
                filenameNaiveSec: LA_NAME_NAIVE,
            }),
        ).toBe(139);
    });

    it("rejects evidence below the 1.5x plausibility floor and above the 24h cap", () => {
        // Realtime clip: mvhd-name ~ duration -> not a wall span.
        expect(
            deriveWallDurationSec({
                isTimelapse: true,
                durationSec: 60,
                createdUtc: new Date((LA_NAME_NAIVE + 61) * 1000),
                records: [],
                filenameNaiveSec: LA_NAME_NAIVE,
            }),
        ).toBeNull();
        // Garbage mvhd (years off): span over a day is corrupt evidence.
        expect(
            deriveWallDurationSec({
                isTimelapse: true,
                durationSec: 6.533,
                createdUtc: new Date((LA_NAME_NAIVE + 90 * 86_400) * 1000),
                records: [],
                filenameNaiveSec: LA_NAME_NAIVE,
            }),
        ).toBeNull();
    });
});

describe("timelapse cadence wall spans (A810 Lapse/, no per-file evidence)", () => {
    // Real A810 lite pattern: 60s LA clips recorded every 900s (15x), F+R
    // pairs, no GPS rows while parked and no mvhd creation time - so
    // deriveWallDurationSec has nothing and the cadence factor is the only
    // wall-span signal.
    function laPair(hhmmss: string, seq: string): VideoCandidate[] {
        const nameNaive = classifyFilenameTime(makeVendorFile(`LA20260714-${hhmmss}-${seq}F.MP4`))!.getTime() / 1000;
        return (["F", "R"] as const).map((ch) =>
            makeCandidate({
                name: `LA20260714-${hhmmss}-${seq}${ch}.MP4`,
                startUtc: nameNaive,
                durationSec: 60,
                channel: ch === "F" ? "front" : "rear",
                isTimelapse: true,
            }),
        );
    }

    it("derives the speed factor from the clip cadence and fills every clip, including the last of the run", () => {
        const cands = [...laPair("145315", "000295"), ...laPair("150815", "000296"), ...laPair("152315", "000297")];
        applyTimelapseCadenceWallSpans(cands, classifyFilenameTime);
        // 900s gap / 60s duration = 15x; the run's last clip has no next
        // neighbor but inherits the shared per-fingerprint factor.
        for (const c of cands) expect(c.wallDurationSec).toBe(900);
    });

    it("bundles a parked lapse run into one trip at the default gap threshold", () => {
        const cands = [...laPair("145315", "000295"), ...laPair("150815", "000296"), ...laPair("152315", "000297")];
        expect(groupTrips(cands)).toHaveLength(3); // without wall spans: 840s phantom pauses
        applyTimelapseCadenceWallSpans(cands, classifyFilenameTime);
        const trips = groupTrips(cands);
        expect(trips).toHaveLength(1);
        expect(trips[0]!.frames).toHaveLength(3);
    });

    it("keeps a real recording pause out of the factor (outlier gap vs median)", () => {
        // Two lapse sessions 4h apart: the cross-session gap (14400s / 60s =
        // 240x) is over the factor cap and must not reach the median.
        const cands = [
            ...laPair("100000", "000001"),
            ...laPair("101500", "000002"),
            ...laPair("103000", "000003"),
            ...laPair("143000", "000010"),
            ...laPair("144500", "000011"),
        ];
        applyTimelapseCadenceWallSpans(cands, classifyFilenameTime);
        for (const c of cands) expect(c.wallDurationSec).toBe(900);
        // The 4h pause still splits the two sessions into two trips.
        expect(groupTrips(cands)).toHaveLength(2);
    });

    it("leaves per-file evidence and non-timelapse clips untouched", () => {
        const evidenced = makeCandidate({
            name: "LA20260714-145315-000295F.MP4",
            startUtc: 0,
            durationSec: 60,
            isTimelapse: true,
            wallDurationSec: 620,
        });
        const realtime = makeCandidate({ name: "NO20260714-150815-000296F.MP4", startUtc: 900, durationSec: 60 });
        const follower = makeCandidate({
            name: "LA20260714-150815-000297F.MP4",
            startUtc: 900,
            durationSec: 60,
            isTimelapse: true,
        });
        applyTimelapseCadenceWallSpans([evidenced, realtime, follower], classifyFilenameTime);
        expect(evidenced.wallDurationSec).toBe(620);
        expect(realtime.wallDurationSec).toBeNull();
        // Factor from the 900s cadence (gap measured between the two LA clips).
        expect(follower.wallDurationSec).toBe(900);
    });

    it("no factor from a lone clip or from realtime spacing", () => {
        const lone = makeCandidate({
            name: "LA20260714-145315-000295F.MP4",
            startUtc: 0,
            durationSec: 60,
            isTimelapse: true,
        });
        applyTimelapseCadenceWallSpans([lone], classifyFilenameTime);
        expect(lone.wallDurationSec).toBeNull();
        // Back-to-back clips (gap == duration) are below the 1.5x floor: a
        // "timelapse" flag on realtime-spaced clips must not invent a span.
        const a = makeCandidate({
            name: "LA20260714-145315-000295F.MP4",
            startUtc: 0,
            durationSec: 60,
            isTimelapse: true,
        });
        const b = makeCandidate({
            name: "LA20260714-145415-000296F.MP4",
            startUtc: 60,
            durationSec: 60,
            isTimelapse: true,
        });
        applyTimelapseCadenceWallSpans([a, b], classifyFilenameTime);
        expect(a.wallDurationSec).toBeNull();
        expect(b.wallDurationSec).toBeNull();
    });
});

describe("deriveStartUtc: mvhd finalize semantics corroborated by the filename (no GPS)", () => {
    // 70mai A510 writes creation_time at file CLOSE and no GPS time at all
    // (freegps-70mai emits timeUnsynced only), so before the finalize check
    // every clip anchored at its own END ("mvhd as-is").
    function derive(
        name: string,
        mvhdOffsetFromName: number,
        durationSec: number,
        opts?: {
            isTimelapse?: boolean;
            wallDurationSec?: number | null;
        },
    ) {
        const nameNaive = classifyFilenameTime(makeVendorFile(name))!.getTime() / 1000;
        return {
            nameNaive,
            result: deriveStartUtc({
                file: makeVendorFile(name),
                fingerprint: "fp:70mai-a510",
                createdUtc: new Date((nameNaive + mvhdOffsetFromName) * 1000),
                durationSec,
                records: [],
                fingerprintTz: null,
                parseFilenameLocalTime: classifyFilenameTime,
                preciseFilenameOffsetSec: null,
                embeddedStartUtcHint: null,
                isTimelapse: opts?.isTimelapse ?? false,
                wallDurationSec: opts?.wallDurationSec ?? null,
            }),
        };
    }

    it("realtime clip: mvhd-name == duration -> start = mvhd - duration", () => {
        const { nameNaive, result } = derive("NO20240509-134909-000016F.MP4", 61, 60);
        expect(result.source).toBe("mp4");
        expect(result.startUtc).toBe(nameNaive + 1); // mvhd(+61) - 60
    });

    it("local-as-UTC JOOYFACT clock stays on the filename time in UTC+4", () => {
        const previousTz = process.env.TZ;
        process.env.TZ = "Europe/Samara";
        try {
            const { result } = derive("2026_0809_222334_654A.MOV", 2, 3);
            expect(result.source).toBe("mp4");
            expect(result.startUtc).toBe(Date.UTC(2026, 7, 9, 18, 23, 33) / 1000);
        } finally {
            process.env.TZ = previousTz;
        }
    });

    it("time-lapse clip: mvhd-name == wall span -> start = filename", () => {
        const { nameNaive, result } = derive("LA20240522-105233-001495F.MP4", 98, 6.533, {
            isTimelapse: true,
            wallDurationSec: 98,
        });
        expect(result.source).toBe("name");
        expect(result.startUtc).toBe(nameNaive);
    });

    it("start-semantics camera (mvhd == filename) keeps the legacy mvhd-as-is anchor", () => {
        const { nameNaive, result } = derive("NO20240509-134909-000016F.MP4", 0, 60);
        expect(result.source).toBe("mp4");
        expect(result.startUtc).toBe(nameNaive); // mvhd as-is, NOT mvhd - duration
    });

    it("tiny clip on a start-semantics camera does not false-fire (delta >= dur/2 guard)", () => {
        const { nameNaive, result } = derive("NO20240509-142706-000055F.MP4", 0, 1.6);
        expect(result.source).toBe("mp4");
        expect(result.startUtc).toBe(nameNaive);
    });
});

describe("time-lapse timeline: wall-scaled segments and gap math", () => {
    // The real A510 pair: LA (6.533 s video, 98 s wall) immediately followed
    // by a realtime PA clip 99 s later. Content axis stays video seconds; the
    // wall projections run 15x inside the LA segment.
    function makeLaPaTrip() {
        const la = makeCandidate({
            name: "LA20240522-105233-001495F.MP4",
            startUtc: 1000,
            durationSec: 6.5,
            wallDurationSec: 98,
            isTimelapse: true,
            recordingMode: null,
        });
        const pa = makeCandidate({
            name: "PA20240522-105412-001496F.MP4",
            startUtc: 1099,
            durationSec: 30,
            recordingMode: "parking",
        });
        const trips = groupTrips([la, pa]);
        expect(trips).toHaveLength(1);
        return trips[0]!;
    }

    it("no phantom pause divider after the time-lapse frame (1 s real gap)", () => {
        const trip = makeLaPaTrip();
        expect(trip.frames).toHaveLength(2);
        expect(trip.timeline.gaps).toHaveLength(0);
        expect(trip.timeline.contentDurationSec).toBeCloseTo(36.5, 6);
        expect(trip.endUtc).toBe(1129);
        expect(trip.durationSec).toBe(129); // wall span, not 36.5
    });

    it("contentToWallUtc runs at the time-lapse rate inside the LA segment", () => {
        const { timeline } = makeLaPaTrip();
        // Mid-LA: content 3.25 of 6.5 -> wall 1000 + 49 (half of 98).
        expect(contentToWallUtc(timeline, 3.25)).toBeCloseTo(1049, 6);
        // PA stays 1:1: content 6.5+15 -> wall 1099+15.
        expect(contentToWallUtc(timeline, 21.5)).toBeCloseTo(1114, 6);
    });

    it("wallToContentSec compresses wall time into the time-lapse segment", () => {
        const { timeline } = makeLaPaTrip();
        expect(wallToContentSec(timeline, 1049)).toBeCloseTo(3.25, 6);
        expect(wallToContentSec(timeline, 1114)).toBeCloseTo(21.5, 6);
        // A record in the 1 s seam clamps to the divider position.
        expect(wallToContentSec(timeline, 1098.5)).toBeCloseTo(6.5, 6);
    });

    it("contentToFrame stays on the content axis (player seek offset is video seconds)", () => {
        const { timeline } = makeLaPaTrip();
        expect(contentToFrame(timeline, 3.25)).toEqual({ index: 0, offsetInFrame: 3.25 });
        expect(contentToFrame(timeline, 21.5)).toEqual({ index: 1, offsetInFrame: 15 });
    });

    it("without a wall span the same input tears into two trips (the phantom 92.5 s gap)", () => {
        // Contrast case: correct startUtc anchors but video-length gap math -
        // the 1 s real seam reads as 92.5 s and crosses the 30 s trip threshold.
        const la = makeCandidate({ name: "a.mp4", startUtc: 1000, durationSec: 6.5 });
        const pa = makeCandidate({ name: "b.mp4", startUtc: 1099, durationSec: 30 });
        expect(groupTrips([la, pa])).toHaveLength(2);
    });
});

describe("rederiveStartUtcForCandidates: A510 LA end-to-end (wall span + finalize anchor + reanchor)", () => {
    it("derives the wall span, anchors at the filename and spreads unsynced records over the wall window", () => {
        const nameNaive = Date.UTC(2024, 4, 22, 10, 52, 33) / 1000;
        const unsynced = (relStartSeconds: number): GpsRecord => ({
            ...makeRecord(0),
            timeUnsynced: true,
            relStartSeconds,
        });
        const la = makeCandidate({
            name: "LA20240522-105233-001495F.MP4",
            startUtc: 0,
            durationSec: 6.533,
            isTimelapse: true,
            records: [unsynced(0), unsynced(49), unsynced(97)],
        });
        la.createdUtc = new Date((nameNaive + 98) * 1000);

        rederiveStartUtcForCandidates([la], classifyFilenameTime);

        expect(la.wallDurationSec).toBe(98);
        expect(la.startSource).toBe("name");
        expect(la.startUtc).toBe(nameNaive);
        // relStartSeconds path: placed at startUtc+offset across the WALL
        // window (98 s), not squeezed into the 6.5 s video window.
        expect(la.records.map((r) => r.unixSeconds - nameNaive)).toEqual([0, 49, 97]);
    });
});
