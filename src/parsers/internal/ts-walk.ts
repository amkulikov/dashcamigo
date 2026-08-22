// Shared MPEG-TS packet/PES plumbing. Three GPS formats ride private PES
// streams in TS containers (novatek-ts, juscar-ts, ts-pes-gps) and all of them
// need to step packets and locate the PES body; the two whose records outgrow
// a single packet also reassemble here. Keeping one copy of the PES header math
// is the point - the body-length rule in particular is easy to get wrong in a
// way that silently drops a whole dialect.
//
// Dashcam TS quirk that shapes all of this: the GPS PES is NOT advertised in
// the PMT, so PSI parsing cannot find it. Detection is content-based and the
// PID is auto-detected, which means these helpers get run over video and audio
// packets too and must reject them cheaply.

export const TS_SIZE = 188;
export const TS_SYNC = 0x47;

/** Cheap container gate: two aligned sync bytes reject non-TS carriers while
 * keeping detection independent of the filename and extension. */
export function looksLikeMpegTs(bytes: Uint8Array): boolean {
    return bytes.length >= 2 * TS_SIZE && bytes[0] === TS_SYNC && bytes[TS_SIZE] === TS_SYNC;
}

/** Where the PES body of one packet starts and how many bytes of it the PES promises. */
export type PesBodyExtent = { bodyOff: number; bodyLen: number };

/**
 * Parses the PES header of the packet at `off`. Null when the packet has no
 * payload / no PES start code.
 *
 * `bodyLen` is deliberately NOT PES_packet_length: the field counts everything
 * after itself, header included. Only private_stream_2 (0xbf) has a fixed
 * 6-byte header where the two coincide; every other stream_id spends
 * 3 + pes_header_data_length of the counted bytes on its extended header.
 */
function readPesHeader(bytes: Uint8Array, off: number): PesBodyExtent | null {
    const b3 = bytes[off + 3]!;
    const af = (b3 & 0x30) >> 4;
    if (af === 2) return null; // adaptation field only, no payload
    let payOff = off + 4;
    if (af === 3) payOff += 1 + bytes[payOff]!;
    if (payOff + 6 > off + TS_SIZE) return null;
    if (bytes[payOff] !== 0 || bytes[payOff + 1] !== 0 || bytes[payOff + 2] !== 1) return null;
    const streamId = bytes[payOff + 3]!;
    const pesLen = (bytes[payOff + 4]! << 8) | bytes[payOff + 5]!;
    if (streamId === 0xbf) return { bodyOff: payOff + 6, bodyLen: pesLen };
    if (payOff + 9 > off + TS_SIZE) return null;
    const headerDataLen = bytes[payOff + 8]!;
    return { bodyOff: payOff + 9 + headerDataLen, bodyLen: pesLen - 3 - headerDataLen };
}

/**
 * For a TS packet at `off` with PUSI=1, returns the offset of the PES body
 * (after the PES header) or null when the packet has no payload / no PES start
 * code. For callers that also need to know how long the body is, use
 * `pesBodyExtent` - deriving it from PES_packet_length is where this goes wrong.
 */
export function pesBodyOffset(bytes: Uint8Array, off: number): number | null {
    return readPesHeader(bytes, off)?.bodyOff ?? null;
}

/**
 * Body offset AND body length of the PES starting at `off`, or null when there
 * is no PES start code, no payload, or the length field yields no body
 * (0 = unbounded, which the spec allows only for video).
 *
 * This is what a reassembly byte budget must be built from: handing
 * `collectPesBody` the raw PES_packet_length of an extended-header stream_id
 * overshoots the body by 3 + pes_header_data_length, so the walk runs into the
 * next PES start and the record reads as unavailable.
 */
export function pesBodyExtent(bytes: Uint8Array, off: number): PesBodyExtent | null {
    const header = readPesHeader(bytes, off);
    if (header === null || header.bodyLen <= 0) return null;
    return header;
}

/**
 * Outcome of a reassembly attempt. The two failure modes must stay distinct:
 * "incomplete" means the buffer ran out and the caller should re-try this
 * packet once more data is in hand, while "unavailable" means the answer will
 * not improve and the packet has to be stepped over. Collapsing them into one
 * null makes a chunked scan carry an ever-growing tail on a stream that keeps
 * failing to reassemble.
 */
export type ReassemblyResult = { body: Uint8Array } | "incomplete" | "unavailable";

// How far to look for continuation packets of the same PID. The continuations
// of one PES follow within a handful of packets; this only bounds the damage
// on a corrupt stream.
const REASSEMBLY_PACKET_LIMIT = 64;

/**
 * Concatenates the PES body starting at `bodyOff` with the payloads of the
 * following packets on the same PID, until `needBytes` are available. Stops at
 * the next PES start (PUSI=1) on that PID, since that is a different record.
 */
export function collectPesBody(
    buf: Uint8Array,
    packetOff: number,
    bodyOff: number,
    pid: number,
    needBytes: number,
): ReassemblyResult {
    const parts: Uint8Array[] = [buf.subarray(bodyOff, packetOff + TS_SIZE)];
    let have = parts[0]!.length;

    let off = packetOff + TS_SIZE;
    let seen = 0;
    while (have < needBytes) {
        if (seen++ >= REASSEMBLY_PACKET_LIMIT) return "unavailable";
        if (off + TS_SIZE > buf.length) return "incomplete";
        if (buf[off] !== TS_SYNC) return "unavailable"; // desync, not a short read
        const b1 = buf[off + 1]!;
        if ((((b1 & 0x1f) << 8) | buf[off + 2]!) !== pid) {
            off += TS_SIZE;
            continue;
        }
        if ((b1 & 0x40) !== 0) return "unavailable"; // next PES started - record is short

        const af = (buf[off + 3]! & 0x30) >> 4;
        if (af === 2) {
            off += TS_SIZE;
            continue; // adaptation field only
        }
        let payOff = off + 4;
        if (af === 3) payOff += 1 + buf[payOff]!;
        if (payOff < off + TS_SIZE) {
            const part = buf.subarray(payOff, off + TS_SIZE);
            parts.push(part);
            have += part.length;
        }
        off += TS_SIZE;
    }

    const out = new Uint8Array(have);
    let at = 0;
    for (const part of parts) {
        out.set(part, at);
        at += part.length;
    }
    return { body: out };
}
