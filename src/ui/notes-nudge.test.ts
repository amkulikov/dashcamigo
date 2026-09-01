import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AnnotationRecord, RememberedFolder } from "../persist/types.js";

type Listener = () => void;
interface FakeElement {
    hidden: boolean;
    disabled: boolean;
    textContent: string;
    listeners: Record<string, Listener>;
    addEventListener(name: string, listener: Listener): void;
    setAttribute(name: string, value: string): void;
    removeAttribute(name: string): void;
}

function fakeElement(hidden = false): FakeElement {
    return {
        hidden,
        disabled: false,
        textContent: "",
        listeners: {},
        addEventListener(name, listener) {
            this.listeners[name] = listener;
        },
        setAttribute: vi.fn(),
        removeAttribute: vi.fn(),
    };
}

const mocks = vi.hoisted(() => ({
    annotationHook: null as ((record: AnnotationRecord) => void) | null,
    attentionHook: null as ((folderId: string) => void) | null,
    folder: null as RememberedFolder | null,
    prepareWrite: vi.fn<() => Promise<"create" | null>>(async () => "create"),
    create: vi.fn<() => Promise<"connected" | "cancelled" | "failed">>(async () => "connected"),
    useExisting: vi.fn(async () => "connected" as const),
    authorize: vi.fn(async () => "connected" as const),
    setFolderNotesStorage: vi.fn(async () => {}),
    rememberLiveSource: vi.fn(async () => null as RememberedFolder | null),
    activate: vi.fn(),
    deactivate: vi.fn(),
}));

vi.mock("../i18n/index.js", () => ({ t: (key: string) => key }));
vi.mock("../persist/folders.js", () => ({
    getFolder: vi.fn(async () => mocks.folder),
    setFolderNotesStorage: mocks.setFolderNotesStorage,
}));
vi.mock("./annotations-sidecar.js", () => ({
    registerNotesWriteAttentionHook: (hook: (folderId: string) => void) => {
        mocks.attentionHook = hook;
    },
}));
vi.mock("./annotations.js", () => ({
    registerUserAnnotationHook: (hook: (record: AnnotationRecord) => void) => {
        mocks.annotationHook = hook;
    },
}));
vi.mock("./folder-sources.js", () => ({
    getNotesConnector: () => ({
        create: mocks.create,
        useExisting: mocks.useExisting,
        connectPicked: vi.fn(),
        authorize: mocks.authorize,
        prepareWrite: mocks.prepareWrite,
        status: vi.fn(),
        browserStorageReady: () => true,
    }),
    hasLiveSource: vi.fn(() => true),
    refreshFolderSources: vi.fn(),
    rememberLiveSource: mocks.rememberLiveSource,
}));
vi.mock("./modal-helper.js", () => ({
    activateModal: mocks.activate,
    deactivateModal: mocks.deactivate,
}));

import { _resetForTests, canConnectNotesBackup, initNotesNudge } from "./notes-nudge.js";

function record(folderId = "folder-1"): AnnotationRecord {
    return {
        id: "meta-1",
        folderId,
        updatedAt: 100,
        deleted: false,
        kind: "tripMeta",
        anchor: { fileIdentityKey: "clip-key", startUtc: 1_700_000_000_000 },
        name: "Morning drive",
    };
}

let elements: Record<string, FakeElement>;

beforeEach(() => {
    vi.clearAllMocks();
    mocks.annotationHook = null;
    mocks.attentionHook = null;
    mocks.prepareWrite.mockResolvedValue("create");
    mocks.create.mockResolvedValue("connected");
    const handle = { kind: "directory", name: "CARD" } as FileSystemDirectoryHandle;
    mocks.folder = { id: "folder-1", handle, label: "CARD", addedAt: 1, lastOpenedAt: 2 };
    elements = {
        "notes-storage-modal": fakeElement(true),
        "notes-storage-modal-body": fakeElement(),
        "notes-storage-modal-error": fakeElement(true),
        "notes-storage-browser": fakeElement(),
        "notes-storage-file": fakeElement(),
    };
    vi.stubGlobal("document", {
        getElementById: (id: string) => elements[id] ?? null,
    });
    initNotesNudge();
});

afterEach(() => {
    _resetForTests();
    vi.unstubAllGlobals();
});

describe("notes storage choice", () => {
    it("opens a blocking modal only after a user edit needs a file", async () => {
        mocks.annotationHook?.(record());

        await vi.waitFor(() => expect(elements["notes-storage-modal"]!.hidden).toBe(false));
        expect(mocks.activate).toHaveBeenCalledWith(
            elements["notes-storage-modal"],
            expect.objectContaining({ initialFocus: elements["notes-storage-file"] }),
        );
        const onClose = mocks.activate.mock.calls[0]![1].onClose as () => void;
        onClose();
        expect(elements["notes-storage-modal"]!.hidden, "Escape cannot dismiss the decision").toBe(false);
    });

    it("stays open when the file picker is cancelled and closes after a retry succeeds", async () => {
        mocks.create.mockResolvedValueOnce("cancelled").mockResolvedValueOnce("connected");
        mocks.annotationHook?.(record());
        await vi.waitFor(() => expect(elements["notes-storage-modal"]!.hidden).toBe(false));

        elements["notes-storage-file"]!.listeners.click?.();
        await vi.waitFor(() => expect(mocks.create).toHaveBeenCalledOnce());
        expect(elements["notes-storage-modal"]!.hidden).toBe(false);

        elements["notes-storage-file"]!.listeners.click?.();
        await vi.waitFor(() => expect(elements["notes-storage-modal"]!.hidden).toBe(true));
        expect(mocks.create).toHaveBeenCalledTimes(2);
    });

    it("persists an explicit browser-only choice and does not ask again", async () => {
        mocks.annotationHook?.(record());
        await vi.waitFor(() => expect(elements["notes-storage-modal"]!.hidden).toBe(false));

        elements["notes-storage-browser"]!.listeners.click?.();
        await vi.waitFor(() => expect(elements["notes-storage-modal"]!.hidden).toBe(true));
        expect(mocks.setFolderNotesStorage).toHaveBeenCalledWith("folder-1", "browser");

        mocks.annotationHook?.(record());
        await Promise.resolve();
        expect(mocks.activate).toHaveBeenCalledTimes(1);
    });

    it("does nothing when the connected file is already writable", async () => {
        mocks.prepareWrite.mockResolvedValue(null);
        mocks.annotationHook?.(record());
        await Promise.resolve();
        await Promise.resolve();

        expect(mocks.activate).not.toHaveBeenCalled();
        expect(elements["notes-storage-modal"]!.hidden).toBe(true);
    });

    it("uses the live source when an old folder record is gone", async () => {
        const live = { ...mocks.folder!, id: "folder-new" };
        mocks.folder = null;
        mocks.rememberLiveSource.mockResolvedValue(live);
        mocks.annotationHook?.(record("forgotten-folder"));

        await vi.waitFor(() => expect(mocks.prepareWrite).toHaveBeenCalledWith(live, false));
        expect(mocks.rememberLiveSource).toHaveBeenCalledWith("clip-key");
    });

    it("hides a backup action when both the remembered folder and live source are gone", async () => {
        mocks.folder = null;
        const folderSources = await import("./folder-sources.js");
        vi.mocked(folderSources.hasLiveSource).mockReturnValue(false);

        await expect(canConnectNotesBackup("forgotten-folder", "clip-key")).resolves.toBe(false);
    });
});
