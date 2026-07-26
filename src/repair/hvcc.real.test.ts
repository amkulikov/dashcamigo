// Integration test against real 70mai x800 files from one trip: 580/583 are
// valid, 581/582 have the zeroed-hvcC-header defect (Pattern A). Conditionally
// skipped when the files are absent (no private/, or moved out of incoming/).
// The files are under NDA and are not committed.
//
// What we verify on the real bytes (the committed synthetic-byte tests in
// hvcc.test.ts / moov-repair.test.ts / mp4-indexing.test.ts guard the same
// logic in CI, which has no private/):
//   1. repairBrokenHvcC is a no-op on the valid files.
//   2. On each broken file it returns {file, description}, size is unchanged,
//      and mediabunny on the patched file reports hev1.1.6.L150 (Main, not the
//      broken header's Main10 / level 0).
//   3. End-to-end through indexMp4FileWithMoov, a broken file's indexed
//      videoCodecString is the REPAIRED string (hev1.1.6.L150), not the bogus
//      one parsed from the zeroed header (hev1.2.0.L0.0.44) that a config-aware
//      canPlay probe would reject.

import { Input, BlobSource, ALL_FORMATS } from "mediabunny";
import { type Dirent, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { hevcCodecStringFromHvcc } from "../parsers/internal/mp4-walker.js";
import { indexMp4FileWithMoov } from "../parsers/internal/mp4-indexing.js";
import { repairBrokenHvcC } from "./hvcc.js";

const INCOMING = join(process.cwd(), "private", "incoming");

// The NDA 70mai samples live somewhere under private/incoming/ - a transit area
// the user reorganizes freely (they are not pinned to a fixed subfolder), so
// resolve each by basename via a shallow recursive walk. Returns null when
// private/ is absent or the file was moved out; the suite then skips.
function findSample(basename: string): string | null {
    if (!existsSync(INCOMING)) return null;
    const stack = [INCOMING];
    while (stack.length > 0) {
        const dir = stack.pop()!;
        let entries: Dirent[];
        try {
            entries = readdirSync(dir, { withFileTypes: true });
        } catch {
            continue;
        }
        for (const entry of entries) {
            const full = join(dir, entry.name);
            if (entry.isDirectory()) stack.push(full);
            else if (entry.name === basename) return full;
        }
    }
    return null;
}

function fileFromPath(path: string): File {
    const buf = readFileSync(path);
    const stat = statSync(path);
    const name = path.split("/").pop() ?? "test.mp4";
    return new File([buf], name, { type: "video/mp4", lastModified: stat.mtimeMs });
}

const GOOD_580 = "NO20260429-171553-000580F.MP4";
const GOOD_583 = "NO20260429-171853-000583F.MP4";
const good580Path = findSample(GOOD_580);

const goodPaths: ReadonlyArray<readonly [string, string | null]> = [
    [GOOD_580, good580Path],
    [GOOD_583, findSample(GOOD_583)],
];
const brokenPaths: ReadonlyArray<readonly [string, string | null]> = [
    ["NO20260429-171653-000581F.MP4", findSample("NO20260429-171653-000581F.MP4")],
    ["NO20260429-171753-000582F.MP4", findSample("NO20260429-171753-000582F.MP4")],
];
const haveAny = [...goodPaths, ...brokenPaths].some(([, path]) => path !== null);

describe.skipIf(!haveAny)("repairBrokenHvcC on real 70mai files (private/)", () => {
    for (const [name, path] of goodPaths) {
        it.skipIf(!path)(`does NOT touch the valid ${name}`, async () => {
            const result = await repairBrokenHvcC(fileFromPath(path!));
            expect(result).toBeNull();
        });
    }

    // Pins our hand-rolled hvcC -> RFC 6381 parse (hevcCodecStringFromHvcc, used
    // by the MP4 indexer for the config-aware canPlay check) against mediabunny's
    // own codec-string derivation on a real file. If mediabunny changes its
    // format or our byte offsets drift, this fails. CI uses the synthetic-bytes
    // unit test in mp4-walker.test.ts; this is the real-sample ground truth.
    it.skipIf(!good580Path)(
        "hevcCodecStringFromHvcc matches mediabunny on the valid 580",
        async () => {
            const input = new Input({ source: new BlobSource(fileFromPath(good580Path!)), formats: ALL_FORMATS });
            const video = await input.getPrimaryVideoTrack();
            expect(video).not.toBeNull();
            const decoderConfig = await video!.getDecoderConfig();
            const description = new Uint8Array(decoderConfig!.description as ArrayBuffer);
            // mediabunny emits "hev1." for HEVC regardless of the hvc1/hev1 entry, as
            // does our helper, so the strings are directly comparable.
            expect(hevcCodecStringFromHvcc(description)).toBe(decoderConfig!.codec);
            input.dispose();
        },
        30000,
    );

    for (const [name, path] of brokenPaths) {
        it.skipIf(!path)(
            `repairs the broken ${name} to a working hvc1.1.6.L150`,
            async () => {
                const original = fileFromPath(path!);
                const origSize = original.size;
                const result = await repairBrokenHvcC(original);
                expect(result).not.toBeNull();
                // Size is preserved - MP4 offsets (stco/stsz) are not shifted.
                expect(result!.file.size).toBe(origSize);
                // name and lastModified must survive the File wrapper.
                expect(result!.file.name).toBe(name);

                const input = new Input({ source: new BlobSource(result!.file), formats: ALL_FORMATS });
                // getPrimaryVideoTrack returns a narrowed InputVideoTrack
                // (vs getTracks() union which lacks getDecoderConfig).
                const video = await input.getPrimaryVideoTrack();
                expect(video).not.toBeNull();
                const decoderConfig = await video!.getDecoderConfig();
                // mediabunny builds the codec string from hvcC. After the fix,
                // profile_idc must be 1 (Main, not Main10) and level_idc = 150.
                expect(decoderConfig!.codec).toBe("hev1.1.6.L150");

                const description = new Uint8Array(decoderConfig!.description as ArrayBuffer);
                expect(description[0]).toBe(1); // configurationVersion
                expect(description[1]! & 0x1f).toBe(1); // profile_idc = 1 (Main)
                expect(description[12]).toBe(150); // level_idc = 150
                expect(description[16]! & 0x3).toBe(1); // chromaFormat = 1 (4:2:0)
                expect(description[17]! & 0x7).toBe(0); // bitDepthLumaMinus8 = 0
                expect(description[21]! & 0x3).toBe(3); // lengthSizeMinusOne = 3 (4-byte NAL prefix)
                expect(description[22]).toBeGreaterThanOrEqual(1); // numOfArrays

                input.dispose();
            },
            30000,
        );

        // End-to-end through the real indexer: the broken hvcC is repaired in the
        // worker, and the indexed videoCodecString must be the repaired string.
        // Otherwise the config-aware canPlay probe rejects hev1.2.0.L0.0.44 and
        // the player shows a false "unsupported codec" overlay on a decodable file.
        it.skipIf(!path)(
            `indexes ${name} with the repaired videoCodecString`,
            async () => {
                const { indexed } = await indexMp4FileWithMoov(fileFromPath(path!), false);
                expect(indexed).not.toBeNull();
                expect(indexed!.codec).toBe("hevc");
                expect(indexed!.videoCodecString).toBe("hev1.1.6.L150");
            },
            30000,
        );
    }
});
