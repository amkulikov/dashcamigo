import { describe, expect, it } from "vitest";

import { associateRecordsWithVideos, recordsForVideo, resolveVideoKey } from "./gps-association.js";
import { mergeIntoGpsLog, rebuildLog } from "./parser.js";
import type { GpsRecord, VendorFile } from "./parsers/types.js";
import { vendorFileKey } from "./vendor-file-key.js";

function video(path: string, sourceKey: string): VendorFile {
    return {
        file: new File([sourceKey], path.split("/").pop()!, { lastModified: 1 }),
        relativePath: path,
        sourceKey,
    };
}

function record(lat: number): GpsRecord {
    return {
        unixSeconds: 100,
        active: true,
        lat,
        lon: 20,
        bearingDeg: 0,
        speedMs: 0,
        accelXg: 0,
        accelYg: 0,
        accelZg: 0,
        mp4Filename: "clip.mp4",
    };
}

describe("GPS video association", () => {
    it("resolves an external source to the matching source scope", () => {
        const a = video("CARD/DCIM/clip.mp4", "card-a");
        const b = video("CARD/DCIM/clip.mp4", "card-b");
        const sidecar = video("CARD/DCIM/clip.gpx", "card-b");
        expect(resolveVideoKey(sidecar, "clip.mp4", [a, b])).toBe(vendorFileKey(b));
    });

    it("uses directory proximity when a later sidecar drop has a new scope", () => {
        const a = video("A/DCIM/clip.mp4", "old-a");
        const b = video("B/DCIM/clip.mp4", "old-b");
        const sidecar = video("B/DCIM/clip.gpx", "late-drop");
        expect(resolveVideoKey(sidecar, "clip.mp4", [a, b])).toBe(vendorFileKey(b));
    });

    it("keeps an unresolved basename unowned instead of guessing", () => {
        const a = video("A/clip.mp4", "card-a");
        const b = video("B/clip.mp4", "card-b");
        const source = video("logs/GPSData.txt", "third-source");
        const rec = record(10);
        associateRecordsWithVideos([rec], source, [a, b]);
        expect(rec.videoKey).toBeUndefined();

        const log = rebuildLog([], [rec], []);
        expect(recordsForVideo(log, a, [a, b])).toEqual([]);
        expect(recordsForVideo(log, b, [a, b])).toEqual([]);
    });

    it("keeps equal basename/time/position records separate by concrete video", () => {
        const a = video("A/clip.mp4", "card-a");
        const b = video("B/clip.mp4", "card-b");
        const aRecord = { ...record(10), videoKey: vendorFileKey(a) };
        const bRecord = { ...record(10), videoKey: vendorFileKey(b) };
        const log = mergeIntoGpsLog(null, { records: [aRecord, bRecord], skipped: [], appliedExtractors: [] });

        expect(log.records).toHaveLength(2);
        expect(recordsForVideo(log, a, [a, b])).toEqual([aRecord]);
        expect(recordsForVideo(log, b, [a, b])).toEqual([bRecord]);
    });

    it("stabilizes stationary bearings independently for equal basenames", () => {
        const a = video("A/clip.mp4", "card-a");
        const b = video("B/clip.mp4", "card-b");
        const aMoving = { ...record(10), unixSeconds: 100, speedMs: 5, bearingDeg: 90, videoKey: vendorFileKey(a) };
        const bStopped = {
            ...record(20),
            unixSeconds: 101,
            speedMs: 0,
            bearingDeg: 210,
            videoKey: vendorFileKey(b),
        };
        const aStopped = {
            ...record(11),
            unixSeconds: 102,
            speedMs: 0,
            bearingDeg: 0,
            videoKey: vendorFileKey(a),
        };

        mergeIntoGpsLog(null, { records: [aMoving, bStopped, aStopped], skipped: [], appliedExtractors: [] });

        expect(aStopped.bearingDeg).toBe(90);
        expect(bStopped.bearingDeg).toBe(210);
    });

    it("keeps a concrete-owner bucket sorted for binary-search consumers", () => {
        const a = video("A/clip.mp4", "card-a");
        const key = vendorFileKey(a);
        const late = { ...record(11), unixSeconds: 200, videoKey: key };
        const early = { ...record(10), unixSeconds: 100, videoKey: key };

        const log = rebuildLog([], [late, early], []);

        expect(log.byVideoKey.get(key)?.map((item) => item.unixSeconds)).toEqual([100, 200]);
    });
});
