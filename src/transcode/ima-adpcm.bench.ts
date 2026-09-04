import { bench, describe } from "vitest";
import { decodeImaAdpcmBlock, imaAdpcmFramesPerBlock } from "./ima-adpcm.js";

// Camera-sized blocks with varied initial indices and nibble patterns. No I/O
// or PCM allocation in the timed path: this isolates the decoder's CPU cost.
const blocks = Array.from({ length: 256 }, (_, blockIndex) => {
    const block = Uint8Array.from({ length: 1017 }, (_, byteIndex) => (byteIndex * 73 + blockIndex * 31) & 255);
    block[2] = blockIndex % 89;
    block[6] = (blockIndex * 3) % 89;
    return block;
});
const pcm = new Int16Array(imaAdpcmFramesPerBlock(blocks[0]!.length, 2) * 2);

describe("IMA-ADPCM decode", () => {
    bench("256 stereo blocks into reusable PCM", () => {
        for (const block of blocks) decodeImaAdpcmBlock(block, 2, pcm, 0);
    });
});
