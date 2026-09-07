import { describe, expect, it } from "vitest";

import type { GpsRecord } from "./parsers/types.js";
import { failedGpsFilesForTrip, hasUnfinishedRecognition, type GpsRecognitionState } from "./recognition-gps.js";
import { groupTrips } from "./trips.js";
import { buildProvisionalCandidate } from "./ui/ingest-candidate.js";
import { vendorFileKey } from "./vendor-file-key.js";

function recording(sourceKey = "card-a", channel: "front" | "rear" = "front") {
    return {
        ...buildProvisionalCandidate({
            file: {
                file: new File(["recording"], "clip.mp4", { lastModified: 1 }),
                relativePath: `${channel}/clip.mp4`,
                sourceKey,
            },
            fingerprint: "camera",
            startUtc: 100,
            startSource: "name",
            cameraTzSec: 0,
            durationSec: 60,
            records: [],
            appliedExtractors: [],
        }),
        channel,
        metadataReady: true,
        metadataFailed: false,
    };
}

function status(failedKeys: string[] = []): GpsRecognitionState {
    return {
        failedEmbeddedGps: new Set(failedKeys),
        pendingHeavyEmbeddedGps: new Map(),
        inflightEmbeddedGps: new Map(),
    };
}

function fix(): GpsRecord {
    return {
        unixSeconds: 100,
        active: true,
        lat: 10,
        lon: 20,
        bearingDeg: 0,
        speedMs: 0,
        accelXg: 0,
        accelYg: 0,
        accelZg: 0,
        mp4Filename: "clip.mp4",
    };
}

describe("GPS recognition invitations", () => {
    it("leaves ordinary recordings without GPS silent", () => {
        const trip = groupTrips([recording()])[0]!;
        expect(failedGpsFilesForTrip(trip, status())).toEqual([]);
    });

    it("offers help for a completed confirmed failure", () => {
        const file = recording();
        const key = vendorFileKey(file);
        expect(failedGpsFilesForTrip(groupTrips([file])[0]!, status([key]))).toEqual([key]);
    });

    it("does not inherit an identically named file's failure from another source", () => {
        const other = vendorFileKey(recording("card-b"));
        expect(failedGpsFilesForTrip(groupTrips([recording()])[0]!, status([other]))).toEqual([]);
    });

    it("waits for a deferred sibling even when another camera has failed", () => {
        const front = recording();
        const rear = recording("card-a", "rear");
        const recognition = {
            ...status([vendorFileKey(front)]),
            pendingHeavyEmbeddedGps: new Map([[vendorFileKey(rear), {}]]),
        };
        expect(failedGpsFilesForTrip(groupTrips([front, rear])[0]!, recognition)).toEqual([]);
    });

    it("allows a completed failed heavy scan to remain retryable", () => {
        const file = recording();
        const key = vendorFileKey(file);
        const recognition = { ...status([key]), pendingHeavyEmbeddedGps: new Map([[key, {}]]) };
        expect(failedGpsFilesForTrip(groupTrips([file])[0]!, recognition)).toEqual([key]);
        expect(
            failedGpsFilesForTrip(groupTrips([file])[0]!, { ...recognition, inflightEmbeddedGps: new Map([[key, 1]]) }),
        ).toEqual([]);
    });

    it("suppresses the invitation when a sibling camera supplies GPS", () => {
        const front = recording();
        const rear = { ...recording("card-a", "rear"), records: [fix()] };
        expect(failedGpsFilesForTrip(groupTrips([front, rear])[0]!, status([vendorFileKey(front)]))).toEqual([]);
    });

    it("suppresses the invitation when an external track supplies GPS", () => {
        const file = recording();
        const trip = groupTrips([file])[0]!;
        trip.records = [fix()];
        expect(failedGpsFilesForTrip(trip, status([vendorFileKey(file)]))).toEqual([]);
    });

    it("waits for mandatory metadata and excludes unreadable video", () => {
        const file = recording();
        expect(hasUnfinishedRecognition([{ ...file, metadataReady: false }], status())).toBe(true);
        expect(hasUnfinishedRecognition([{ ...file, metadataReady: undefined }], status())).toBe(true);
        expect(hasUnfinishedRecognition([{ ...file, metadataFailed: true }], status())).toBe(true);
        expect(hasUnfinishedRecognition([file], status())).toBe(false);
    });
});
