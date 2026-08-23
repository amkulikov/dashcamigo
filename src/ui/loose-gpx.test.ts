import { describe, expect, it } from "vitest";

import { firstSyncedRecord, lastSyncedRecord } from "../parser.js";
import type { ClassifiedFile } from "../parsers/registry-light.js";
import type { GpsRecord } from "../parsers/types.js";
import type { Trip } from "../trips.js";

import { looseGpxTarget, pairLooseGpxFiles } from "./loose-gpx.js";

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
    });

    it("reclassifies only loose GPX files and marks the association as external", () => {
        const files = [classified("route.gpx", "unknown"), classified("notes.txt", "unknown")];
        expect(pairLooseGpxFiles(files, { mp4Filename: "action.mp4", videoKey: "exact-video" })).toEqual({
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
