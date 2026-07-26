#!/usr/bin/env node
// Builds a minimal MP4 with a PNDM subtitle track for the Garmin plugin's
// tests. A real Garmin Dash Cam writes dozens of PNDM samples (1Hz × duration).
// Here we make a compact fixture with 5 samples.
//
// MP4 structure:
//   ftyp
//   moov
//     mvhd (creation_time = some value)
//     trak (PNDM subtitle track)
//       tkhd
//       mdia
//         mdhd
//         hdlr (handler_type = 'sbtl')
//         minf
//           dinf (minimal)
//           stbl
//             stsd (sample format = 'tx3g')
//             stts (1 sec on each sample)
//             stsc (1 sample per chunk)
//             stsz (each sample = 20 bytes)
//             stco (chunk offsets - point into mdat)
//   mdat (5 × 20 bytes PNDM data)

import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function fourCC(s) { return Buffer.from(s, "ascii"); }
function box(type, payload) {
    const size = 8 + payload.length;
    const head = Buffer.alloc(8);
    head.writeUInt32BE(size, 0);
    fourCC(type).copy(head, 4);
    return Buffer.concat([head, payload]);
}
function u32be(n) { const b = Buffer.alloc(4); b.writeUInt32BE(n, 0); return b; }

// 1904 -> 2026-01-15 12:00:00 UTC = 2082844800 + 1768478400 = 3851323200
const CREATION_TIME = 3851323200;

const mvhd = (() => {
    const p = Buffer.alloc(108);
    // version=0 + flags (4 bytes) already zero
    p.writeUInt32BE(CREATION_TIME, 4); // creation_time
    p.writeUInt32BE(CREATION_TIME, 8); // modification_time
    p.writeUInt32BE(1000, 12); // timescale
    p.writeUInt32BE(5000, 16); // duration (5 seconds × 1000)
    return box("mvhd", p);
})();

// hdlr: handler_type='sbtl'
const hdlr = (() => {
    const p = Buffer.alloc(33);
    // version+flags (4) = zeros
    // pre_defined (4) = zeros (offset 4)
    fourCC("sbtl").copy(p, 8); // handler_type at offset 8
    // reserved (12 bytes) = zeros (offset 12-23)
    // name (null-terminated) at offset 24
    p.writeUInt8(0, 24); // empty name
    return box("hdlr", p);
})();

// minimal mdhd: version=0 + flags + 4 timestamps + lang + quality
const mdhd = (() => {
    const p = Buffer.alloc(24);
    p.writeUInt32BE(CREATION_TIME, 4); // creation_time
    p.writeUInt32BE(CREATION_TIME, 8); // modification_time
    p.writeUInt32BE(1000, 12); // timescale
    p.writeUInt32BE(5000, 16); // duration
    return box("mdhd", p);
})();

// stsd: 1 entry of format 'tx3g'
const stsd = (() => {
    // version+flags (4) + entry_count (4) + entry header (8) + tx3g body...
    // Minimal: tx3g entry = size+format+8byte reserved+min payload.
    // Just make an entry with the right format, body minimal.
    const entry = Buffer.alloc(16); // 16-byte minimal sample entry
    entry.writeUInt32BE(16, 0); // entry size
    fourCC("tx3g").copy(entry, 4);
    // reserved 6 + data_reference_index 2 = filled with zeros

    const p = Buffer.concat([
        Buffer.alloc(4), // version+flags
        u32be(1), // entry_count
        entry,
    ]);
    return box("stsd", p);
})();

// stts: 1 entry sample_count=5 sample_delta=1000 (at timescale=1000 that's 1 sec)
const stts = (() => {
    const p = Buffer.concat([
        Buffer.alloc(4), // version+flags
        u32be(1), // entry_count
        u32be(5), // sample_count
        u32be(1000), // sample_delta
    ]);
    return box("stts", p);
})();

// stsc: 1 entry first_chunk=1 samples_per_chunk=5 sample_description_index=1.
// All 5 samples sit in one chunk (sequentially in mdat).
const stsc = (() => {
    const p = Buffer.concat([
        Buffer.alloc(4), // version+flags
        u32be(1), // entry_count
        u32be(1), // first_chunk
        u32be(5), // samples_per_chunk
        u32be(1), // sample_description_index
    ]);
    return box("stsc", p);
})();

// stsz: sample_size=20 (all the same size), sample_count=5
const stsz = (() => {
    const p = Buffer.concat([
        Buffer.alloc(4), // version+flags
        u32be(20), // sample_size (20 = same for all)
        u32be(5), // sample_count
    ]);
    return box("stsz", p);
})();

// PNDM payload: 20 bytes per sample.
function pndm({ speedMph, lat, lon }) {
    const buf = Buffer.alloc(20);
    fourCC("PNDM").copy(buf, 0);
    // [4..7] reserved zeros
    buf.writeUInt16LE(speedMph, 8);
    // [10..11] reserved zeros
    // lat/lon int32 LE, scale 180/2^31
    buf.writeInt32LE(Math.round(lat / (180 / 0x80000000)), 12);
    buf.writeInt32LE(Math.round(lon / (180 / 0x80000000)), 16);
    return buf;
}

const samples = [
    pndm({ speedMph: 25, lat: 50.0, lon: 30.0 }),
    pndm({ speedMph: 30, lat: 50.0001, lon: 30.0001 }),
    pndm({ speedMph: 35, lat: 50.0002, lon: 30.0002 }),
    pndm({ speedMph: 40, lat: 50.0003, lon: 30.0003 }),
    pndm({ speedMph: 45, lat: 50.0004, lon: 30.0004 }),
];

// Compute the mdat offset - need it to write into stco.
// Structure: ftyp + moov + mdat. mdat starts right after moov.

// First assemble moov without stco to compute its size. Then
// add stco with the correct offset and reassemble.
// Hack: leave a placeholder in stco, patch it later.

const stcoPlaceholder = (() => {
    const p = Buffer.concat([
        Buffer.alloc(4), // version+flags
        u32be(1), // entry_count
        u32be(0), // chunk offset placeholder
    ]);
    return box("stco", p);
})();

const stbl = box("stbl", Buffer.concat([stsd, stts, stsc, stsz, stcoPlaceholder]));

// dinf: dref with a single url-self-reference
const dinf = (() => {
    const dref = box("dref", Buffer.concat([
        Buffer.alloc(4), // version+flags
        u32be(1), // entry_count
        // url-entry: size + 'url ' + version + flags=1 (self-reference)
        u32be(12), fourCC("url "), Buffer.from([0, 0, 0, 1]),
    ]));
    return box("dinf", dref);
})();
const minf = box("minf", Buffer.concat([dinf, stbl]));
const mdia = box("mdia", Buffer.concat([mdhd, hdlr, minf]));

// minimal tkhd
const tkhd = (() => {
    const p = Buffer.alloc(84);
    p.writeUInt32BE(7, 0); // version=0, flags=0x000007 (track enabled+used+poster)
    p.writeUInt32BE(CREATION_TIME, 4);
    p.writeUInt32BE(CREATION_TIME, 8);
    p.writeUInt32BE(1, 12); // track_id=1
    p.writeUInt32BE(5000, 20); // duration in mvhd timescale=1000
    return box("tkhd", p);
})();
const trak = box("trak", Buffer.concat([tkhd, mdia]));
const moov = box("moov", Buffer.concat([mvhd, trak]));

const ftyp = box("ftyp", Buffer.concat([
    fourCC("isom"),
    u32be(512),
    fourCC("isom"),
    fourCC("avc1"),
    fourCC("mp41"),
]));

const mdat = box("mdat", Buffer.concat(samples));

// Now patch the stco placeholder with the correct mdat offset.
// chunk-offset = ftyp.length + moov.length + 8 (mdat header). But stco is
// already inside moov, and patching would change moov size... circular.
// Simpler: compute mdat-offset assuming moov size is fixed (it does not
// depend on the stco payload content).
const mdatStartOffset = ftyp.length + moov.length + 8;

// Assemble the final file. Find the stco-data-offset inside moov:
// the stco payload contains [version+flags, entry_count, chunk_offset].
// We need the position of chunk_offset (the last 4 bytes of stcoPlaceholder).
const stcoOffsetInMoov = moov.indexOf(stcoPlaceholder);
const chunkOffsetPos = stcoOffsetInMoov + 8 /* stco header */ + 4 /* version+flags */ + 4 /* entry_count */;
const moovPatched = Buffer.from(moov);
moovPatched.writeUInt32BE(mdatStartOffset, chunkOffsetPos);

const file = Buffer.concat([ftyp, moovPatched, mdat]);

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(__dirname, "synthetic-pndm.mp4");
writeFileSync(outPath, file);
console.error(`wrote ${file.length} bytes to ${outPath}`);
