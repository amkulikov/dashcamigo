import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AnnotationRecord } from "../persist/types.js";

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
    attentionHook: null as (() => void) | null,
    prepareWrite: vi.fn<() => Promise<"create" | "connect" | "authorize" | null>>(async () => "create"),
    create: vi.fn<() => Promise<"connected" | "cancelled" | "failed">>(async () => "connected"),
    useExisting: vi.fn<() => Promise<"connected" | "cancelled" | "failed">>(async () => "connected"),
    authorize: vi.fn<() => Promise<"connected" | "cancelled" | "failed">>(async () => "connected"),
    chooseBrowser: vi.fn(async () => {}),
    activate: vi.fn(),
    deactivate: vi.fn(),
}));

vi.mock("../i18n/index.js", () => ({ t: (key: string) => key }));
vi.mock("./annotations-sidecar.js", () => ({
    registerNotesWriteAttentionHook: (hook: () => void) => {
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
        authorize: mocks.authorize,
        chooseBrowser: mocks.chooseBrowser,
        prepareWrite: mocks.prepareWrite,
        status: vi.fn(),
        browserStorageReady: () => true,
        canSelectFile: () => true,
    }),
    refreshFolderSources: vi.fn(),
}));
vi.mock("./modal-helper.js", () => ({ activateModal: mocks.activate, deactivateModal: mocks.deactivate }));

import { _resetForTests, canConnectNotesBackup, initNotesNudge } from "./notes-nudge.js";

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

let elements: Record<string, FakeElement>;

beforeEach(() => {
    vi.clearAllMocks();
    mocks.annotationHook = null;
    mocks.attentionHook = null;
    mocks.prepareWrite.mockResolvedValue("create");
    mocks.create.mockResolvedValue("connected");
    mocks.useExisting.mockResolvedValue("connected");
    elements = {
        "notes-storage-modal": fakeElement(true),
        "notes-storage-modal-body": fakeElement(),
        "notes-storage-modal-error": fakeElement(true),
        "notes-storage-browser": fakeElement(),
        "notes-storage-file": fakeElement(),
    };
    vi.stubGlobal("document", { getElementById: (id: string) => elements[id] ?? null });
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
        const onClose = mocks.activate.mock.calls[0]![1].onClose as () => void;
        onClose();
        expect(elements["notes-storage-modal"]!.hidden, "Escape cannot dismiss the decision").toBe(false);
    });

    it("stays open after picker cancellation and closes after a retry", async () => {
        mocks.create.mockResolvedValueOnce("cancelled").mockResolvedValueOnce("connected");
        mocks.annotationHook?.(record());
        await vi.waitFor(() => expect(elements["notes-storage-modal"]!.hidden).toBe(false));

        elements["notes-storage-file"]!.listeners.click?.();
        await vi.waitFor(() => expect(mocks.create).toHaveBeenCalledOnce());
        expect(elements["notes-storage-modal"]!.hidden).toBe(false);

        elements["notes-storage-file"]!.listeners.click?.();
        await vi.waitFor(() => expect(elements["notes-storage-modal"]!.hidden).toBe(true));
    });

    it("remembers a browser-only choice globally for the session", async () => {
        mocks.annotationHook?.(record());
        await vi.waitFor(() => expect(elements["notes-storage-modal"]!.hidden).toBe(false));
        elements["notes-storage-browser"]!.listeners.click?.();
        await vi.waitFor(() => expect(elements["notes-storage-modal"]!.hidden).toBe(true));
        expect(mocks.chooseBrowser).toHaveBeenCalledOnce();

        mocks.annotationHook?.(record());
        await Promise.resolve();
        expect(mocks.activate).toHaveBeenCalledTimes(1);
    });

    it("opens an existing file with write intent from the blocking modal", async () => {
        mocks.prepareWrite.mockResolvedValue("connect");
        mocks.annotationHook?.(record());
        await vi.waitFor(() => expect(elements["notes-storage-modal"]!.hidden).toBe(false));
        elements["notes-storage-file"]!.listeners.click?.();
        await vi.waitFor(() => expect(mocks.useExisting).toHaveBeenCalledWith(true));
    });

    it("does nothing while the connected file is already writable", async () => {
        mocks.prepareWrite.mockResolvedValue(null);
        mocks.annotationHook?.(record());
        await Promise.resolve();
        await Promise.resolve();
        expect(mocks.activate).not.toHaveBeenCalled();
    });

    it("offers the current connection independently of recording-folder settings", () => {
        expect(canConnectNotesBackup()).toBe(true);
    });
});
