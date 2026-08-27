import { describe, expect, it } from "vitest";

import { firstSyncedRecord, lastSyncedRecord } from "../parser.js";
import type { ClassifiedFile } from "../parsers/registry-light.js";
import type { GpsRecord } from "../parsers/types.js";
import { groupTrips, type StartSource, type VideoCandidate } from "../trips.js";

import { looseGpxTargets, planLooseGpxAssignments, recordsForLooseGpxAssignments } from "./loose-gpx-assignment.js";
import { looseGpxFiles, type ParsedLooseGpx } from "./loose-gpx.js";

function classified(name: string, role: ClassifiedFile["role"]): ClassifiedFile {
    return {
        file: { file: new File([], name, { lastModified: 1234 }), relativePath: name, sourceKey: "test" },
        role,
        sidecarId: role === "sidecar" ? "gpx" : null,
        sidecarMp4: role === "sidecar" ? name.replace(/\.gpx$/i, ".mp4") : null,
        logExtractorId: role === "gps-log" ? "fixture" : null,
    };
}

function gps(unixSeconds: number, lat = 43.2): GpsRecord {
    return {
        unixSeconds,
        active: true,
        lat,
        lon: 76.9,
        bearingDeg: 0,
        speedMs: 0,
        accelXg: 0,
        accelYg: 0,
        accelZg: 0,
        mp4Filename: "source.gpx",
    };
}

function candidate(
    name: string,
    startUtc: number,
    records: GpsRecord[] = [],
    startSource: StartSource = "mp4",
): VideoCandidate {
    return {
        file: new File([], name, { lastModified: 1234 }),
        relativePath: `CARD/${name}`,
        sourceKey: "test",
        fingerprint: "camera",
        appliedExtractors: [],
        classifierMatches: { time: null, channel: null, mode: null, sequence: null },
        channel: null,
        channelConfident: false,
        sequence: null,
        recordingMode: "normal",
        isTimelapse: false,
        startUtc,
        durationSec: 10,
        wallDurationSec: null,
        driftLeadSec: null,
        startSource,
        cameraTzSec: null,
        createdUtc: null,
        records,
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
        localClockOffsetHintSec: null,
    };
}

function track(name: string, ranges: Array<{ startUnix: number; endUnix: number }>, explicit = true): ParsedLooseGpx {
    return {
        file: classified(name, "unknown"),
        records: ranges.flatMap((range, index) => [gps(range.startUnix, 43 + index), gps(range.endUnix, 43 + index)]),
        timeRanges: ranges,
        hasExplicitTimezone: explicit,
        trackKey: `track:${name}`,
    };
}

describe("loose GPX association", () => {
    it("admits only unknown .gpx files after authoritative classifier paths", () => {
        const loose = classified("route.gpx", "unknown");
        const exact = classified("clip.gpx", "sidecar");
        const modelSpecific = classified("DDPAI.gpx", "sidecar");
        modelSpecific.sidecarId = "ddpai-gpx";
        const notes = classified("notes.txt", "unknown");
        expect(looseGpxFiles([loose, exact, modelSpecific, notes])).toEqual([loose]);
    });

    it("offers one target per trip, not one target per clip", () => {
        const trips = groupTrips([candidate("one.mp4", 1000), candidate("two.mp4", 1010)]);
        expect(trips).toHaveLength(1);
        const targets = looseGpxTargets(trips);
        expect(targets).toHaveLength(1);
        expect(targets[0]).toMatchObject({ mp4Filename: "one.mp4", hasGps: false });
        expect(targets[0]!.footageRanges).toEqual([
            { startUnix: 1000, endUnix: 1010 },
            { startUnix: 1010, endUnix: 1020 },
        ]);
    });

    it("protects the whole trip when any clip has GPS or a pending embedded source", () => {
        const withGps = groupTrips([candidate("one.mp4", 1000), candidate("two.mp4", 1010, [gps(1012)])]);
        expect(looseGpxTargets(withGps)[0]!.hasGps).toBe(true);

        const pending = groupTrips([candidate("pending.mp4", 2000)]);
        const key = looseGpxTargets(pending)[0]!.videoKey;
        expect(looseGpxTargets(pending, new Set([key]))[0]!.hasGps).toBe(true);
    });

    it("recommends a sole reliable timestamp overlap", () => {
        const trips = groupTrips([candidate("morning.mp4", 1000), candidate("evening.mp4", 5000)]);
        const plans = planLooseGpxAssignments(
            [track("route.gpx", [{ startUnix: 1002, endUnix: 1008 }])],
            looseGpxTargets(trips),
        );
        expect(plans[0]!.recommendedVideoKey).toBe(plans[0]!.choices[0]!.target.videoKey);
        expect(plans[0]!.choices[0]!.timeMatch).toBe("overlap");
    });

    it("does not recommend ambiguous overlaps or a segment gap", () => {
        const overlappingTrips = groupTrips(
            [candidate("a.mp4", 1000), candidate("b.mp4", 1005)].map((value, index) => ({
                ...value,
                fingerprint: `camera-${index}`,
            })),
        );
        const ambiguous = planLooseGpxAssignments(
            [track("ambiguous.gpx", [{ startUnix: 1006, endUnix: 1008 }])],
            looseGpxTargets(overlappingTrips),
        );
        expect(ambiguous[0]!.recommendedVideoKey).toBeNull();

        const splitTrack = track("split.gpx", [
            { startUnix: 900, endUnix: 950 },
            { startUnix: 1100, endUnix: 1150 },
        ]);
        const middleTrip = groupTrips([candidate("middle.mp4", 1000)]);
        const gap = planLooseGpxAssignments([splitTrack], looseGpxTargets(middleTrip));
        expect(gap[0]!.choices[0]!.timeMatch).toBe("none");
        expect(gap[0]!.recommendedVideoKey).toBeNull();
    });

    it("does not recommend timezone-less GPX or mtime-only video timing", () => {
        const reliableTrip = groupTrips([candidate("reliable.mp4", 1000)]);
        const zoneLess = planLooseGpxAssignments(
            [track("zone-less.gpx", [{ startUnix: 1001, endUnix: 1002 }], false)],
            looseGpxTargets(reliableTrip),
        );
        expect(zoneLess[0]!.choices[0]!.timeMatch).toBe("uncertain");
        expect(zoneLess[0]!.recommendedVideoKey).toBeNull();

        const mtimeTrip = groupTrips([candidate("mtime.mp4", 1000, [], "mtime")]);
        const unreliableVideo = planLooseGpxAssignments(
            [track("route.gpx", [{ startUnix: 1001, endUnix: 1002 }])],
            looseGpxTargets(mtimeTrip),
        );
        expect(unreliableVideo[0]!.choices[0]!.timeMatch).toBe("uncertain");
        expect(unreliableVideo[0]!.recommendedVideoKey).toBeNull();
    });

    it("requires mutual one-to-one ownership before recommending multiple tracks", () => {
        const trips = groupTrips([candidate("one.mp4", 1000), candidate("two.mp4", 5000)]);
        const plans = planLooseGpxAssignments(
            [
                track("first.gpx", [{ startUnix: 1001, endUnix: 1002 }]),
                track("second.gpx", [{ startUnix: 1003, endUnix: 1004 }]),
            ],
            looseGpxTargets(trips),
        );
        expect(plans.every((plan) => plan.recommendedVideoKey === null)).toBe(true);
    });

    it("stamps confirmed records as external with exact trip and source identities", () => {
        const destination = looseGpxTargets(groupTrips([candidate("action.mp4", 1000)]))[0]!;
        const source = track("route.gpx", [{ startUnix: 1001, endUnix: 1002 }]);
        const records = recordsForLooseGpxAssignments([{ track: source, target: destination }]);
        expect(records).toHaveLength(2);
        expect(records[0]).toMatchObject({
            mp4Filename: "action.mp4",
            videoKey: destination.videoKey,
            externalTrack: true,
            externalTrackKey: "track:route.gpx",
        });
        expect(firstSyncedRecord(records)).toBeNull();
        expect(lastSyncedRecord(records)).toBeNull();
    });
});
