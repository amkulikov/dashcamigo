import { describe, expect, it } from "vitest";

import { groupTrips, tripAllCandidates, tripCandidatesByChannel } from "../../trips.js";
import { buildProvisionalCandidate } from "../../ui/ingest-candidate.js";
import { cameraFingerprint } from "../camera-fingerprint.js";
import type { VendorFile } from "../types.js";
import {
    classifyFilenameCameraKey,
    classifyFilenameTime,
    matchFilenameChannel,
    matchFilenameMode,
    matchFilenameSequence,
    matchFilenameTime,
} from "./index.js";

function fileAt(path: string): VendorFile {
    return { file: new File([], path.split("/").at(-1)!), relativePath: path };
}

describe("SEI double GPS card filenames", () => {
    it.each([
        ["ExteriorView", "front"],
        ["InternalView", "interior"],
        ["internalview", "interior"],
    ])("recognizes %s as %s", (folder, channel) => {
        const file = fileAt(`card/${folder}/260101/120001_123_091_D.mp4`);
        expect(matchFilenameChannel(file)).toEqual({
            matchedId: "sei-double-gps-channel",
            value: { channel, confident: true },
        });
        expect(matchFilenameTime(file)).toEqual({
            matchedId: "sei-double-gps-time",
            value: new Date(Date.UTC(2026, 0, 1, 12, 0, 1)),
        });
        expect(matchFilenameMode(file).value).toBeNull();
        expect(matchFilenameSequence(file).value).toBeNull();
    });

    it.each([
        "120001_123_091_D.mp4",
        "card/260101/120001_123_091_D.mp4",
        "card/OtherView/260101/120001_123_091_D.mp4",
        "card/InternalView/120001_123_091_D.mp4",
        "card/InternalView/260101/random.mp4",
    ])("keeps unmatched card layout %s unclassified", (path) => {
        const file = fileAt(path);
        expect(matchFilenameChannel(file).value).toBeNull();
        expect(matchFilenameTime(file).value).toBeNull();
        expect(classifyFilenameCameraKey(file)).toBeNull();
    });

    it.each(["card/InternalView/260231/120001_123_091_D.mp4", "card/ExteriorView/260101/250001_123_091_D.mp4"])(
        "rejects an impossible calendar clock in %s",
        (path) => {
            expect(matchFilenameTime(fileAt(path)).value).toBeNull();
        },
    );

    it("shares one identity across view folders, dates and recording suffixes", () => {
        const front = fileAt("card/ExteriorView/260101/235930_123_023_D.mp4");
        const interior = fileAt("card/InternalView/260102/000002_321_091_G.mp4");
        expect(cameraFingerprint(front)).toBe(cameraFingerprint(interior));
        expect(cameraFingerprint(front)).toBe("sei-double-gps|card|#_#_#.mp#");
    });

    it("preserves different camera roots including roots named after a view", () => {
        const roots = ["camera-a", "camera-b", "InternalView", "ExteriorView"];
        const keys = roots.map((root) => cameraFingerprint(fileAt(`${root}/ExteriorView/260101/120001_123_023_D.mp4`)));
        expect(new Set(keys).size).toBe(roots.length);
    });
});

function session(root: string, sourceKey = "card") {
    const base = Date.UTC(2026, 0, 1, 12);
    const spans: [string, number, number][] = [
        ["ExteriorView", 0, 24],
        ["ExteriorView", 24, 26],
        ["ExteriorView", 50, 24],
        ["ExteriorView", 74, 26],
        ["ExteriorView", 100, 24],
        ["ExteriorView", 124, 26],
        ["ExteriorView", 150, 24],
        ["ExteriorView", 174, 10],
        ["InternalView", 1, 92],
        ["InternalView", 93, 91],
    ];
    return spans.map(([view, offset, durationSec]) => {
        const time = new Date(base + offset * 1000).toISOString().slice(11, 19).replaceAll(":", "");
        const file = {
            ...fileAt(`${root}/${view}/260101/${time}_123_${String(durationSec - 1).padStart(3, "0")}_D.mp4`),
            sourceKey,
        };
        const candidate = buildProvisionalCandidate({
            file,
            fingerprint: cameraFingerprint(file),
            startUtc: classifyFilenameTime(file)!.getTime() / 1000,
            startSource: "name",
            cameraTzSec: 0,
            durationSec,
            records: [],
            appliedExtractors: [],
        });
        candidate.metadataReady = true;
        return candidate;
    });
}

describe("SEI double GPS card grouping", () => {
    it("joins short exterior clips and long interior clips on one continuous clock", () => {
        const files = session("camera-a");
        const trips = groupTrips(files);
        expect(trips).toHaveLength(1);
        const trip = trips[0]!;
        expect(trip.durationSec).toBe(184);
        expect(trip.timeline.contentDurationSec).toBe(184);
        expect(tripAllCandidates(trip)).toHaveLength(files.length);
        expect(tripCandidatesByChannel(trip, "front")).toHaveLength(8);
        expect(tripCandidatesByChannel(trip, "interior")).toHaveLength(2);
        expect(trip.confidentChannels).toEqual(new Set(["front", "interior"]));
    });

    it("keeps simultaneous recordings from separate camera roots separate", () => {
        const trips = groupTrips([...session("camera-a"), ...session("camera-b")]);
        expect(trips).toHaveLength(2);
        for (const trip of trips) {
            expect(tripAllCandidates(trip)).toHaveLength(10);
            expect(trip.timeline.contentDurationSec).toBe(184);
            expect(new Set(tripAllCandidates(trip).map((file) => file.relativePath.split("/")[0])).size).toBe(1);
        }
    });

    it("keeps identical card paths from separate sources separate", () => {
        const trips = groupTrips([...session("card", "source-a"), ...session("card", "source-b")]);
        expect(trips).toHaveLength(2);
        for (const trip of trips) {
            expect(tripAllCandidates(trip)).toHaveLength(10);
            expect(new Set(tripAllCandidates(trip).map((file) => file.sourceKey)).size).toBe(1);
        }
    });
});
