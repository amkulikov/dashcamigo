// The two functions the sidecar merge leans on: applyMergedRecords (what comes
// out of the notes file lands in memory + IndexedDB) and rebindFolderAnnotations
// (records made before the folder was remembered, or under a folder id that no
// longer exists, get re-keyed onto the live one). Both decide whether a note the
// user wrote is still findable, so they get their own gate.

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Trip, VideoCandidate } from "../trips.js";
import { fileIdentityKey } from "../persist/identity.js";
import type { AnnotationRecord, MarkerAnnotation, TripMetaAnnotation } from "../persist/types.js";

// annotations.ts resolves a record's folder through folder-sources, which pulls
// in DOM-touching modules. Only the lookup matters here - back it with a map the
// tests control.
const { folderByKey, folderScopeSeparator } = vi.hoisted(() => ({
    folderByKey: new Map<string, string>(),
    folderScopeSeparator: String.fromCharCode(1),
}));
vi.mock("./folder-sources.js", () => ({
    folderIdForFileKey: (key: string, sourceKey?: string) =>
        folderByKey.get(sourceKey === undefined ? key : `${sourceKey}${folderScopeSeparator}${key}`) ?? "",
}));

import {
    _resetForTests,
    applyMergedRecords,
    deleteMarker,
    markerById,
    markersForTrip,
    rebindFolderAnnotations,
    recordsForFolder,
    scopeAnnotationRecordsToFolder,
    setTripMeta,
    tripMetaFor,
    updateMarkerText,
} from "./annotations.js";
import { state } from "./state.js";

const CLIP_PATH = "CARD/Normal/REC0001.MP4";
const CLIP_SIZE = 12_345;
const CLIP_MTIME = 67_890;
// Derived, never typed out: the real key joins its fields with NUL, which has
// no business sitting as a raw byte in a source file (see persist/identity.ts).
const ANCHOR_KEY = fileIdentityKey({ relativePath: CLIP_PATH, size: CLIP_SIZE, lastModified: CLIP_MTIME });
const TRIP_START = 1_700_000_000;

function meta(overrides: Partial<TripMetaAnnotation> = {}): TripMetaAnnotation {
    return {
        id: "meta-1",
        folderId: "folder-A",
        updatedAt: 100,
        deleted: false,
        kind: "tripMeta",
        anchor: { fileIdentityKey: ANCHOR_KEY, startUtc: TRIP_START * 1000 },
        name: "Morning drive",
        ...overrides,
    };
}

function marker(overrides: Partial<MarkerAnnotation> = {}): MarkerAnnotation {
    return {
        id: "marker-1",
        folderId: "",
        updatedAt: 100,
        deleted: false,
        kind: "marker",
        utc: (TRIP_START + 30) * 1000,
        text: "deer",
        ...overrides,
    };
}

function buildCandidate(name: string, relativePath: string, startUtc: number, sourceKey?: string): VideoCandidate {
    const candidate = {
        file: new File(["x"], name, { lastModified: CLIP_MTIME }),
        relativePath,
        startUtc,
        durationSec: 60,
        ...(sourceKey === undefined ? {} : { sourceKey }),
    } as unknown as VideoCandidate;
    Object.defineProperty(candidate.file, "size", { value: CLIP_SIZE });
    return candidate;
}

/** Trip over the given clips, one frame each. With no argument: the single
 *  clip whose identity ANCHOR_KEY maps to. */
function buildTrip(clips: VideoCandidate[] = [buildCandidate("REC0001.MP4", CLIP_PATH, TRIP_START)]): Trip {
    const last = clips[clips.length - 1]!;
    return {
        frames: clips.map((candidate) => ({
            startUtc: candidate.startUtc,
            durationSec: 60,
            wallDurationSec: 60,
            channels: { front: candidate },
        })),
        startUtc: clips[0]!.startUtc,
        endUtc: last.startUtc + 60,
        durationSec: last.startUtc + 60 - clips[0]!.startUtc,
    } as unknown as Trip;
}

const SECOND_CLIP_PATH = "CARD/Normal/REC0002.MP4";
const SECOND_ANCHOR_KEY = fileIdentityKey({
    relativePath: SECOND_CLIP_PATH,
    size: CLIP_SIZE,
    lastModified: CLIP_MTIME,
});

/** The shape a regroup leaves behind: one trip holding two clips that were
 *  each annotated while they still belonged to trips of their own. */
function buildMergedTrip(): Trip {
    return buildTrip([
        buildCandidate("REC0001.MP4", CLIP_PATH, TRIP_START),
        buildCandidate("REC0002.MP4", SECOND_CLIP_PATH, TRIP_START + 60),
    ]);
}

describe("applyMergedRecords", () => {
    beforeEach(() => {
        _resetForTests();
        folderByKey.clear();
        state.trips = [];
    });

    it("takes an incoming record that is newer than the local one", () => {
        applyMergedRecords([meta({ name: "local" })]);
        const changed = applyMergedRecords([meta({ name: "remote", updatedAt: 200 })]);
        expect(changed, "one user-visible change").toBe(1);
        expect(recordsForFolder("folder-A")[0]).toMatchObject({ name: "remote" });
    });

    it("keeps a copied backup's shared record id in both remembered folders", () => {
        const shared = meta({ id: "shared", folderId: "folder-A" });
        applyMergedRecords([shared]);

        const fromCopy = scopeAnnotationRecordsToFolder(
            [{ ...shared, folderId: "folder-B" }],
            "folder-B",
            new Set(["folder-A", "folder-B"]),
        );
        applyMergedRecords(fromCopy);

        expect(recordsForFolder("folder-A").map((record) => record.id)).toEqual(["shared"]);
        expect(recordsForFolder("folder-B")).toEqual([
            expect.objectContaining({ id: "copy:folder-B:shared", name: "Morning drive" }),
        ]);
    });

    it("keeps the local record when it is newer, and reports nothing changed", () => {
        applyMergedRecords([meta({ name: "local", updatedAt: 200 })]);
        const changed = applyMergedRecords([meta({ name: "remote", updatedAt: 100 })]);
        expect(changed).toBe(0);
        expect(recordsForFolder("folder-A")[0]).toMatchObject({ name: "local" });
    });

    it("adopts the incoming folderId even when the local content wins", () => {
        // The sidecar reader restamps every record with the LOCAL folder id.
        // Without adoption a record kept through a forget/re-remember cycle
        // stays keyed to the dead id and vanishes from every future write.
        applyMergedRecords([meta({ folderId: "dead-folder", updatedAt: 200, name: "local" })]);
        const changed = applyMergedRecords([meta({ folderId: "folder-A", updatedAt: 100, name: "remote" })]);
        expect(changed, "adoption is bookkeeping, not a visible change").toBe(0);
        expect(recordsForFolder("dead-folder"), "left the dead id").toEqual([]);
        expect(recordsForFolder("folder-A")[0], "kept the local content under the live id").toMatchObject({
            name: "local",
        });
    });

    it("preserves a live local folder binding for an unremembered batch import", () => {
        applyMergedRecords([meta({ folderId: "folder-A", updatedAt: 100, name: "local" })]);
        const changed = applyMergedRecords([meta({ folderId: "", updatedAt: 200, name: "from file" })], {
            preserveFolderIds: new Set(["folder-A"]),
        });
        expect(changed).toBe(1);
        expect(recordsForFolder("folder-A")[0]).toMatchObject({ name: "from file" });
        expect(recordsForFolder("")).toEqual([]);
    });

    it("does not preserve a dead folder binding for an unremembered batch import", () => {
        applyMergedRecords([meta({ folderId: "dead-folder", updatedAt: 100, name: "local" })]);
        applyMergedRecords([meta({ folderId: "", updatedAt: 200, name: "from file" })], {
            preserveFolderIds: new Set(["folder-A"]),
        });
        expect(recordsForFolder("dead-folder")).toEqual([]);
        expect(recordsForFolder("")[0]).toMatchObject({ name: "from file" });
    });

    it("applies an incoming tombstone and hides the record from the trip", () => {
        state.trips = [buildTrip()];
        applyMergedRecords([meta()]);
        expect(tripMetaFor(state.trips[0]!)?.name).toBe("Morning drive");
        applyMergedRecords([meta({ deleted: true, updatedAt: 200 })]);
        expect(tripMetaFor(state.trips[0]!), "tombstoned records do not resolve").toBeNull();
    });
});

describe("rebindFolderAnnotations", () => {
    beforeEach(() => {
        _resetForTests();
        folderByKey.clear();
        state.trips = [];
    });

    it('re-keys trip metadata stranded on "" onto the folder its anchor file came from', () => {
        applyMergedRecords([meta({ folderId: "" })]);
        folderByKey.set(ANCHOR_KEY, "folder-A");
        expect(rebindFolderAnnotations("folder-A", new Set(["folder-A"]))).toBe(1);
        expect(recordsForFolder("folder-A").map((r) => r.id)).toEqual(["meta-1"]);
    });

    it("re-keys a record left on a folder id that no longer exists", () => {
        applyMergedRecords([meta({ folderId: "dead-folder" })]);
        folderByKey.set(ANCHOR_KEY, "folder-A");
        expect(rebindFolderAnnotations("folder-A", new Set(["folder-A"]))).toBe(1);
        expect(recordsForFolder("folder-A").map((r) => r.id)).toEqual(["meta-1"]);
    });

    it("re-keys restored trip metadata after the recording root was renamed", () => {
        const oldKey = fileIdentityKey({
            relativePath: "OLD/Normal/REC0001.MP4",
            size: CLIP_SIZE,
            lastModified: CLIP_MTIME,
        });
        const candidate = buildCandidate("REC0001.MP4", "NEW/Normal/REC0001.MP4", TRIP_START, "card-a");
        const currentKey = fileIdentityKey({
            relativePath: candidate.relativePath,
            size: candidate.file.size,
            lastModified: candidate.file.lastModified,
        });
        state.trips = [buildTrip([candidate])];
        folderByKey.set(`card-a${folderScopeSeparator}${currentKey}`, "folder-A");
        applyMergedRecords([meta({ folderId: "", anchor: { fileIdentityKey: oldKey, startUtc: TRIP_START * 1000 } })]);

        expect(rebindFolderAnnotations("folder-A", new Set(["folder-A"]))).toBe(1);
        expect(recordsForFolder("folder-A").map((record) => record.id)).toEqual(["meta-1"]);
    });

    it("leaves a record owned by another still-existing folder alone", () => {
        applyMergedRecords([meta({ folderId: "folder-B" })]);
        folderByKey.set(ANCHOR_KEY, "folder-A");
        expect(rebindFolderAnnotations("folder-A", new Set(["folder-A", "folder-B"]))).toBe(0);
        expect(recordsForFolder("folder-B").map((r) => r.id)).toEqual(["meta-1"]);
    });

    it("does not bump updatedAt - re-keying must not win LWW against a real edit", () => {
        applyMergedRecords([meta({ folderId: "", updatedAt: 42 })]);
        folderByKey.set(ANCHOR_KEY, "folder-A");
        rebindFolderAnnotations("folder-A", new Set(["folder-A"]));
        expect(recordsForFolder("folder-A")[0]!.updatedAt).toBe(42);
    });

    it("adopts an orphaned marker that falls inside a trip made of this folder's files", () => {
        state.trips = [buildTrip()];
        folderByKey.set(ANCHOR_KEY, "folder-A");
        applyMergedRecords([marker()]);
        expect(rebindFolderAnnotations("folder-A", new Set(["folder-A"]))).toBe(1);
        expect(recordsForFolder("folder-A").map((r) => r.id)).toEqual(["marker-1"]);
        expect(markersForTrip(state.trips[0]!).map((m) => m.id)).toEqual(["marker-1"]);
    });

    it("re-keys an anchored marker before trips have been built", () => {
        folderByKey.set(ANCHOR_KEY, "folder-A");
        applyMergedRecords([
            marker({
                anchor: { fileIdentityKey: ANCHOR_KEY, startUtc: TRIP_START * 1000, offsetSec: 30 },
            }),
        ]);

        expect(rebindFolderAnnotations("folder-A", new Set(["folder-A"]))).toBe(1);
        expect(recordsForFolder("folder-A").map((record) => record.id)).toEqual(["marker-1"]);
    });

    it("re-keys a recovered marker to its clip's folder inside a mixed-source trip", () => {
        const first = buildCandidate("REC0001.MP4", CLIP_PATH, TRIP_START, "card-a");
        const second = buildCandidate("REC0002.MP4", SECOND_CLIP_PATH, TRIP_START + 60, "card-b");
        const firstKey = fileIdentityKey({
            relativePath: first.relativePath,
            size: first.file.size,
            lastModified: first.file.lastModified,
        });
        const secondKey = fileIdentityKey({
            relativePath: second.relativePath,
            size: second.file.size,
            lastModified: second.file.lastModified,
        });
        folderByKey.set(`card-a${folderScopeSeparator}${firstKey}`, "folder-A");
        folderByKey.set(`card-b${folderScopeSeparator}${secondKey}`, "folder-B");
        state.trips = [buildTrip([first, second])];
        const oldSecondKey = fileIdentityKey({
            relativePath: "OLD/Normal/REC0002.MP4",
            size: CLIP_SIZE,
            lastModified: CLIP_MTIME,
        });
        applyMergedRecords([
            marker({
                folderId: "",
                anchor: { fileIdentityKey: oldSecondKey, startUtc: (TRIP_START + 60) * 1000, offsetSec: 10 },
            }),
        ]);

        expect(rebindFolderAnnotations("folder-A", new Set(["folder-A", "folder-B"]))).toBe(0);
        expect(rebindFolderAnnotations("folder-B", new Set(["folder-A", "folder-B"]))).toBe(1);
        expect(markerById("marker-1")?.folderId).toBe("folder-B");
    });

    it("does not show a marker from another folder at the same UTC", () => {
        state.trips = [buildTrip()];
        folderByKey.set(ANCHOR_KEY, "folder-A");
        applyMergedRecords([
            marker({ id: "right-folder", folderId: "folder-A" }),
            marker({ id: "wrong-folder", folderId: "folder-B" }),
        ]);
        expect(markersForTrip(state.trips[0]!).map((item) => item.id)).toEqual(["right-folder"]);
    });

    it("restores an anchored marker even when its old folder id is unavailable", () => {
        const trip = buildTrip();
        state.trips = [trip];
        applyMergedRecords([
            marker({
                folderId: "",
                anchor: { fileIdentityKey: ANCHOR_KEY, startUtc: TRIP_START * 1000, offsetSec: 30 },
            }),
        ]);

        expect(markersForTrip(trip).map((item) => item.id)).toEqual(["marker-1"]);
    });

    it("does not show an unbound anchored marker on two identical open copies", () => {
        const one = buildTrip();
        const two = buildTrip();
        state.trips = [one, two];
        applyMergedRecords([
            marker({
                folderId: "",
                anchor: { fileIdentityKey: ANCHOR_KEY, startUtc: TRIP_START * 1000, offsetSec: 30 },
            }),
        ]);

        expect(markersForTrip(one)).toEqual([]);
        expect(markersForTrip(two)).toEqual([]);
    });

    it("does not show an unbound legacy marker on two overlapping open copies", () => {
        const one = buildTrip();
        const two = buildTrip();
        state.trips = [one, two];
        applyMergedRecords([marker({ folderId: "", anchor: undefined })]);

        expect(markersForTrip(one)).toEqual([]);
        expect(markersForTrip(two)).toEqual([]);
    });

    it("leaves an orphaned marker outside every trip of this folder", () => {
        state.trips = [buildTrip()];
        folderByKey.set(ANCHOR_KEY, "folder-A");
        applyMergedRecords([marker({ utc: (TRIP_START + 5000) * 1000 })]);
        expect(rebindFolderAnnotations("folder-A", new Set(["folder-A"]))).toBe(0);
        expect(markerById("marker-1")?.folderId, "still unattached").toBe("");
    });

    it("carries a tombstone across too - a deletion left behind would resurrect", () => {
        const records: AnnotationRecord[] = [meta({ folderId: "", deleted: true })];
        applyMergedRecords(records);
        folderByKey.set(ANCHOR_KEY, "folder-A");
        expect(rebindFolderAnnotations("folder-A", new Set(["folder-A"]))).toBe(1);
        expect(recordsForFolder("folder-A")[0]).toMatchObject({ deleted: true });
    });
});

describe("trip-meta anchor resolution", () => {
    beforeEach(() => {
        _resetForTests();
        folderByKey.clear();
        state.trips = [];
    });

    it("does not let an older live record re-occupy an anchor a newer tombstone cleared", () => {
        // Load order is db.getAll's (by UUID), not by time: the tombstone can
        // arrive first and leave the anchor empty for a stale record to claim.
        applyMergedRecords([meta({ id: "newer", deleted: true, updatedAt: 300 })]);
        applyMergedRecords([meta({ id: "older", updatedAt: 100, name: "stale" })]);
        state.trips = [buildTrip()];
        expect(tripMetaFor(state.trips[0]!), "the newer deletion still stands").toBeNull();
    });

    it("lets a record newer than the tombstone take the anchor back", () => {
        applyMergedRecords([meta({ id: "newer", deleted: true, updatedAt: 300 })]);
        applyMergedRecords([meta({ id: "revived", updatedAt: 400, name: "renamed" })]);
        state.trips = [buildTrip()];
        expect(tripMetaFor(state.trips[0]!)?.name).toBe("renamed");
    });

    it("resolves equal-time records deterministically regardless of load order", () => {
        const one = meta({ id: "one", updatedAt: 100, name: "One" });
        const two = meta({ id: "two", updatedAt: 100, name: "Two" });
        state.trips = [buildTrip()];
        applyMergedRecords([one, two]);
        const forward = tripMetaFor(state.trips[0]!)?.id;

        _resetForTests();
        applyMergedRecords([two, one]);
        const reverse = tripMetaFor(state.trips[0]!)?.id;
        expect(forward).toBe(reverse);
    });

    it("recovers a note after the recording folder is renamed", () => {
        const oldKey = fileIdentityKey({
            relativePath: "OLD/Normal/REC0001.MP4",
            size: CLIP_SIZE,
            lastModified: CLIP_MTIME,
        });
        applyMergedRecords([
            meta({ anchor: { fileIdentityKey: oldKey, startUtc: TRIP_START * 1000 }, name: "Recovered" }),
        ]);

        const trip = buildTrip([buildCandidate("REC0001.MP4", "NEW/Normal/REC0001.MP4", TRIP_START)]);
        folderByKey.set(
            fileIdentityKey({ relativePath: "NEW/Normal/REC0001.MP4", size: CLIP_SIZE, lastModified: CLIP_MTIME }),
            "folder-A",
        );
        expect(tripMetaFor(trip)?.name).toBe("Recovered");
    });

    it("moves a recovered note onto the current clip identity when edited", () => {
        const oldKey = fileIdentityKey({
            relativePath: "OLD/Normal/REC0001.MP4",
            size: CLIP_SIZE,
            lastModified: CLIP_MTIME,
        });
        applyMergedRecords([
            meta({ anchor: { fileIdentityKey: oldKey, startUtc: TRIP_START * 1000 }, name: "Recovered" }),
        ]);
        const candidate = buildCandidate("REC0001.MP4", "NEW/Normal/REC0001.MP4", TRIP_START);
        const currentKey = fileIdentityKey({
            relativePath: candidate.relativePath,
            size: candidate.file.size,
            lastModified: candidate.file.lastModified,
        });
        folderByKey.set(currentKey, "folder-A");
        const trip = buildTrip([candidate]);
        state.trips = [trip];

        setTripMeta(trip, { name: "Edited after restore" });

        expect(recordsForFolder("folder-A").find((record) => record.id === "meta-1")).toMatchObject({
            name: "Edited after restore",
            anchor: { fileIdentityKey: currentKey },
        });
    });

    it("recovers a note when a copy changed only the file modification time", () => {
        applyMergedRecords([meta({ name: "Recovered" })]);
        const candidate = buildCandidate("REC0001.MP4", CLIP_PATH, TRIP_START);
        candidate.file = new File(["x"], "REC0001.MP4", { lastModified: CLIP_MTIME + 1 });
        Object.defineProperty(candidate.file, "size", { value: CLIP_SIZE });
        folderByKey.set(
            fileIdentityKey({ relativePath: CLIP_PATH, size: CLIP_SIZE, lastModified: CLIP_MTIME + 1 }),
            "folder-A",
        );

        expect(tripMetaFor(buildTrip([candidate]))?.name).toBe("Recovered");
    });

    it("does not recover a note onto a copied clip owned by another folder", () => {
        const oldKey = fileIdentityKey({
            relativePath: "OLD/Normal/REC0001.MP4",
            size: CLIP_SIZE,
            lastModified: CLIP_MTIME,
        });
        applyMergedRecords([
            meta({ folderId: "folder-A", anchor: { fileIdentityKey: oldKey, startUtc: TRIP_START * 1000 } }),
        ]);
        const copied = buildCandidate("REC0001.MP4", "NEW/Normal/REC0001.MP4", TRIP_START, "card-b");
        const copiedKey = fileIdentityKey({
            relativePath: copied.relativePath,
            size: copied.file.size,
            lastModified: copied.file.lastModified,
        });
        folderByKey.set(`card-b${folderScopeSeparator}${copiedKey}`, "folder-B");

        expect(tripMetaFor(buildTrip([copied]))).toBeNull();
    });

    it("keeps separate notes for byte-identical clips from two remembered folders", () => {
        const one = buildTrip([buildCandidate("REC0001.MP4", CLIP_PATH, TRIP_START, "card-a")]);
        const two = buildTrip([buildCandidate("REC0001.MP4", CLIP_PATH, TRIP_START, "card-b")]);
        folderByKey.set(`card-a${folderScopeSeparator}${ANCHOR_KEY}`, "folder-A");
        folderByKey.set(`card-b${folderScopeSeparator}${ANCHOR_KEY}`, "folder-B");
        state.trips = [one, two];
        applyMergedRecords([
            meta({ id: "one", folderId: "folder-A", updatedAt: 100, name: "One" }),
            meta({ id: "two", folderId: "folder-B", updatedAt: 200, name: "Two" }),
        ]);

        expect(tripMetaFor(one)?.name).toBe("One");
        expect(tripMetaFor(two)?.name).toBe("Two");
    });

    it("does not guess when two old notes match the renamed recording", () => {
        const oldKey = (root: string) =>
            fileIdentityKey({
                relativePath: `${root}/Normal/REC0001.MP4`,
                size: CLIP_SIZE,
                lastModified: CLIP_MTIME,
            });
        applyMergedRecords([
            meta({ id: "one", anchor: { fileIdentityKey: oldKey("ONE"), startUtc: TRIP_START * 1000 } }),
            meta({ id: "two", anchor: { fileIdentityKey: oldKey("TWO"), startUtc: TRIP_START * 1000 } }),
        ]);

        expect(
            tripMetaFor(buildTrip([buildCandidate("REC0001.MP4", "NEW/Normal/REC0001.MP4", TRIP_START)])),
        ).toBeNull();
    });

    it("does not show one recovered note on two identical open copies", () => {
        const oldKey = fileIdentityKey({
            relativePath: "OLD/Normal/REC0001.MP4",
            size: CLIP_SIZE,
            lastModified: CLIP_MTIME,
        });
        applyMergedRecords([meta({ anchor: { fileIdentityKey: oldKey, startUtc: TRIP_START * 1000 } })]);
        const one = buildTrip([buildCandidate("REC0001.MP4", "ONE/Normal/REC0001.MP4", TRIP_START)]);
        const two = buildTrip([buildCandidate("REC0001.MP4", "TWO/Normal/REC0001.MP4", TRIP_START)]);
        state.trips = [one, two];

        expect(tripMetaFor(one)).toBeNull();
        expect(tripMetaFor(two)).toBeNull();
    });

    it("does not show an unbound exact note on two identical open copies", () => {
        applyMergedRecords([meta({ folderId: "" })]);
        const one = buildTrip();
        const two = buildTrip();
        state.trips = [one, two];

        expect(tripMetaFor(one)).toBeNull();
        expect(tripMetaFor(two)).toBeNull();
    });
});

describe("setTripMeta on a trip a regroup merged", () => {
    beforeEach(() => {
        _resetForTests();
        folderByKey.clear();
        state.trips = [];
    });

    /** Two named clips, now one trip. The newer name is the visible one. */
    function seedTwoNames(): Trip {
        applyMergedRecords([
            meta({ id: "home", updatedAt: 100, name: "Home" }),
            meta({
                id: "work",
                updatedAt: 200,
                name: "Work",
                anchor: { fileIdentityKey: SECOND_ANCHOR_KEY, startUtc: (TRIP_START + 60) * 1000 },
            }),
        ]);
        const trip = buildMergedTrip();
        state.trips = [trip];
        return trip;
    }

    it("shows the newest of the two names, not whichever clip sorts first", () => {
        const trip = seedTwoNames();
        expect(tripMetaFor(trip)?.name).toBe("Work");
    });

    it("keeps the hidden name alive through an ordinary edit - the merge is reversible", () => {
        // Un-merging is one setting away (the trip-gap slider), and the other
        // clip's name belongs to the trip it comes back as.
        const trip = seedTwoNames();
        setTripMeta(trip, { isFavorite: true });
        expect(recordsForFolder("folder-A").find((r) => r.id === "home")).toMatchObject({
            deleted: false,
            name: "Home",
        });
    });

    it("folds the hidden name away when the edit clears the trip", () => {
        // Clearing the card means "no annotation here"; leaving the other one
        // live would uncover a name the user just deleted.
        const trip = seedTwoNames();
        setTripMeta(trip, { name: "", note: "" });
        expect(tripMetaFor(trip), "nothing left to show").toBeNull();
        expect(recordsForFolder("folder-A").find((r) => r.id === "home")?.deleted).toBe(true);
        expect(recordsForFolder("folder-A").find((r) => r.id === "home")).not.toHaveProperty("name");
    });

    it("applies an edit to the visible record even when a remote clock ran ahead", () => {
        // Another machine's record can carry a future updatedAt; the local edit
        // is then older than the anchor's watermark and must still take effect.
        applyMergedRecords([
            meta({ id: "remote", updatedAt: Date.now() + 60 * 60 * 1000, name: "from the other laptop" }),
        ]);
        const trip = buildTrip();
        state.trips = [trip];
        setTripMeta(trip, { name: "renamed here" });
        expect(tripMetaFor(trip)?.name).toBe("renamed here");
    });

    it("names a trip the remote clock already cleared into the future", () => {
        // The same fast clock, but the remote record is a TOMBSTONE: the anchor
        // is empty, so there is no visible record for the same-id escape hatch
        // to match, and a wall-clock stamp would sit behind the watermark the
        // tombstone left. The name the user just typed must still show up.
        const future = Date.now() + 60 * 60 * 1000;
        // The record setTripMeta mints resolves its own folder from the anchor.
        folderByKey.set(ANCHOR_KEY, "folder-A");
        applyMergedRecords([meta({ id: "remote", updatedAt: future, deleted: true })]);
        const trip = buildTrip();
        state.trips = [trip];
        expect(tripMetaFor(trip), "the tombstone cleared the anchor").toBeNull();

        setTripMeta(trip, { name: "Airport run" });
        expect(tripMetaFor(trip)?.name).toBe("Airport run");
        // Stamped past the watermark, or the other machine rejects it in turn
        // and the two profiles disagree about the trip forever.
        const written = recordsForFolder("folder-A").find((r) => r.kind === "tripMeta" && r.name === "Airport run");
        expect(written?.updatedAt, "beats the future-dated tombstone").toBeGreaterThan(future);
    });
});

describe("marker edits", () => {
    beforeEach(() => {
        _resetForTests();
        folderByKey.clear();
        state.trips = [];
    });

    it("beats a future-dated imported version when editing locally", () => {
        const future = Date.now() + 60 * 60 * 1000;
        applyMergedRecords([marker({ folderId: "folder-A", updatedAt: future })]);
        updateMarkerText("marker-1", "updated here");
        expect(markerById("marker-1")).toMatchObject({ text: "updated here", updatedAt: future + 1 });
    });

    it("removes private text from a marker tombstone", () => {
        applyMergedRecords([marker({ folderId: "folder-A", text: "private detail" })]);
        deleteMarker("marker-1");
        expect(recordsForFolder("folder-A")[0]).toMatchObject({ deleted: true, text: "" });
    });
});
