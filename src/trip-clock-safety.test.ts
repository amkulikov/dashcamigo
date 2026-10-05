import { describe, expect, it } from "vitest";
import type { GpsRecord } from "./parsers/types.js";
import { cameraFingerprint } from "./parsers/camera-fingerprint.js";
import { classifyFilenameTime, classifyFilenameRecordingKey } from "./parsers/filename/index.js";
import { buildProvisionalCandidate } from "./ui/ingest-candidate.js";
import { findStaleGpsCandidates, usableCandidateRecords } from "./stale-gps.js";
import { groupTrips, rederiveStartUtcForCandidates, tripAllCandidates, type VideoCandidate } from "./trips.js";
import { tripHasRawGps } from "./gps-sync.js";

const NAME_START = Date.UTC(2026, 8, 26, 16, 8, 50) / 1000;
const ZONE = 19800;
const STALE_TIME = Date.UTC(2026, 8, 26, 9, 56, 50) / 1000;

function record(time: number): GpsRecord {
    return {
        unixSeconds: time,
        active: true,
        lat: 10,
        lon: 70,
        speedMs: 0,
        bearingDeg: 0,
        accelXg: 0,
        accelYg: 0,
        accelZg: 0,
        mp4Filename: "",
    };
}

function clip(index: number, channel: "F" | "I" | "R" = "F", isStale = true): VideoCandidate {
    const naive = NAME_START + index * 180;
    const iso = new Date(naive * 1000).toISOString();
    const name = `${iso.slice(0, 10).replaceAll("-", "")}_${iso.slice(11, 19).replaceAll(":", "")}${channel}.MP4`;
    const folder = { F: "Front", I: "Inside", R: "Rear" }[channel];
    const file = {
        file: new File([], name, { lastModified: 0 }),
        relativePath: `card/Video_${folder}/${name}`,
        sourceKey: "card",
    };
    const candidate = buildProvisionalCandidate({
        file,
        fingerprint: cameraFingerprint(file),
        startUtc: STALE_TIME,
        startSource: "gps",
        cameraTzSec: null,
        durationSec: 180,
        appliedExtractors: ["freegps"],
        records: isStale ? [record(STALE_TIME)] : [record(naive - ZONE + 3), record(naive - ZONE + 179)],
    });
    candidate.createdUtc = new Date((naive + 180) * 1000);
    candidate.metadataReady = true;
    return candidate;
}

function frameNames(candidates: VideoCandidate[]): string[][] {
    return groupTrips(candidates)
        .flatMap((trip) =>
            trip.frames.map((frame) =>
                Object.values(frame.channels)
                    .map((candidate) => candidate.file.name)
                    .sort(),
            ),
        )
        .sort((a, b) => a[0]!.localeCompare(b[0]!));
}

describe("colliding recording clocks", () => {
    it("pairs exact sibling recordings despite reordered and missing channels", () => {
        const candidates = [
            clip(0),
            clip(1),
            clip(2),
            clip(2, "I"),
            clip(0, "I"),
            clip(1, "I"),
            clip(2, "R"),
            clip(0, "R"),
        ];
        const expected = [
            [clip(0), clip(0, "I"), clip(0, "R")],
            [clip(1), clip(1, "I")],
            [clip(2), clip(2, "I"), clip(2, "R")],
        ].map((group) => group.map((candidate) => candidate.file.name).sort());
        expect(frameNames(candidates)).toEqual(expected);
        expect(frameNames([...candidates].reverse())).toEqual(expected);
        expect(frameNames(groupTrips(candidates).flatMap(tripAllCandidates))).toEqual(expected);
    });

    it("does not pair different named recordings when only one file per channel remains", () => {
        const candidates = [clip(0), clip(1, "I")];
        candidates[1]!.startUtc += 0.5;
        expect(groupTrips(candidates)).toHaveLength(2);
        expect(frameNames(candidates).every((names) => names.length === 1)).toBe(true);
    });

    it("protects sibling matching across the snap boundary", () => {
        const candidates = [clip(0), clip(1), clip(1, "I"), clip(0, "I")];
        for (const candidate of candidates) candidate.startUtc = candidate.channel === "front" ? 1004.8 : 1005.2;
        expect(frameNames(candidates)).toEqual([
            [clip(0).file.name, clip(0, "I").file.name],
            [clip(1).file.name, clip(1, "I").file.name],
        ]);
    });

    it("keeps different recordings separate across the snap boundary", () => {
        const candidates = [clip(0), clip(1, "I")];
        candidates[0]!.startUtc = 1004.8;
        candidates[1]!.startUtc = 1005.2;
        const expected = candidates.map((candidate) => [candidate.file.name]);
        expect(groupTrips(candidates)).toHaveLength(2);
        expect(frameNames(candidates)).toEqual(expected);
        expect(frameNames([...candidates].reverse())).toEqual(expected);
        expect(frameNames(groupTrips(candidates).flatMap(tripAllCandidates))).toEqual(expected);
    });

    it("keeps sequential recordings together outside the boundary rescue window", () => {
        const candidates = [clip(0), clip(0, "I"), clip(1), clip(1, "I")];
        for (const [i, candidate] of candidates.entries()) {
            candidate.startUtc = i < 2 ? 1000 : 1040;
            candidate.durationSec = 40;
        }
        const trips = groupTrips(candidates);
        expect(trips).toHaveLength(1);
        expect(trips[0]!.frames).toHaveLength(2);
        expect(trips[0]!.frames.every((frame) => Object.keys(frame.channels).length === 2)).toBe(true);
    });

    it("keeps ambiguous unnamed clips separate through interval normalization", () => {
        const candidates = [clip(0), clip(1), clip(0, "I")];
        candidates.forEach((candidate, i) => {
            candidate.file = new File([], `clip-${i}.mp4`);
        });
        candidates[2]!.durationSec = 60;
        expect(groupTrips(candidates)).toHaveLength(3);
        expect(frameNames(candidates).every((names) => names.length === 1)).toBe(true);
    });

    it("does not choose between duplicate versions of a sibling recording", () => {
        const candidates = [clip(0), clip(0), clip(0, "I")];
        expect(frameNames(candidates).every((names) => names.length === 1)).toBe(true);
    });

    it("keeps identical recording names from different sources apart", () => {
        const candidates = [clip(0), clip(1), clip(0, "I"), clip(1, "I")];
        candidates[2]!.sourceKey = "other";
        candidates[3]!.sourceKey = "other";
        expect(frameNames(candidates).every((names) => names.length === 1)).toBe(true);
    });

    it("requires the synchronized filename shape for a sibling identity", () => {
        const candidate = clip(0);
        expect(classifyFilenameRecordingKey(candidate)).toBe("20260926_160850");
        candidate.file = new File([], "20260926_160850.MP4");
        expect(classifyFilenameRecordingKey(candidate)).toBeNull();
        candidate.file = new File([], "arbitraryF.MP4");
        expect(classifyFilenameRecordingKey(candidate)).toBeNull();
    });
});

describe("repeated GPS clock recovery", () => {
    it("recovers incomplete sibling channels using their confirmed recording twins", () => {
        const candidates = [
            clip(0),
            clip(1),
            clip(2),
            clip(0, "I"),
            clip(2, "R"),
            clip(3, "F", false),
            clip(4, "F", false),
        ];
        rederiveStartUtcForCandidates(candidates, classifyFilenameTime);
        expect(candidates.slice(0, 5).every((candidate) => candidate.hasStaleGps)).toBe(true);
        expect(candidates[3]!.startUtc).toBe(candidates[0]!.startUtc);
        expect(candidates[4]!.startUtc).toBe(candidates[2]!.startUtc);
        expect(groupTrips(candidates)).toHaveLength(1);
    });

    it("recovers filenames from healthy recordings and withholds stale fixes without altering them", () => {
        const stale = [clip(0), clip(1), clip(2)];
        const raw = stale.map((candidate) => structuredClone(candidate.records));
        const healthy = [clip(3, "F", false), clip(4, "F", false)];
        const candidates = [...stale, ...healthy];
        rederiveStartUtcForCandidates(candidates, classifyFilenameTime);
        for (const [i, candidate] of stale.entries()) {
            expect(candidate.hasStaleGps).toBe(true);
            expect(candidate.startUtc, candidate.file.name).toBe(NAME_START + i * 180 - ZONE);
            expect(candidate.startSource).toBe("name");
            expect(candidate.hasUncalibratedClock).toBe(false);
            expect(candidate.cameraTzSec).toBe(ZONE);
            expect(candidate.records).toEqual(raw[i]);
        }
        expect(healthy.every((candidate) => !candidate.hasStaleGps)).toBe(true);
        const trips = groupTrips(candidates);
        expect(trips).toHaveLength(1);
        expect(trips[0]!.records).toHaveLength(4);
        expect(trips[0]!.records.every((point) => point.unixSeconds !== STALE_TIME)).toBe(true);
        rederiveStartUtcForCandidates([...candidates].reverse(), classifyFilenameTime);
        expect(groupTrips(candidates)).toEqual(trips);
        expect(stale.map((candidate) => candidate.records)).toEqual(raw);
    });

    it("uses the local filename clock without claiming UTC calibration when no healthy run exists", () => {
        const candidates = [clip(0), clip(1), clip(2)];
        rederiveStartUtcForCandidates(candidates, classifyFilenameTime);
        expect(candidates.map((candidate) => candidate.startUtc)).toEqual([
            NAME_START,
            NAME_START + 180,
            NAME_START + 360,
        ]);
        expect(candidates.every((candidate) => candidate.hasUncalibratedClock && candidate.cameraTzSec === null)).toBe(
            true,
        );
        const trip = groupTrips(candidates)[0]!;
        expect(trip.records).toEqual([]);
        expect(tripHasRawGps(trip)).toBe(false);
    });

    it("does not count simultaneous healthy channels as independent clock calibration", () => {
        const candidates = [clip(0), clip(1), clip(2), clip(3, "F", false), clip(3, "I", false), clip(3, "R", false)];
        rederiveStartUtcForCandidates(candidates, classifyFilenameTime);
        expect(candidates.slice(0, 3).every((candidate) => candidate.hasUncalibratedClock)).toBe(true);
    });

    it("does not borrow healthy clocks from another source or beyond the inheritance window", () => {
        for (const otherSource of [true, false]) {
            const stale = [clip(0), clip(1), clip(2)];
            const healthy = [clip(otherSource ? 3 : 2000, "F", false), clip(otherSource ? 4 : 2001, "F", false)];
            if (otherSource) for (const candidate of healthy) candidate.sourceKey = "other";
            rederiveStartUtcForCandidates([...stale, ...healthy], classifyFilenameTime);
            expect(stale.every((candidate) => candidate.hasUncalibratedClock)).toBe(true);
        }
    });

    it("rejects a nearby calibration run whose recording clocks disagree", () => {
        const stale = [clip(0), clip(1), clip(2)];
        const healthy = [clip(3, "F", false), clip(4, "F", false)];
        for (const point of healthy[1]!.records) point.unixSeconds -= 900;
        rederiveStartUtcForCandidates([...stale, ...healthy], classifyFilenameTime);
        expect(stale.every((candidate) => candidate.hasUncalibratedClock)).toBe(true);
    });

    it("recomputes the verdict when GPS is replaced and permits an attached external track", () => {
        const candidates = [clip(0), clip(1), clip(2)];
        rederiveStartUtcForCandidates(candidates, classifyFilenameTime);
        candidates[0]!.records = [record(NAME_START - ZONE), record(NAME_START - ZONE + 179)];
        candidates[1]!.records = [{ ...record(NAME_START - ZONE + 180), externalTrack: true }];
        expect(usableCandidateRecords(candidates[1]!)).toEqual(candidates[1]!.records);
        rederiveStartUtcForCandidates(candidates, classifyFilenameTime);
        expect(candidates.every((candidate) => !candidate.hasStaleGps && !candidate.hasUncalibratedClock)).toBe(true);
    });

    it("preserves recovered clocks and external tracks when GPX is added to stale GPS", () => {
        const candidates = [clip(0), clip(1), clip(2)];
        rederiveStartUtcForCandidates(candidates, classifyFilenameTime);
        const starts = candidates.map((candidate) => candidate.startUtc);
        const raw = candidates.map((candidate) => structuredClone(candidate.records));
        const external = [
            { ...record(STALE_TIME - 1), externalTrack: true },
            { ...record(NAME_START), externalTrack: true },
            { ...record(NAME_START + 500), externalTrack: true },
        ];
        candidates[0]!.records = [...external.slice(0, 1), ...candidates[0]!.records, ...external.slice(1)];

        rederiveStartUtcForCandidates(candidates, classifyFilenameTime);
        expect(candidates.every((candidate) => candidate.hasStaleGps && candidate.hasUncalibratedClock)).toBe(true);
        expect(candidates.map((candidate) => candidate.startUtc)).toEqual(starts);
        expect(candidates.map((candidate) => candidate.records.filter((point) => !point.externalTrack))).toEqual(raw);
        expect(candidates.flatMap(usableCandidateRecords)).toEqual(external);
        const trips = groupTrips(candidates);
        expect(trips).toHaveLength(1);
        expect(trips[0]!.records).toEqual(external);
        expect(tripHasRawGps(trips[0]!)).toBe(true);
        rederiveStartUtcForCandidates([...candidates].reverse(), classifyFilenameTime);
        expect(groupTrips(candidates)).toEqual(trips);
    });

    it("recognizes raw duplicate fixes and both container timestamp conventions", () => {
        const candidates = [clip(0), clip(1), clip(2)];
        for (const candidate of candidates) {
            candidate.records.push({ ...candidate.records[0]! });
            candidate.createdUtc = new Date(candidate.createdUtc!.getTime() - 180000);
        }
        expect(findStaleGpsCandidates(candidates, classifyFilenameTime).size).toBe(3);
    });

    it.each([
        "single",
        "two",
        "siblings",
        "copies",
        "overlapping",
        "event",
        "timelapse",
        "pending",
        "container",
        "source",
        "progressing",
        "unsynced",
        "external",
    ])("does not infer a stale GPS clock from %s evidence", (kind) => {
        let candidates = [clip(0), clip(1), clip(2)];
        if (kind === "single") candidates = [clip(0)];
        if (kind === "two") candidates = [clip(0), clip(1)];
        if (kind === "siblings") candidates = [clip(0), clip(0, "I"), clip(0, "R")];
        if (kind === "copies") candidates = [clip(0), clip(0), clip(0)];
        for (const [i, candidate] of candidates.entries()) {
            if (kind === "overlapping") candidate.durationSec = 600;
            if (kind === "event") candidate.recordingMode = "event";
            if (kind === "timelapse") candidate.isTimelapse = true;
            if (kind === "pending") candidate.metadataReady = false;
            if (kind === "container") candidate.createdUtc = candidates[0]!.createdUtc;
            if (kind === "source") candidate.sourceKey = `source-${i}`;
            if (kind === "progressing") candidate.records.push(record(STALE_TIME + 1));
            if (kind === "unsynced") candidate.records[0]!.timeUnsynced = true;
            if (kind === "external") candidate.records[0]!.externalTrack = true;
        }
        expect(findStaleGpsCandidates(candidates, classifyFilenameTime).size).toBe(0);
    });
});
