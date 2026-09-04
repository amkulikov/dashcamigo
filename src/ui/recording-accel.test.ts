import { expect, it } from "vitest";
import type { AccelSample, GpsRecord } from "../parsers/types.js";
import { buildProvisionalCandidate, vendorFileKey } from "./ingest-candidate.js";
import { createRecordingAccelStore } from "./recording-accel.js";

function candidate(sourceKey: string) {
    const file = {
        file: new File([sourceKey], "clip.mp4", { lastModified: 1 }),
        relativePath: "CARD/clip.mp4",
        sourceKey,
    };
    const record: GpsRecord = {
        unixSeconds: 100,
        active: true,
        lat: 1,
        lon: 2,
        bearingDeg: 0,
        speedMs: 0,
        accelXg: 0,
        accelYg: 0,
        accelZg: 0,
        mp4Filename: file.file.name,
        videoKey: vendorFileKey(file),
    };
    return buildProvisionalCandidate({
        file,
        fingerprint: sourceKey,
        startUtc: 100,
        startSource: "gps",
        cameraTzSec: null,
        durationSec: 60,
        records: [record],
        appliedExtractors: [],
    });
}

const samples: AccelSample[] = [
    { msSinceStart: 0, accelXg: 2, accelYg: 0, accelZg: 1 },
    { msSinceStart: 1000, accelXg: 0, accelYg: 0, accelZg: 1 },
];

it("retains unmerged sidecar data when a later drop adds unrelated recordings", () => {
    const store = createRecordingAccelStore();
    const a = candidate("first-drop");
    store.register([a], "sidecar", new Map([[vendorFileKey(a), samples]]));
    const b = candidate("second-drop");
    store.register([a, b], "sidecar", new Map());
    store.register([a, b], "embedded", new Map());
    expect(store.merge([a, b])).toBe(1);
    expect(a.records[0]!.accelXg).toBeCloseTo(1);
    expect(b.records[0]!.accelXg).toBe(0);
});

it("keeps sidecar precedence when embedded samples arrive after a restart", () => {
    const store = createRecordingAccelStore();
    const a = candidate("first-drop");
    store.register([a], "sidecar", new Map([[vendorFileKey(a), samples]]));
    store.register([a], "embedded", new Map([[vendorFileKey(a), [{ ...samples[0]!, accelXg: 0 }]]]));
    store.merge([a]);
    expect(a.records[0]!.accelXg).toBeCloseTo(1);
    store.release([a]);
    a.records[0]!.accelXg = 0;
    expect(store.merge([a])).toBe(0);
    expect(a.records[0]!.accelXg).toBe(0);
});

it("reapplies raw samples to replaced GPS records using the refined clock", () => {
    const store = createRecordingAccelStore();
    const a = candidate("first-drop");
    store.register([a], "embedded", new Map([[vendorFileKey(a), samples]]));
    a.startUtc = 200;
    a.records = [{ ...a.records[0]!, unixSeconds: 200 }];
    expect(store.merge([a])).toBe(1);
    expect(a.records[0]!.accelXg).toBeCloseTo(1);
});
