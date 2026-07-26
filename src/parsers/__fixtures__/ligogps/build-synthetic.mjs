#!/usr/bin/env node
// Builds a minimal MP4 with a meta track carrying a LigoGPS-encrypted
// payload. Used for the ligogpsPlugin unit test.
//
// Structure of each sample (~120 bytes):
//   [0..29]   pre-SKIP preamble (zeros - we do not copy real CARCAM bytes,
//             the parser ignores them and only reads LIGOGPSINFO + chunk).
//   [30..33]  SKIP box size (BE u32) - unused by the parser, but valid
//             for sanity.
//   [34..37]  "SKIP" atom type
//   [38..48]  "LIGOGPSINFO" magic
//   [49..52]  4 zero pad
//   [53..57]  spare (zeros)
//   [58..]    chunk: '####' + u32 LE num + encrypted body (length=num)
//
// Encoding an ASCII string into the encrypted body - the inverse of
// DecryptLigoGPS:
//   - the first 4 output chars (preamble, regex `^.{4}`) are 4×0x00.
//     Encoded: control b=0xc0 + 4×0x20 input → output 4×0x00. (5 bytes
//     input -> 4 bytes output)
//   - every following ASCII char is encoded via the b=0x00 1-byte
//     branch: identity, 2 bytes input (0x00 + char) -> 1 byte output.
//
// This is the simplest inverse of the decrypt. The real CARCAM uses a
// 4-byte branch (b=0xe0/0xf0/etc) for compactness, but our parser
// handles every branch the same way.
//
// Run: node src/parsers/__fixtures__/ligogps/build-synthetic.mjs

import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function fourCC(s) { return Buffer.from(s, "ascii"); }
function u32be(n) {
    const b = Buffer.alloc(4);
    b.writeUInt32BE(n, 0);
    return b;
}
function u32le(n) {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(n, 0);
    return b;
}
function box(type, payload) {
    const size = 8 + payload.length;
    return Buffer.concat([u32be(size), fourCC(type), payload]);
}
function box64(type, payload) {
    // 64-bit size variant (size=1, then 8-byte largesize). Unused.
    void type; void payload;
    throw new Error("not used");
}

/**
 * Encode an ASCII string into the LigoGPS-encrypted body (inverse DecryptLigoGPS).
 *  - the first 4 output chars (always a null preamble per ExifTool regex `^.{4}`):
 *    control 0xc0 + 4×0x20 → 4×0x00.
 *  - remaining chars: control 0x00 + char (identity 1-byte mode).
 */
function encodeLigoGps(asciiText) {
    const out = [];
    // 4-byte preamble: output "\0\0\0\0".
    out.push(0xc0, 0x20, 0x20, 0x20, 0x20);
    // Every following output char: control 0x00 + char.
    for (let i = 4; i < asciiText.length; i++) {
        const ch = asciiText.charCodeAt(i);
        if (ch >= 0x20 && ch <= 0x3f) {
            // 0x00..0x1f and 0x40..0xff are valid in b=0x00 mode (identity).
            // 0x20..0x3f are not - they would then be read as steering bits 0x20.
            // These chars would need the b=0x40 branch with tweaks.
            // This simple 1-byte path can't encode 0x20-0x3f (space, digits, ':', '.',
            // '/'), so it throws for that range; encodeLigoGpsCompact routes every
            // char through the b=0xc0 4-byte branch instead.
            throw new Error(`encoder: 0x20-0x3f range needs 4-char mode, not implemented in this simple path: "${asciiText[i]}"`);
        }
        out.push(0x00, ch);
    }
    return Buffer.from(out);
}

/**
 * Compact encoder: always uses the b=0xc0 4-byte branch (5 bytes input,
 * 4 chars output). This covers all printable ASCII + the null preamble.
 *
 * out = (in | b&mask) ^ 0x20 for byte 0..2; out[3] = (in ^ 0x20) | b&0x30.
 *
 * To get output[i] = the desired char W, with b=0xc0 (mask 0x01/0x02/0x0c/0x30):
 *   out[0] = W, b&0x01 = 0 -> in[0] = W ^ 0x20
 *   out[1] = W, b&0x02 = 0 -> in[1] = W ^ 0x20
 *   out[2] = W, b&0x0c = 0 -> in[2] = W ^ 0x20
 *   out[3] = W, b&0x30 = 0 -> in[3] = W ^ 0x20 (since (in[3]^0x20)|0=in[3]^0x20=W means in[3]=W^0x20)
 *
 * For all 4 output chars to be the same - in = 4×(W^0x20). For
 * different chars per output - specific in bytes are needed. With b=0xc0
 * (mask all zeros), simply in[i] = W[i] ^ 0x20.
 */
function encodeLigoGpsCompact(asciiText) {
    // Pad to multiple of 4 chars
    const padded = asciiText + "\0".repeat((4 - asciiText.length % 4) % 4);
    const out = [];
    for (let i = 0; i < padded.length; i += 4) {
        out.push(0xc0); // control b: all bits zero in masks 0x01/0x02/0x0c/0x30
        out.push(padded.charCodeAt(i) ^ 0x20);
        out.push(padded.charCodeAt(i + 1) ^ 0x20);
        out.push(padded.charCodeAt(i + 2) ^ 0x20);
        out.push(padded.charCodeAt(i + 3) ^ 0x20);
    }
    return Buffer.from(out);
}

function buildLigoSample(asciiText) {
    // Body ASCII = "<4-byte pre> <datetime> N:<lat> E:<lon> <speed>"
    // regex skips first 4 chars, expects ASCII pattern after.
    // Example: "@@@@2025/06/07 18:06:17 N:50.000 E:30.000 25.5"
    const encoded = encodeLigoGpsCompact(asciiText);
    const num = encoded.length; // length of encrypted body

    // SKIP-box payload: "LIGOGPSINFO\0\0\0\0" (15 bytes) + 5 spare zeros (20 total = 0x14) + chunk
    const ligoMagic = Buffer.concat([
        Buffer.from("LIGOGPSINFO", "ascii"),
        Buffer.alloc(4), // 4 zero pad
        Buffer.alloc(5), // 5 spare zeros (total 0x14)
    ]);
    // chunk: '####' (4) + u32 LE num (4) + encoded body
    const chunk = Buffer.concat([
        Buffer.from("####", "ascii"),
        u32le(num),
        encoded,
    ]);

    const skipPayload = Buffer.concat([ligoMagic, chunk]);
    const skipBox = box("SKIP", skipPayload);

    // pre-SKIP preamble: 30 bytes zeros (dummy lat/lon doubles + datetime
    // metadata - the parser ignores them).
    const preamble = Buffer.alloc(30);

    return Buffer.concat([preamble, skipBox]);
}

/**
 * Minimal moov with a single trak (handler='meta', format='ssmd', 3 samples).
 */
function buildSyntheticMp4(samples) {
    const ftyp = box("ftyp", Buffer.concat([
        fourCC("isom"), u32be(512), fourCC("isom"), fourCC("avc1"), fourCC("mp41"),
    ]));

    // mdat: concatenated sample bytes (no wrapper).
    const mdatPayload = Buffer.concat(samples);
    const mdat = box("mdat", mdatPayload);

    // The sample table is needed by the walker to read samples correctly.
    // All samples are variable size, so we go through an stsz table of
    // per-sample sizes. chunk_offset - the absolute offset of mdat start + 8 (header).
    const ftypSize = ftyp.length;
    // moov can go AFTER mdat (faststart=false) - our walker allows that,
    // but it is simpler to put moov BEFORE mdat. Then mdat-offset = ftyp.size + moov.size.
    // We put moov-before-mdat for simplicity, but we do not know moov's
    // size up front because it holds a chunkOffset that depends on moov's size.
    // Solution: first assemble moov with a placeholder offset, then compute
    // the final offset and update stco.

    const stsdPayload = Buffer.concat([
        Buffer.alloc(4), // version+flags
        u32be(1), // entry_count
        // sample-entry: 8 bytes header (size + format) + box-specific
        Buffer.concat([u32be(16), fourCC("ssmd"), Buffer.alloc(8)]),
    ]);
    const stsd = box("stsd", stsdPayload);

    // stts: 1 entry, sample_count = N, sample_delta = 1 (timescale 1).
    const stts = box("stts", Buffer.concat([
        Buffer.alloc(4), u32be(1), u32be(samples.length), u32be(1),
    ]));

    // stsc: 1 entry first_chunk=1, samples_per_chunk=1, sdi=1.
    const stsc = box("stsc", Buffer.concat([
        Buffer.alloc(4), u32be(1), u32be(1), u32be(1), u32be(1),
    ]));

    // stsz: variable per-sample. sample_size=0 + sample_count + table.
    const sizesTable = Buffer.alloc(samples.length * 4);
    let off = 0;
    for (const s of samples) {
        sizesTable.writeUInt32BE(s.length, off);
        off += 4;
    }
    const stsz = box("stsz", Buffer.concat([
        Buffer.alloc(4), u32be(0), u32be(samples.length), sizesTable,
    ]));

    // stco: N chunks (one sample per chunk - so as many chunks). offsets
    // are updated later.
    const stcoTable = Buffer.alloc(samples.length * 4); // placeholder zeros
    const stco = box("stco", Buffer.concat([
        Buffer.alloc(4), u32be(samples.length), stcoTable,
    ]));

    const stbl = box("stbl", Buffer.concat([stsd, stts, stsc, stsz, stco]));

    // minf with empty hdlr-style (not critical for us - the walker follows paths).
    // mdia/hdlr - handler='meta' (type 'meta' with a 4-char handler-type 'meta' inside).
    const hdlrPayload = Buffer.concat([
        Buffer.alloc(8), // version+flags + pre_defined
        fourCC("meta"), // handler_type
        Buffer.alloc(12), // reserved
        Buffer.from("\0", "ascii"), // name (empty)
    ]);
    const hdlr = box("hdlr", hdlrPayload);

    // minf - container with stbl. No vmhd/smhd/etc (the walker does not check).
    const minf = box("minf", stbl);

    // mdhd - timescale 1.
    const mdhdPayload = Buffer.concat([
        Buffer.alloc(4), // version+flags
        Buffer.alloc(4), // creation_time
        Buffer.alloc(4), // modification_time
        u32be(1), // timescale
        u32be(samples.length), // duration
        Buffer.alloc(4), // language + pre_defined
    ]);
    const mdhd = box("mdhd", mdhdPayload);

    const mdia = box("mdia", Buffer.concat([mdhd, hdlr, minf]));

    const tkhdPayload = Buffer.alloc(84); // minimal v0 tkhd
    const tkhd = box("tkhd", tkhdPayload);
    const trak = box("trak", Buffer.concat([tkhd, mdia]));

    const mvhd = box("mvhd", Buffer.alloc(108));
    const moov = box("moov", Buffer.concat([mvhd, trak]));

    // Compute chunk offsets: mdat starts at ftyp.length + moov.length + 8 (mdat header).
    const mdatPayloadStart = ftypSize + moov.length + 8;
    let cumulativeOffset = mdatPayloadStart;
    // Update stco entries in moov (in-place patching).
    // moov layout: walker through placeholders - find 'stco' atom and rewrite.
    const stcoMagic = Buffer.from("stco", "ascii");
    const stcoIdx = moov.indexOf(stcoMagic);
    if (stcoIdx < 0) throw new Error("stco not found in moov");
    // After 'stco', skip 4 (version+flags), 4 (entry_count), then write offsets.
    let writeOff = stcoIdx + 4 + 4 + 4;
    for (const s of samples) {
        moov.writeUInt32BE(cumulativeOffset, writeOff);
        cumulativeOffset += s.length;
        writeOff += 4;
    }

    return Buffer.concat([ftyp, moov, mdat]);
}

const sample1Text = "@@@@2025/06/07 18:06:16 N:50.000000 E:30.000000 25.5";
const sample2Text = "@@@@2025/06/07 18:06:17 N:50.000100 E:30.000200 26.0";
const sample3Text = "@@@@2025/06/07 18:06:18 N:50.000200 E:30.000400 26.5";

const samples = [sample1Text, sample2Text, sample3Text].map(buildLigoSample);
const file = buildSyntheticMp4(samples);

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(__dirname, "synthetic-ligogps.mp4");
writeFileSync(outPath, file);
console.error(`wrote ${file.length} bytes to ${outPath}`);

// Sanity check: round-trip decrypt to verify encoder correctness.
function decryptCheck(buf) {
    const num = buf.readUInt32LE(4);
    const inBuf = buf.subarray(8, 8 + num);
    const out = [];
    let i = 0;
    while (i < inBuf.length) {
        const b = inBuf[i++];
        const steering = b & 0xe0;
        if (steering >= 0xc0) {
            const a = inBuf[i++], c = inBuf[i++], d = inBuf[i++], e = inBuf[i++];
            out.push(((a | (b & 0x01)) ^ 0x20) & 0xff);
            out.push(((c | (b & 0x02)) ^ 0x20) & 0xff);
            out.push(((d | (b & 0x0c)) ^ 0x20) & 0xff);
            out.push((((e ^ 0x20) | (b & 0x30))) & 0xff);
        } else {
            throw new Error(`unexpected steering 0x${steering.toString(16)} at i=${i}`);
        }
    }
    return Buffer.from(out).toString("ascii");
}

// Extract first sample's chunk and verify
const skipIdx = samples[0].indexOf(Buffer.from("####"));
const chunk = samples[0].subarray(skipIdx);
const decrypted = decryptCheck(chunk);
console.error(`decrypt round-trip sample 1: "${decrypted.replace(/\0/g, "·")}"`);
