import { beforeEach, describe, expect, it, vi } from "vitest";

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

import { _resetForTests, getNotesFileState, migrateLegacyNotesFileState } from "./notes-file.js";

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
    _resetForTests();
    mocks.folders = [];
    mocks.notes = undefined;
});

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
