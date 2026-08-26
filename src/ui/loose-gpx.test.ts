import { describe, expect, it } from "vitest";

import { firstSyncedRecord, lastSyncedRecord } from "../parser.js";
import type { ClassifiedFile } from "../parsers/registry-light.js";
import type { GpsRecord } from "../parsers/types.js";
import type { Trip } from "../trips.js";

import { looseGpxFiles, looseGpxTarget, pairLooseGpxFiles } from "./loose-gpx.js";
import { looseGpxTargets, pairAssignedLooseGpxFiles } from "./loose-gpx-assignment.js";

function classified(name: string, role: ClassifiedFile["role"]): ClassifiedFile {
    return {
        file: { file: new File([], name), relativePath: name },
        role,
        sidecarId: null,
        sidecarMp4: null,
        logExtractorId: null,
    };
}

function tripWithFilename(name: string, sourceKey = "source"): Trip {
    return {
        frames: [
            {
                startUtc: 1000,
                durationSec: 10,
                wallDurationSec: 10,
                channels: {
                    front: {
                        file: new File([], name, { lastModified: 1234 }),
                        relativePath: `${sourceKey}/${name}`,
                        sourceKey,
                    },
                },
            },
        ],
    } as unknown as Trip;
}

function tripWithFrames(names: string[], sourceKey = "source", gpsFrame = -1): Trip {
    return {
        frames: names.map((name, index) => ({
            startUtc: 1000 + index * 10,
            durationSec: 10,
            wallDurationSec: 10,
            channels: {
                front: {
                    file: new File([], name, { lastModified: 1234 + index }),
                    relativePath: `${sourceKey}/${name}`,
                    sourceKey,
                    records:
                        index === gpsFrame
                            ? [
                                  {
                                      unixSeconds: 1000,
                                      active: true,
                                      lat: 1,
                                      lon: 2,
                                  },
                              ]
                            : [],
                },
            },
        })),
    } as unknown as Trip;
}

describe("loose GPX association", () => {
    it("targets a single new video, or the active trip on a later GPX-only drop", () => {
        expect(looseGpxTarget([classified("new.mp4", "video")], [], null)).toMatchObject({
            mp4Filename: "new.mp4",
        });

        const trips = [tripWithFilename("one.mp4"), tripWithFilename("two.mp4")];
        expect(looseGpxTarget([], trips, 1)).toMatchObject({ mp4Filename: "two.mp4" });
    });

    it("keeps the active trip exact when several recordings reuse the same basename", () => {
        const trips = [tripWithFilename("clip.mp4", "card-a"), tripWithFilename("clip.mp4", "card-b")];
        const first = looseGpxTarget([], trips, 0);
        const second = looseGpxTarget([], trips, 1);
        expect(first?.mp4Filename).toBe("clip.mp4");
        expect(second?.mp4Filename).toBe("clip.mp4");
        expect(first?.videoKey).not.toBe(second?.videoKey);
    });

    it("does not guess among several new videos or several unopened trips", () => {
        expect(looseGpxTarget([classified("one.mp4", "video"), classified("two.mp4", "video")], [], null)).toBeNull();
        expect(looseGpxTarget([], [tripWithFilename("one.mp4"), tripWithFilename("two.mp4")], null)).toBeNull();
        expect(looseGpxTarget([], [tripWithFrames(["one.mp4", "two.mp4"])], 0)).toBeNull();
    });

    it("reclassifies only loose GPX files and marks the association as external", () => {
        const files = [classified("route.gpx", "unknown"), classified("notes.txt", "unknown")];
        expect(
            pairLooseGpxFiles(files, {
                mp4Filename: "action.mp4",
                videoKey: "exact-video",
                label: "action.mp4",
                hasGps: false,
            }),
        ).toEqual({
            paired: 1,
            unassigned: 0,
        });
        expect(files[0]).toMatchObject({
            role: "sidecar",
            sidecarId: "gpx",
            sidecarMp4: "action.mp4",
            manualSidecarVideoKey: "exact-video",
        });
        expect(files[1]!.role).toBe("unknown");
    });

    it("offers one target per logical clip in the active trip and marks existing GPS", () => {
        const trips = [tripWithFrames(["old.mp4"]), tripWithFrames(["one.mp4", "two.mp4"], "active", 1)];
        expect(looseGpxTarget([], trips, 1)).toBeNull();
        const targets = looseGpxTargets([], trips, 1);
        expect(targets.map((target) => ({ label: target.label, hasGps: target.hasGps }))).toEqual([
            { label: "active/one.mp4", hasGps: false },
            { label: "active/two.mp4", hasGps: true },
        ]);
    });

    it("pairs each chosen GPX with its exact manual target and leaves skipped rows unknown", () => {
        const first = classified("tracks/one.gpx", "unknown");
        const second = classified("tracks/two.gpx", "unknown");
        const third = classified("tracks/three.gpx", "unknown");
        const files = [first, second, third];
        const targets = looseGpxTargets([classified("a.mp4", "video"), classified("b.mp4", "video")], [], null);

        expect(looseGpxFiles(files)).toEqual(files);
        expect(
            pairAssignedLooseGpxFiles(files, [
                { file: first, target: targets[0]! },
                { file: third, target: targets[1]! },
            ]),
        ).toEqual({ paired: 2, unassigned: 1 });
        expect(files[0]).toMatchObject({ sidecarMp4: "a.mp4", manualSidecarVideoKey: targets[0]!.videoKey });
        expect(files[1]!.role).toBe("unknown");
        expect(files[2]).toMatchObject({ sidecarMp4: "b.mp4", manualSidecarVideoKey: targets[1]!.videoKey });
    });

    it("enforces source and one-track-per-clip conflicts below the dialog layer", () => {
        const first = classified("one.gpx", "unknown");
        const second = classified("two.gpx", "unknown");
        const files = [first, second];
        const target = looseGpxTargets([classified("clip.mp4", "video")], [], null)[0]!;

        expect(
            pairAssignedLooseGpxFiles(files, [
                { file: first, target },
                { file: second, target },
            ]),
        ).toEqual({ paired: 1, unassigned: 1 });
        expect(files[0]!.role).toBe("sidecar");
        expect(files[1]!.role).toBe("unknown");

        const protectedFile = classified("protected.gpx", "unknown");
        expect(
            pairAssignedLooseGpxFiles([protectedFile], [{ file: protectedFile, target: { ...target, hasGps: true } }]),
        ).toEqual({ paired: 0, unassigned: 1 });
        expect(protectedFile.role).toBe("unknown");

        const automaticProtected = classified("automatic.gpx", "unknown");
        expect(pairLooseGpxFiles([automaticProtected], { ...target, hasGps: true })).toEqual({
            paired: 0,
            unassigned: 1,
        });
        expect(automaticProtected.role).toBe("unknown");
    });

    it("keeps an external track's valid timestamps out of video-clock derivation", () => {
        const external = {
            unixSeconds: 1_800_000_000,
            active: true,
            lat: 1,
            lon: 2,
            bearingDeg: 0,
            speedMs: 0,
            accelXg: 0,
            accelYg: 0,
            accelZg: 0,
            mp4Filename: "action.mp4",
            externalTrack: true,
        } satisfies GpsRecord;
        expect(firstSyncedRecord([external])).toBeNull();
        expect(lastSyncedRecord([external])).toBeNull();
    });
});
