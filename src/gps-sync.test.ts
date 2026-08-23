import { beforeEach, describe, expect, it, vi } from "vitest";

import {
    _resetForTests,
    applyStoredGpsSyncToTrip,
    getDefaultGpsOffsetSec,
    gpsOutsideVideoSec,
    resolvedGpsSyncForTrip,
    setDefaultGpsOffsetSec,
    setTripGpsOffsetSec,
    setTripGpsTrimToVideo,
} from "./gps-sync.js";
import type { GpsRecord } from "./parsers/types.js";
import { groupTrips, type Trip, type VideoCandidate } from "./trips.js";

const storage = new Map<string, string>();
vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
    clear: () => storage.clear(),
});

function record(unixSeconds: number, index: number): GpsRecord {
    return {
        unixSeconds,
        active: true,
        lat: 43.2 + index * 0.0001,
        lon: 76.9 + index * 0.0001,
        bearingDeg: 45,
        speedMs: 10,
        accelXg: 0,
        accelYg: 0,
        accelZg: 0,
        mp4Filename: "action.mp4",
    };
}

function candidate(records: GpsRecord[], lastModified = 1234): VideoCandidate {
    return {
        file: new File([new Uint8Array(32)], "action.mp4", { lastModified }),
        relativePath: "DCIM/action.mp4",
        fingerprint: "action-camera",
        appliedExtractors: ["gpx"],
        classifierMatches: { time: null, channel: null, mode: null, sequence: null },
        channel: null,
        channelConfident: false,
        sequence: null,
        recordingMode: "normal",
        isTimelapse: false,
        startUtc: 1000,
        durationSec: 20,
        wallDurationSec: null,
        driftLeadSec: null,
        startSource: "mp4",
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

function trip(lastModified = 1234): Trip {
    const records = [995, 1000, 1010, 1025].map(record);
    return groupTrips([candidate(records, lastModified)])[0]!;
}

beforeEach(() => {
    storage.clear();
    _resetForTests();
});

describe("GPS synchronization", () => {
    it("always shifts from immutable candidate records and restores points hidden by a previous trim", () => {
        const value = trip();
        const rawTimes = value.frames[0]!.channels.front!.records.map((item) => item.unixSeconds);

        setTripGpsOffsetSec(value, 5);
        applyStoredGpsSyncToTrip(value);
        expect(value.records.map((item) => item.unixSeconds)).toEqual([1000, 1005, 1015]);

        setTripGpsOffsetSec(value, -5);
        applyStoredGpsSyncToTrip(value);
        expect(value.records.map((item) => item.unixSeconds)).toEqual([1005, 1020]);
        expect(value.frames[0]!.channels.front!.records.map((item) => item.unixSeconds)).toEqual(rawTimes);
    });

    it("lets the user keep or hide GPS outside the footage window", () => {
        const value = trip();
        expect(gpsOutsideVideoSec(value, 0)).toBe(10);

        setTripGpsTrimToVideo(value, false);
        applyStoredGpsSyncToTrip(value);
        expect(value.records.map((item) => item.unixSeconds)).toEqual([995, 1000, 1010, 1025]);

        setTripGpsTrimToVideo(value, true);
        applyStoredGpsSyncToTrip(value);
        expect(value.records.map((item) => item.unixSeconds)).toEqual([1000, 1010]);
    });

    it("automatically aligns a wholly external track start before applying the user's fine offset", () => {
        const rawStart = 1_800_000_000;
        const external = [rawStart, rawStart + 10, rawStart + 25].map((time, index) => ({
            ...record(time, index),
            externalTrack: true,
        }));
        const value = groupTrips([candidate(external)])[0]!;

        applyStoredGpsSyncToTrip(value);
        expect(value.gpsOffsetSec).toBe(0);
        expect(value.gpsBaseOffsetSec).toBe(1000 - rawStart);
        expect(value.records.map((item) => item.unixSeconds)).toEqual([1000, 1010]);

        setTripGpsOffsetSec(value, 3);
        applyStoredGpsSyncToTrip(value);
        expect(value.records.map((item) => item.unixSeconds)).toEqual([1003, 1013]);
        expect(external[0]!.unixSeconds).toBe(rawStart);
    });

    it("keeps one external track synchronized across consecutive action-camera clips", () => {
        const rawStart = 1_800_000_000;
        const external = [0, 10, 25, 35, 45].map((delta, index) => ({
            ...record(rawStart + delta, index),
            externalTrack: true,
        }));
        const first = candidate(external);
        const second = candidate([], 5678);
        second.file = new File([new Uint8Array(32)], "action-2.mp4", { lastModified: 5678 });
        second.relativePath = "DCIM/action-2.mp4";
        second.startUtc = 1020;

        const value = groupTrips([first, second])[0]!;
        expect(value.frames).toHaveLength(2);
        applyStoredGpsSyncToTrip(value);

        // The GPX is associated with the first file but belongs to the whole
        // derived trip; trimming uses both footage spans and drops only the
        // point beyond the second clip.
        expect(value.records.map((item) => item.unixSeconds)).toEqual([1000, 1010, 1025, 1035]);
    });

    it("persists an explicit zero per trip so it can override a non-zero player default", () => {
        setDefaultGpsOffsetSec(12);
        expect(getDefaultGpsOffsetSec()).toBe(12);

        const firstLoad = trip();
        setTripGpsOffsetSec(firstLoad, 0);
        applyStoredGpsSyncToTrip(firstLoad);
        expect(firstLoad.gpsOffsetSec).toBe(0);
        expect(resolvedGpsSyncForTrip(firstLoad).hasOffsetOverride).toBe(true);

        // Fresh Trip and File objects with the same stable identity simulate a
        // later folder re-open; the per-trip override must survive it.
        const reopened = trip();
        applyStoredGpsSyncToTrip(reopened);
        expect(reopened.gpsOffsetSec).toBe(0);

        setTripGpsOffsetSec(reopened, null);
        applyStoredGpsSyncToTrip(reopened);
        expect(reopened.gpsOffsetSec).toBe(12);
        expect(resolvedGpsSyncForTrip(reopened).hasOffsetOverride).toBe(false);
    });
});
