// Walk NAL units inside first key packet to see if VPS/SPS/PPS are inband.
import { Input, BlobSource, ALL_FORMATS, EncodedPacketSink } from "mediabunny";
import { readFileSync } from "node:fs";
import { basename } from "node:path";

function nalTypeName(t) {
    if (t >= 0 && t <= 9) return "TRAIL/STSA/RASL slice (" + t + ")";
    if (t === 16) return "BLA_W_LP";
    if (t === 19) return "IDR_W_RADL";
    if (t === 20) return "IDR_N_LP";
    if (t === 21) return "CRA";
    if (t === 32) return "VPS";
    if (t === 33) return "SPS";
    if (t === 34) return "PPS";
    if (t === 35) return "AUD";
    if (t === 39) return "PREFIX_SEI";
    if (t === 40) return "SUFFIX_SEI";
    return "type=" + t;
}

async function inspect(path) {
    console.log("\n=== " + basename(path) + " ===");
    const buf = readFileSync(path);
    const blob = new Blob([buf]);
    const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
    const tracks = await input.getTracks();
    const v = tracks.find((t) => t.type === "video");
    const sink = new EncodedPacketSink(v);
    const first = await sink.getFirstPacket();
    if (!first) {
        console.log("no first packet");
        return;
    }
    console.log("packet bytes:", first.data.byteLength, "type:", first.type);
    const data = new Uint8Array(first.data.buffer, first.data.byteOffset, first.data.byteLength);
    // AVCC-style: length-prefixed (4 bytes per lengthSizeMinusOne+1=4)
    let off = 0;
    let i = 0;
    while (off + 4 <= data.length && i < 12) {
        const len = (data[off] << 24) | (data[off+1] << 16) | (data[off+2] << 8) | data[off+3];
        off += 4;
        if (len === 0 || len > data.length - off) {
            console.log("  bad nalu length at", off-4, "len=", len, " - stop");
            break;
        }
        const nalHeader = data[off];
        const nalType = (nalHeader >> 1) & 0x3f;
        const hex16 = Array.from(data.subarray(off, off + Math.min(16, len)), (b) => b.toString(16).padStart(2, "0")).join(" ");
        console.log(`  nalu[${i}] off=${off} len=${len} type=${nalType} (${nalTypeName(nalType)}) hex16=${hex16}`);
        off += len;
        i++;
    }
}

for (const p of process.argv.slice(2)) {
    try {
        await inspect(p);
    } catch (e) {
        console.error(p, e);
    }
}
