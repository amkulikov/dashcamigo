import { describe, expect, it } from "vitest";

import {
    associateRecordsWithVideos,
    bindRecordsByRecordingStart,
    recordsForVideo,
    resolveVideoKey,
} from "./gps-association.js";
import { mergeIntoGpsLog, rebuildLog } from "./parser.js";
import type { GpsRecord, VendorFile } from "./parsers/types.js";
import type { VideoCandidate } from "./trips.js";
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

function recordingCandidate(path: string, sourceKey: string, startUtc: number): VideoCandidate {
    const vf = video(path, sourceKey);
    return {
        ...vf,
        fingerprint: "recording-scoped-log",
        appliedExtractors: [],
        classifierMatches: { time: null, channel: null, mode: null, sequence: null },
        channel: null,
        channelConfident: false,
        sequence: null,
        recordingMode: null,
        isTimelapse: false,
        startUtc,
        durationSec: 60,
        wallDurationSec: null,
        driftLeadSec: null,
        startSource: "mp4",
        cameraTzSec: null,
        createdUtc: new Date(startUtc * 1000),
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

function recordingRecord(startUtc: number, sourceKey?: string): GpsRecord {
    return {
        ...record(10),
        mp4Filename: `[pending:${startUtc}]`,
        recordingAssociation: {
            startUtc,
            extractorId: "sectioned-nmea-log",
            ...(sourceKey === undefined ? {} : { sourceKey }),
        },
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

    it("binds a recording-scoped section to the unique matching creation time", () => {
        const startUtc = 1_777_777_777;
        const rec = recordingRecord(startUtc, "card-a");
        const candidate = recordingCandidate("MP_ROOT/100ANV01/MAH00384.MP4", "card-a", startUtc + 0.8);
        const log = rebuildLog(["sectioned-nmea-log"], [rec], []);

        const result = bindRecordsByRecordingStart(log, [candidate]);

        expect(result.boundRecords).toBe(1);
        expect(result.boundVideos).toBe(1);
        expect(rec.mp4Filename).toBe("MAH00384.MP4");
        expect(rec.videoKey).toBe(vendorFileKey(candidate));
        expect(rec.recordingAssociation).toBeUndefined();
        expect(candidate.appliedExtractors).toEqual(["sectioned-nmea-log"]);
    });

    it("prefers the matching source scope when two cards contain the same start time", () => {
        const startUtc = 1_777_777_777;
        const a = recordingCandidate("MP_ROOT/100ANV01/MAH00001.MP4", "card-a", startUtc);
        const b = recordingCandidate("MP_ROOT/100ANV01/MAH00001.MP4", "card-b", startUtc);
        const rec = recordingRecord(startUtc, "card-b");

        const result = bindRecordsByRecordingStart(rebuildLog([], [rec], []), [a, b]);

        expect(result.boundRecords).toBe(1);
        expect(rec.videoKey).toBe(vendorFileKey(b));
        expect(a.appliedExtractors).toEqual([]);
        expect(b.appliedExtractors).toEqual(["sectioned-nmea-log"]);
    });

    it("uses a unique cross-source start for a log added after its video", () => {
        const startUtc = 1_777_777_777;
        const candidate = recordingCandidate("MP_ROOT/100ANV01/MAH00001.MP4", "earlier-video-drop", startUtc);
        const rec = recordingRecord(startUtc, "later-log-drop");

        const result = bindRecordsByRecordingStart(rebuildLog([], [rec], []), [candidate]);

        expect(result.boundRecords).toBe(1);
        expect(rec.videoKey).toBe(vendorFileKey(candidate));
    });

    it("does not mix a late recording-scoped log into an explicitly assigned external track", () => {
        const startUtc = 1_777_777_777;
        const candidate = recordingCandidate("MP_ROOT/100ANV01/MAH00001.MP4", "card-a", startUtc);
        candidate.records = [{ ...record(startUtc), externalTrack: true }];
        const rec = recordingRecord(startUtc, "card-a");
        const log = rebuildLog(["sectioned-nmea-log"], [rec], []);

        const result = bindRecordsByRecordingStart(log, [candidate]);

        expect(result.boundRecords).toBe(0);
        expect(rec.recordingAssociation).toBeDefined();
        expect(rec.videoKey).toBeUndefined();
    });

    it("waits for a same-source candidate instead of binding to a ready clip from another card", () => {
        const startUtc = 1_777_777_777;
        const pendingSameSource = recordingCandidate("A/MAH00001.MP4", "card-a", startUtc);
        pendingSameSource.createdUtc = null;
        const readyOtherSource = recordingCandidate("B/MAH00001.MP4", "card-b", startUtc);
        const rec = recordingRecord(startUtc, "card-a");

        const result = bindRecordsByRecordingStart(rebuildLog([], [rec], []), [pendingSameSource, readyOtherSource]);

        expect(result.boundRecords).toBe(0);
        expect(rec.recordingAssociation).toBeDefined();
        expect(readyOtherSource.appliedExtractors).toEqual([]);
    });

    it("leaves an ambiguous recording start unbound instead of guessing", () => {
        const startUtc = 1_777_777_777;
        const a = recordingCandidate("A/MAH00001.MP4", "card-a", startUtc);
        const b = recordingCandidate("B/MAH00001.MP4", "card-b", startUtc);
        const rec = recordingRecord(startUtc);
        const log = rebuildLog([], [rec], []);

        const result = bindRecordsByRecordingStart(log, [a, b]);

        expect(result).toEqual({ log, boundRecords: 0, boundVideos: 0 });
        expect(rec.mp4Filename).toBe(`[pending:${startUtc}]`);
        expect(rec.videoKey).toBeUndefined();
        expect(rec.recordingAssociation).toBeDefined();
    });

    it("leaves a bucket with conflicting recording hints unbound", () => {
        const first = recordingRecord(1_777_777_777, "card-a");
        const second = recordingRecord(1_777_777_900, "card-a");
        second.mp4Filename = first.mp4Filename;
        const candidates = [
            recordingCandidate("A/MAH00001.MP4", "card-a", 1_777_777_777),
            recordingCandidate("A/MAH00002.MP4", "card-a", 1_777_777_900),
        ];
        const log = rebuildLog([], [first, second], []);

        const result = bindRecordsByRecordingStart(log, candidates);

        expect(result.boundRecords).toBe(0);
        expect(first.recordingAssociation).toBeDefined();
        expect(second.recordingAssociation).toBeDefined();
    });
});
