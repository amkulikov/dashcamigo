// The source-row grouping and its display labels. The regression under guard:
// Chromium names a Windows drive-root handle "\", which the path split used to
// swallow - one picked flash card shattered into per-subfolder rows, none of
// them holding the handle, so Remember bound zero files.

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { VendorFile } from "../parsers/types.js";
import { rememberFolder } from "../persist/folders.js";
import { fileIdentityKey, fileIdentityOf } from "../persist/identity.js";
import type { RememberedFolder } from "../persist/types.js";

// Sever the DOM-touching imports; the grouping logic under test never reaches
// rendering (the list element is absent) or the store.
vi.mock("../i18n/index.js", () => ({ t: (key: string) => key }));
vi.mock("./icons.js", () => ({ buildLucideIcon: () => null }));
vi.mock("./notifications.js", () => ({ notify: vi.fn() }));
vi.mock("../persist/folders.js", () => ({
    ensureDirectoryReadwritePermission: vi.fn(async () => true),
    forgetFolder: vi.fn(),
    getFolder: vi.fn(),
    listFolders: vi.fn(async () => []),
    probeFolderAvailability: vi.fn(async () => "available"),
    rememberFolder: vi.fn(),
}));

import {
    _resetForTests,
    bindSourceToFolder,
    disambiguatedLabels,
    folderDisplayLabel,
    folderIdForFileKey,
    hasLiveSource,
    connectWritableFolderToSource,
    registerFolderOpenedHook,
    registerIngestNotesFiles,
    registerIngestSource,
    rememberLiveSource,
} from "./folder-sources.js";
import type { IngestOrigin } from "./state.js";

function vendorFile(relativePath: string): VendorFile {
    const basename = relativePath.split(/[/\\]/).pop() ?? relativePath;
    return { file: new File(["0"], basename, { lastModified: 1_700_000_000_000 }), relativePath };
}

function keyOf(vf: VendorFile): string {
    return fileIdentityKey(fileIdentityOf(vf.file, vf.relativePath));
}

// Boundary casts: a real handle needs a browser; only .name is read here.
function fakeHandle(name: string): FileSystemDirectoryHandle {
    return { name } as FileSystemDirectoryHandle;
}

function fakeFolder(id: string, label: string, addedAt: number): RememberedFolder {
    return { id, label, addedAt } as RememberedFolder;
}

describe("registerIngestSource", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        _resetForTests();
    });

    it("keeps a picker batch on the handle's single row when the handle is a drive root", () => {
        const files = [vendorFile("\\/Vlog/a.mp4"), vendorFile("\\/b.mp4")];
        const origin: IngestOrigin = { handle: fakeHandle("\\"), folderId: "folder-1" };
        registerIngestSource(files, origin);
        expect(folderIdForFileKey(keyOf(files[0]!)), "subfolder file binds to the folder").toBe("folder-1");
        expect(folderIdForFileKey(keyOf(files[1]!)), "root-level file binds to the folder").toBe("folder-1");
        expect(hasLiveSource(keyOf(files[0]!)), "the drive-root row holds the handle").toBe(true);
        expect(hasLiveSource(null), "it is the session's sole live source").toBe(true);
    });

    it("still creates the handle row when dedup emptied the picker batch", () => {
        registerIngestSource([], { handle: fakeHandle("DCIM"), folderId: "" });
        expect(hasLiveSource(null)).toBe(true);
    });

    it("keeps same-named picker folders and identical file identities separate", () => {
        const handleA = fakeHandle("DCIM");
        const handleB = fakeHandle("DCIM");
        const fileA = { ...vendorFile("DCIM/a.mp4"), sourceKey: "card-a" };
        const fileB = { ...vendorFile("DCIM/a.mp4"), sourceKey: "card-b" };

        registerIngestSource([fileA], { handle: handleA, folderId: "folder-a" });
        registerIngestSource([fileB], { handle: handleB, folderId: "folder-b" });

        expect(folderIdForFileKey(keyOf(fileA), "card-a")).toBe("folder-a");
        expect(folderIdForFileKey(keyOf(fileB), "card-b")).toBe("folder-b");
        expect(folderIdForFileKey(keyOf(fileA)), "an unscoped lookup refuses the ambiguous identity").toBe("");
        expect(hasLiveSource(keyOf(fileA)), "an unscoped backup action refuses to guess between cards").toBe(false);
    });

    it("does not borrow a remembered owner for an identical file from an unremembered card", () => {
        const fileA = { ...vendorFile("DCIM/a.mp4"), sourceKey: "card-a" };
        const fileB = { ...vendorFile("DCIM/a.mp4"), sourceKey: "card-b" };

        registerIngestSource([fileA], { handle: fakeHandle("DCIM"), folderId: "folder-a" });
        registerIngestSource([fileB], { handle: fakeHandle("DCIM"), folderId: "" });

        expect(folderIdForFileKey(keyOf(fileA), "card-a")).toBe("folder-a");
        expect(folderIdForFileKey(keyOf(fileB), "card-b")).toBe("");
    });

    it("keeps one source row when the same remembered folder is picked again", () => {
        const first = { ...vendorFile("CARD/a.mp4"), sourceKey: "first-open" };
        const second = { ...vendorFile("CARD/b.mp4"), sourceKey: "second-open" };

        registerIngestSource([first], { handle: fakeHandle("CARD"), folderId: "folder-a" });
        registerIngestSource([second], { handle: fakeHandle("CARD"), folderId: "folder-a" });

        expect(hasLiveSource(null), "the remembered folder remains one live source").toBe(true);
        expect(folderIdForFileKey(keyOf(first), "first-open")).toBe("folder-a");
        expect(folderIdForFileKey(keyOf(second), "second-open")).toBe("folder-a");
    });

    it("groups a handle-less drop by each path's root folder", () => {
        const cardA = vendorFile("CARD/Normal/a.mp4");
        const cardB = vendorFile("CARD/Vlog/b.mp4");
        const other = vendorFile("OTHER/c.mp4");
        const bare = vendorFile("d.mp4");
        registerIngestSource([cardA, cardB, other, bare], null);
        // A late bind of the CARD handle must pick up exactly the CARD files.
        bindSourceToFolder(fakeHandle("CARD"), fakeFolder("folder-2", "CARD", 1));
        expect(folderIdForFileKey(keyOf(cardA)), "CARD file joins the bound folder").toBe("folder-2");
        expect(folderIdForFileKey(keyOf(cardB)), "second CARD file joins too").toBe("folder-2");
        expect(folderIdForFileKey(keyOf(other)), "another root stays unbound").toBe("");
        expect(folderIdForFileKey(keyOf(bare)), "a loose file stays unbound").toBe("");
        expect(hasLiveSource(keyOf(other)), "the other root has no handle").toBe(false);
    });

    it("waits for notes-file discovery when remembering a live source", async () => {
        const file = vendorFile("CARD/Normal/a.mp4");
        const handle = fakeHandle("CARD");
        const folder = { ...fakeFolder("folder-3", "CARD", 1), handle, lastOpenedAt: 2 };
        vi.mocked(rememberFolder).mockResolvedValue(folder);
        registerIngestSource([file], { handle, folderId: "" });

        let finishDiscovery: (() => void) | undefined;
        const discovery = new Promise<void>((resolve) => {
            finishDiscovery = resolve;
        });
        const opened = vi.fn(() => discovery);
        registerFolderOpenedHook(opened);

        let settled = false;
        const remembering = rememberLiveSource(keyOf(file)).then((result) => {
            settled = true;
            return result;
        });
        await vi.waitFor(() => expect(opened).toHaveBeenCalledWith(folder));
        expect(settled, "must not outrun auto-adoption").toBe(false);
        finishDiscovery?.();
        await expect(remembering).resolves.toBe(folder);
    });

    it("connects a read-only notes source only after the same folder is selected", async () => {
        const file = vendorFile("CARD/Normal/a.mp4");
        const notes = vendorFile("CARD/notes.dashcamigo");
        registerIngestSource([file, notes], null);
        registerIngestNotesFiles([
            { sourceKey: "unscoped", root: "CARD", fileName: "notes.dashcamigo", state: "loaded" },
        ]);

        const handle = fakeHandle("CARD");
        const folder = { ...fakeFolder("folder-4", "CARD", 1), handle, lastOpenedAt: 2 };
        vi.mocked(rememberFolder).mockResolvedValue(folder);
        const opened = vi.fn(async () => {});
        registerFolderOpenedHook(opened);

        await expect(
            connectWritableFolderToSource("drop:unscoped:CARD", handle, [vendorFile("CARD/other.mp4")]),
            "an unrelated folder must never receive the notes",
        ).resolves.toBe(false);
        await expect(
            connectWritableFolderToSource("drop:unscoped:CARD", handle, [
                vendorFile("CARD/other.mp4"),
                vendorFile("CARD/notes.dashcamigo"),
            ]),
            "the notes file itself is not proof that the recordings folder matches",
        ).resolves.toBe(false);
        await expect(
            connectWritableFolderToSource("drop:unscoped:CARD", handle, [
                file,
                vendorFile("CARD/nested/notes.dashcamigo"),
            ]),
            "auto-sync only watches the selected folder root",
        ).resolves.toBe(false);
        expect(rememberFolder).not.toHaveBeenCalled();

        await expect(connectWritableFolderToSource("drop:unscoped:CARD", handle, [file, notes])).resolves.toBe(true);
        expect(rememberFolder).toHaveBeenCalledWith(handle);
        expect(opened).toHaveBeenCalledWith(folder);
        expect(folderIdForFileKey(keyOf(file))).toBe("folder-4");
    });

    it("keeps notes status on the sole source row after a duplicate-only re-open", async () => {
        const file = { ...vendorFile("CARD/Normal/a.mp4"), sourceKey: "first-open" };
        const notes = vendorFile("CARD/notes.dashcamigo");
        registerIngestSource([file], null);
        registerIngestNotesFiles([
            { sourceKey: "second-open", root: "CARD", fileName: "notes.dashcamigo", state: "loaded" },
        ]);

        const handle = fakeHandle("CARD");
        const folder = { ...fakeFolder("folder-5", "CARD", 1), handle, lastOpenedAt: 2 };
        vi.mocked(rememberFolder).mockResolvedValue(folder);
        registerFolderOpenedHook(vi.fn(async () => {}));

        await expect(
            connectWritableFolderToSource("drop:first-open:CARD", handle, [file, notes]),
            "the later notes-only pass annotates the existing source",
        ).resolves.toBe(true);
    });

    it("does not attach a notes-only reopen when its duplicate recording matches two cards", async () => {
        const loadedA = { ...vendorFile("CARD/Y.MP4"), sourceKey: "card-a" };
        const loadedB = { ...vendorFile("CARD/Y.MP4"), sourceKey: "card-b" };
        const incoming = { ...vendorFile("CARD/Y.MP4"), sourceKey: "card-c" };
        registerIngestSource([loadedA], null);
        registerIngestSource([loadedB], null);
        registerIngestSource([], null, [
            { incoming, loaded: loadedA },
            { incoming, loaded: loadedB },
        ]);
        registerIngestNotesFiles([
            { sourceKey: "card-c", root: "CARD", fileName: "notes.dashcamigo", state: "loaded" },
        ]);

        const handle = fakeHandle("CARD");
        const selected = [incoming, { ...vendorFile("CARD/notes.dashcamigo"), sourceKey: "card-c" }];
        await expect(connectWritableFolderToSource("drop:card-a:CARD", handle, selected)).resolves.toBe(false);
        await expect(connectWritableFolderToSource("drop:card-b:CARD", handle, selected)).resolves.toBe(false);
    });

    it("attaches a drive-root notes file to its picker source despite the root-label mismatch", async () => {
        const handle = fakeHandle("\\");
        const file = { ...vendorFile("\\/Vlog/a.mp4"), sourceKey: "drive-open" };
        const notes = { ...vendorFile("\\/notes.dashcamigo"), sourceKey: "drive-open" };
        registerIngestSource([file, notes], { handle, folderId: "" });
        // Path parsing sees the notes file at root "", while Chromium exposes
        // the picked drive's handle name as "\\".
        registerIngestNotesFiles([
            { sourceKey: "drive-open", root: "", fileName: "notes.dashcamigo", state: "loaded" },
        ]);

        const folder = { ...fakeFolder("folder-6", "\\", 1), handle, lastOpenedAt: 2 };
        vi.mocked(rememberFolder).mockResolvedValue(folder);
        registerFolderOpenedHook(vi.fn(async () => {}));

        await expect(
            connectWritableFolderToSource("handle:1", handle, [file, notes]),
            "the notes status must remain attached to the live drive-root row",
        ).resolves.toBe(true);
    });
});

describe("folderDisplayLabel", () => {
    it("replaces a separator-only name with the drive-root label", () => {
        expect(folderDisplayLabel("\\")).toBe("folderSources.driveRoot");
        expect(folderDisplayLabel("/")).toBe("folderSources.driveRoot");
    });

    it("passes ordinary names and the empty name through", () => {
        expect(folderDisplayLabel("DCIM")).toBe("DCIM");
        expect(folderDisplayLabel(""), "empty stays empty for the loose-files fallback").toBe("");
    });
});

describe("disambiguatedLabels", () => {
    it("disambiguates two drive roots by their shared display label", () => {
        const labels = disambiguatedLabels([fakeFolder("a", "\\", 1), fakeFolder("b", "/", 2)]);
        expect(labels.get("a"), "the older folder keeps the bare label").toBeUndefined();
        expect(labels.get("b")).toBe("folderSources.driveRoot (2)");
    });

    it("suffixes same-named folders in addedAt order", () => {
        const labels = disambiguatedLabels([fakeFolder("late", "DCIM", 5), fakeFolder("early", "DCIM", 1)]);
        expect(labels.get("early")).toBeUndefined();
        expect(labels.get("late")).toBe("DCIM (2)");
    });
});
