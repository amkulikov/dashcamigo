import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AnnotationRecord, RememberedFolder } from "../persist/types.js";
import type { NotifyInput } from "./notifications.js";

const mocks = vi.hoisted(() => ({
    annotationHook: null as ((record: AnnotationRecord) => void) | null,
    folder: null as RememberedFolder | null,
    create: vi.fn(),
    useExisting: vi.fn(),
    getFolder: vi.fn(async () => mocks.folder),
    hasLiveSource: vi.fn(() => true),
    notify: vi.fn<(input: NotifyInput) => void>(),
}));

vi.mock("../persist/folders.js", () => ({ getFolder: mocks.getFolder }));
vi.mock("./annotations.js", () => ({
    registerUserAnnotationHook: (hook: (record: AnnotationRecord) => void) => {
        mocks.annotationHook = hook;
    },
}));
vi.mock("./folder-sources.js", () => ({
    getNotesConnector: () => ({ create: mocks.create, useExisting: mocks.useExisting }),
    hasLiveSource: mocks.hasLiveSource,
    rememberLiveSource: vi.fn(),
}));
vi.mock("./notifications.js", () => ({ notify: mocks.notify }));

import { canConnectNotesBackup, initNotesNudge } from "./notes-nudge.js";

function record(): AnnotationRecord {
    return {
        id: "meta-1",
        folderId: "folder-1",
        updatedAt: 100,
        deleted: false,
        kind: "tripMeta",
        anchor: { fileIdentityKey: "clip-key", startUtc: 1_700_000_000_000 },
        name: "Morning drive",
    };
}

beforeEach(() => {
    vi.clearAllMocks();
    mocks.annotationHook = null;
    mocks.hasLiveSource.mockReturnValue(true);
    const handle = { kind: "directory", name: "CARD" } as FileSystemDirectoryHandle;
    mocks.folder = { id: "folder-1", handle, label: "CARD", addedAt: 1, lastOpenedAt: 2 };
    const storage = new Map<string, string>();
    vi.stubGlobal("localStorage", {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
    });
    initNotesNudge();
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("notes-file nudge", () => {
    it("delegates discovery and creation to the connector once", async () => {
        mocks.annotationHook?.(record());
        await vi.waitFor(() => expect(mocks.notify).toHaveBeenCalled());
        const nudge = mocks.notify.mock.calls[0]![0];
        expect(nudge.messageKey).toBe("notesNudge.message");
        nudge.onAction?.();

        await vi.waitFor(() => expect(mocks.create).toHaveBeenCalledWith(mocks.folder));
        expect(mocks.create).toHaveBeenCalledTimes(1);
    });

    it("uses a marker's clip anchor when its old folder record is gone", async () => {
        mocks.folder = null;
        const marker: AnnotationRecord = {
            id: "marker-1",
            folderId: "forgotten-folder",
            updatedAt: 100,
            deleted: false,
            kind: "marker",
            utc: 1_700_000_000_000,
            text: "Turn",
            anchor: { fileIdentityKey: "marker-clip-key", startUtc: 1_700_000_000_000, offsetSec: 5 },
        };

        mocks.annotationHook?.(marker);

        await vi.waitFor(() => expect(mocks.notify).toHaveBeenCalled());
        expect(mocks.hasLiveSource).toHaveBeenCalledWith("marker-clip-key");
    });

    it("hides a backup action when both the remembered folder and live source are gone", async () => {
        mocks.folder = null;
        mocks.hasLiveSource.mockReturnValue(false);

        await expect(canConnectNotesBackup("forgotten-folder", "clip-key")).resolves.toBe(false);
    });
});
