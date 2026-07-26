import { describe, expect, it } from "vitest";

import { buildStructureReport, looksLikeRecordings } from "./report-structure.js";
import type { VendorFile } from "./parsers/types.js";

/** Builds a VendorFile with a real File; name is the basename of relativePath. */
function vf(relativePath: string, opts: { size?: number; mtime?: number } = {}): VendorFile {
    const slash = relativePath.lastIndexOf("/");
    const name = slash < 0 ? relativePath : relativePath.slice(slash + 1);
    const size = opts.size ?? 1;
    const file = new File([new Uint8Array(size)], name, { lastModified: opts.mtime ?? 0 });
    return { file, relativePath };
}

describe("looksLikeRecordings", () => {
    it("is true when a video-like file is present", () => {
        expect(looksLikeRecordings([vf("DCIM/FILE0001.MP4"), vf("info.txt")])).toBe(true);
    });

    it("is false when nothing looks like a recording", () => {
        expect(looksLikeRecordings([vf("readme.txt"), vf("photo.jpg")])).toBe(false);
    });

    it("is false for an empty drop", () => {
        expect(looksLikeRecordings([])).toBe(false);
    });
});

describe("buildStructureReport", () => {
    it("includes header, extension histogram and the file listing", () => {
        const report = buildStructureReport([
            vf("Front/FILE0001.MP4", { size: 3_200_000, mtime: Date.UTC(2024, 5, 14, 16, 16) }),
            vf("Front/FILE0002.MP4", { size: 3_100_000 }),
            vf("info.txt", { size: 40 }),
        ]);
        expect(report).toContain("dashcamigo camera report");
        expect(report).toContain("files: 3");
        // Extension histogram, .mp4 twice.
        expect(report).toMatch(/\.mp4\s+2/);
        expect(report).toMatch(/\.txt\s+1/);
        // File listing carries the paths and the UTC modified time.
        expect(report).toContain("Front/FILE0001.MP4");
        expect(report).toContain("2024-06-14 16:16");
        // Privacy reassurance line is part of the body.
        expect(report).toContain("No video, no GPS coordinates");
    });

    it("recognises a path-based channel technique (Front/ folder)", () => {
        const report = buildStructureReport([vf("Front/FILE0001.MP4"), vf("Rear/FILE0001.MP4")]);
        const channelLine = report.split("\n").find((l) => l.trim().startsWith("channel"));
        expect(channelLine).toBeDefined();
        // A Front/Rear directory layout is a known channel technique - must not
        // report the field as unrecognised.
        expect(channelLine).not.toContain("not recognised");
    });

    it("flags a basename sidecar pairing (video + companion file)", () => {
        const report = buildStructureReport([vf("REC/20240614.MP4"), vf("REC/20240614.NMEA")]);
        const sidecarBlock = report.slice(report.indexOf("== possible sidecars"));
        expect(sidecarBlock).toContain("20240614");
        expect(sidecarBlock).not.toContain("none found");
    });

    it("truncates the listing past the cap and announces it", () => {
        const many: VendorFile[] = [];
        for (let i = 0; i < 3005; i++) many.push(vf(`DCIM/FILE${String(i).padStart(5, "0")}.MP4`));
        const report = buildStructureReport(many);
        expect(report).toMatch(/and \d+ more \(list truncated\)/);
        expect(report).toContain("files: 3005");
    });
});
