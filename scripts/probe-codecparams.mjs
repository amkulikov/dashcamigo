#!/usr/bin/env node
// Diagnostic script: for each .mp4/.mov in private/incoming, prints
// codec / codecParam / decoderConfig.description.byteLength and our
// needsHevcRemux verdict. Helps understand why specific files land in the
// MSE pipeline (false-positive vs true hev1).
//
// Run: node scripts/probe-codecparams.mjs

import { promises as fs } from "node:fs";
import path from "node:path";
import { Input, FilePathSource, ALL_FORMATS } from "mediabunny";

const ROOT = path.resolve(process.cwd(), "private/incoming/troubles");

async function walk(dir) {
    const out = [];
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) out.push(...(await walk(full)));
        else if (/\.(mp4|mov)$/i.test(e.name)) out.push(full);
    }
    return out;
}

// Reproduces the detection from src/hevc-remux.ts (node has no TS import
// without a build step, easier to copy). Fires only if hvcC contains a NAL
// array with a type that clearly breaks the native decoder (VCL 0-31 or
// reserved 45+).
function isInvalidHvccNalType(nalType) {
    return nalType < 32 || nalType > 44;
}
function needsHevcRemux(codec, hvccArrays) {
    if (codec !== "hevc") return false;
    if (!hvccArrays) return false;
    return hvccArrays.some((a) => isInvalidHvccNalType(a.nalType));
}

// Parses the HEVCDecoderConfigurationRecord and extracts the array of NAL
// types stored in hvcC. Per ISO/IEC 14496-15 §8.3.3.1.2, only parameter sets
// (VPS=32, SPS=33, PPS=34) and SEI (39, 40) should be here; firmwares often
// throw in extra non-VCL NALs (AUD=35, EOS=36, EOB=37, FD=38) - native
// decoders usually ignore those. VCL types (0-31, slice data) and reserved
// (45+) are obvious garbage/padding.
function parseHvccNalTypes(desc) {
    if (!desc) return null;
    let src;
    if (desc instanceof ArrayBuffer) src = new Uint8Array(desc);
    else if (ArrayBuffer.isView(desc)) src = new Uint8Array(desc.buffer, desc.byteOffset, desc.byteLength);
    else return null;
    if (src.byteLength < 23) return null;
    const numArrays = src[22];
    const out = [];
    let p = 23;
    for (let a = 0; a < numArrays; a++) {
        if (p + 3 > src.length) return out;
        const headerByte = src[p];
        const nalType = headerByte & 0x3f;
        const numNalus = (src[p + 1] << 8) | src[p + 2];
        p += 3;
        let totalNalBytes = 0;
        for (let n = 0; n < numNalus; n++) {
            if (p + 2 > src.length) return out;
            const naluSize = (src[p] << 8) | src[p + 1];
            const naluStart = p + 2;
            if (naluStart + naluSize > src.length) return out;
            totalNalBytes += naluSize;
            p = naluStart + naluSize;
        }
        out.push({ nalType, numNalus, totalNalBytes });
    }
    return out;
}

const NAL_NAMES = {
    0: "TRAIL_N",
    1: "TRAIL_R",
    16: "BLA_W_LP",
    19: "IDR_W_RADL",
    20: "IDR_N_LP",
    21: "CRA",
    32: "VPS",
    33: "SPS",
    34: "PPS",
    35: "AUD",
    36: "EOS",
    37: "EOB",
    38: "FD",
    39: "PREFIX_SEI",
    40: "SUFFIX_SEI",
};
function nalLabel(t) {
    return NAL_NAMES[t] ?? `?${t}`;
}

async function probe(file) {
    let input = null;
    try {
        input = new Input({ source: new FilePathSource(file), formats: ALL_FORMATS });
        const vt = await input.getPrimaryVideoTrack();
        if (!vt) return { file, codec: null, codecParam: null, descLen: 0, hvccArrays: null, decision: false, note: "no-video-track" };
        const codec = await vt.getCodec();
        const codecParam = await vt.getCodecParameterString();
        const dc = await vt.getDecoderConfig();
        const descLen = dc?.description ? dc.description.byteLength ?? dc.description.length ?? 0 : 0;
        const hvccArrays = codec === "hevc" ? parseHvccNalTypes(dc?.description) : null;
        const decision = needsHevcRemux(codec, hvccArrays);
        return { file, codec, codecParam, descLen, hvccArrays, decision, note: "" };
    } catch (e) {
        return { file, codec: null, codecParam: null, descLen: 0, hvccArrays: null, decision: false, note: `err: ${e.message ?? e}` };
    } finally {
        if (input) {
            try {
                input.dispose();
            } catch {
                /* ignore */
            }
        }
    }
}

const files = await walk(ROOT);
files.sort();

console.log(`probing ${files.length} files in ${ROOT}\n`);

const rows = [];
for (const f of files) {
    rows.push(await probe(f));
}

// Print the table.
const rel = (p) => path.relative(ROOT, p);

console.log("# HEVC files only (others omitted - all native h264)\n");
console.log("file | codecParam | hvcC arrays");
console.log("-".repeat(120));
for (const r of rows) {
    if (r.codec !== "hevc") continue;
    const arr = (r.hvccArrays ?? []).map((a) => `${nalLabel(a.nalType)}×${a.numNalus}(${a.totalNalBytes}B)`).join(" ");
    console.log(`${rel(r.file)}\n  codecParam=${r.codecParam} descLen=${r.descLen}\n  arrays: ${arr}\n`);
}

console.log("\n=== HEVC summary by hvcC NAL types signature ===");
const sigCount = {};
for (const r of rows) {
    if (r.codec !== "hevc") continue;
    const sig = (r.hvccArrays ?? []).map((a) => nalLabel(a.nalType)).join(",");
    sigCount[sig] = (sigCount[sig] ?? 0) + 1;
}
for (const [sig, n] of Object.entries(sigCount).sort()) {
    console.log(`${n}× [${sig}]`);
}
