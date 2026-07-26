// Diagnostic for "black screen, audio only" MP4 from dashcam.
// Usage: node scripts/inspect-mp4.mjs <file.mp4> [<file.mp4> ...]
import { Input, BlobSource, ALL_FORMATS, EncodedPacketSink } from "mediabunny";
import { readFileSync, statSync } from "node:fs";
import { basename } from "node:path";

async function inspect(path) {
    console.log("\n=== " + basename(path) + " ===");
    const size = statSync(path).size;
    console.log("size:", size, "bytes");

    const buf = readFileSync(path);
    const blob = new Blob([buf]);
    const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });

    const format = await input.getFormat();
    console.log("format:", format.name);
    console.log("duration:", await input.computeDuration(), "sec");
    console.log("mime:", await input.getMimeType());

    const tracks = await input.getTracks();
    console.log("tracks:", tracks.length);

    for (const track of tracks) {
        console.log("\n  track #" + track.id + " type=" + track.type);
        console.log("    codec:", await track.getCodec());
        console.log("    name:", track.name);
        console.log("    language:", track.languageCode);
        if (track.type === "video") {
            console.log("    width x height:", track.codedWidth + "x" + track.codedHeight);
            console.log("    rotation:", track.rotation);
            console.log("    displayWidth:", track.displayWidth, "displayHeight:", track.displayHeight);
            try {
                const decoderConfig = await track.getDecoderConfig();
                console.log("    decoderConfig:", decoderConfig ? {
                    codec: decoderConfig.codec,
                    codedWidth: decoderConfig.codedWidth,
                    codedHeight: decoderConfig.codedHeight,
                    descriptionBytes: decoderConfig.description ? decoderConfig.description.byteLength : 0,
                } : null);
            } catch (e) {
                console.log("    decoderConfig ERROR:", e.message);
            }
        }
        if (track.type === "audio") {
            console.log("    sampleRate:", track.sampleRate, "channels:", track.numberOfChannels);
        }
        try {
            const ts = await track.computeDuration();
            console.log("    track duration:", ts);
        } catch (e) {
            console.log("    track duration ERROR:", e.message);
        }
        try {
            const sink = new EncodedPacketSink(track);
            const first = await sink.getFirstPacket();
            console.log("    first packet:", first ? {
                timestamp: first.timestamp,
                duration: first.duration,
                type: first.type,
                byteLength: first.data.byteLength,
            } : null);
            // Walk first 5 video packets to see if there's a keyframe near start
            if (track.type === "video" && first) {
                let pkt = first;
                let i = 0;
                while (pkt && i < 8) {
                    console.log(`    pkt[${i}] t=${pkt.timestamp.toFixed(3)} d=${pkt.duration.toFixed(3)} type=${pkt.type} bytes=${pkt.data.byteLength}`);
                    pkt = await sink.getNextPacket(pkt);
                    i++;
                }
            }
            // Quick scan: count keyframes vs delta in first 30 sec
            if (track.type === "video") {
                const sink2 = new EncodedPacketSink(track);
                let p = await sink2.getFirstPacket();
                let key = 0, delta = 0, total = 0;
                while (p && p.timestamp < 30) {
                    if (p.type === "key") key++;
                    else delta++;
                    total++;
                    p = await sink2.getNextPacket(p);
                }
                console.log(`    video stats first 30s: total=${total} key=${key} delta=${delta}`);
            }
        } catch (e) {
            console.log("    packet walk ERROR:", e.message);
        }
    }
}

for (const path of process.argv.slice(2)) {
    try {
        await inspect(path);
    } catch (e) {
        console.error("FAILED on", path, ":", e);
    }
}
