// Repair a 70mai MP4 with broken hvcC by copying hvcC payload from a sibling
// known-good file (same camera, same recording session - identical SPS/VPS/PPS).
//
// Usage:
//   node scripts/repair-hvcc.mjs <broken.mp4> <good.mp4> <out.mp4>
//
// Strategy: scan the file linearly, find moov->trak->mdia->minf->stbl->stsd->
// hev1->hvcC and replace its payload byte-for-byte from the donor file's hvcC.
// We do not touch any offsets in moov (the new hvcC has the same length so
// nothing shifts), so this is safe.

import { readFileSync, writeFileSync } from "node:fs";

function readUint32BE(buf, off) {
    return (buf[off] * 0x1000000) + (buf[off+1] << 16) + (buf[off+2] << 8) + buf[off+3];
}

function findBox(buf, type, start = 0, end = buf.length) {
    let off = start;
    while (off + 8 <= end) {
        const size = readUint32BE(buf, off);
        const t = String.fromCharCode(buf[off+4], buf[off+5], buf[off+6], buf[off+7]);
        if (size < 8) return -1;
        if (t === type) return off;
        off += size;
    }
    return -1;
}

function findHvcC(buf) {
    // moov box
    const moov = findBox(buf, "moov");
    if (moov < 0) throw new Error("no moov");
    const moovSize = readUint32BE(buf, moov);
    const moovEnd = moov + moovSize;

    // walk tracks under moov
    let trakOff = moov + 8;
    while (trakOff < moovEnd) {
        const sz = readUint32BE(buf, trakOff);
        const t = String.fromCharCode(buf[trakOff+4], buf[trakOff+5], buf[trakOff+6], buf[trakOff+7]);
        if (t === "trak") {
            const trakEnd = trakOff + sz;
            const mdia = findBox(buf, "mdia", trakOff + 8, trakEnd);
            if (mdia >= 0) {
                const mdiaEnd = mdia + readUint32BE(buf, mdia);
                const minf = findBox(buf, "minf", mdia + 8, mdiaEnd);
                if (minf >= 0) {
                    const minfEnd = minf + readUint32BE(buf, minf);
                    const stbl = findBox(buf, "stbl", minf + 8, minfEnd);
                    if (stbl >= 0) {
                        const stblEnd = stbl + readUint32BE(buf, stbl);
                        const stsd = findBox(buf, "stsd", stbl + 8, stblEnd);
                        if (stsd >= 0) {
                            const stsdEnd = stsd + readUint32BE(buf, stsd);
                            // stsd: 8 (size+type) + 4 (version+flags) + 4 (entry_count) = +16 to entries
                            let entryOff = stsd + 16;
                            while (entryOff < stsdEnd) {
                                const esz = readUint32BE(buf, entryOff);
                                const etype = String.fromCharCode(buf[entryOff+4], buf[entryOff+5], buf[entryOff+6], buf[entryOff+7]);
                                if (etype === "hev1" || etype === "hvc1" || etype === "hvcC") {
                                    if (etype === "hvcC") return { off: entryOff, size: esz };
                                    // VisualSampleEntry has 78-byte fixed area before children
                                    const childStart = entryOff + 8 + 78;
                                    const childEnd = entryOff + esz;
                                    const hvcC = findBox(buf, "hvcC", childStart, childEnd);
                                    if (hvcC >= 0) return { off: hvcC, size: readUint32BE(buf, hvcC), parentType: etype };
                                }
                                entryOff += esz;
                            }
                        }
                    }
                }
            }
        }
        trakOff += sz;
    }
    throw new Error("no hvcC");
}

const [brokenPath, goodPath, outPath] = process.argv.slice(2);
if (!brokenPath || !goodPath || !outPath) {
    console.error("usage: node repair-hvcc.mjs <broken.mp4> <good.mp4> <out.mp4>");
    process.exit(2);
}

const broken = readFileSync(brokenPath);
const good = readFileSync(goodPath);

const brokenHvcC = findHvcC(broken);
const goodHvcC = findHvcC(good);

console.log("broken hvcC:", brokenHvcC);
console.log("good   hvcC:", goodHvcC);

if (brokenHvcC.size !== goodHvcC.size) {
    console.error("hvcC sizes differ - aborting (broken=" + brokenHvcC.size + " good=" + goodHvcC.size + ")");
    process.exit(3);
}

const out = Buffer.from(broken);
good.copy(out, brokenHvcC.off, goodHvcC.off, goodHvcC.off + goodHvcC.size);
writeFileSync(outPath, out);
console.log("wrote", outPath, "(", out.length, "bytes )");
console.log("replaced", brokenHvcC.size, "bytes of hvcC at offset", brokenHvcC.off);
