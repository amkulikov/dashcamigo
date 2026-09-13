import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { NotesFileRecord, RememberedFolder } from "./types.js";

interface LegacyFolder extends RememberedFolder {
    sidecarHandle?: FileSystemFileHandle;
    sidecarAccess?: "file";
    notesStorage?: "browser";
}

const mocks = vi.hoisted(() => ({
    folders: [] as LegacyFolder[],
    notes: undefined as NotesFileRecord | undefined,
}));

vi.mock("./db.js", () => ({
    openPersistDb: vi.fn(async () => ({
        transaction: () => ({
            objectStore(name: "folders" | "notesFile") {
                if (name === "notesFile") {
                    return {
                        get: vi.fn(async () => mocks.notes),
                        put: vi.fn(async (record: NotesFileRecord) => {
                            mocks.notes = record;
                        }),
                    };
                }
                return {
                    getAll: vi.fn(async () => mocks.folders),
                    put: vi.fn(async (record: LegacyFolder) => {
                        const index = mocks.folders.findIndex((folder) => folder.id === record.id);
                        mocks.folders[index] = record;
                    }),
                };
            },
            done: Promise.resolve(),
        }),
        get: vi.fn(async () => mocks.notes),
        put: vi.fn(async (_store: string, record: NotesFileRecord) => {
            mocks.notes = record;
        }),
    })),
}));

import { openPersistDb } from "./db.js";
import { listFolders, markFolderOpened, rememberFolder } from "./folders.js";
import {
    _resetForTests,
    getNotesFileState,
    migrateLegacyNotesFileState,
    setNotesFileHandle,
    setNotesStorage,
} from "./notes-file.js";

function handle(name: string): FileSystemFileHandle {
    return { kind: "file", name } as FileSystemFileHandle;
}

function folder(id: string, legacy: Partial<LegacyFolder> = {}): LegacyFolder {
    return {
        id,
        label: id,
        addedAt: 1,
        lastOpenedAt: 2,
        handle: { kind: "directory", name: id } as FileSystemDirectoryHandle,
        ...legacy,
    };
}

beforeEach(() => {
    vi.clearAllMocks();
    _resetForTests();
    mocks.folders = [];
    mocks.notes = undefined;
});

afterEach(() => vi.unstubAllGlobals());

describe("legacy notes-file connection migration", () => {
    it("promotes one explicitly picked file and removes notes state from folders", async () => {
        const notes = handle("notes.dashcamigo");
        mocks.folders = [
            folder("one", { sidecarHandle: notes, sidecarAccess: "file" }),
            folder("two", { notesStorage: "browser" }),
        ];

        await expect(migrateLegacyNotesFileState()).resolves.toEqual({
            id: "global",
            handle: notes,
            access: "file",
        });
        expect(mocks.folders.every((record) => !("sidecarHandle" in record))).toBe(true);
        expect(mocks.folders.every((record) => !("sidecarAccess" in record))).toBe(true);
        expect(mocks.folders.every((record) => !("notesStorage" in record))).toBe(true);
    });

    it("uses the most recently opened folder's file as the legacy fallback", async () => {
        const older = handle("one.dashcamigo");
        const newer = handle("two.dashcamigo");
        mocks.folders = [
            folder("one", { lastOpenedAt: 10, sidecarHandle: older, sidecarAccess: "file" }),
            folder("two", { lastOpenedAt: 20, sidecarHandle: newer, sidecarAccess: "file" }),
        ];

        await expect(getNotesFileState()).resolves.toEqual({ id: "global", handle: newer, access: "file" });
        expect(mocks.folders.every((record) => !("sidecarHandle" in record))).toBe(true);
    });

    it("keeps an already migrated global choice", async () => {
        const current = { id: "global" as const, handle: handle("current.dashcamigo"), access: "file" as const };
        mocks.notes = current;
        mocks.folders = [folder("one", { sidecarHandle: handle("old.dashcamigo"), sidecarAccess: "file" })];

        await expect(migrateLegacyNotesFileState()).resolves.toEqual(current);
        expect(mocks.notes).toEqual(current);
    });
});

describe("Chromium handle persistence fallback", () => {
    beforeEach(() => {
        vi.stubGlobal("navigator", { userAgent: "Chrome/153.0.8010.12" });
    });

    it("leaves saved handles and legacy state untouched without opening the database", async () => {
        const savedFolder = folder("one", { sidecarHandle: handle("legacy.dashcamigo"), sidecarAccess: "file" });
        const savedNotes: NotesFileRecord = { id: "global", handle: handle("saved.dashcamigo"), access: "file" };
        mocks.folders = [savedFolder];
        mocks.notes = savedNotes;

        await expect(listFolders()).resolves.toEqual([]);
        await expect(migrateLegacyNotesFileState()).resolves.toEqual({ id: "global" });
        await expect(getNotesFileState()).resolves.toEqual({ id: "global" });
        await markFolderOpened(savedFolder.id);
        await expect(rememberFolder(savedFolder.handle)).rejects.toThrow("cannot be remembered");
        await setNotesFileHandle(handle("live.dashcamigo"));
        await setNotesStorage("browser");

        expect(openPersistDb).not.toHaveBeenCalled();
        expect(mocks.folders).toEqual([savedFolder]);
        expect(savedFolder.sidecarHandle?.name).toBe("legacy.dashcamigo");
        expect(mocks.notes).toBe(savedNotes);
    });

    it("keeps live notes access and storage choices until the tab is reset", async () => {
        const live = handle("live.dashcamigo");
        await setNotesFileHandle(live, "derived");
        await setNotesStorage("browser");
        await expect(getNotesFileState()).resolves.toEqual({
            id: "global",
            handle: live,
            access: "derived",
            storage: "browser",
        });

        await setNotesStorage(null);
        const current = await getNotesFileState();
        expect(current.storage).toBeUndefined();
        current.storage = "browser";
        expect((await getNotesFileState()).storage).toBeUndefined();

        _resetForTests();
        await expect(getNotesFileState()).resolves.toEqual({ id: "global" });
        expect(openPersistDb).not.toHaveBeenCalled();
    });

    it("restores the saved connection when a compatible browser opens it", async () => {
        const saved: NotesFileRecord = { id: "global", handle: handle("saved.dashcamigo"), access: "file" };
        mocks.notes = saved;
        await setNotesFileHandle(handle("live.dashcamigo"));
        expect(openPersistDb).not.toHaveBeenCalled();

        vi.stubGlobal("navigator", { userAgent: "Chrome/152.0.7977.83" });
        await expect(getNotesFileState()).resolves.toEqual(saved);
        expect(mocks.notes).toBe(saved);
    });
});
