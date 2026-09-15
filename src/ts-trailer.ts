// Detection of the LigoGPS-family GPS trailer appended to MPEG-TS files.
//
// Firmware appends a plaintext table after the last whole 188-byte packet.
// AV readers must exclude it to preserve packet sync; GPS parsing reads it
// separately. Layout and dialect constraints: docs/format-ligogps-trailer-ts.md.

import { isTransportStreamName } from "./video-format-names.js";

export interface TsGpsTrailer {
    /** Byte length of the clean 188-aligned TS stream; the trailer occupies the rest of the file. */
    cleanLength: number;
    /** Trailer length in bytes (fileSize - cleanLength). */
    trailerLength: number;
}

const TS_PACKET = 188;
const TS_SYNC_BYTE = 0x47;
const TS_SYNC_RUN = 4;
const TS_SUFFIX_SCAN_PACKETS = 256;
const MAX_TS_SUFFIX_BYTES = 16 * 1024 * 1024;
const TRAILER_SLOT_BYTES = 132;
const HASH_BYTE = 0x23;
const AMPERSAND_BYTE = 0x26;
/** Known magic/terminator pairs. Anything else stays undetected on purpose:
 *  a wrong clamp on an unknown trailer is worse than the old failure mode. */
const TRAILER_DIALECTS = [
    { magic: "SKIPLIGOGPSINFO", terminatorByte: AMPERSAND_BYTE, header: "slot-capacity" },
    { magic: "SKIPLIGOGPSINFO", terminatorByte: HASH_BYTE, header: "length" },
    { magic: "SKIPLCAIGPSINFO", terminatorByte: HASH_BYTE, header: "length-or-count" },
] as const;
/** Empty table: u32 len + magic 15 + 5 flags + u32 field + marker + u32 len. */
const MIN_TRAILER_BYTES = 36;
/** Sanity cap: 24 h at 1 Hz is ~11.4 MB of 132-byte slots. */
const MAX_TRAILER_BYTES = 16 * 1024 * 1024;
const MAX_TRAILER_SLOTS = Math.floor((MAX_TRAILER_BYTES - MIN_TRAILER_BYTES) / TRAILER_SLOT_BYTES);

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

function tsGpsTrailerTerminatorByte(buf: Uint8Array, offset: number): number | null {
    if (offset + 4 > buf.length) return null;
    const markerByte = buf[offset];
    if (markerByte !== HASH_BYTE && markerByte !== AMPERSAND_BYTE) return null;
    if (buf[offset + 1] !== markerByte || buf[offset + 2] !== markerByte || buf[offset + 3] !== markerByte) {
        return null;
    }
    return markerByte;
}

/** Whether four bytes at `offset` are a supported table terminator. */
export function isTsGpsTrailerTerminator(buf: Uint8Array, offset: number): boolean {
    return tsGpsTrailerTerminatorByte(buf, offset) !== null;
}

/**
 * Detects the GPS trailer on a MPEG-TS blob by its EOF terminator. Two tiny
 * reads: the last 8 bytes (known terminator + u32 BE length), then the trailer
 * head at fileSize - length (leading length copy + magic). Every structural
 * check must pass - length sanity, 188-grid alignment of the clean prefix,
 * length copies agreeing, a known magic - or the file reads as trailer-less.
 * Returns null when there is no trailer; IO errors propagate.
 */
export async function findTsGpsTrailer(blob: Blob): Promise<TsGpsTrailer | null> {
    const size = blob.size;
    if (size < TS_PACKET + MIN_TRAILER_BYTES) return null;

    const tail = new Uint8Array(await blob.slice(size - 8, size).arrayBuffer());
    const tailView = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
    const terminatorByte = tsGpsTrailerTerminatorByte(tail, 0);
    if (terminatorByte === null) return null;
    const trailerLength = tailView.getUint32(4);
    if (trailerLength < MIN_TRAILER_BYTES || trailerLength > MAX_TRAILER_BYTES) return null;
    if (trailerLength >= size) return null;
    if ((trailerLength - MIN_TRAILER_BYTES) % TRAILER_SLOT_BYTES !== 0) return null;

    const cleanLength = size - trailerLength;
    if (cleanLength % TS_PACKET !== 0) return null;

    const head = new Uint8Array(await blob.slice(cleanLength, cleanLength + TS_TRAILER_SLOTS_OFFSET).arrayBuffer());
    if (head.length < TS_TRAILER_SLOTS_OFFSET) return null;
    const headView = new DataView(head.buffer, head.byteOffset, head.byteLength);
    if (headView.getUint32(0) !== trailerLength) return null;
    // Parking clips carry only SKIP and zero padding, with no GPS magic.
    if (
        trailerLength === MIN_TRAILER_BYTES &&
        terminatorByte === HASH_BYTE &&
        asciiAt(head, 4, 4) === "SKIP" &&
        head.subarray(8).every((byte) => byte === 0)
    ) {
        return { cleanLength, trailerLength };
    }
    const magic = asciiAt(head, 4, 15);
    const dialect = TRAILER_DIALECTS.find(
        (candidate) => candidate.magic === magic && candidate.terminatorByte === terminatorByte,
    );
    if (!dialect) return null;
    const slotCount = (trailerLength - MIN_TRAILER_BYTES) / TRAILER_SLOT_BYTES;
    const headerValue = headView.getUint32(24, true);
    if (dialect.header === "length" && headerValue !== trailerLength) return null;
    // An empty LCAI table may retain its nominal slot capacity even though
    // no GPS slots were written. Keep this exception limited to empty tables.
    if (
        dialect.header === "length-or-count" &&
        headerValue !== trailerLength &&
        headerValue !== slotCount &&
        !(slotCount === 0 && headerValue > 0 && headerValue <= MAX_TRAILER_SLOTS)
    ) {
        return null;
    }
    // Partial clips retain their nominal slot capacity, so it may exceed the
    // number of slots that were actually appended.
    if (dialect.header === "slot-capacity" && (headerValue < slotCount || headerValue > MAX_TRAILER_SLOTS)) {
        return null;
    }

    return { cleanLength, trailerLength };
}

function hasTsSyncRun(bytes: Uint8Array, start: number): boolean {
    for (let i = 0; i < TS_SYNC_RUN; i++) {
        const packet = start + i * TS_PACKET;
        if (bytes[packet] !== TS_SYNC_BYTE) return false;
        // Transport errors do not break packet alignment.
        const adaptationControl = (bytes[packet + 3]! >> 4) & 3;
        if (adaptationControl === 0) return false;
        const adaptationLength = bytes[packet + 4]!;
        if (adaptationControl === 2 && adaptationLength !== 183) return false;
        if (adaptationControl === 3 && adaptationLength > 182) return false;
    }
    return true;
}

/** Finds the last complete packet when a .ts file has an unknown trailing block. */
async function findTsPacketBoundary(blob: Blob): Promise<number | null> {
    const alignedEnd = blob.size - (blob.size % TS_PACKET);
    const runBytes = TS_SYNC_RUN * TS_PACKET;
    if (alignedEnd < runBytes) return null;

    const tail = new Uint8Array(await blob.slice(alignedEnd - runBytes, alignedEnd).arrayBuffer());
    const hasCompleteTail = hasTsSyncRun(tail, 0);
    if (hasCompleteTail && alignedEnd === blob.size) return null;

    // Require the packet grid to begin at byte zero. A mislabeled MP4, M2TS,
    // or a stream with a different packet stride must retain its full bytes.
    const head = new Uint8Array(await blob.slice(0, runBytes).arrayBuffer());
    if (!hasTsSyncRun(head, 0)) return null;
    if (hasCompleteTail) return alignedEnd;

    const floor = Math.max(runBytes, alignedEnd - Math.floor(MAX_TS_SUFFIX_BYTES / TS_PACKET) * TS_PACKET);
    const chunkBytes = TS_SUFFIX_SCAN_PACKETS * TS_PACKET;
    for (let chunkEnd = alignedEnd; chunkEnd > floor; ) {
        const chunkStart = Math.max(floor, chunkEnd - chunkBytes);
        const readStart = chunkStart - runBytes;
        const bytes = new Uint8Array(await blob.slice(readStart, chunkEnd).arrayBuffer());
        for (let boundary = chunkEnd; boundary >= chunkStart; boundary -= TS_PACKET) {
            if (hasTsSyncRun(bytes, boundary - readStart - runBytes)) return boundary;
        }
        chunkEnd = chunkStart;
    }
    return null;
}

/**
 * Returns a view of a .ts File ending at its last complete 188-byte packet.
 * A recognized GPS trailer supplies an exact boundary; an unknown suffix is
 * clipped only when a four-packet sync run establishes the same packet grid
 * at the head and near the tail. GPS extraction still requires its own strict
 * trailer marker. The returned Blob loses the File name.
 */
export async function clampTsTrailingBytes(blob: Blob): Promise<Blob> {
    const name = blob instanceof File ? blob.name : "";
    if (!isTransportStreamName(name)) return blob;
    const trailer = await findTsGpsTrailer(blob);
    const cleanLength = trailer?.cleanLength ?? (await findTsPacketBoundary(blob));
    return cleanLength === null ? blob : blob.slice(0, cleanLength);
}
