// IMA/DVI ADPCM decoder (WAVE format tag 0x0011), as written by Mio/Navman
// MiVue cameras into a QuickTime `ms \0\x11` audio sample entry.
//
// Browsers do not decode ADPCM (not in the HTML media codec set, not in the
// WebCodecs registry), and mediabunny does not recognise the codec either, so
// the only way to give the exported MP4 working audio is to decode it ourselves
// to linear PCM-s16 (which mediabunny CAN mux and the browser CAN play) here.
//
// Block framing - the non-obvious part: the metadata blockAlign (nBlockAlign in
// the WAVEFORMATEX, bytesPerFrame in the QuickTime v1 sound description) on a
// real Navman sample is 1024, but the ACTUAL stored block size is 1017 bytes -
// the camera makes each container chunk exactly one self-contained ADPCM block.
// So we do NOT trust the metadata blockAlign; the caller passes one Uint8Array
// per chunk (= per block) and the block's sample count is derived from its byte
// length. Verified against ffmpeg (whose own MOV path mis-frames this file).
//
// Block layout (multi-channel WAV IMA): a per-channel 4-byte header (int16 LE
// initial predictor + uint8 step index + 1 reserved byte), then the remaining
// bytes as 4-byte words that interleave per channel (word0 = ch0's next 8
// samples, word1 = ch1's, ...), low nibble first. A trailing partial word is
// ignored. The Navman content is mono duplicated into both channels (the two
// channels carry byte-identical data), so the decoded L and R are equal.

// Canonical IMA ADPCM step-size table (89 entries).
const STEP_TABLE = [
    7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45, 50, 55, 60, 66, 73, 80, 88, 97, 107,
    118, 130, 143, 157, 173, 190, 209, 230, 253, 279, 307, 337, 371, 408, 449, 494, 544, 598, 658, 724, 796, 876, 963,
    1060, 1166, 1282, 1411, 1552, 1707, 1878, 2066, 2272, 2499, 2749, 3024, 3327, 3660, 4026, 4428, 4871, 5358, 5894,
    6484, 7132, 7845, 8630, 9493, 10442, 11487, 12635, 13899, 15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794,
    32767,
] as const;

// Index adjustment per nibble (16 entries).
const INDEX_TABLE = [-1, -1, -1, -1, 2, 4, 6, 8, -1, -1, -1, -1, 2, 4, 6, 8] as const;

const STEP_TABLE_MAX_INDEX = STEP_TABLE.length - 1; // 88

function clamp(value: number, min: number, max: number): number {
    return value < min ? min : value > max ? max : value;
}

/** Per-channel ADPCM decoder state: running predictor and step-table index. */
interface AdpcmState {
    predictor: number; // current sample value, int16 range
    index: number; // step-table index, 0..88
}

/**
 * Decodes one 4-bit ADPCM nibble, advancing `state` and returning the new
 * predictor (the decoded PCM sample, int16). Standard IMA reconstruction.
 */
function decodeNibble(state: AdpcmState, nibble: number): number {
    const step = STEP_TABLE[state.index]!;
    // diff = step/8 + (b2?step:0) + (b1?step/2:0) + (b0?step/4:0)
    let diff = step >> 3;
    if (nibble & 4) diff += step;
    if (nibble & 2) diff += step >> 1;
    if (nibble & 1) diff += step >> 2;
    state.predictor = clamp(state.predictor + (nibble & 8 ? -diff : diff), -32768, 32767);
    state.index = clamp(state.index + INDEX_TABLE[nibble]!, 0, STEP_TABLE_MAX_INDEX);
    return state.predictor;
}

/**
 * PCM frames per channel a block of `blockBytes` decodes to: 1 from each
 * channel's header predictor, plus 8 per 4-byte data word. A trailing partial
 * word (the block length need not be a multiple of 4*channels) contributes 0.
 */
export function imaAdpcmFramesPerBlock(blockBytes: number, channels: number): number {
    const dataBytes = blockBytes - 4 * channels;
    if (dataBytes < 0) return 0;
    const wordsPerChannel = Math.floor(dataBytes / (4 * channels));
    return 1 + wordsPerChannel * 8;
}

/**
 * Decodes one ADPCM block into interleaved PCM-s16, writing into `out` starting
 * at `outOffset`. The block's sample count is derived from its byte length (see
 * the module note: the metadata blockAlign is unreliable here). Returns the
 * number of int16 values written (frames * channels).
 */
export function decodeImaAdpcmBlock(block: Uint8Array, channels: number, out: Int16Array, outOffset: number): number {
    if (block.length < 4 * channels) return 0;
    const framesPerChannel = imaAdpcmFramesPerBlock(block.length, channels);
    const states: AdpcmState[] = new Array(channels);

    // Per-channel 4-byte header: int16 LE predictor + uint8 index + 1 reserved.
    for (let ch = 0; ch < channels; ch++) {
        const h = ch * 4;
        const predictor = ((block[h]! | (block[h + 1]! << 8)) << 16) >> 16; // sign-extend int16
        states[ch] = { predictor, index: clamp(block[h + 2]!, 0, STEP_TABLE_MAX_INDEX) };
        out[outOffset + ch] = predictor; // sample 0 of each channel = initial predictor
    }

    // Remaining samples: 4-byte words interleaved per channel, 8 samples
    // (2 per byte, low nibble first) per word.
    let pos = channels * 4;
    let frame = 1; // frame 0 is the header predictors
    while (frame < framesPerChannel) {
        for (let ch = 0; ch < channels; ch++) {
            const state = states[ch]!;
            const base = outOffset + frame * channels + ch;
            for (let b = 0; b < 4; b++) {
                const byte = block[pos + b]!;
                out[base + b * 2 * channels] = decodeNibble(state, byte & 0x0f);
                out[base + (b * 2 + 1) * channels] = decodeNibble(state, byte >> 4);
            }
            pos += 4;
        }
        frame += 8; // each channel's word produced 8 frames
    }

    return framesPerChannel * channels;
}

/**
 * Decodes a list of ADPCM blocks (one Uint8Array per container chunk, each a
 * self-contained block) into a single interleaved PCM-s16 buffer.
 */
export function decodeImaAdpcmBlocks(blocks: readonly Uint8Array[], channels: number): Int16Array {
    let totalFrames = 0;
    for (const block of blocks) totalFrames += imaAdpcmFramesPerBlock(block.length, channels);
    const out = new Int16Array(totalFrames * channels);
    let written = 0;
    for (const block of blocks) {
        written += decodeImaAdpcmBlock(block, channels, out, written);
    }
    return written === out.length ? out : out.subarray(0, written);
}
