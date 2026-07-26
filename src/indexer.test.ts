// Integration tests for the indexer's non-ISOBMFF branch (MPEG-TS + Matroska).
//
// MP4 path is exercised indirectly through trips/registry/vendor tests
// (every snapshot test builds an Mp4Index, which shares findMoovInFile with
// the indexer). The TS/MKV path has no such overlap - if mediabunny's
// MPEG_TS / MATROSKA input formats regress or the indexNonIsobmffFile wrapper
// drops a code path, nothing else in the test suite would catch it. Hence a
// dedicated check.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { indexOneFile } from "./parsers/internal/mp4-indexing.js";

const FIXTURES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "parsers/__fixtures__/generic");

// Tests the indexing logic directly (mp4-indexing.ts) rather than going
// through indexer.ts → Worker - Worker is undefined in node, but the
// indexing logic itself is environment-agnostic and that is what we want
// to lock down (the wire layer is covered by worker-client.test.ts).
describe("indexer: MPEG-TS branch", () => {
    it("extracts durationSec + HEVC codec from a generated .TS fixture", async () => {
        const buf = readFileSync(resolve(FIXTURES_DIR, "20260511134011_073648A.TS"));
        const file = new File([buf], "20260511134011_073648A.TS");
        const { indexed } = await indexOneFile(file, false);
        expect(indexed).not.toBeNull();
        // 5 s fixture (anonymize-ts-generic.mjs default). mediabunny's
        // computeDuration on MPEG-TS resolves from PCR/PTS spans, and ffmpeg's
        // muxer offsets video by ~1.5 s relative to audio - so the reported
        // duration is in [4.5, 7.5], not exactly the wall-clock 5 s. We only
        // assert "non-zero + within the right order of magnitude" - the goal
        // here is to catch regressions where indexTsFile returns null or 0,
        // not to nail the exact value.
        expect(indexed!.durationSec).toBeGreaterThan(4.5);
        expect(indexed!.durationSec).toBeLessThan(7.5);
        expect(indexed!.codec).toBe("hevc");
        // Full RFC 6381 string from mediabunny.getCodecParameterString - feeds
        // the config-aware canPlay check. mediabunny emits the "hev1." prefix
        // for HEVC regardless of the in-band/out-of-band parameter-set storage.
        expect(indexed!.videoCodecString).toMatch(/^hev1\./);
        // TS has no mvhd, so creation_time and rotation are explicitly null/0.
        expect(indexed!.createdUtc).toBeNull();
        expect(indexed!.rotation).toBe(0);
        // needsHevcRemux is left false on the TS path - the player forces MSE
        // via the orthogonal isTransportStream flag, not this one.
        expect(indexed!.needsHevcRemux).toBe(false);
    });
});

describe("indexer: Matroska branch", () => {
    it("extracts durationSec + H.264 codec from a generated .mkv fixture", async () => {
        const buf = readFileSync(resolve(FIXTURES_DIR, "clip-h264.mkv"));
        const file = new File([buf], "clip-h264.mkv");
        const { indexed, moovBytes } = await indexOneFile(file, true);
        expect(indexed).not.toBeNull();
        // 2 s fixture (make-mkv-fixture.mjs). mediabunny computeDuration on
        // Matroska reads the segment duration, so it lands close to wall-clock;
        // keep a tolerant band rather than nailing the exact value.
        expect(indexed!.durationSec).toBeGreaterThan(1.5);
        expect(indexed!.durationSec).toBeLessThan(3.0);
        expect(indexed!.codec).toBe("avc");
        // Full RFC 6381 string feeds the config-aware canPlay check.
        expect(indexed!.videoCodecString).toMatch(/^avc1\./);
        // Matroska has no moov, so the wall-clock/rotation fields are null/0 and
        // no moov bytes come back even when captureMoov=true.
        expect(indexed!.createdUtc).toBeNull();
        expect(indexed!.rotation).toBe(0);
        expect(moovBytes).toBeUndefined();
        // The MSE decision rides the orthogonal isMatroska filename flag, so the
        // index leaves needsHevcRemux / audioNeedsTranscode false here.
        expect(indexed!.needsHevcRemux).toBe(false);
        expect(indexed!.audioNeedsTranscode).toBe(false);
    });
});
