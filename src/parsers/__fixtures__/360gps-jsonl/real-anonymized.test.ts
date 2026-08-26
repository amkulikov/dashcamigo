// Regression test for a real 360GPSINFO whole-session log. Coordinates are
// rounded to whole degrees and the stream is trimmed by
// scripts/anonymize-360gps-jsonl-log.mjs; timing, speed, course, NUL padding
// and the footer stay representative of the camera output.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { associateRecordsWithVideos, buildVideoAssociationIndex, recordsForVideo } from "../../../gps-association.js";
import { rebuildLog } from "../../../parser.js";
import { threeSixtyGpsJsonlPrimitive } from "../../primitives/360gps-jsonl.js";
import type { VendorFile } from "../../types.js";
import { expectPlausibleGpsTrack } from "../helpers.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE_KEY = "real-360gps-card";
const LOG_NAME = "20260824205434_000001GPS.TXT";
const VIDEO_NAMES = [
    "20260824205434_000001AAN.MP4",
    "20260824205516_000002AAN.MP4",
    "20260824205616_000003AAN.MP4",
    "20260824205717_000004AAN.MP4",
    "20260824205818_000005AAN.MP4",
    "20260824205918_000006AAN.MP4",
] as const;

function logFile(): VendorFile {
    return {
        file: new File([readFileSync(resolve(HERE, "real-anonymized.TXT"))], LOG_NAME),
        relativePath: `360CARDVR/GPS/${LOG_NAME}`,
        sourceKey: SOURCE_KEY,
    };
}

function videos(): VendorFile[] {
    return VIDEO_NAMES.map((name) => ({
        file: new File([new Uint8Array(16)], name),
        relativePath: `360CARDVR/REC/${name}`,
        sourceKey: SOURCE_KEY,
    }));
}

describe("real-anonymized 360GPSINFO JSONL log", () => {
    it("parses the preallocated stream and assigns every fix to its loop clip", async () => {
        const source = logFile();
        const loadedVideos = videos();
        const parsed = await threeSixtyGpsJsonlPrimitive.parse(source, undefined, undefined, {
            knownVideos: loadedVideos.map((video) => ({
                name: video.file.name,
                relativePath: video.relativePath,
                sourceKey: video.sourceKey,
            })),
        });

        expectPlausibleGpsTrack(parsed.records, { minCount: 50 });
        expect(parsed.records).toHaveLength(50);
        expect(parsed.skipped).toEqual([]);
        expect(parsed.records.every((record) => Number.isInteger(record.lat) && Number.isInteger(record.lon))).toBe(
            true,
        );
        expect(parsed.records.every((record) => record.timeUnsynced && record.relStartSeconds !== undefined)).toBe(
            true,
        );
        expect(parsed.records.some((record) => record.speedMs > 0)).toBe(true);

        const association = buildVideoAssociationIndex(loadedVideos);
        associateRecordsWithVideos(parsed.records, source, association);
        const log = rebuildLog([threeSixtyGpsJsonlPrimitive.id], parsed.records, parsed.skipped);
        expect(log.records.every((record) => record.videoKey !== undefined)).toBe(true);
        expect(VIDEO_NAMES.map((_, index) => recordsForVideo(log, loadedVideos[index]!, association).length)).toEqual([
            0, 11, 12, 12, 12, 3,
        ]);
    });
});
