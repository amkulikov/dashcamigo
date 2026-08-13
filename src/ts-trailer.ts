// Detection of the LigoGPS-family GPS trailer appended to MPEG-TS files.
//
// Some SigmaStar-era firmwares (LCAI magic observed on a real 2-channel
// camera; the LIGO spelling is the classic family literal) append a plaintext
// GPS table to the END of a .ts recording, after the last whole 188-byte
// packet. The trailer is not TS-packetized, so any demuxer that scans to EOF
// (mediabunny computeDuration, MSE remux, export reads) loses packet sync on
// it and throws. This module finds the trailer so AV consumers can clamp
// their readable range to the clean TS prefix, and the ligogps-trailer-ts
// primitive can parse the table.
//
// Trailer layout (verified on a real 11-file corpus):
//   [u32 BE length]["SKIP" + 11-byte magic][5 flag bytes][u32 LE length]
//   [N slots of 132 bytes: u32 slot index + NUL-padded ASCII record]
//   ["####" + u32 BE length]
// The length counts the whole trailer including both length copies and the
// terminator, so cleanLength = fileSize - length; the firmware always starts
// the trailer on the 188-byte grid.

import { isTransportStreamName } from "./video-format-names.js";

export interface TsGpsTrailer {
    /** Byte length of the clean 188-aligned TS stream; the trailer occupies the rest of the file. */
    cleanLength: number;
    /** Trailer length in bytes (fileSize - cleanLength). */
    trailerLength: number;
}

const TS_PACKET = 188;
/** '####' - the terminator literal, u32 BE view. */
const HASH_MARKER = 0x23232323;
/** Known 11-byte magic spellings after "SKIP". Firmwares rebrand the LIGO
 *  prefix (LCAI observed); anything else stays undetected on purpose - a
 *  wrong clamp on an unknown trailer is worse than the old failure mode. */
const TRAILER_MAGICS = ["SKIPLIGOGPSINFO", "SKIPLCAIGPSINFO"];
/** Empty table: u32 len + magic 15 + 5 flags + u32 len + '####' + u32 len. */
const MIN_TRAILER_BYTES = 36;
/** Sanity cap: 24 h at 1 Hz is ~11.4 MB of 132-byte slots. */
const MAX_TRAILER_BYTES = 16 * 1024 * 1024;

/** Offset of the first 132-byte slot from the trailer start. */
export const TS_TRAILER_SLOTS_OFFSET = 28;

function asciiAt(buf: Uint8Array, start: number, length: number): string {
    let out = "";
    for (let i = start; i < start + length && i < buf.length; i++) {
        const b = buf[i]!;
        out += b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : ".";
    }
    return out;
}

/**
 * Detects the GPS trailer on a MPEG-TS blob by its EOF terminator. Two tiny
 * reads: the last 8 bytes ('####' + u32 BE length), then the trailer head at
 * fileSize - length (leading length copy + magic). Every structural check
 * must pass - length sanity, 188-grid alignment of the clean prefix, length
 * copies agreeing, a known magic - or the file reads as trailer-less.
 * Returns null when there is no trailer; IO errors propagate.
 */
export async function findTsGpsTrailer(blob: Blob): Promise<TsGpsTrailer | null> {
    const size = blob.size;
    if (size < TS_PACKET + MIN_TRAILER_BYTES) return null;

    const tail = new Uint8Array(await blob.slice(size - 8, size).arrayBuffer());
    const tailView = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
    if (tailView.getUint32(0) !== HASH_MARKER) return null;
    const trailerLength = tailView.getUint32(4);
    if (trailerLength < MIN_TRAILER_BYTES || trailerLength > MAX_TRAILER_BYTES) return null;
    if (trailerLength >= size) return null;

    const cleanLength = size - trailerLength;
    if (cleanLength % TS_PACKET !== 0) return null;

    const head = new Uint8Array(await blob.slice(cleanLength, cleanLength + 19).arrayBuffer());
    if (head.length < 19) return null;
    const headView = new DataView(head.buffer, head.byteOffset, head.byteLength);
    if (headView.getUint32(0) !== trailerLength) return null;
    if (!TRAILER_MAGICS.includes(asciiAt(head, 4, 15))) return null;

    return { cleanLength, trailerLength };
}

/**
 * Returns a view of `blob` with a detected GPS trailer clipped off, so
 * mediabunny sees only the sync-clean TS stream. Gated on the transport
 * stream filename (a plain Blob without a name passes through untouched) -
 * non-TS containers never pay the probe reads. The returned Blob loses the
 * File name; callers that need the name keep the original reference.
 */
export async function clampTsGpsTrailer(blob: Blob): Promise<Blob> {
    const name = blob instanceof File ? blob.name : "";
    if (!isTransportStreamName(name)) return blob;
    const trailer = await findTsGpsTrailer(blob);
    return trailer ? blob.slice(0, trailer.cleanLength) : blob;
}
