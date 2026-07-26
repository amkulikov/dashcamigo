import { describe, expect, it } from "vitest";
import { decodeImaAdpcmBlock, decodeImaAdpcmBlocks, imaAdpcmFramesPerBlock } from "./ima-adpcm.js";

describe("imaAdpcmFramesPerBlock", () => {
    it("1 header frame + 8 per 4-byte word per channel", () => {
        // mono: 8 bytes = 4 header + 1 word -> 1 + 8 = 9
        expect(imaAdpcmFramesPerBlock(8, 1)).toBe(9);
        // stereo: 24 bytes = 8 header + 2 words -> 1 + 16 = 17
        expect(imaAdpcmFramesPerBlock(24, 2)).toBe(17);
        // real Navman block: 1017 bytes stereo -> 8 header + floor(1009/8)=126 words
        expect(imaAdpcmFramesPerBlock(1017, 2)).toBe(1 + 126 * 8); // 1009
    });

    it("a trailing partial word is dropped (block length need not be a multiple of 4*channels)", () => {
        // stereo, 8 header + 9 data bytes: only 1 full word-pair (8 bytes) fits.
        expect(imaAdpcmFramesPerBlock(8 + 9, 2)).toBe(9);
    });

    it("too-short block (below the per-channel header) yields 0", () => {
        expect(imaAdpcmFramesPerBlock(4, 2)).toBe(0);
    });
});

describe("decodeImaAdpcmBlocks (mono)", () => {
    it("decodes a single block against a hand-verified IMA reference", () => {
        // header: predictor=100, stepIndex=5; one data word 0x12 0x34 0x56 0x78.
        const block = new Uint8Array([0x64, 0x00, 0x05, 0x00, 0x12, 0x34, 0x56, 0x78]);
        const pcm = decodeImaAdpcmBlocks([block], 1);
        // Reconstructed by stepping the canonical IMA tables by hand (low nibble
        // first within each byte): see ima-adpcm.ts for the algorithm.
        expect(Array.from(pcm)).toEqual([100, 107, 110, 121, 131, 148, 173, 170, 216]);
    });

    it("sign-extends a negative initial predictor", () => {
        // predictor int16 LE 0xffa0 = -96, stepIndex 12, no data words.
        const block = new Uint8Array([0xa0, 0xff, 0x0c, 0x00]);
        const pcm = decodeImaAdpcmBlocks([block], 1);
        expect(Array.from(pcm)).toEqual([-96]);
    });
});

describe("decodeImaAdpcmBlocks (stereo)", () => {
    it("interleaves L/R; mono-duplicated input yields L == R", () => {
        // Both channels carry byte-identical data (the Navman mono-duplicated
        // case), so every decoded L must equal its R.
        const block = new Uint8Array([
            0xa0, 0xff, 0x0c, 0x00, 0xa0, 0xff, 0x0c, 0x00, 0x21, 0x02, 0x00, 0x33, 0x21, 0x02, 0x00, 0x33, 0x82, 0xca,
            0x9f, 0xb9, 0x82, 0xca, 0x9f, 0xb9,
        ]);
        const pcm = decodeImaAdpcmBlocks([block], 2);
        expect(pcm.length).toBe(17 * 2);
        for (let f = 0; f < 17; f++) {
            expect(pcm[f * 2]).toBe(pcm[f * 2 + 1]); // L == R
        }
        // First few interleaved samples are a stable golden vector.
        expect(Array.from(pcm.subarray(0, 8))).toEqual([-96, -96, -89, -89, -77, -77, -66, -66]);
    });

    it("concatenates multiple blocks, each decoded independently from its own header", () => {
        const b0 = new Uint8Array([0x64, 0x00, 0x05, 0x00, 0x12, 0x34, 0x56, 0x78]);
        const b1 = new Uint8Array([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
        const pcm = decodeImaAdpcmBlocks([b0, b1], 1);
        expect(pcm.length).toBe(9 + 9);
        // Block 1 resets the predictor to its own header (0), independent of b0.
        expect(pcm[9]).toBe(0);
    });
});

describe("decodeImaAdpcmBlock (low-level)", () => {
    it("writes frames*channels int16 at the given offset and returns the count", () => {
        const block = new Uint8Array([0x64, 0x00, 0x05, 0x00, 0x12, 0x34, 0x56, 0x78]);
        const out = new Int16Array(20);
        const written = decodeImaAdpcmBlock(block, 1, out, 3);
        expect(written).toBe(9);
        expect(out[3]).toBe(100); // first frame at the offset
        expect(out[0]).toBe(0); // untouched before the offset
    });
});
