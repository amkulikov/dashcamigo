// Minimal ISOBMFF box writer for our single use case: injecting a gpmd
// metadata track into an existing MP4. Only the boxes needed for one
// meta/gpmd track are implemented - no VMHD/SMHD, no edts, no SgpdEntries,
// no ctts. Extend if more is ever needed.
//
// API is intentionally narrow: each function returns a Uint8Array for a
// complete box (header + payload). Composition via concat. Sizes are computed
// up front, big-endian.

import { concat } from "../bytes.js";

// Re-exported so existing importers (gpmd-inject, tests) keep their import site.
export { concat };

const ENC = new TextEncoder();

/** [size:u32 BE][type:4 ASCII][payload]. size includes itself. */
export function box(type: string, payload: Uint8Array | Uint8Array[]): Uint8Array {
    const data = Array.isArray(payload) ? concat(payload) : payload;
    const size = 8 + data.byteLength;
    const out = new Uint8Array(size);
    new DataView(out.buffer).setUint32(0, size, false);
    writeFourCC(out, 4, type);
    out.set(data, 8);
    return out;
}

/** FullBox: box with an extra 1-byte version + 3-byte flags header. */
export function fullBox(type: string, version: number, flags: number, payload: Uint8Array | Uint8Array[]): Uint8Array {
    const data = Array.isArray(payload) ? concat(payload) : payload;
    const header = new Uint8Array(4);
    header[0] = version & 0xff;
    header[1] = (flags >> 16) & 0xff;
    header[2] = (flags >> 8) & 0xff;
    header[3] = flags & 0xff;
    return box(type, [header, data]);
}

export function u8(v: number): Uint8Array {
    return new Uint8Array([v & 0xff]);
}
export function u16(v: number): Uint8Array {
    const b = new Uint8Array(2);
    new DataView(b.buffer).setUint16(0, v, false);
    return b;
}
export function u32(v: number): Uint8Array {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setUint32(0, v, false);
    return b;
}
/** Four ASCII characters for FourCC; no null terminator needed. */
export function fourCC(code: string): Uint8Array {
    if (code.length !== 4) throw new Error(`fourCC must be 4 chars: ${code}`);
    return ENC.encode(code);
}

/** ASCII string, optionally with a trailing null byte. */
export function ascii(s: string, withNul: boolean): Uint8Array {
    const base = ENC.encode(s);
    if (!withNul) return base;
    const out = new Uint8Array(base.byteLength + 1);
    out.set(base, 0);
    return out;
}

/** Identity 3x3 fixed-point matrix as used in tkhd/mvhd. */
export function identityMatrix(): Uint8Array {
    // 9 u32 BE values. Identity: a=0x00010000, e=0x00010000, i=0x40000000.
    const out = new Uint8Array(36);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, 0x00010000, false); // a
    dv.setUint32(16, 0x00010000, false); // e
    dv.setUint32(32, 0x40000000, false); // i (1.0 in 2.30 fixed for w-coord)
    return out;
}

function writeFourCC(buf: Uint8Array, offset: number, code: string): void {
    if (code.length !== 4) throw new Error(`fourCC must be 4 chars: ${code}`);
    for (let i = 0; i < 4; i++) buf[offset + i] = code.charCodeAt(i);
}
