import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { VendorFile } from "../parsers/types.js";
import type { AnnotationRecord, RememberedFolder, TripMetaAnnotation } from "../persist/types.js";

const mocks = vi.hoisted(() => ({
    annotationHook: null as ((folderId: string) => void) | null,
    connector: null as { create(folder: RememberedFolder): void; useExisting(folder: RememberedFolder): void } | null,
    folderHook: null as ((folder: RememberedFolder) => void | Promise<void>) | null,
    folder: null as RememberedFolder | null,
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
    setFolderSidecarHandle: vi.fn(async (_id: string, handle: FileSystemFileHandle) => {
        if (mocks.folder) mocks.folder = { ...mocks.folder, sidecarHandle: handle };
    }),
}));

vi.mock("../persist/folders.js", () => ({
    ensureFileReadwritePermission: vi.fn(async () => true),
    getFolder: vi.fn(async () => mocks.folder),
    listFolders: vi.fn(async () => (mocks.folder ? [mocks.folder] : [])),
    setFolderSidecarHandle: mocks.setFolderSidecarHandle,
}));
vi.mock("./annotations.js", () => ({
    applyMergedRecords: mocks.applyMergedRecords,
    rebindFolderAnnotations: vi.fn(() => 0),
    recordsForFolder: (folderId: string) =>
        [...mocks.records.values()].filter((record) => record.folderId === folderId),
    registerAnnotationsChangedHook: (hook: (folderId: string) => void) => {
        mocks.annotationHook = hook;
    },
}));
vi.mock("./folder-sources.js", () => ({
    registerFolderOpenedHook: (hook: (folder: RememberedFolder) => void | Promise<void>) => {
        mocks.folderHook = hook;
    },
    registerNotesConnector: (connector: {
        create(folder: RememberedFolder): void;
        useExisting(folder: RememberedFolder): void;
    }) => {
        mocks.connector = connector;
    },
}));
vi.mock("./notifications.js", () => ({ notify: mocks.notify }));
vi.mock("./sidebar.js", () => ({ renderTrips: mocks.renderTrips }));
vi.mock("./timeline-markers.js", () => ({ refreshTimelineMarkers: mocks.refreshTimelineMarkers }));

import { _resetForTests, initAnnotationsSidecar, mergeNotesFilesFromBatch } from "./annotations-sidecar.js";

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

function payload(records: AnnotationRecord[], version = 1): string {
    return JSON.stringify({ app: "dashcamigo", format: "annotations", version, annotations: records });
}

interface FakeSidecar {
    handle: FileSystemFileHandle;
    read(): string;
    replace(text: string): void;
    writes(): number;
}

function fakeSidecar(initial: string): FakeSidecar {
    let contents = initial;
    let writeCount = 0;
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
        async createWritable() {
            let staged = "";
            return {
                async write(value: string) {
                    staged = value;
                },
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
        ...(sidecarHandle ? { sidecarHandle } : {}),
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
    mocks.records.clear();
    documentListeners = {};
    vi.stubGlobal("window", {
        showSaveFilePicker: vi.fn(),
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
    it("attaches and merges the existing notes file before the open hook resolves", async () => {
        const remote = tripMeta("remote", "other-profile-folder");
        const sidecar = fakeSidecar(payload([remote]));
        const folder = folderWith([sidecar.handle]);
        mocks.folder = folder;

        await mocks.folderHook?.(folder);

        expect(mocks.setFolderSidecarHandle).toHaveBeenCalledWith(FOLDER_ID, sidecar.handle);
        expect(mocks.folder?.sidecarHandle).toBe(sidecar.handle);
        expect(mocks.records.get("remote")).toMatchObject({ folderId: FOLDER_ID, name: "remote" });
        expect(mocks.notify).toHaveBeenCalledWith({ severity: "info", messageKey: "sidecar.enabled" });
    });

    it("does not attach a sidecar from a future format version", async () => {
        const sidecar = fakeSidecar(payload([tripMeta("future")], 2));
        const folder = folderWith([sidecar.handle]);
        mocks.folder = folder;

        await mocks.folderHook?.(folder);

        expect(mocks.setFolderSidecarHandle).not.toHaveBeenCalled();
        expect(mocks.folder?.sidecarHandle).toBeUndefined();
    });

    it("routes creation through the safe open picker when a notes-like file blocks adoption", async () => {
        const sidecar = fakeSidecar(payload([tripMeta("future")], 2));
        const folder = folderWith([sidecar.handle]);
        mocks.folder = folder;
        vi.mocked(window.showOpenFilePicker!).mockResolvedValue([sidecar.handle]);

        mocks.connector?.create(folder);

        await vi.waitFor(() => expect(window.showOpenFilePicker).toHaveBeenCalled());
        await vi.waitFor(() =>
            expect(mocks.notify).toHaveBeenCalledWith({ severity: "warn", messageKey: "sidecar.notOurFile" }),
        );
        expect(window.showSaveFilePicker, "must never open the destructive picker").not.toHaveBeenCalled();
        expect(mocks.folder?.sidecarHandle).toBeUndefined();
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
        // then visibilitychange flushes its newly scheduled debounce timer.
        await new Promise((resolve) => setTimeout(resolve, 0));
        Object.assign(document, { visibilityState: "hidden" });
        documentListeners.visibilitychange?.();

        await vi.waitFor(() => expect(sidecar.writes()).toBe(1));
        const written = JSON.parse(sidecar.read()) as { annotations: AnnotationRecord[] };
        expect(written.annotations.map((record) => record.id).sort()).toEqual(["external", "local", "original"]);
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
