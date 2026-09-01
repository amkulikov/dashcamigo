import { describe, expect, it } from "vitest";
import {
    buildSidecarPayload,
    compareAnnotationVersions,
    mergeAnnotationLists,
    parseSidecarPayload,
} from "./annotations.js";
import type { AnnotationRecord, TripMetaAnnotation } from "./types.js";

function tripMeta(overrides: Partial<TripMetaAnnotation>): TripMetaAnnotation {
    return {
        id: "a1",
        folderId: "f1",
        updatedAt: 100,
        deleted: false,
        kind: "tripMeta",
        anchor: { fileIdentityKey: "k1", startUtc: 1_753_900_000_000 },
        name: "trip",
        ...overrides,
    };
}

describe("mergeAnnotationLists", () => {
    it("keeps records unique to either side", () => {
        const a: AnnotationRecord[] = [tripMeta({ id: "a1" })];
        const b: AnnotationRecord[] = [tripMeta({ id: "b1" })];
        const merged = mergeAnnotationLists(a, b);
        expect(merged.map((r) => r.id).sort()).toEqual(["a1", "b1"]);
    });

    it("resolves an id collision to the newer updatedAt regardless of side", () => {
        const older = tripMeta({ updatedAt: 100, name: "old" });
        const newer = tripMeta({ updatedAt: 200, name: "new" });
        expect((mergeAnnotationLists([older], [newer])[0] as TripMetaAnnotation).name, "newer on b side").toBe("new");
        expect((mergeAnnotationLists([newer], [older])[0] as TripMetaAnnotation).name, "newer on a side").toBe("new");
    });

    it("prefers the tombstone on an exact timestamp tie", () => {
        const live = tripMeta({ updatedAt: 100, deleted: false });
        const tombstone = tripMeta({ updatedAt: 100, deleted: true });
        expect(mergeAnnotationLists([live], [tombstone])[0]!.deleted, "tombstone on b").toBe(true);
        expect(mergeAnnotationLists([tombstone], [live])[0]!.deleted, "tombstone on a").toBe(true);
    });

    it("resolves equal live versions deterministically regardless of side", () => {
        const one = tripMeta({ updatedAt: 100, name: "one" });
        const two = tripMeta({ updatedAt: 100, name: "two" });
        const winnerFromOne = mergeAnnotationLists([one], [two])[0]!;
        const winnerFromTwo = mergeAnnotationLists([two], [one])[0]!;
        expect(winnerFromOne).toEqual(winnerFromTwo);
        expect(compareAnnotationVersions(winnerFromOne, one)).toBeGreaterThanOrEqual(0);
        expect(compareAnnotationVersions(winnerFromOne, two)).toBeGreaterThanOrEqual(0);
    });

    it("lets a newer edit win over an older tombstone", () => {
        const tombstone = tripMeta({ updatedAt: 100, deleted: true });
        const revived = tripMeta({ updatedAt: 200, deleted: false, name: "revived" });
        const merged = mergeAnnotationLists([tombstone], [revived]);
        expect(merged[0]!.deleted).toBe(false);
        expect((merged[0] as TripMetaAnnotation).name).toBe("revived");
    });
});

describe("parseSidecarPayload", () => {
    const wrap = (annotations: unknown[]): string =>
        JSON.stringify({ app: "dashcamigo", format: "annotations", version: 1, annotations });

    it("returns an empty list for an empty file", () => {
        expect(parseSidecarPayload("")).toEqual({ records: [], rejectedEntries: 0, version: 2 });
        expect(parseSidecarPayload("   \n")).toEqual({ records: [], rejectedEntries: 0, version: 2 });
    });

    it("returns null for a foreign or broken file", () => {
        expect(parseSidecarPayload("not json"), "not JSON").toBeNull();
        expect(parseSidecarPayload("[1,2]"), "not an object").toBeNull();
        expect(parseSidecarPayload('{"format":"other","annotations":[]}'), "foreign format").toBeNull();
        expect(
            parseSidecarPayload('{"format":"annotations","version":1,"annotations":[]}'),
            "missing app marker",
        ).toBeNull();
        expect(
            parseSidecarPayload('{"app":"dashcamigo","format":"annotations","version":3,"annotations":[]}'),
            "unsupported future version",
        ).toBeNull();
    });

    it("round-trips valid tripMeta and marker records", () => {
        const records = [
            tripMeta({ id: "t1", note: "n", isFavorite: true }),
            {
                id: "m1",
                folderId: "f1",
                updatedAt: 5,
                deleted: false,
                kind: "marker",
                utc: 1_753_900_000_000,
                text: "hit",
            },
        ];
        const parsed = parseSidecarPayload(wrap(records));
        expect(parsed).not.toBeNull();
        expect(parsed!.records.map((r) => r.id).sort()).toEqual(["m1", "t1"]);
        const meta = parsed!.records.find((r) => r.id === "t1") as TripMetaAnnotation;
        expect(meta.name, "name survives").toBe("trip");
        expect(meta.isFavorite, "favorite survives").toBe(true);
    });

    it("skips a tripMeta without an anchor instead of throwing later", () => {
        const parsed = parseSidecarPayload(wrap([{ id: "x", updatedAt: 1, deleted: false, kind: "tripMeta" }]));
        expect(parsed).toEqual({ records: [], rejectedEntries: 1, version: 1 });
    });

    it("skips non-finite timestamps that would pin LWW forever", () => {
        const infinite = { ...tripMeta({}), updatedAt: Number.POSITIVE_INFINITY };
        const nan = { ...tripMeta({ id: "a2" }), updatedAt: Number.NaN };
        // JSON has no Infinity/NaN literal - emulate a hand-edited file.
        const text = wrap([infinite, nan]).replace(/null/g, "1e999");
        const parsed = parseSidecarPayload(text);
        expect(parsed).toEqual({ records: [], rejectedEntries: 2, version: 1 });
    });

    it("skips unsafe, fractional, and negative timestamps", () => {
        const parsed = parseSidecarPayload(
            wrap([
                tripMeta({ id: "unsafe", updatedAt: Number.MAX_SAFE_INTEGER + 1 }),
                tripMeta({ id: "fraction", updatedAt: 1.5 }),
                tripMeta({ id: "negative", updatedAt: -1 }),
            ]),
        );
        expect(parsed).toEqual({ records: [], rejectedEntries: 3, version: 1 });
    });

    it("skips a marker with a non-string text and non-number utc", () => {
        const parsed = parseSidecarPayload(
            wrap([
                { id: "m1", updatedAt: 1, deleted: false, kind: "marker", utc: "later", text: "x" },
                { id: "m2", updatedAt: 1, deleted: false, kind: "marker", utc: 5, text: { nested: true } },
            ]),
        );
        expect(parsed).toEqual({ records: [], rejectedEntries: 2, version: 1 });
    });

    it("recovers known fields but flags unknown fields so a writer preserves the file", () => {
        const parsed = parseSidecarPayload(wrap([{ ...tripMeta({}), evil: "payload" }]));
        expect(parsed!.records[0]).not.toHaveProperty("evil");
        expect(parsed!.rejectedEntries).toBe(1);
    });

    it("reports unknown entries so writers can preserve them", () => {
        const parsed = parseSidecarPayload(wrap([tripMeta({}), { kind: "future", id: "f1" }]));
        expect(parsed?.records).toHaveLength(1);
        expect(parsed?.rejectedEntries).toBe(1);
    });

    it("flags unknown top-level data so it is not erased by a rewrite", () => {
        const parsed = parseSidecarPayload(
            JSON.stringify({ app: "dashcamigo", format: "annotations", version: 1, annotations: [], future: true }),
        );
        expect(parsed).toEqual({ records: [], rejectedEntries: 1, version: 1 });
    });
});

describe("buildSidecarPayload", () => {
    // The notes file is the only copy that survives a browser data wipe, so the
    // writer and the reader agreeing is not a detail: a payload the parser
    // rejects reads as "not a dashcamigo file" and gets silently replaced.
    it("round-trips every record kind as global v2 without local folder ids", () => {
        const records: AnnotationRecord[] = [
            tripMeta({ id: "a1", name: "Morning drive", note: "roadworks on the bridge", isFavorite: true }),
            tripMeta({ id: "a2", deleted: true, name: undefined }),
            {
                id: "m1",
                folderId: "f1",
                updatedAt: 7,
                deleted: false,
                kind: "marker",
                utc: 1_753_900_500_000,
                text: "deer",
                anchor: { fileIdentityKey: "k1", startUtc: 1_753_900_000_000, offsetSec: 12.5 },
            },
            { id: "m2", folderId: "f1", updatedAt: 8, deleted: true, kind: "marker", utc: 1_753_900_900_000, text: "" },
        ];
        const parsed = parseSidecarPayload(JSON.stringify(buildSidecarPayload(records, 1_753_901_000_000)));
        expect(parsed).toEqual({
            records: records.map((record) => ({ ...record, folderId: "" })),
            rejectedEntries: 0,
            version: 2,
        });
    });
});
