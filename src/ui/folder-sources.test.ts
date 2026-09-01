import { beforeEach, describe, expect, it, vi } from "vitest";

import type { VendorFile } from "../parsers/types.js";
import { fileIdentityKey, fileIdentityOf } from "../persist/identity.js";
import type { RememberedFolder } from "../persist/types.js";
import type { IngestOrigin } from "./state.js";

vi.mock("../i18n/index.js", () => ({ t: (key: string) => key }));
vi.mock("./icons.js", () => ({ buildLucideIcon: () => null }));
vi.mock("./notifications.js", () => ({ notify: vi.fn() }));
vi.mock("../persist/folders.js", () => ({
    forgetFolder: vi.fn(),
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
    registerIngestSource,
} from "./folder-sources.js";

function vendorFile(relativePath: string, sourceKey?: string): VendorFile {
    const basename = relativePath.split(/[/\\]/).pop() ?? relativePath;
    return {
        file: new File(["0"], basename, { lastModified: 1_700_000_000_000 }),
        relativePath,
        ...(sourceKey ? { sourceKey } : {}),
    };
}

function keyOf(vf: VendorFile): string {
    return fileIdentityKey(fileIdentityOf(vf.file, vf.relativePath));
}

function fakeHandle(name: string): FileSystemDirectoryHandle {
    return { name } as FileSystemDirectoryHandle;
}

function fakeFolder(id: string, label: string, addedAt: number): RememberedFolder {
    return { id, label, addedAt, lastOpenedAt: addedAt, handle: fakeHandle(label) };
}

beforeEach(() => {
    vi.clearAllMocks();
    _resetForTests();
});

describe("registerIngestSource", () => {
    it("keeps a drive-root picker batch bound to one remembered folder", () => {
        const files = [vendorFile("\\/Vlog/a.mp4", "card"), vendorFile("\\/b.mp4", "card")];
        const origin: IngestOrigin = { handle: fakeHandle("\\"), folderId: "folder-1" };
        registerIngestSource(files, origin);

        expect(folderIdForFileKey(keyOf(files[0]!), "card")).toBe("folder-1");
        expect(folderIdForFileKey(keyOf(files[1]!), "card")).toBe("folder-1");
    });

    it("keeps same-named folders with identical files separate by source", () => {
        const fileA = vendorFile("DCIM/a.mp4", "card-a");
        const fileB = vendorFile("DCIM/a.mp4", "card-b");
        registerIngestSource([fileA], { handle: fakeHandle("DCIM"), folderId: "folder-a" });
        registerIngestSource([fileB], { handle: fakeHandle("DCIM"), folderId: "folder-b" });

        expect(folderIdForFileKey(keyOf(fileA), "card-a")).toBe("folder-a");
        expect(folderIdForFileKey(keyOf(fileB), "card-b")).toBe("folder-b");
        expect(folderIdForFileKey(keyOf(fileA)), "unscoped identity stays ambiguous").toBe("");
    });

    it("does not borrow ownership from an identical remembered copy", () => {
        const fileA = vendorFile("DCIM/a.mp4", "card-a");
        const fileB = vendorFile("DCIM/a.mp4", "card-b");
        registerIngestSource([fileA], { handle: fakeHandle("DCIM"), folderId: "folder-a" });
        registerIngestSource([fileB], { handle: fakeHandle("DCIM"), folderId: "" });

        expect(folderIdForFileKey(keyOf(fileA), "card-a")).toBe("folder-a");
        expect(folderIdForFileKey(keyOf(fileB), "card-b")).toBe("");
    });

    it("groups a handle-less drop by path root and binds only the matching source", () => {
        const cardA = vendorFile("CARD/Normal/a.mp4");
        const cardB = vendorFile("CARD/Vlog/b.mp4");
        const other = vendorFile("OTHER/c.mp4");
        registerIngestSource([cardA, cardB, other], null);
        bindSourceToFolder(fakeHandle("CARD"), fakeFolder("folder-2", "CARD", 1));

        expect(folderIdForFileKey(keyOf(cardA))).toBe("folder-2");
        expect(folderIdForFileKey(keyOf(cardB))).toBe("folder-2");
        expect(folderIdForFileKey(keyOf(other))).toBe("");
    });
});

describe("folder labels", () => {
    it("replaces a separator-only name with the drive-root label", () => {
        expect(folderDisplayLabel("\\")).toBe("folderSources.driveRoot");
        expect(folderDisplayLabel("/")).toBe("folderSources.driveRoot");
    });

    it("disambiguates duplicate labels in added order", () => {
        const labels = disambiguatedLabels([fakeFolder("late", "DCIM", 5), fakeFolder("early", "DCIM", 1)]);
        expect(labels.get("early")).toBeUndefined();
        expect(labels.get("late")).toBe("DCIM (2)");
    });
});
