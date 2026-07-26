// GPMF (GoPro Metadata Format) - KLV parser.
//
// Format: github.com/gopro/gpmf-parser/blob/main/docs/README.md
//
// Each token: 8-byte header + payload:
//   [0..3] FourCC      ASCII (e.g. "GPS5")
//   [4]    Type        ASCII char ('l','f','S','U','c', 0=nested...)
//   [5]    SampleSize  uint8 (size of one element in the payload)
//   [6..7] Repeat      uint16 BE (number of elements)
//   [8..]  Payload     SampleSize*Repeat bytes + padding to multiple of 4
//
// All integer fields are big-endian (unlike Novatek freeGPS which uses LE).
//
// Type=0x00 means nested: payload is a nested KLV chain. Used for DEVC
// (root device container) and STRM (stream container grouping tags for one
// data type such as GPS5).
//
// Typical device-payload hierarchy:
//   DEVC (nested)
//     ├ DVID (uint32 device id)
//     ├ DVNM (string device name)
//     └ STRM (nested) - one per telemetry type
//         ├ STMP (uint64 timestamp in microseconds)
//         ├ TSMP (uint32 total samples)
//         ├ SCAL (int32×N - divisors for the next payload tag)
//         ├ UNIT (string×N - units of measure)
//         ├ STNM (string - stream name)
//         ├ GPSU (string yymmddhhmmss.sss UTC, for GPS5)
//         ├ GPSF (uint32 fix quality 0/2/3)
//         ├ GPSP (uint16 DOP × 100)
//         ├ GPS5 (int32×5 - lat/lon/alt/speed2d/speed3d, up to HERO10)
//         └ GPS9 (mixed - lat/lon/alt/speed2d/speed3d/days/ms/dop/fix, HERO11+)

export interface GpmfToken {
    /** FourCC key: 'DEVC', 'STRM', 'GPS5', 'GPSU', 'SCAL', etc. */
    fourCC: string;
    /** Type byte: 'l'/'L'/'s'/'S'/'b'/'B'/'f'/'d'/'c'/'U'/'?', or 0 for nested. */
    type: number;
    /** Size of one element in the payload, bytes. */
    sampleSize: number;
    /** Number of elements. Total payload = sampleSize * repeat (without padding). */
    repeat: number;
    /** Raw DataView over the payload. */
    payload: DataView;
    /** Absolute payload offset in the source DataView (for debugging). */
    payloadOffset: number;
}

/**
 * Iterator over all top-level KLV tokens in the given DataView region.
 * Not recursive - pass token.payload to iterTokens again for nested blocks.
 */
export function* iterTokens(dv: DataView, start = 0, end = dv.byteLength): Generator<GpmfToken> {
    let pos = start;
    while (pos + 8 <= end) {
        const fourCC = String.fromCharCode(
            dv.getUint8(pos),
            dv.getUint8(pos + 1),
            dv.getUint8(pos + 2),
            dv.getUint8(pos + 3),
        );
        const type = dv.getUint8(pos + 4);
        const sampleSize = dv.getUint8(pos + 5);
        const repeat = dv.getUint16(pos + 6); // BE by default
        const payloadStart = pos + 8;
        const payloadSize = sampleSize * repeat;
        if (payloadStart + payloadSize > end) return; // corrupt block - stop
        const payload = new DataView(dv.buffer, dv.byteOffset + payloadStart, payloadSize);
        yield { fourCC, type, sampleSize, repeat, payload, payloadOffset: payloadStart };
        // Pad to multiple of 4 bytes.
        const padded = (payloadSize + 3) & ~3;
        pos = payloadStart + padded;
    }
}

/**
 * Decodes the payload into an array of values according to the type byte.
 * For scalar types (l/L/s/S/b/B/f/d) returns Number[]; for other types
 * returns null (caller handles them directly).
 *
 * When sampleSize > sizeof(type) there are multiple elements per sample:
 * GPS5 has sampleSize=20, type='l' (4 bytes) = 5 int32 per sample; repeat
 * is the number of samples.
 */
export function decodeNumeric(token: GpmfToken): number[] | null {
    const { type, sampleSize, repeat, payload } = token;
    const elemSize = numericTypeSize(type);
    if (elemSize === null) return null;
    if (sampleSize % elemSize !== 0) return null;

    const elemsPerSample = sampleSize / elemSize;
    const totalElems = elemsPerSample * repeat;
    const out: number[] = [];
    for (let i = 0; i < totalElems; i++) {
        const off = i * elemSize;
        out.push(readNumeric(payload, off, type));
    }
    return out;
}

/** Size in bytes of a numeric type. Null for non-numeric types. */
function numericTypeSize(type: number): number | null {
    switch (type) {
        case 0x62:
        case 0x42:
            return 1; // 'b'/'B' int8/uint8
        case 0x73:
        case 0x53:
            return 2; // 's'/'S' int16/uint16
        case 0x6c:
        case 0x4c:
            return 4; // 'l'/'L' int32/uint32
        case 0x66:
            return 4; // 'f' float32
        case 0x64:
            return 8; // 'd' float64
        case 0x4a:
            return 8; // 'J' uint64
        default:
            return null;
    }
}

/** Reads one value from a DataView according to the type byte (all BE). */
function readNumeric(dv: DataView, offset: number, type: number): number {
    switch (type) {
        case 0x62:
            return dv.getInt8(offset);
        case 0x42:
            return dv.getUint8(offset);
        case 0x73:
            return dv.getInt16(offset);
        case 0x53:
            return dv.getUint16(offset);
        case 0x6c:
            return dv.getInt32(offset);
        case 0x4c:
            return dv.getUint32(offset);
        case 0x66:
            return dv.getFloat32(offset);
        case 0x64:
            return dv.getFloat64(offset);
        case 0x4a: {
            // uint64 returned as Number. Precision is lost beyond 2^53, but for
            // microsecond timestamps that is ~285 thousand years - fine.
            const hi = dv.getUint32(offset);
            const lo = dv.getUint32(offset + 4);
            return hi * 0x100000000 + lo;
        }
        default:
            return NaN;
    }
}

/** Decodes an ASCII string from the payload, stopping at the first null byte. */
export function decodeString(token: GpmfToken): string {
    const { payload, sampleSize, repeat } = token;
    const totalLen = sampleSize * repeat;
    let str = "";
    for (let i = 0; i < totalLen; i++) {
        const b = payload.getUint8(i);
        if (b === 0) break;
        str += String.fromCharCode(b);
    }
    return str;
}

/**
 * Parses a GPSU timestamp ASCII string "yymmddhhmmss.sss" (UTC start of block).
 * Returns unix-seconds as a float (sub-second precision from the sss field).
 */
export function parseGpsuTimestamp(s: string): number | null {
    // Format: "YYMMDDHHmmss.sss" - 16 chars minimum for the integer part.
    if (s.length < 12) return null;
    const yy = Number(s.slice(0, 2));
    const mm = Number(s.slice(2, 4));
    const dd = Number(s.slice(4, 6));
    const hh = Number(s.slice(6, 8));
    const mi = Number(s.slice(8, 10));
    const ss = Number(s.slice(10, 12));
    const fracStr = s.length > 12 && s[12] === "." ? s.slice(12) : "";
    const frac = fracStr === "" ? 0 : Number(fracStr);
    if (![yy, mm, dd, hh, mi, ss, frac].every(Number.isFinite)) return null;
    // GPMF timestamps are 21st century (GoPro started in 2010).
    const year = 2000 + yy;
    const ms = Date.UTC(year, mm - 1, dd, hh, mi, ss);
    if (!Number.isFinite(ms)) return null;
    return ms / 1000 + frac;
}
