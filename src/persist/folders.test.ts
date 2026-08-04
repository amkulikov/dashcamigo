import { describe, expect, it, vi } from "vitest";

import { enumerateFolder } from "./folders.js";

// Fakes stand in for FileSystemDirectoryHandle: the real API needs a browser
// and a user gesture, while the walk under test is pure iteration. vi.fn wraps
// let the tests assert that pruned entries are never touched at all.

interface FakeEntry {
    kind: "file" | "directory";
    name: string;
}

function fakeFile(name: string) {
    return {
        kind: "file" as const,
        name,
        getFile: vi.fn(async () => new File(["x"], name)),
    };
}

function fakeDir(name: string, children: FakeEntry[] = []) {
    return {
        kind: "directory" as const,
        name,
        values: vi.fn(async function* () {
            yield* children;
        }),
    };
}

// Mirrors how the platform surfaces OS metadata directories: the handle
// enumerates fine as a child, but iterating it rejects.
function fakeUnreadableDir(name: string) {
    return {
        kind: "directory" as const,
        name,
        values: vi.fn(() => ({
            [Symbol.asyncIterator]() {
                return this;
            },
            async next(): Promise<IteratorResult<FakeEntry>> {
                throw new Error("permission denied by the platform");
            },
        })),
    };
}

function asHandle(dir: unknown): FileSystemDirectoryHandle {
    return dir as FileSystemDirectoryHandle;
}

describe("enumerateFolder", () => {
    it("prunes hidden and OS-junk children without reading them or counting errors", async () => {
        const spotlight = fakeUnreadableDir(".Spotlight-V100");
        const systemVolumeInformation = fakeUnreadableDir("System Volume Information");
        const dsStore = fakeFile(".DS_Store");
        const clip = fakeFile("clip.mp4");
        const root = fakeDir("SD", [spotlight, systemVolumeInformation, dsStore, fakeDir("Normal", [clip])]);

        const result = await enumerateFolder(asHandle(root));

        expect(result.files.map((vf) => vf.relativePath)).toEqual(["SD/Normal/clip.mp4"]);
        expect(result.readErrors, "a pruned entry is not a failure").toBe(0);
        expect(spotlight.values).not.toHaveBeenCalled();
        expect(systemVolumeInformation.values).not.toHaveBeenCalled();
        expect(dsStore.getFile).not.toHaveBeenCalled();
    });

    it("counts a non-junk unreadable subdirectory as a read error and keeps walking", async () => {
        const broken = fakeUnreadableDir("DCIM");
        const clip = fakeFile("clip.mp4");
        const root = fakeDir("SD", [broken, clip]);

        const result = await enumerateFolder(asHandle(root));

        expect(result.files.map((vf) => vf.relativePath)).toEqual(["SD/clip.mp4"]);
        expect(result.readErrors).toBe(1);
    });
});
