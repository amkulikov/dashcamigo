import { describe, expect, it } from "vitest";

import type { ClassifiedFile } from "../parsers/registry-light.js";
import type { VendorFile } from "../parsers/types.js";
import { buildVideoAssociationIndex } from "../gps-association.js";
import { vendorFileKey } from "../vendor-file-key.js";
import { hasIndexCacheIdentityCollision, indexCacheDependencyKey } from "./ingest-cache.js";

function classified(
    path: string,
    role: ClassifiedFile["role"],
    options: { size?: number; lastModified?: number } = {},
): ClassifiedFile {
    const name = path.split("/").pop()!;
    const file: VendorFile = {
        file: new File([new Uint8Array(options.size ?? 1)], name, { lastModified: options.lastModified ?? 1 }),
        relativePath: path,
    };
    return {
        file,
        role,
        sidecarId: role === "sidecar" || role === "accel-sidecar" ? "fixture" : null,
        sidecarMp4: role === "sidecar" || role === "accel-sidecar" ? "clip.mp4" : null,
        logExtractorId: role === "gps-log" ? "fixture-log" : null,
    };
}

describe("indexCacheDependencyKey", () => {
    it("changes when a parsed sidecar is edited or removed", () => {
        const video = classified("CARD/clip.mp4", "video");
        const original = classified("CARD/clip.gpx", "sidecar", { size: 10, lastModified: 1 });
        const edited = classified("CARD/clip.gpx", "sidecar", { size: 11, lastModified: 2 });

        expect(indexCacheDependencyKey(video, [video, original])).not.toBe(
            indexCacheDependencyKey(video, [video, edited]),
        );
        expect(indexCacheDependencyKey(video, [video, original])).not.toBe(indexCacheDependencyKey(video, [video]));
    });

    it("is independent of classification result order", () => {
        const video = classified("CARD/clip.mp4", "video");
        const log = classified("CARD/GPSData.txt", "gps-log");
        const sidecar = classified("CARD/clip.gpx", "sidecar");
        expect(indexCacheDependencyKey(video, [video, log, sidecar])).toBe(
            indexCacheDependencyKey(video, [sidecar, log, video]),
        );
    });

    it("ignores video and unknown files", () => {
        const video = classified("CARD/clip.mp4", "video");
        expect(indexCacheDependencyKey(video, [video])).toBe(
            indexCacheDependencyKey(video, [video, classified("CARD/readme.bin", "unknown")]),
        );
    });

    it("does not invalidate an unrelated same-batch video for one sidecar", () => {
        const a = classified("CARD/a.mp4", "video");
        const b = classified("CARD/b.mp4", "video");
        const sidecar = classified("CARD/a.gpx", "sidecar");
        sidecar.sidecarMp4 = "a.mp4";
        const files = [a, b, sidecar];
        const index = buildVideoAssociationIndex([a.file, b.file]);

        expect(indexCacheDependencyKey(a, files, index)).not.toBe("");
        expect(indexCacheDependencyKey(b, files, index)).toBe("");
    });

    it("changes when another video makes the basename association non-unique", () => {
        const video = classified("CARD/A/clip.mp4", "video");
        const peer = classified("CARD/B/clip.mp4", "video");
        const log = classified("CARD/GPSData.txt", "gps-log");

        expect(indexCacheDependencyKey(video, [video, log])).not.toBe(
            indexCacheDependencyKey(video, [video, peer, log]),
        );
    });

    it("attributes a manually paired GPX to its exact same-named video", () => {
        const a = classified("CARD/A/clip.mp4", "video");
        const b = classified("CARD/B/clip.mp4", "video");
        a.file.sourceKey = "card-a";
        b.file.sourceKey = "card-b";
        const gpx = classified("DROP/route.gpx", "sidecar");
        gpx.manualSidecarVideoKey = vendorFileKey(b.file);
        const index = buildVideoAssociationIndex([a.file, b.file]);

        expect(indexCacheDependencyKey(a, [a, b, gpx], index)).toBe(indexCacheDependencyKey(a, [a, b], index));
        expect(indexCacheDependencyKey(b, [a, b, gpx], index)).not.toBe(indexCacheDependencyKey(b, [a, b], index));
    });
});

describe("hasIndexCacheIdentityCollision", () => {
    it("detects equal persistent metadata belonging to distinct session sources", () => {
        const a = classified("CARD/clip.mp4", "video");
        const b = classified("CARD/clip.mp4", "video");
        a.file.sourceKey = "card-a";
        b.file.sourceKey = "card-b";
        const index = buildVideoAssociationIndex([a.file, b.file]);

        expect(hasIndexCacheIdentityCollision(a, index)).toBe(true);
        expect(hasIndexCacheIdentityCollision(b, index)).toBe(true);
    });

    it("allows an overwritten path when metadata gives it a distinct persistent key", () => {
        const old = classified("CARD/clip.mp4", "video", { lastModified: 1 });
        const next = classified("CARD/clip.mp4", "video", { lastModified: 2 });
        old.file.sourceKey = "card-a";
        next.file.sourceKey = "card-b";
        const index = buildVideoAssociationIndex([old.file, next.file]);

        expect(hasIndexCacheIdentityCollision(next, index)).toBe(false);
    });
});
