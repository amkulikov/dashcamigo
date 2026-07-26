// Tiny byte-buffer helpers shared across the write paths (ISOBMFF box writer
// in src/export/iso-write.ts and the GPMF packer in src/parsers/internal).
// Kept dependency-free so either layer can import it without a cycle.

/** Concatenates Uint8Array parts into a single buffer, preserving order. */
export function concat(parts: Uint8Array[]): Uint8Array {
    let total = 0;
    for (const p of parts) total += p.byteLength;
    const out = new Uint8Array(total);
    let off = 0;
    for (const p of parts) {
        out.set(p, off);
        off += p.byteLength;
    }
    return out;
}
