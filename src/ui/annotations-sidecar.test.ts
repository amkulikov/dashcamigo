import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { VendorFile } from "../parsers/types.js";
import type { AnnotationRecord, RememberedFolder, TripMetaAnnotation } from "../persist/types.js";
import type { NotesConnector } from "./folder-sources.js";

const mocks = vi.hoisted(() => ({
    annotationHook: null as ((folderId: string) => void) | null,
    connector: null as NotesConnector | null,
    folderHook: null as ((folder: RememberedFolder) => void | Promise<void>) | null,
    folder: null as RememberedFolder | null,
    otherFolders: [] as RememberedFolder[],
    getFolder: vi.fn(async () => mocks.folder),
    ensureFileReadwritePermission: vi.fn(async () => true),
    rebindFolderAnnotations: vi.fn(() => 0),
    records: new Map<string, AnnotationRecord>(),
    applyMergedRecords: vi.fn((records: AnnotationRecord[]) => {
        let changed = 0;
        for (const record of records) {
            const previous = mocks.records.get(record.id);
            if (!previous || JSON.stringify(previous) !== JSON.stringify(record)) changed++;
            mocks.records.set(record.id, record);
        }
        return changed;
    }),
    notify: vi.fn(),
    renderTrips: vi.fn(),
    refreshTimelineMarkers: vi.fn(),
    savePicker: vi.fn(),
    setFolderSidecarHandle: vi.fn(async (_id: string, handle: FileSystemFileHandle) => {
        if (mocks.folder) mocks.folder = { ...mocks.folder, sidecarHandle: handle, sidecarAccess: "file" };
    }),
}));

vi.mock("../persist/folders.js", () => ({
    ensureFileReadwritePermission: mocks.ensureFileReadwritePermission,
    getFolder: mocks.getFolder,
    listFolders: vi.fn(async () => [...(mocks.folder ? [mocks.folder] : []), ...mocks.otherFolders]),
    setFolderSidecarHandle: mocks.setFolderSidecarHandle,
}));
vi.mock("./annotations.js", () => ({
    annotationStoreAvailable: vi.fn(() => true),
    allAnnotationRecords: () => [...mocks.records.values()],
    applyMergedRecords: mocks.applyMergedRecords,
    rebindFolderAnnotations: mocks.rebindFolderAnnotations,
    recordsForFolder: (folderId: string) =>
        [...mocks.records.values()].filter((record) => record.folderId === folderId),
    registerAnnotationsChangedHook: (hook: (folderId: string) => void) => {
        mocks.annotationHook = hook;
    },
    registerAnnotationPersistenceStatusHook: vi.fn(),
    waitForAnnotationsReady: vi.fn(async () => {}),
    scopeAnnotationRecordsToFolder: (records: AnnotationRecord[], folderId: string) =>
        records.map((record) => (record.folderId === folderId ? record : { ...record, folderId })),
}));
vi.mock("./folder-sources.js", () => ({
    refreshFolderSources: vi.fn(),
    registerFolderOpenedHook: (hook: (folder: RememberedFolder) => void | Promise<void>) => {
        mocks.folderHook = hook;
    },
    registerNotesConnector: (connector: NotesConnector) => {
        mocks.connector = connector;
    },
}));
vi.mock("./notifications.js", () => ({ notify: mocks.notify }));
vi.mock("./sidebar.js", () => ({ renderTrips: mocks.renderTrips }));
vi.mock("./timeline-markers.js", () => ({ refreshTimelineMarkers: mocks.refreshTimelineMarkers }));

import {
    _resetForTests,
    annotationStorageState,
    flushPendingSidecarWrites,
    importPortableNotesBackup,
    initAnnotationsSidecar,
    mergeNotesFilesFromBatch,
} from "./annotations-sidecar.js";

const FOLDER_ID = "folder-1";

function tripMeta(id: string, folderId = FOLDER_ID): TripMetaAnnotation {
    return {
        id,
        folderId,
        updatedAt: 100,
        deleted: false,
        kind: "tripMeta",
        anchor: { fileIdentityKey: `key-${id}`, startUtc: 1_700_000_000_000 },
        name: id,
    };
}

function payload(records: unknown[], version = 1): string {
    return JSON.stringify({ app: "dashcamigo", format: "annotations", version, annotations: records });
}

interface FakeSidecar {
    handle: FileSystemFileHandle;
    read(): string;
    replace(text: string): void;
    writes(): number;
    createWritableOptions(): unknown;
}

function fakeSidecar(initial: string): FakeSidecar {
    let contents = initial;
    let writeCount = 0;
    let writableOptions: unknown;
    const handle = {
        kind: "file",
        name: "notes.dashcamigo",
        async getFile() {
            return { text: async () => contents };
        },
        async queryPermission() {
            return "granted" as const;
        },
        async requestPermission() {
            return "granted" as const;
        },
        async isSameEntry(other: FileSystemHandle) {
            return other === handle;
        },
        async createWritable(options?: unknown) {
            writableOptions = options;
            let staged = "";
            return {
                async write(value: string) {
                    staged = value;
                },
                async abort() {},
                async close() {
                    contents = staged;
                    writeCount++;
                },
            };
        },
    } as unknown as FileSystemFileHandle;
    return {
        handle,
        read: () => contents,
        replace: (text) => {
            contents = text;
        },
        writes: () => writeCount,
        createWritableOptions: () => writableOptions,
    };
}

function folderWith(children: FileSystemHandle[], sidecarHandle?: FileSystemFileHandle): RememberedFolder {
    const handle = {
        kind: "directory",
        name: "CARD",
        async *values() {
            for (const child of children) yield child;
        },
    } as unknown as FileSystemDirectoryHandle;
    return {
        id: FOLDER_ID,
        handle,
        label: "CARD",
        addedAt: 1,
        lastOpenedAt: 2,
        ...(sidecarHandle ? { sidecarHandle, sidecarAccess: "file" as const } : {}),
    };
}

let documentListeners: Record<string, () => void>;

beforeEach(() => {
    _resetForTests();
    vi.clearAllMocks();
    mocks.annotationHook = null;
    mocks.connector = null;
    mocks.folderHook = null;
    mocks.folder = null;
    mocks.otherFolders = [];
    mocks.records.clear();
    mocks.ensureFileReadwritePermission.mockResolvedValue(true);
    documentListeners = {};
    vi.stubGlobal("window", {
        showSaveFilePicker: mocks.savePicker,
        showOpenFilePicker: vi.fn(),
        addEventListener: vi.fn(),
        setTimeout: globalThis.setTimeout.bind(globalThis),
    });
    vi.stubGlobal("document", {
        visibilityState: "visible",
        addEventListener: (name: string, listener: () => void) => {
            documentListeners[name] = listener;
        },
    });
    initAnnotationsSidecar();
});

afterEach(() => {
    _resetForTests();
    vi.unstubAllGlobals();
});

describe("folder discovery", () => {
    it("merges an existing notes file without treating the directory-derived handle as writable", async () => {
        const remote = tripMeta("remote", "other-profile-folder");
        const sidecar = fakeSidecar(payload([remote]));
        const folder = folderWith([sidecar.handle]);
        mocks.folder = folder;

        await mocks.folderHook?.(folder);

        expect(mocks.setFolderSidecarHandle).not.toHaveBeenCalled();
        expect(mocks.folder?.sidecarHandle).toBeUndefined();
        expect(mocks.records.get("remote")).toMatchObject({ folderId: FOLDER_ID, name: "remote" });
        expect(sidecar.writes()).toBe(0);
        await expect(mocks.connector?.prepareWrite(folder)).resolves.toBe("connect");
    });

    it("does not attach a sidecar from a future format version", async () => {
        const sidecar = fakeSidecar(payload([tripMeta("future")], 2));
        const folder = folderWith([sidecar.handle]);
        mocks.folder = folder;

        await mocks.folderHook?.(folder);

        expect(mocks.setFolderSidecarHandle).not.toHaveBeenCalled();
        expect(mocks.folder?.sidecarHandle).toBeUndefined();
    });

    it("routes a discovered notes file to the open picker", async () => {
        const sidecar = fakeSidecar(payload([tripMeta("future")], 2));
        const folder = folderWith([sidecar.handle]);
        mocks.folder = folder;
        await mocks.folderHook?.(folder);

        await expect(mocks.connector?.prepareWrite(folder)).resolves.toBe("connect");
        expect(window.showOpenFilePicker).not.toHaveBeenCalled();
        expect(mocks.savePicker).not.toHaveBeenCalled();
        expect(mocks.folder?.sidecarHandle).toBeUndefined();
    });

    it("creates a backup through the narrowly scoped save picker", async () => {
        const sidecar = fakeSidecar("");
        const folder = folderWith([]);
        mocks.folder = folder;
        mocks.savePicker.mockResolvedValue(sidecar.handle);

        await expect(mocks.connector?.create(folder)).resolves.toBe("connected");

        expect(mocks.savePicker).toHaveBeenCalledWith(
            expect.objectContaining({ startIn: folder.handle, suggestedName: "notes.dashcamigo" }),
        );
        expect(mocks.rebindFolderAnnotations).toHaveBeenCalledWith(FOLDER_ID, new Set([FOLDER_ID]));
        expect(mocks.folder?.sidecarHandle).toBe(sidecar.handle);
        expect(mocks.folder?.sidecarAccess).toBe("file");
        expect(sidecar.writes()).toBe(1);
        expect(JSON.parse(sidecar.read())).toMatchObject({ app: "dashcamigo", format: "annotations", version: 1 });
    });

    it("never requests directory write permission when creating a backup", async () => {
        const sidecar = fakeSidecar("");
        const folder = folderWith([]);
        mocks.folder = folder;
        mocks.savePicker.mockResolvedValue(sidecar.handle);

        await mocks.connector?.create(folder);

        expect(folder.handle.queryPermission).toBeUndefined();
        expect(folder.handle.requestPermission).toBeUndefined();
        expect(mocks.savePicker).toHaveBeenCalledOnce();
    });

    it("recovers valid records but never attaches a partially unreadable backup", async () => {
        const valid = tripMeta("valid", "other-profile");
        const sidecar = fakeSidecar(payload([valid, { kind: "future", id: "unknown" }]));
        const folder = folderWith([sidecar.handle]);
        mocks.folder = folder;

        await mocks.connector?.connectPicked(folder, sidecar.handle);

        expect(mocks.records.get("valid")).toMatchObject({ folderId: FOLDER_ID });
        expect(mocks.setFolderSidecarHandle).not.toHaveBeenCalled();
        expect(sidecar.writes()).toBe(0);
        expect(mocks.notify).toHaveBeenCalledWith({
            severity: "error",
            messageKey: "sidecar.partialReadOnly",
            messageParams: { n: 1 },
        });
        await expect(mocks.connector?.status(folder)).resolves.toBe("needsAttention");
        await expect(annotationStorageState(FOLDER_ID)).resolves.toMatchObject({ backupAction: "reconnect" });
    });

    it("does not connect one backup file to two folders", async () => {
        const sidecar = fakeSidecar(payload([]));
        const folder = folderWith([sidecar.handle]);
        mocks.folder = folder;
        mocks.otherFolders = [{ ...folder, id: "folder-2", label: "OTHER", sidecarHandle: sidecar.handle }];

        await mocks.connector?.connectPicked(folder, sidecar.handle);

        expect(mocks.setFolderSidecarHandle).not.toHaveBeenCalled();
        expect(sidecar.writes()).toBe(0);
        expect(mocks.notify).toHaveBeenCalledWith({ severity: "error", messageKey: "sidecar.alreadyConnected" });
    });

    it("keeps reconnect as the next action when a picked file denies write access", async () => {
        const sidecar = fakeSidecar(payload([]));
        const folder = folderWith([sidecar.handle]);
        mocks.folder = folder;
        mocks.ensureFileReadwritePermission.mockResolvedValue(false);

        await mocks.connector?.connectPicked(folder, sidecar.handle);

        await expect(mocks.connector?.status(folder)).resolves.toBe("needsAttention");
        await expect(annotationStorageState(FOLDER_ID)).resolves.toMatchObject({ backupAction: "reconnect" });
    });
});

describe("writes", () => {
    it("re-reads and preserves external changes immediately before replacing the file", async () => {
        const original = tripMeta("original");
        const sidecar = fakeSidecar(payload([original]));
        const folder = folderWith([], sidecar.handle);
        mocks.folder = folder;
        mocks.records.set(original.id, original);
        await mocks.folderHook?.(folder);

        const external = tripMeta("external", "another-profile");
        sidecar.replace(payload([original, external]));
        const local = tripMeta("local");
        mocks.records.set(local.id, local);
        mocks.annotationHook?.(FOLDER_ID);
        // onAnnotationsChanged first awaits the folder record and permission;
        // then visibilitychange waits for the serialized write it scheduled.
        await new Promise((resolve) => setTimeout(resolve, 0));
        Object.assign(document, { visibilityState: "hidden" });
        documentListeners.visibilitychange?.();

        await vi.waitFor(() => expect(sidecar.writes()).toBe(1));
        const written = JSON.parse(sidecar.read()) as { annotations: AnnotationRecord[] };
        expect(written.annotations.map((record) => record.id).sort()).toEqual(["external", "local", "original"]);
    });

    it("lets reset flushing wait for the folder lookup before a write is queued", async () => {
        const original = tripMeta("original");
        const sidecar = fakeSidecar(payload([original]));
        const folder = folderWith([], sidecar.handle);
        mocks.folder = folder;
        mocks.records.set(original.id, original);
        let releaseLookup: ((value: RememberedFolder | null) => void) | undefined;
        mocks.getFolder.mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    releaseLookup = resolve;
                }),
        );

        mocks.annotationHook?.(FOLDER_ID);
        let flushed = false;
        const flushing = flushPendingSidecarWrites().then(() => {
            flushed = true;
        });
        await Promise.resolve();
        expect(flushed, "the pre-queue lookup is part of the flush").toBe(false);

        releaseLookup?.(folder);
        await flushing;
        expect(sidecar.writes()).toBe(1);
    });

    it("collapses a burst of annotation changes into one file replacement", async () => {
        const original = tripMeta("original");
        const sidecar = fakeSidecar(payload([original]));
        const folder = folderWith([], sidecar.handle);
        mocks.folder = folder;
        mocks.records.set(original.id, original);
        await mocks.folderHook?.(folder);

        mocks.annotationHook?.(FOLDER_ID);
        mocks.annotationHook?.(FOLDER_ID);
        mocks.annotationHook?.(FOLDER_ID);
        await flushPendingSidecarWrites();

        expect(sidecar.writes()).toBe(1);
    });

    it("keeps a saved healthy connection across a fresh page session", async () => {
        const sidecar = fakeSidecar(payload([]));
        const folder = folderWith([], sidecar.handle);
        mocks.folder = folder;

        await expect(mocks.connector?.status(folder)).resolves.toBe("ready");
        await expect(annotationStorageState(FOLDER_ID)).resolves.toEqual({
            hintKey: "annotations.storageHintFile",
            backupAction: null,
        });
        await mocks.folderHook?.(folder);
        expect(
            mocks.ensureFileReadwritePermission,
            "opening is read-only and must not prompt for write",
        ).not.toHaveBeenCalled();
        await expect(annotationStorageState(FOLDER_ID)).resolves.toEqual({
            hintKey: "annotations.storageHintFile",
            backupAction: null,
        });
    });

    it("never writes through a legacy directory-derived handle until the file is reconnected", async () => {
        const sidecar = fakeSidecar(payload([]));
        const folder = folderWith([], sidecar.handle);
        delete folder.sidecarAccess;
        mocks.folder = folder;

        await mocks.folderHook?.(folder);
        mocks.records.set("local", tripMeta("local"));
        mocks.annotationHook?.(FOLDER_ID);
        await flushPendingSidecarWrites();

        expect(sidecar.writes()).toBe(0);
        expect(mocks.ensureFileReadwritePermission).not.toHaveBeenCalled();
        await expect(mocks.connector?.prepareWrite(folder)).resolves.toBe("connect");
    });

    it("honours browser-only storage until a manual reconnect", async () => {
        const sidecar = fakeSidecar(payload([]));
        const folder = { ...folderWith([], sidecar.handle), notesStorage: "browser" as const };
        mocks.folder = folder;

        mocks.records.set("local", tripMeta("local"));
        mocks.annotationHook?.(FOLDER_ID);
        await flushPendingSidecarWrites();

        expect(sidecar.writes()).toBe(0);
        await expect(mocks.connector?.status(folder)).resolves.toBe("missing");
        await expect(mocks.connector?.prepareWrite(folder)).resolves.toBeNull();
        await expect(mocks.connector?.prepareWrite(folder, true)).resolves.toBe("connect");
        await expect(annotationStorageState(FOLDER_ID)).resolves.toEqual({
            hintKey: "annotations.storageHint",
            backupAction: "create",
        });
    });

    it("keeps a saved connection neutral while reload permission awaits a folder-load click", async () => {
        const sidecar = fakeSidecar(payload([]));
        const promptHandle = {
            ...sidecar.handle,
            async queryPermission() {
                return "prompt" as const;
            },
        } as unknown as FileSystemFileHandle;
        const folder = folderWith([], promptHandle);
        mocks.folder = folder;

        await expect(mocks.connector?.status(folder)).resolves.toBe("connected");
        // An editor is an active write surface, so it still offers the gesture
        // that can restore permission instead of claiming writes are live.
        await expect(annotationStorageState(FOLDER_ID)).resolves.toMatchObject({ backupAction: "reconnect" });
    });

    it("marks a saved connection broken only after its file really fails to read", async () => {
        const unreadable = {
            kind: "file",
            name: "notes.dashcamigo",
            async queryPermission() {
                return "granted" as const;
            },
            async getFile() {
                throw new DOMException("drive is gone", "NotFoundError");
            },
        } as unknown as FileSystemFileHandle;
        const folder = folderWith([], unreadable);
        mocks.folder = folder;

        await expect(mocks.connector?.status(folder), "persisted and not checked yet").resolves.toBe("ready");
        await mocks.folderHook?.(folder);
        await expect(
            mocks.connector?.status(folder),
            "the attempted read supplies real failure evidence",
        ).resolves.toBe("needsAttention");
        await expect(annotationStorageState(FOLDER_ID)).resolves.toMatchObject({ backupAction: "reconnect" });
    });

    it("waits for the explicit authorize action instead of prompting from the edit hook", async () => {
        const sidecar = fakeSidecar(payload([]));
        const promptHandle = {
            ...sidecar.handle,
            async queryPermission() {
                return "prompt" as const;
            },
        } as unknown as FileSystemFileHandle;
        const folder = folderWith([], promptHandle);
        mocks.folder = folder;
        await mocks.folderHook?.(folder);

        mocks.annotationHook?.(FOLDER_ID);
        await flushPendingSidecarWrites();

        expect(mocks.ensureFileReadwritePermission).not.toHaveBeenCalled();
        expect(sidecar.writes()).toBe(0);
        await expect(mocks.connector?.prepareWrite(folder)).resolves.toBe("authorize");

        await mocks.connector?.authorize(folder);
        expect(mocks.ensureFileReadwritePermission).toHaveBeenCalledWith(promptHandle);
    });
});

describe("ingest ambiguity", () => {
    it("does not merge two valid notes files from one batch", async () => {
        const files: VendorFile[] = [
            { file: new File([payload([tripMeta("one")])], "one.dashcamigo"), relativePath: "CARD/one.dashcamigo" },
            { file: new File([payload([tripMeta("two")])], "two.dashcamigo"), relativePath: "CARD/two.dashcamigo" },
        ];

        await mergeNotesFilesFromBatch(files, "");

        expect(mocks.applyMergedRecords).not.toHaveBeenCalled();
        expect(mocks.records.size).toBe(0);
    });
});

describe("portable restore", () => {
    it("clears a foreign profile's folder id while restoring its records", async () => {
        const folder = folderWith([]);
        mocks.folder = folder;
        const imported = tripMeta("portable", "folder-from-another-browser");

        await importPortableNotesBackup(new File([payload([imported])], "backup.dashcamigo"));

        expect(mocks.records.get("portable")).toMatchObject({ folderId: "", name: "portable" });
        expect(mocks.notify).toHaveBeenCalledWith({
            severity: "info",
            messageKey: "sidecar.imported",
            messageParams: { n: 1 },
        });
    });

    it("pushes restored changes into an already connected folder backup", async () => {
        const local = tripMeta("portable");
        const sidecar = fakeSidecar(payload([local]));
        const folder = folderWith([], sidecar.handle);
        mocks.folder = folder;
        mocks.records.set(local.id, local);
        await mocks.folderHook?.(folder);
        const restored = { ...local, updatedAt: 200, name: "restored" };

        await importPortableNotesBackup(new File([payload([restored])], "backup.dashcamigo"));
        await flushPendingSidecarWrites();

        expect(sidecar.writes()).toBe(1);
        expect(JSON.parse(sidecar.read())).toMatchObject({
            annotations: [expect.objectContaining({ id: "portable", name: "restored" })],
        });
    });
});
