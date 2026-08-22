// Headless coverage for the pure ingest core. The star here is
// embeddedResultHasEffect: it is the guard that keeps the sstar-ssmd
// phantom-track gate working (0 records + a start-UTC hint must still apply),
// and nothing else in the suite exercises that branch.

import { describe, it, expect } from "vitest";

import {
    countByExtension,
    countByField,
    embeddedResultHasEffect,
    mergeAccelIntoCandidates,
    toVendorFiles,
} from "./ingest-core.js";
import type { DispatchedEmbeddedGpsResult } from "../parsers/registry.js";
import type { GpsRecord, VendorFile } from "../parsers/types.js";
import type { VideoCandidate } from "../trips.js";
import { vendorFileKey } from "../vendor-file-key.js";

const fakeFile = (name: string, webkitRelativePath = ""): File => ({ name, webkitRelativePath }) as unknown as File;
const vf = (name: string): VendorFile => ({ file: { name } }) as unknown as VendorFile;

describe("toVendorFiles", () => {
    it("uses webkitRelativePath when the browser set it (directory picker)", () => {
        const out = toVendorFiles([fakeFile("F.MP4", "DCIM/Movie/F.MP4")]);
        expect(out).toEqual([{ file: expect.anything(), relativePath: "DCIM/Movie/F.MP4" }]);
    });

    it("falls back to the bare name when webkitRelativePath is empty (drag-and-drop)", () => {
        const out = toVendorFiles([fakeFile("F.MP4", "")]);
        expect(out[0]!.relativePath).toBe("F.MP4");
    });
});

describe("countByExtension", () => {
    it("groups by lowercased extension and buckets extensionless files under ''", () => {
        const counts = countByExtension([vf("a.MP4"), vf("b.mp4"), vf("c.TXT"), vf("README")]);
        expect(counts).toEqual({ ".mp4": 2, ".txt": 1, "": 1 });
    });
});

describe("countByField", () => {
    it("counts occurrences of the derived key", () => {
        expect(countByField(["front", "rear", "front"], (s) => s)).toEqual({ front: 2, rear: 1 });
    });
});

describe("embeddedResultHasEffect", () => {
    const result = (over: Partial<DispatchedEmbeddedGpsResult>): DispatchedEmbeddedGpsResult =>
        ({
            records: [],
            videoStartUtcHintByFileKey: new Map(),
            localClockOffsetHintByFileKey: new Map(),
            accelByFileKey: new Map(),
            winningExtractorByFileKey: new Map(),
            ...over,
        }) as unknown as DispatchedEmbeddedGpsResult;

    it("is true when there are records", () => {
        expect(embeddedResultHasEffect(result({ records: [{} as never] }))).toBe(true);
    });

    it("is true for a hint-only result (phantom-track gate: 0 records + start-UTC hint)", () => {
        expect(
            embeddedResultHasEffect(result({ videoStartUtcHintByFileKey: new Map([["f.mp4", 1_700_000_000]]) })),
        ).toBe(true);
    });

    it("is true for local-clock or accelerometer evidence without GPS points", () => {
        expect(embeddedResultHasEffect(result({ localClockOffsetHintByFileKey: new Map([["f.mp4", 3600]]) }))).toBe(
            true,
        );
        expect(embeddedResultHasEffect(result({ accelByFileKey: new Map([["f.mp4", [{} as never]]]) }))).toBe(true);
    });

    it("is true when a parser claimed a file without producing telemetry", () => {
        expect(embeddedResultHasEffect(result({ winningExtractorByFileKey: new Map([["f.mp4", "novatek"]]) }))).toBe(
            true,
        );
    });

    it("is false only when there are no records, evidence or attribution", () => {
        expect(embeddedResultHasEffect(result({}))).toBe(false);
    });
});

describe("mergeAccelIntoCandidates", () => {
    it("updates only the concrete same-basename video targeted by the sidecar", () => {
        const candidate = (sourceKey: string): VideoCandidate =>
            ({
                file: new File([sourceKey], "clip.mp4", { lastModified: 1 }),
                relativePath: "CARD/clip.mp4",
                sourceKey,
                startUtc: 100,
            }) as VideoCandidate;
        const a = candidate("card-a");
        const b = candidate("card-b");
        const record = (video: VideoCandidate): GpsRecord => ({
            unixSeconds: 100.2,
            active: true,
            lat: 1,
            lon: 2,
            bearingDeg: 0,
            speedMs: 0,
            accelXg: 0,
            accelYg: 0,
            accelZg: 0,
            mp4Filename: "clip.mp4",
            videoKey: vendorFileKey(video),
        });
        const aRecord = record(a);
        const bRecord = record(b);
        const accel = new Map([
            [
                vendorFileKey(a),
                [
                    { msSinceStart: 200, accelXg: 2, accelYg: 0, accelZg: 1 },
                    { msSinceStart: 400, accelXg: 0, accelYg: 0, accelZg: 1 },
                ],
            ],
        ]);

        expect(mergeAccelIntoCandidates([aRecord, bRecord], accel, [a, b])).toBe(1);
        expect(Math.abs(aRecord.accelXg)).toBeGreaterThan(0);
        expect(bRecord.accelXg).toBe(0);
    });
});
