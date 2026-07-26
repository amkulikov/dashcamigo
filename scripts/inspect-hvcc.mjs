// Dump hvcC (HEVCDecoderConfigurationRecord) and SPS bits to compare two files.
import { Input, BlobSource, ALL_FORMATS } from "mediabunny";
import { readFileSync } from "node:fs";
import { basename } from "node:path";

function hex(buf, max = 200) {
    const arr = new Uint8Array(buf);
    const slice = arr.subarray(0, Math.min(max, arr.length));
    return Array.from(slice, (b) => b.toString(16).padStart(2, "0")).join(" ");
}

// Parse HEVCDecoderConfigurationRecord (ISO/IEC 14496-15)
function parseHvcC(buf) {
    const v = new DataView(buf instanceof ArrayBuffer ? buf : buf.buffer, buf.byteOffset ?? 0, buf.byteLength);
    let off = 0;
    const out = {};
    out.configurationVersion = v.getUint8(off++);
    const b = v.getUint8(off++);
    out.general_profile_space = (b >> 6) & 0x3;
    out.general_tier_flag = (b >> 5) & 0x1;
    out.general_profile_idc = b & 0x1f;
    out.general_profile_compatibility_flags = v.getUint32(off); off += 4;
    // 6 bytes general_constraint_indicator_flags
    const c0 = v.getUint8(off++);
    const c1 = v.getUint8(off++);
    const c2 = v.getUint8(off++);
    const c3 = v.getUint8(off++);
    const c4 = v.getUint8(off++);
    const c5 = v.getUint8(off++);
    out.general_constraint_indicator_flags = [c0, c1, c2, c3, c4, c5].map((x) => x.toString(16).padStart(2, "0")).join("");
    out.general_level_idc = v.getUint8(off++);
    out.min_spatial_segmentation_idc = v.getUint16(off) & 0x0fff; off += 2;
    out.parallelismType = v.getUint8(off++) & 0x3;
    out.chromaFormat = v.getUint8(off++) & 0x3;
    out.bitDepthLumaMinus8 = v.getUint8(off++) & 0x7;
    out.bitDepthChromaMinus8 = v.getUint8(off++) & 0x7;
    out.avgFrameRate = v.getUint16(off); off += 2;
    const flags = v.getUint8(off++);
    out.constantFrameRate = (flags >> 6) & 0x3;
    out.numTemporalLayers = (flags >> 3) & 0x7;
    out.temporalIdNested = (flags >> 2) & 0x1;
    out.lengthSizeMinusOne = flags & 0x3;
    out.numOfArrays = v.getUint8(off++);
    out.arrays = [];
    for (let i = 0; i < out.numOfArrays; i++) {
        const a = {};
        const ab = v.getUint8(off++);
        a.array_completeness = (ab >> 7) & 0x1;
        a.NAL_unit_type = ab & 0x3f; // 32=VPS, 33=SPS, 34=PPS
        a.numNalus = v.getUint16(off); off += 2;
        a.nalus = [];
        for (let k = 0; k < a.numNalus; k++) {
            const len = v.getUint16(off); off += 2;
            const data = new Uint8Array(v.buffer, v.byteOffset + off, len);
            off += len;
            a.nalus.push({ length: len, hex: hex(data, 64), full: data });
        }
        out.arrays.push(a);
    }
    return out;
}

// Strip HEVC emulation prevention bytes (0x03 after two 0x00s) from RBSP
function stripEmulation(nal) {
    const out = [];
    let zeroes = 0;
    for (let i = 0; i < nal.length; i++) {
        const b = nal[i];
        if (zeroes >= 2 && b === 0x03) {
            zeroes = 0;
            continue;
        }
        out.push(b);
        if (b === 0) zeroes++;
        else zeroes = 0;
    }
    return new Uint8Array(out);
}

// Bit reader for RBSP
function makeBitReader(bytes) {
    let bytePos = 0;
    let bitPos = 0;
    return {
        u(n) {
            let v = 0;
            for (let i = 0; i < n; i++) {
                const b = (bytes[bytePos] >> (7 - bitPos)) & 1;
                v = (v << 1) | b;
                bitPos++;
                if (bitPos === 8) {
                    bitPos = 0;
                    bytePos++;
                }
            }
            return v;
        },
        ue() {
            // Exp-Golomb unsigned
            let zeroes = 0;
            while (this.u(1) === 0 && bytePos < bytes.length) zeroes++;
            if (zeroes === 0) return 0;
            const tail = this.u(zeroes);
            return (1 << zeroes) - 1 + tail;
        },
        se() {
            const v = this.ue();
            return v % 2 === 0 ? -(v >> 1) : ((v + 1) >> 1);
        },
        get pos() { return [bytePos, bitPos]; },
    };
}

// Parse SPS up to general_level_idc + chroma_format + bit_depth
function parseSpsTop(spsNal) {
    // skip 2-byte NAL header
    const rbsp = stripEmulation(spsNal.subarray(2));
    const r = makeBitReader(rbsp);
    const sps = {};
    sps.video_parameter_set_id = r.u(4);
    sps.max_sub_layers_minus1 = r.u(3);
    sps.temporal_id_nesting_flag = r.u(1);
    // profile_tier_level(1, max_sub_layers_minus1)
    sps.general_profile_space = r.u(2);
    sps.general_tier_flag = r.u(1);
    sps.general_profile_idc = r.u(5);
    sps.general_profile_compatibility_flags = r.u(32).toString(16).padStart(8, "0");
    // 48 bits of constraint flags (split into two reads since u() max)
    const cFlagsHi = r.u(24);
    const cFlagsLo = r.u(24);
    sps.general_constraint_indicator_flags =
        cFlagsHi.toString(16).padStart(6, "0") + cFlagsLo.toString(16).padStart(6, "0");
    sps.general_level_idc = r.u(8);
    return sps;
}

async function inspect(path) {
    console.log("\n=== " + basename(path) + " ===");
    const buf = readFileSync(path);
    const blob = new Blob([buf]);
    const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
    const tracks = await input.getTracks();
    const v = tracks.find((t) => t.type === "video");
    const dec = await v.getDecoderConfig();
    console.log("decoderConfig.codec:", dec.codec);
    console.log("decoderConfig.description bytes:", dec.description.byteLength);
    console.log("hvcC raw:", hex(dec.description, 100));

    const hvcc = parseHvcC(dec.description);
    console.log("\nhvcC parsed:");
    console.log("  profile_idc:", hvcc.general_profile_idc, "(1=Main, 2=Main10, 3=MainStillPicture)");
    console.log("  tier_flag:", hvcc.general_tier_flag, "(0=Main, 1=High)");
    console.log("  profile_compat_flags:", hvcc.general_profile_compatibility_flags.toString(2).padStart(32, "0"));
    console.log("  constraint_flags:", hvcc.general_constraint_indicator_flags);
    console.log("  level_idc:", hvcc.general_level_idc, "(level = idc/30)");
    console.log("  chromaFormat:", hvcc.chromaFormat, "(1=4:2:0, 2=4:2:2, 3=4:4:4)");
    console.log("  bitDepthLuma:", 8 + hvcc.bitDepthLumaMinus8);
    console.log("  bitDepthChroma:", 8 + hvcc.bitDepthChromaMinus8);
    console.log("  avgFrameRate:", hvcc.avgFrameRate, "(in 256ths, 0=unspecified)");
    console.log("  numTemporalLayers:", hvcc.numTemporalLayers);
    console.log("  numOfArrays:", hvcc.numOfArrays);

    for (const a of hvcc.arrays) {
        const typeName = a.NAL_unit_type === 32 ? "VPS" : a.NAL_unit_type === 33 ? "SPS" : a.NAL_unit_type === 34 ? "PPS" : "?";
        console.log(`  array NAL=${a.NAL_unit_type} (${typeName}), nalus=${a.numNalus}`);
        for (const n of a.nalus) {
            console.log(`    len=${n.length}, hex[64]=${n.hex}`);
            if (a.NAL_unit_type === 33) {
                try {
                    const sps = parseSpsTop(n.full);
                    console.log("    -> SPS profile_idc=" + sps.general_profile_idc, "level_idc=" + sps.general_level_idc, "compat=" + sps.general_profile_compatibility_flags, "constraint=" + sps.general_constraint_indicator_flags);
                } catch (e) {
                    console.log("    SPS parse error:", e.message);
                }
            }
        }
    }
}

for (const p of process.argv.slice(2)) {
    try {
        await inspect(p);
    } catch (e) {
        console.error("FAIL", p, e);
    }
}
