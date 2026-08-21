import { beforeEach, describe, expect, it } from "vitest";

import type { VendorFile } from "../parsers/types.js";
import type { IngestOrigin } from "./state.js";
import { _resetForTests, scopeIngestFiles } from "./ingest-source-key.js";

function files(): VendorFile[] {
    return [{ file: new File(["x"], "clip.mp4"), relativePath: "CARD/clip.mp4" }];
}

function origin(folderId = ""): IngestOrigin {
    return { handle: {} as FileSystemDirectoryHandle, folderId };
}

describe("scopeIngestFiles", () => {
    beforeEach(_resetForTests);

    it("keeps one scope for repeated reads through the same handle", () => {
        const picked = origin();
        expect(scopeIngestFiles(files(), picked)[0]!.sourceKey).toBe(scopeIngestFiles(files(), picked)[0]!.sourceKey);
    });

    it("gives independent ad-hoc drops independent scopes", () => {
        expect(scopeIngestFiles(files(), null)[0]!.sourceKey).not.toBe(scopeIngestFiles(files(), null)[0]!.sourceKey);
    });

    it("uses a remembered folder id as the stable scope", () => {
        expect(scopeIngestFiles(files(), origin("folder-id"))[0]!.sourceKey).toBe("folder:folder-id");
    });

    it("does not rescope a queued batch", () => {
        const scoped = scopeIngestFiles(files(), null);
        expect(scopeIngestFiles(scoped, null)).toBe(scoped);
    });
});
