import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AnnotationRecord, RememberedFolder } from "../persist/types.js";
import type { NotifyInput } from "./notifications.js";

const mocks = vi.hoisted(() => ({
    annotationHook: null as ((record: AnnotationRecord) => void) | null,
    folder: null as RememberedFolder | null,
    create: vi.fn(),
    getFolder: vi.fn(async () => mocks.folder),
    notify: vi.fn<(input: NotifyInput) => void>(),
    notifyFolderOpened: vi.fn<(folder: RememberedFolder) => Promise<void>>(),
}));

vi.mock("../persist/folders.js", () => ({ getFolder: mocks.getFolder }));
vi.mock("./annotations.js", () => ({
    registerUserAnnotationHook: (hook: (record: AnnotationRecord) => void) => {
        mocks.annotationHook = hook;
    },
}));
vi.mock("./folder-sources.js", () => ({
    getNotesConnector: () => ({ create: mocks.create, useExisting: vi.fn() }),
    hasLiveSource: () => true,
    notifyFolderOpened: mocks.notifyFolderOpened,
    rememberLiveSource: vi.fn(),
}));
vi.mock("./notifications.js", () => ({ notify: mocks.notify }));

import { initNotesNudge } from "./notes-nudge.js";

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
    it("does not offer creation when discovery attaches an existing file", async () => {
        let finishDiscovery: (() => void) | undefined;
        const discovery = new Promise<void>((resolve) => {
            finishDiscovery = () => {
                if (mocks.folder) {
                    mocks.folder = {
                        ...mocks.folder,
                        sidecarHandle: { kind: "file", name: "notes.dashcamigo" } as FileSystemFileHandle,
                    };
                }
                resolve();
            };
        });
        mocks.notifyFolderOpened.mockReturnValue(discovery);

        mocks.annotationHook?.(record());
        await vi.waitFor(() => expect(mocks.notify).toHaveBeenCalled());
        const nudge = mocks.notify.mock.calls[0]![0];
        expect(nudge.messageKey).toBe("notesNudge.message");
        nudge.onAction?.();

        await vi.waitFor(() => expect(mocks.notifyFolderOpened).toHaveBeenCalled());
        expect(mocks.create, "creation must wait for discovery").not.toHaveBeenCalled();
        finishDiscovery?.();
        await vi.waitFor(() => expect(mocks.getFolder).toHaveBeenCalledTimes(4));
        expect(mocks.create, "the discovered file is reused").not.toHaveBeenCalled();
    });
});
