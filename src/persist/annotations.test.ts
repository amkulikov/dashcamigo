import { describe, expect, it } from "vitest";
import { mergeAnnotationLists } from "./annotations.js";
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

    it("lets a newer edit win over an older tombstone", () => {
        const tombstone = tripMeta({ updatedAt: 100, deleted: true });
        const revived = tripMeta({ updatedAt: 200, deleted: false, name: "revived" });
        const merged = mergeAnnotationLists([tombstone], [revived]);
        expect(merged[0]!.deleted).toBe(false);
        expect((merged[0] as TripMetaAnnotation).name).toBe("revived");
    });
});
