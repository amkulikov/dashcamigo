// End-to-end regression for the dual-channel Mio MiVue filename and folder
// layout. The source pair used sibling F/ and R/ folders; only the front clip
// had a same-basename NMEA sidecar. Videos were rebuilt with
// scripts/anonymize-mp4.mjs, and the sidecar was processed with
// scripts/anonymize-nmea-log.mjs.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { cameraFingerprint } from "../../camera-fingerprint.js";
import {
    classifyFilenameMode,
    classifyFilenameTime,
    matchFilenameChannel,
    matchFilenameTime,
} from "../../filename/index.js";
import { classifyGpsSource } from "../../gps-source-hints.js";
import { indexMp4FileWithMoov } from "../../internal/mp4-indexing.js";
import { classifyFiles } from "../../registry.js";
import { nmeaSidecar } from "../../sidecars/nmea-sidecar.js";
import { groupTrips, rederiveStartUtcForCandidates } from "../../../trips.js";
import { applyIndexedMetadata, buildProvisionalCandidate } from "../../../ui/ingest-candidate.js";
import { expectPlausibleGpsTrack, makeVendorFile } from "../helpers.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const FRONT_NAME = "FILE260819-071804F.mp4";
const REAR_NAME = "FILE260819-071804R.mp4";
const NMEA_NAME = "FILE260819-071804F.NMEA";

function loadFixture(relativePath: string): ReturnType<typeof makeVendorFile> {
    const name = relativePath.split("/").at(-1)!;
    return makeVendorFile(relativePath, readFileSync(resolve(HERE, name)));
}

describe("mio mivue 955wd pro real-anonymized pair", () => {
    it("parses the front NMEA sidecar without retaining precise coordinates", async () => {
        const sidecar = loadFixture(`F/${NMEA_NAME}`);
        const records = await nmeaSidecar.parse(sidecar, FRONT_NAME);

        expect(records).toHaveLength(5);
        expectPlausibleGpsTrack(records, { minCount: 5 });
        for (const record of records) {
            expect(record.lat).toBe(50);
            expect(record.lon).toBe(9);
            expect(record.mp4Filename).toBe(FRONT_NAME);
        }
        expect(records[0]!.unixSeconds).toBe(Date.UTC(2026, 7, 19, 5, 18, 5) / 1000);
        expect(records.at(-1)!.unixSeconds).toBe(records[0]!.unixSeconds + 4);
    });

    it("classifies both channels and binds the sidecar to the front clip", async () => {
        const front = loadFixture(`F/${FRONT_NAME}`);
        const rear = loadFixture(`R/${REAR_NAME}`);
        const sidecar = loadFixture(`F/${NMEA_NAME}`);
        const classified = await classifyFiles([front, rear, sidecar]);

        expect(matchFilenameTime(front).matchedId).toBe("ibox-time");
        expect(matchFilenameTime(rear).matchedId).toBe("ibox-time");
        expect(matchFilenameChannel(front)).toEqual({
            matchedId: "ibox-channel",
            value: { channel: "front", confident: true },
        });
        expect(matchFilenameChannel(rear)).toEqual({
            matchedId: "ibox-channel",
            value: { channel: "rear", confident: true },
        });
        expect(classifyFilenameMode(front)).toBe("normal");
        expect(classifyFilenameMode(rear)).toBe("normal");
        expect(classifyGpsSource(front)).toBe("basename-sidecar");
        expect(classifyGpsSource(rear)).toBe("basename-sidecar");
        expect(cameraFingerprint(front)).toBe(cameraFingerprint(rear));

        const classifiedSidecar = classified.find((item) => item.file.file.name === NMEA_NAME);
        expect(classifiedSidecar?.role).toBe("sidecar");
        expect(classifiedSidecar?.sidecarId).toBe("nmea-sidecar");
        expect(classifiedSidecar?.sidecarMp4).toBe(FRONT_NAME);
    });

    it("groups the HEVC front and AVC rear into one multichannel frame", async () => {
        const frontFile = loadFixture(`F/${FRONT_NAME}`);
        const rearFile = loadFixture(`R/${REAR_NAME}`);
        const sidecar = loadFixture(`F/${NMEA_NAME}`);
        const frontRecords = await nmeaSidecar.parse(sidecar, FRONT_NAME);
        const [frontResult, rearResult] = await Promise.all([
            indexMp4FileWithMoov(frontFile.file, false),
            indexMp4FileWithMoov(rearFile.file, false),
        ]);
        expect(frontResult.indexed?.codec).toBe("hevc");
        expect(frontResult.indexed?.width).toBe(3840);
        expect(frontResult.indexed?.height).toBe(2160);
        expect(rearResult.indexed?.codec).toBe("avc");
        expect(rearResult.indexed?.width).toBe(1920);
        expect(rearResult.indexed?.height).toBe(1080);

        const makeCandidate = (
            file: typeof frontFile,
            records: typeof frontRecords,
            indexed: NonNullable<typeof frontResult.indexed>,
        ) => {
            const candidate = buildProvisionalCandidate({
                file,
                fingerprint: cameraFingerprint(file),
                startUtc: 0,
                startSource: "mtime",
                cameraTzSec: null,
                durationSec: indexed.durationSec,
                records,
                appliedExtractors: records.length > 0 ? ["nmea-sidecar"] : [],
            });
            applyIndexedMetadata(candidate, indexed, undefined);
            return candidate;
        };

        const front = makeCandidate(frontFile, frontRecords, frontResult.indexed!);
        const rear = makeCandidate(rearFile, [], rearResult.indexed!);
        rederiveStartUtcForCandidates([front, rear], classifyFilenameTime);
        const trips = groupTrips([front, rear]);

        expect(front.startUtc).toBe(rear.startUtc);
        expect(trips).toHaveLength(1);
        expect(trips[0]!.frames).toHaveLength(1);
        expect(Object.keys(trips[0]!.frames[0]!.channels).sort()).toEqual(["front", "rear"]);
        expect(trips[0]!.frames[0]!.channels.front?.file.name).toBe(FRONT_NAME);
        expect(trips[0]!.frames[0]!.channels.rear?.file.name).toBe(REAR_NAME);
    });
});
