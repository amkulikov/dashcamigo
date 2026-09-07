import { describe, expect, it } from "vitest";

import { cameraFingerprint } from "./parsers/camera-fingerprint.js";
import {
    matchFilenameChannel,
    matchFilenameMode,
    matchFilenameSequence,
    matchFilenameTime,
} from "./parsers/filename/index.js";
import { findUnpairedCameraIssue } from "./recognition-issues.js";
import { groupTrips, type Trip, type VideoCandidate } from "./trips.js";
import { vendorFileKey } from "./vendor-file-key.js";

function candidate(name: string, offsetSec = 0, overrides: Partial<VideoCandidate> = {}): VideoCandidate {
    const source = {
        file: new File([name], name, { lastModified: 1 }),
        relativePath: `card/Record/${name}`,
        sourceKey: "card-a",
    };
    const time = matchFilenameTime(source);
    const channel = matchFilenameChannel(source);
    const mode = matchFilenameMode(source);
    const sequence = matchFilenameSequence(source);
    return {
        ...source,
        fingerprint: cameraFingerprint(source),
        appliedExtractors: [],
        classifierMatches: {
            time: time.matchedId,
            channel: channel.matchedId,
            mode: mode.matchedId,
            sequence: sequence.matchedId,
        },
        channel: channel.value?.channel ?? null,
        channelConfident: channel.value?.confident ?? false,
        sequence: sequence.value,
        recordingMode: mode.value,
        isTimelapse: false,
        startUtc: (time.value?.getTime() ?? Date.UTC(2026, 0, 1)) / 1000 + offsetSec,
        durationSec: 60,
        wallDurationSec: null,
        driftLeadSec: null,
        startSource: "mp4",
        cameraTzSec: null,
        localClockOffsetHintSec: null,
        createdUtc: null,
        records: [],
        codec: "avc",
        codecParam: "avc1",
        videoCodecString: null,
        rotation: 0,
        width: 1920,
        height: 1080,
        fps: 30,
        audio: null,
        canPlay: true,
        needsHevcRemux: false,
        isTransportStream: false,
        isMatroska: false,
        audioNeedsTranscode: false,
        embeddedStartUtcHint: null,
        metadataReady: true,
        metadataFailed: false,
        ...overrides,
    };
}

function cameraPairs(count = 3, frontOffsetSec = 20): VideoCandidate[] {
    return Array.from({ length: count }, (_, index) => {
        const minute = String(index).padStart(2, "0");
        return [candidate(`20260101_12${minute}00_NF.mp4`, frontOffsetSec), candidate(`20260101_12${minute}00_NR.mp4`)];
    }).flat();
}

function firstTrip(candidates: VideoCandidate[]): { trip: Trip; trips: Trip[] } {
    const trips = groupTrips(candidates);
    return { trip: trips[0]!, trips };
}

function issue(candidates: VideoCandidate[]) {
    const { trip, trips } = firstTrip(candidates);
    return findUnpairedCameraIssue(trip, trips);
}

describe("findUnpairedCameraIssue", () => {
    it("finds three recognized simultaneous pairs separated by final clock grouping", () => {
        const candidates = cameraPairs();
        const { trip, trips } = firstTrip(candidates);
        expect(trips.every((loaded) => loaded.frames.every((frame) => Object.keys(frame.channels).length === 1))).toBe(
            true,
        );
        const found = findUnpairedCameraIssue(trip, trips);
        expect(found?.fileKeys.slice().sort()).toEqual(candidates.map(vendorFileKey).sort());
    });

    it("leaves properly grouped cameras alone", () => {
        expect(issue(cameraPairs(3, 0))).toBeNull();
    });

    it.each([1, 2])("requires repeated evidence beyond %i simultaneous moments", (count) => {
        expect(issue(cameraPairs(count))).toBeNull();
    });

    it("suppresses the issue when the same channel pair works at another moment", () => {
        const candidates = cameraPairs(4);
        candidates[6]!.startUtc -= 20;
        expect(issue(candidates)).toBeNull();
    });

    it("does not infer missing cameras from rear-only recordings", () => {
        expect(issue(cameraPairs().filter((file) => file.channel === "rear"))).toBeNull();
    });

    it("does not treat positional channel labels as a recognition issue", () => {
        const candidates = cameraPairs(3, 0);
        for (const file of candidates) file.channelConfident = false;
        expect(issue(candidates)).toBeNull();
    });

    it("accepts recognized positional channels only with repeated pairing failures", () => {
        const candidates = Array.from({ length: 3 }, (_, index) => {
            const minute = String(index).padStart(2, "0");
            return [
                candidate(`REC20260101-12${minute}00-00${index}-A.mp4`, 20),
                candidate(`REC20260101-12${minute}00-00${index}-B.mp4`),
            ];
        }).flat();
        expect(candidates.every((file) => !file.channelConfident)).toBe(true);
        expect(issue(candidates)?.fileKeys).toHaveLength(6);
    });

    it.each([false, undefined])("waits for explicit complete metadata when metadataReady is %s", (metadataReady) => {
        const candidates = cameraPairs();
        candidates[5]!.metadataReady = metadataReady;
        expect(issue(candidates)).toBeNull();
    });

    it("waits for a pending sibling even when it is an event recording", () => {
        const candidates = Array.from({ length: 3 }, (_, index) => {
            const minute = String(index).padStart(2, "0");
            return [
                candidate(`NO20260101-12${minute}00-00000${index}F.MP4`, 20),
                candidate(`NO20260101-12${minute}00-00000${index}R.MP4`),
            ];
        }).flat();
        expect(issue(candidates)?.fileKeys).toHaveLength(6);
        candidates.push(candidate("EV20260101-120500-000005F.MP4", 0, { metadataReady: false }));
        expect(issue(candidates)).toBeNull();
    });

    it.each<Partial<VideoCandidate>>([
        { metadataFailed: true },
        { canPlay: false },
        { startSource: "mtime" },
        { durationSec: 0 },
        { durationSec: Number.NaN },
    ])("rejects failed or unreliable recording evidence: %j", (overrides) => {
        const candidates = cameraPairs();
        Object.assign(candidates[5]!, overrides);
        expect(issue(candidates)).toBeNull();
    });

    it.each(["parking", "event", "manual", null] as const)("ignores %s recording mode", (recordingMode) => {
        const candidates = cameraPairs();
        for (const file of candidates) file.recordingMode = recordingMode;
        expect(issue(candidates)).toBeNull();
    });

    it("ignores time-lapse even when the recording mode is normal", () => {
        const candidates = cameraPairs();
        for (const file of candidates) file.isTimelapse = true;
        expect(issue(candidates)).toBeNull();
    });

    it("does not combine rear recordings from another picked source", () => {
        const candidates = cameraPairs();
        for (const file of candidates) {
            if (file.channel === "rear") file.sourceKey = "card-b";
        }
        expect(issue(candidates)).toBeNull();
    });

    it("requires an explicit picked-source identity", () => {
        const candidates = cameraPairs();
        for (const file of candidates) file.sourceKey = undefined;
        expect(issue(candidates)).toBeNull();
    });

    it("does not combine separate recorders with identical filename conventions", () => {
        const candidates = cameraPairs();
        for (const file of candidates) {
            if (file.channel !== "rear") continue;
            file.relativePath = `other/Record/${file.file.name}`;
            file.fingerprint = cameraFingerprint(file);
        }
        expect(issue(candidates)).toBeNull();
    });

    it("rejects a duplicate file version in the relevant source", () => {
        const candidates = cameraPairs();
        candidates.push({ ...candidates[0]! });
        expect(issue(candidates)).toBeNull();
    });

    it("rejects multiple files claiming the same filename time and channel", () => {
        const candidates = cameraPairs();
        const original = candidates[0]!;
        candidates.push({ ...original, file: new File(["copy"], original.file.name, { lastModified: 2 }) });
        expect(issue(candidates)).toBeNull();
    });

    it("does not speculate about unknown filename families", () => {
        const candidates = Array.from({ length: 3 }, (_, index) => {
            const minute = String(index).padStart(2, "0");
            return [
                candidate(`custom_2026010112${minute}00_front.mp4`, 20, { recordingMode: "normal" }),
                candidate(`custom_2026010112${minute}00_rear.mp4`, 0, { recordingMode: "normal" }),
            ];
        }).flat();
        expect(issue(candidates)).toBeNull();
    });

    it("rejects a fingerprint that disagrees with the recognized camera key", () => {
        const candidates = cameraPairs();
        for (const file of candidates) file.fingerprint = "guessed-camera";
        expect(issue(candidates)).toBeNull();
    });

    it("requires the recorded time and channel classifiers to agree with the filename", () => {
        const candidates = cameraPairs();
        candidates[5]!.classifierMatches = { time: null, channel: null, mode: null, sequence: null };
        expect(issue(candidates)).toBeNull();
    });

    it("does not warn on an unrelated selected trip", () => {
        const unrelated = candidate("20260102_120000_NF.mp4", 0, { sourceKey: "unrelated-card" });
        const trips = groupTrips([...cameraPairs(), unrelated]);
        const selected = trips.find((trip) => trip.frames.some((frame) => frame.channels.front === unrelated))!;
        expect(findUnpairedCameraIssue(selected, trips)).toBeNull();
    });
});
