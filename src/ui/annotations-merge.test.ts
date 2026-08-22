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
const { folderByKey } = vi.hoisted(() => ({ folderByKey: new Map<string, string>() }));
vi.mock("./folder-sources.js", () => ({
    folderIdForFileKey: (key: string) => folderByKey.get(key) ?? "",
}));

import {
    _resetForTests,
    applyMergedRecords,
    deleteMarker,
    markerById,
    markersForTrip,
    rebindFolderAnnotations,
    recordsForFolder,
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

function buildCandidate(name: string, relativePath: string, startUtc: number): VideoCandidate {
    const candidate = {
        file: new File(["x"], name, { lastModified: CLIP_MTIME }),
        relativePath,
        startUtc,
        durationSec: 60,
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

    it("does not show a marker from another folder at the same UTC", () => {
        state.trips = [buildTrip()];
        folderByKey.set(ANCHOR_KEY, "folder-A");
        applyMergedRecords([
            marker({ id: "right-folder", folderId: "folder-A" }),
            marker({ id: "wrong-folder", folderId: "folder-B" }),
        ]);
        expect(markersForTrip(state.trips[0]!).map((item) => item.id)).toEqual(["right-folder"]);
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
