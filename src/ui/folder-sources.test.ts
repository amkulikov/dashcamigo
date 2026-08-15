// The source-row grouping and its display labels. The regression under guard:
// Chromium names a Windows drive-root handle "\", which the path split used to
// swallow - one picked flash card shattered into per-subfolder rows, none of
// them holding the handle, so Remember bound zero files.

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { VendorFile } from "../parsers/types.js";
import { fileIdentityKey, fileIdentityOf } from "../persist/identity.js";
import type { RememberedFolder } from "../persist/types.js";

// Sever the DOM-touching imports; the grouping logic under test never reaches
// rendering (the list element is absent) or the store.
vi.mock("../i18n/index.js", () => ({ t: (key: string) => key }));
vi.mock("./icons.js", () => ({ buildLucideIcon: () => null }));
vi.mock("./notifications.js", () => ({ notify: vi.fn() }));
vi.mock("../persist/folders.js", () => ({
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
    registerIngestSource,
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
