// Regression test for a real recording-scoped NMEA log. Coordinates are
// rounded to whole degrees and every section is trimmed by
// scripts/anonymize-sectioned-nmea-log.mjs; timestamps, speeds, headers, and
// section boundaries stay representative of the camera output.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { bindRecordsByRecordingStart } from "../../../gps-association.js";
import { mergeIntoGpsLog } from "../../../parser.js";
import type { VideoCandidate } from "../../../trips.js";
import { sectionedNmeaLogPrimitive } from "../../primitives/sectioned-nmea-log.js";
import type { VendorFile } from "../../types.js";
import { expectPlausibleGpsTrack } from "../helpers.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE_KEY = "real-sectioned-nmea-card";
const RECORDINGS = [
    ["MAH00384.MP4", "2026-08-23T07:54:02.000Z"],
    ["MAH00385.MP4", "2026-08-23T08:16:45.000Z"],
    ["MAH00386.MP4", "2026-08-23T08:39:28.000Z"],
    ["MAH00387.MP4", "2026-08-23T09:02:12.000Z"],
] as const;

function loadFixture(): VendorFile {
    const content = readFileSync(resolve(HERE, "real-anonymized.LOG"));
    return {
        file: new File([content], "26082300.LOG"),
        relativePath: "PRIVATE/SONY/GPS/26082300.LOG",
        sourceKey: SOURCE_KEY,
    };
}

function candidate(name: string, isoStart: string): VideoCandidate {
    const createdUtc = new Date(isoStart);
    return {
        file: new File([new Uint8Array(16)], name),
        relativePath: `MP_ROOT/100ANV01/${name}`,
        sourceKey: SOURCE_KEY,
        fingerprint: "sectioned-nmea-camera",
        appliedExtractors: [],
        classifierMatches: { time: null, channel: null, mode: null, sequence: "sectioned-nmea-sequence" },
        channel: null,
        channelConfident: false,
        sequence: Number(name.slice(3, 8)),
        recordingMode: null,
        isTimelapse: false,
        startUtc: createdUtc.getTime() / 1000,
        durationSec: 60,
        wallDurationSec: null,
        driftLeadSec: null,
        startSource: "mp4",
        cameraTzSec: null,
        createdUtc,
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

describe("real-anonymized recording-scoped NMEA log", () => {
    it("parses four sections and binds each one to the MP4 with the same creation time", async () => {
        const parsed = await sectionedNmeaLogPrimitive.parse(loadFixture());
        expectPlausibleGpsTrack(parsed.records, { minCount: 48 });
        expect(parsed.records).toHaveLength(48);
        expect(parsed.skipped).toEqual([]);
        expect(parsed.records.every((record) => Number.isInteger(record.lat) && Number.isInteger(record.lon))).toBe(
            true,
        );
        expect(parsed.records.some((record) => record.speedMs > 0)).toBe(true);

        const starts = new Set(parsed.records.map((record) => record.recordingAssociation?.startUtc));
        expect(starts).toEqual(new Set(RECORDINGS.map(([, iso]) => new Date(iso).getTime() / 1000)));
        const firstStart = new Date(RECORDINGS[0][1]).getTime() / 1000;
        const firstFix = Math.min(
            ...parsed.records
                .filter((record) => record.recordingAssociation?.startUtc === firstStart)
                .map((record) => record.unixSeconds),
        );
        expect(firstFix - firstStart).toBeGreaterThan(100);

        const log = mergeIntoGpsLog(null, {
            records: parsed.records,
            skipped: parsed.skipped,
            appliedExtractors: [sectionedNmeaLogPrimitive.id],
        });
        const candidates = RECORDINGS.map(([name, iso]) => candidate(name, iso));
        const bound = bindRecordsByRecordingStart(log, candidates);

        expect(bound.boundRecords).toBe(48);
        expect(bound.boundVideos).toBe(4);
        expect(bound.log.byFilename.size).toBe(4);
        for (const [name] of RECORDINGS) {
            expect(bound.log.byFilename.get(name)).toHaveLength(12);
        }
        expect(bound.log.records.every((record) => record.videoKey !== undefined)).toBe(true);
        expect(bound.log.records.every((record) => record.recordingAssociation === undefined)).toBe(true);
        expect(candidates.every((item) => item.appliedExtractors.includes(sectionedNmeaLogPrimitive.id))).toBe(true);
    });
});
