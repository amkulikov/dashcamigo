import { describe, expect, it, vi } from "vitest";

import { dropDuplicateFiles } from "./ingest-dedup.js";
import { cameraFingerprint } from "./parsers/camera-fingerprint.js";
import type { VendorFile } from "./parsers/types.js";

// Big enough to exercise the separate tail probe (> 64 KiB head window).
const LARGE_SIZE = 200 * 1024;

/** File filled with `fill`, with optional byte patches at given offsets. */
function makeContent(size: number, fill: number, patches: Record<number, number> = {}): Uint8Array<ArrayBuffer> {
    const buf = new Uint8Array(size).fill(fill);
    for (const [offset, value] of Object.entries(patches)) {
        buf[Number(offset)] = value;
    }
    return buf;
}

function vf(
    relativePath: string,
    content: Uint8Array<ArrayBuffer> | string,
    options: { lastModified?: number; sourceKey?: string } = {},
): VendorFile {
    const name = relativePath.split("/").pop()!;
    return {
        file: new File([content], name, { lastModified: options.lastModified ?? 1 }),
        relativePath,
        sourceKey: options.sourceKey,
    };
}

describe("dropDuplicateFiles", () => {
    it("passes unique files through untouched, preserving order", async () => {
        const incoming = [
            vf("Normal/Front/A.MP4", makeContent(1024, 1)),
            vf("Normal/Front/B.MP4", makeContent(1024, 2)),
            vf("Normal/Back/C.MP4", makeContent(2048, 3)),
        ];
        const { kept, dropped } = await dropDuplicateFiles(incoming, []);
        expect(kept).toEqual(incoming);
        expect(dropped).toEqual([]);
    });

    it("keeps same-name files of different sizes without probing", async () => {
        // 70mai .s_* proxies share a basename with the full-res clip but differ
        // in size - they must never collide on the metadata key.
        const incoming = [vf("Normal/Front/X.MP4", makeContent(4096, 1)), vf("proxy/X.MP4", makeContent(1024, 1))];
        const { kept, dropped } = await dropDuplicateFiles(incoming, []);
        expect(kept).toHaveLength(2);
        expect(dropped).toEqual([]);
    });

    it("drops a byte-identical copy from another subfolder", async () => {
        const content = makeContent(LARGE_SIZE, 7);
        const incoming = [vf("Movie/front/0001.MP4", content), vf("backupcopy/0001.MP4", content)];
        const { kept, dropped } = await dropDuplicateFiles(incoming, []);
        expect(kept).toHaveLength(1);
        expect(dropped).toEqual([{ droppedPath: "backupcopy/0001.MP4", keptPath: "Movie/front/0001.MP4" }]);
    });

    it("prefers the copy whose path is recognised by a channel technique", async () => {
        // The backup copy comes FIRST in the drop; the channel-matched path
        // (/front/ folder) must still survive - relativePath feeds the
        // path-based classifiers, so the structure-less copy is the one to drop.
        const content = makeContent(LARGE_SIZE, 7);
        const incoming = [vf("backupcopy/0001.MP4", content), vf("Movie/front/0001.MP4", content)];
        const { kept, dropped } = await dropDuplicateFiles(incoming, []);
        expect(kept.map((f) => f.relativePath)).toEqual(["Movie/front/0001.MP4"]);
        expect(dropped).toEqual([{ droppedPath: "backupcopy/0001.MP4", keptPath: "Movie/front/0001.MP4" }]);
    });

    it("keeps same-name same-size files whose heads differ", async () => {
        const incoming = [
            vf("Movie/front/0001.MP4", makeContent(LARGE_SIZE, 7, { 100: 1 })),
            vf("Movie/rear/0001.MP4", makeContent(LARGE_SIZE, 7, { 100: 2 })),
        ];
        const { kept, dropped } = await dropDuplicateFiles(incoming, []);
        expect(kept).toHaveLength(2);
        expect(dropped).toEqual([]);
    });

    it("keeps same-name same-size files that differ only in the tail", async () => {
        // Identical head (shared container prefix), divergence past the head
        // probe window - the tail probe must catch it.
        const incoming = [
            vf("a/0001.MP4", makeContent(LARGE_SIZE, 7, { [LARGE_SIZE - 10]: 1 })),
            vf("b/0001.MP4", makeContent(LARGE_SIZE, 7, { [LARGE_SIZE - 10]: 2 })),
        ];
        const { kept, dropped } = await dropDuplicateFiles(incoming, []);
        expect(kept).toHaveLength(2);
        expect(dropped).toEqual([]);
    });

    it("collapses three identical copies into one", async () => {
        const content = makeContent(LARGE_SIZE, 5);
        const incoming = [vf("a/X.MP4", content), vf("b/X.MP4", content), vf("c/X.MP4", content)];
        const { kept, dropped } = await dropDuplicateFiles(incoming, []);
        expect(kept).toHaveLength(1);
        expect(dropped).toHaveLength(2);
    });

    it("handles tiny files (whole file inside the head probe)", async () => {
        const content = makeContent(16, 9);
        const incoming = [vf("a/S.MP4", content), vf("b/S.MP4", content)];
        const { kept, dropped } = await dropDuplicateFiles(incoming, []);
        expect(kept).toHaveLength(1);
        expect(dropped).toHaveLength(1);
    });

    it("drops a copy of an already-loaded file (cross-drop dedup)", async () => {
        const content = makeContent(LARGE_SIZE, 3);
        const loaded = [vf("Normal/Front/Y.MP4", content)];
        const incoming = [vf("Backup/Y.MP4", content)];
        const { kept, dropped } = await dropDuplicateFiles(incoming, loaded);
        expect(kept).toEqual([]);
        expect(dropped).toEqual([{ droppedPath: "Backup/Y.MP4", keptPath: "Normal/Front/Y.MP4" }]);
    });

    it("keeps a same-name same-size file whose content differs from the loaded one", async () => {
        const loaded = [vf("Normal/Front/Y.MP4", makeContent(LARGE_SIZE, 3, { 50: 1 }))];
        const incoming = [vf("Other/Y.MP4", makeContent(LARGE_SIZE, 3, { 50: 2 }))];
        const { kept, dropped } = await dropDuplicateFiles(incoming, loaded);
        expect(kept).toHaveLength(1);
        expect(dropped).toEqual([]);
    });

    it("preserves incoming order across multiple groups", async () => {
        const c1 = makeContent(1024, 1);
        const c2 = makeContent(1024, 2);
        const incoming = [
            vf("z/late.MP4", c1),
            vf("a/early.MP4", c2),
            vf("copy/late.MP4", c1), // dup of [0]; wins lexicographically (no channel/depth signal)
        ];
        const { kept } = await dropDuplicateFiles(incoming, []);
        // Survivors keep their incoming positions: a/early at [1], copy/late at [2].
        expect(kept.map((f) => f.relativePath)).toEqual(["a/early.MP4", "copy/late.MP4"]);
    });

    it("keeps a camera's channels in one folder so they do not split into separate frames", async () => {
        // Regression: a duplicated front channel that survives from a DIFFERENT
        // parent than its (non-duplicated) rear sibling gets a different camera
        // fingerprint, so the two channels stop merging into one multichannel
        // trip and the player plays front then rear sequentially. Here a Juscar
        // dual recording lives in `rig/video/{front,rear}` and a partial copy
        // (front only, no rear) sits in `rig mono/video/front`. The front copies
        // are byte-identical; the survivor must stay in `rig/video` (where the
        // camera also has its rear) so both channels keep one fingerprint.
        const frontContent = makeContent(LARGE_SIZE, 11);
        const rearContent = makeContent(LARGE_SIZE, 22);
        const incoming = [
            vf("Samples/rig/video/front/20260512_150820F.ts", frontContent),
            vf("Samples/rig/video/rear/20260512_150820R.ts", rearContent),
            // Byte-identical front copy in a sibling folder that lacks the rear.
            // The old lexicographic tie-break kept THIS one ("rig mono" < "rig"
            // because space < "/"), splitting the channels.
            vf("Samples/rig mono/video/front/20260512_150820F.ts", frontContent),
        ];
        const { kept, dropped } = await dropDuplicateFiles(incoming, []);

        const keptFront = kept.find((f) => f.file.name.endsWith("F.ts"));
        const keptRear = kept.find((f) => f.file.name.endsWith("R.ts"));
        expect(keptFront, "front survivor").toBeDefined();
        expect(keptRear, "rear survivor").toBeDefined();
        // The front survives from the folder that holds the rear, not the mono copy.
        expect(keptFront!.relativePath).toBe("Samples/rig/video/front/20260512_150820F.ts");
        expect(dropped).toEqual([
            {
                droppedPath: "Samples/rig mono/video/front/20260512_150820F.ts",
                keptPath: "Samples/rig/video/front/20260512_150820F.ts",
            },
        ]);
        // The point of the fix: both channels share one camera fingerprint, so
        // groupTrips merges them into one multichannel frame.
        expect(cameraFingerprint(keptFront!)).toBe(cameraFingerprint(keptRear!));
    });

    it("drops the same source/path/metadata identity with zero content probes (B4)", async () => {
        // Re-reading the same scoped folder: source, path, size, and mtime all
        // agree, so no slice() (head/tail probe) should run.
        const content = makeContent(LARGE_SIZE, 3);
        const loaded = [vf("Normal/Front/Y.MP4", content, { sourceKey: "card" })];
        const incoming = [vf("Normal/Front/Y.MP4", content, { sourceKey: "card" })];
        const sliceSpy = vi.spyOn(File.prototype, "slice");
        try {
            const { kept, dropped } = await dropDuplicateFiles(incoming, loaded);
            expect(kept).toEqual([]);
            expect(dropped).toEqual([{ droppedPath: "Normal/Front/Y.MP4", keptPath: "Normal/Front/Y.MP4" }]);
            expect(sliceSpy).not.toHaveBeenCalled();
        } finally {
            sliceSpy.mockRestore();
        }
    });

    it("keeps an overwritten same-path file when its metadata and content changed", async () => {
        const loaded = [vf("Normal/Front/Y.MP4", makeContent(LARGE_SIZE, 3), { lastModified: 1, sourceKey: "card" })];
        const incoming = [vf("Normal/Front/Y.MP4", makeContent(LARGE_SIZE, 4), { lastModified: 2, sourceKey: "card" })];
        const { kept, dropped } = await dropDuplicateFiles(incoming, loaded);
        expect(kept).toEqual(incoming);
        expect(dropped).toEqual([]);
    });

    it("does not treat an equal path on another source as path identity", async () => {
        const loaded = [vf("DCIM/Y.MP4", makeContent(LARGE_SIZE, 3), { sourceKey: "card-a" })];
        const incoming = [vf("DCIM/Y.MP4", makeContent(LARGE_SIZE, 4), { sourceKey: "card-b" })];
        const sliceSpy = vi.spyOn(File.prototype, "slice");
        try {
            const { kept, dropped } = await dropDuplicateFiles(incoming, loaded);
            expect(kept).toEqual(incoming);
            expect(dropped).toEqual([]);
            expect(sliceSpy).toHaveBeenCalled();
        } finally {
            sliceSpy.mockRestore();
        }
    });

    it("still probes distinct-path same-(name,size) files with different content (B4 negative case)", async () => {
        // Different relativePath must NOT short-circuit - the full sameContent
        // probe still runs, and here it correctly finds them distinct.
        const loaded = [vf("Normal/Front/Y.MP4", makeContent(LARGE_SIZE, 3, { 50: 1 }))];
        const incoming = [vf("Other/Y.MP4", makeContent(LARGE_SIZE, 3, { 50: 2 }))];
        const sliceSpy = vi.spyOn(File.prototype, "slice");
        try {
            const { kept, dropped } = await dropDuplicateFiles(incoming, loaded);
            expect(kept).toHaveLength(1);
            expect(dropped).toEqual([]);
            expect(sliceSpy).toHaveBeenCalled();
        } finally {
            sliceSpy.mockRestore();
        }
    });

    it("throws AbortError when the signal is already aborted and probing is needed", async () => {
        const content = makeContent(1024, 4);
        const incoming = [vf("a/X.MP4", content), vf("b/X.MP4", content)];
        const controller = new AbortController();
        controller.abort();
        await expect(dropDuplicateFiles(incoming, [], controller.signal)).rejects.toThrowError(/aborted/);
    });

    it("returns empty result for an empty drop", async () => {
        const { kept, dropped } = await dropDuplicateFiles([], []);
        expect(kept).toEqual([]);
        expect(dropped).toEqual([]);
    });
});
