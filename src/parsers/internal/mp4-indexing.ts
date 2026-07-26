// Pure indexing logic - separated from workers/indexer-worker.ts so node
// tests can call it without spinning up a Worker (Worker is undefined in
// node, and we still want unit coverage of the TS branch since nothing else
// in the test suite hits mediabunny.MpegTsInputFormat).

import { Input, BlobSource, InputDisposedError, UnsupportedInputFormatError } from "mediabunny";
import type { VideoCodec } from "mediabunny";

import { createLogger } from "../../log.js";
import { needsHevcRemux } from "../../hevc-remux.js";
import { detectMoovRepairs } from "../../repair/moov-repair.js";
import { VIDEO_INPUT_FORMATS } from "../../video-formats.js";
import { isNonIsobmffContainerName } from "../../video-format-names.js";
import type { IndexedMp4, IndexerRepair } from "../../workers/indexer-protocol.js";

import {
    findBox,
    findHvccInTrak,
    findMoovInFile,
    findPrimaryVideoSampleFormat,
    fourCCToVideoCodec,
    hevcCodecStringFromHvcc,
    isImaAdpcmSampleEntry,
    iterBoxes,
    readHandlerType,
    readMvhdCreationTime,
    readMvhdDurationSec,
    readSoundSampleParams,
    readTkhdRotation,
    readVideoFrameRate,
    readVisualSampleDimensions,
    type Mp4Rotation,
} from "./mp4-walker.js";

const log = createLogger("mp4-indexing");

// Packet budget for the TS/MKV fps estimate. computePacketStats does a prefix
// scan; ~120 frames (a few seconds at 25-60 fps) gives a stable average packet
// rate without walking the whole container on a cold SD card. Display-only, so
// a rough value is fine.
const FPS_PROBE_PACKETS = 120;

/** Index result + optional moov bytes (only when the caller asked for them). */
export interface IndexedWithMoov {
    indexed: IndexedMp4 | null;
    /** Raw moov bytes (transferable) when captureMoov=true and the file is
     *  MP4/MOV with a valid moov. Undefined for TS or non-MP4. */
    moovBytes?: Uint8Array;
    /** Container-repair descriptor when a phantom track / broken hvcC was found
     *  in this file's moov. Undefined when the moov is clean. */
    repair?: IndexerRepair;
}

/**
 * Indexes one MP4/MOV via a direct moov walk. Returns the moov bytes too
 * so the caller can ship them to gps-extract and skip its second read.
 */
export async function indexMp4FileWithMoov(file: File, captureMoov: boolean): Promise<IndexedWithMoov> {
    const found = await findMoovInFile(file).catch(() => null);
    if (!found) {
        log.info("mp4 indexing skipped: moov not found", { file: file.name });
        return { indexed: null };
    }
    const moovDv = new DataView(found.bytes.buffer, found.bytes.byteOffset, found.bytes.byteLength);
    const durationSec = readMvhdDurationSec(moovDv);
    if (durationSec === null) {
        log.info("mp4 indexing skipped: no valid duration in mvhd", { file: file.name });
        return { indexed: null };
    }
    const createdUtc = readMvhdCreationTime(moovDv);
    const codecParam = findPrimaryVideoSampleFormat(moovDv);
    const codec = codecParam ? fourCCToVideoCodec(codecParam) : null;

    let rotation: Mp4Rotation = 0;
    let needsRemux = false;
    // RFC 6381 string only for HEVC (parsed from hvcC below). AVC stays
    // codec-enum only: H.264 decode is near-universal where the browser claims
    // avc support, so the false-positive that matters (HEVC Main10 / high level
    // on a browser without 10-bit decode) is HEVC-specific. See the canPlay
    // check in ingest.ts.
    let videoCodecString: string | null = null;
    // Audio track is IMA ADPCM (Mio/Navman MiVue) - flagged so playback routes
    // through the MSE backend that transcodes it to Opus (no browser decodes
    // ADPCM natively). Detected from the soun trak's stsd 4cc in the moov bytes
    // already in hand, so it costs no extra IO.
    let audioNeedsTranscode = false;
    // Display-only technical-details fields read from the same moov already in
    // hand (zero extra IO): coded frame size + average fps from the video trak,
    // audio 4cc/channels/rate from the soun trak.
    let width: number | null = null;
    let height: number | null = null;
    let fps: number | null = null;
    let audio: IndexedMp4["audio"] = null;
    let sawVideo = false;
    let sawAudio = false;
    const moov = findBox(moovDv, 0, moovDv.byteLength, "moov");
    if (moov) {
        for (const child of iterBoxes(moovDv, moov.payloadStart, moov.end)) {
            if (child.type !== "trak") continue;
            const handler = readHandlerType(moovDv, child);
            if (handler === "vide" && !sawVideo) {
                sawVideo = true;
                rotation = readTkhdRotation(moovDv, child);
                const dims = readVisualSampleDimensions(moovDv, child);
                if (dims) {
                    width = dims.width;
                    height = dims.height;
                }
                fps = readVideoFrameRate(moovDv, child);
                if (codec === "hevc") {
                    const hvcc = findHvccInTrak(moovDv, child);
                    if (hvcc) {
                        const description = new Uint8Array(
                            moovDv.buffer,
                            moovDv.byteOffset + hvcc.payloadStart,
                            hvcc.payloadEnd - hvcc.payloadStart,
                        );
                        needsRemux = needsHevcRemux(codec, description);
                        videoCodecString = hevcCodecStringFromHvcc(description);
                    }
                }
            } else if (handler === "soun" && !sawAudio) {
                sawAudio = true;
                const sound = readSoundSampleParams(moovDv, child);
                if (sound) {
                    if (isImaAdpcmSampleEntry(sound.format)) audioNeedsTranscode = true;
                    audio = { codec: sound.format, channels: sound.channels, sampleRate: sound.sampleRate };
                }
            }
            if (sawVideo && sawAudio) break;
        }
    }

    // Detect container defects (phantom no-data tracks, broken hvcC) from the
    // moov bytes already in hand. This used to be two post-index stages on the
    // main thread, each re-reading the moov via findMoovInFile. Constant-size
    // patch; the descriptor carries the patched moov for a zero-copy splice on
    // main. null (the common case) means the moov is clean - no extra copy.
    const moovRepair = detectMoovRepairs(found.bytes, codec);
    // When the hvcC header was rebuilt, videoCodecString parsed above came from
    // the broken header (bogus profile/level, e.g. hev1.2.0.L0) - keeping it
    // would make the config-aware canPlay probe reject a file that decodes fine
    // after the splice, and would show the wrong codec in the details panel.
    // Adopt the string re-derived from the repaired hvcC. (needsHevcRemux is
    // corrected on the main thread in applyIndexRepair, so it needs no fix here.)
    if (moovRepair?.hvcc?.videoCodecString) videoCodecString = moovRepair.hvcc.videoCodecString;

    const indexed: IndexedMp4 = {
        durationSec,
        createdUtc,
        codec,
        codecParam,
        videoCodecString,
        rotation,
        width,
        height,
        fps,
        audio,
        needsHevcRemux: needsRemux,
        audioNeedsTranscode,
    };

    const repair: IndexerRepair | undefined = moovRepair
        ? {
              patchedMoov: moovRepair.patchedMoov,
              moovFileStart: found.fileStart,
              moovFileEnd: found.fileEnd,
              phantomNeutralized: moovRepair.phantomNeutralized,
              hvcc: moovRepair.hvcc,
          }
        : undefined;

    return { indexed, moovBytes: captureMoov ? found.bytes : undefined, repair };
}

/**
 * Non-ISOBMFF path (MPEG-TS, Matroska): no mvhd, no display matrix, no embedded
 * wall-clock. Single mediabunny Input call yields durationSec and codec. moov
 * bytes are N/A (these containers have no moov). computeDuration scans the whole
 * container, so the same cold-SD-card abort concern as TS applies to MKV too.
 */
export async function indexNonIsobmffFile(file: File, signal?: AbortSignal): Promise<IndexedWithMoov> {
    let input: Input | null = null;
    let onAbort: (() => void) | null = null;
    try {
        input = new Input({ source: new BlobSource(file), formats: VIDEO_INPUT_FORMATS });
        // mediabunny has no InputOptions.signal - dispose() is the documented way
        // to cancel in-flight reads. computeDuration scans the whole TS container
        // (no moov) and is 10+ s on a cold SD card; without this an ingest cancel
        // waits out every in-flight scan. dispose() surfaces as InputDisposedError,
        // which the catch below already handles as a clean abort.
        if (signal) {
            const inp = input;
            onAbort = () => {
                if (!inp.disposed) inp.dispose();
            };
            if (signal.aborted) onAbort();
            else signal.addEventListener("abort", onAbort, { once: true });
        }
        const durationSec = await input.computeDuration();
        if (!Number.isFinite(durationSec) || durationSec <= 0) {
            log.info("non-isobmff indexing skipped: invalid duration", { file: file.name, durationSec });
            return { indexed: null };
        }
        let codec: VideoCodec | null = null;
        // Full codec string straight from mediabunny here: the TS path has the
        // track in hand, so getCodecParameterString gives profile/level for free
        // (no extra IO) and feeds the config-aware canPlay check in ingest.ts.
        let videoCodecString: string | null = null;
        let width: number | null = null;
        let height: number | null = null;
        let fps: number | null = null;
        try {
            const vt = await input.getPrimaryVideoTrack();
            if (vt) {
                codec = await vt.getCodec();
                videoCodecString = await vt.getCodecParameterString();
                // Display dims are cached getters once the track is resolved.
                if (vt.displayWidth > 0 && vt.displayHeight > 0) {
                    width = vt.displayWidth;
                    height = vt.displayHeight;
                }
                // fps needs a bounded packet scan; best-effort so a scan failure
                // (or an ingest-cancel dispose) never voids the codec above.
                try {
                    const stats = await vt.computePacketStats(FPS_PROBE_PACKETS);
                    if (Number.isFinite(stats.averagePacketRate) && stats.averagePacketRate > 0) {
                        fps = stats.averagePacketRate;
                    }
                } catch {
                    // fps stays null - packet scan unavailable / aborted.
                }
            }
        } catch {
            // codec=null is treated optimistically downstream.
        }

        // Matroska can carry IMA-ADPCM audio (A_MS/ACM + null codec: a PCM WAVE
        // tag would be recognised, so null under A_MS/ACM is the ADPCM variant
        // mediabunny cannot read). Flag it so playback routes through the MSE
        // backend, which decodes ADPCM and re-encodes it. TS in our corpus
        // carries AAC, so this only ever fires for MKV.
        let audioNeedsTranscode = false;
        let audio: IndexedMp4["audio"] = null;
        try {
            const at = await input.getPrimaryAudioTrack();
            if (at) {
                const audioCodec = await at.getCodec();
                if (audioCodec === null && (await at.getInternalCodecId()) === "A_MS/ACM") {
                    audioNeedsTranscode = true;
                }
                audio = { codec: audioCodec, channels: at.numberOfChannels, sampleRate: at.sampleRate };
            }
        } catch {
            // Unreadable audio metadata - leave audio to drop gracefully.
        }

        return {
            indexed: {
                durationSec,
                createdUtc: null,
                codec,
                codecParam: null,
                videoCodecString,
                rotation: 0,
                width,
                height,
                fps,
                audio,
                needsHevcRemux: false,
                audioNeedsTranscode,
            },
        };
    } catch (err) {
        if (err instanceof UnsupportedInputFormatError) {
            log.info("non-isobmff indexing skipped: unsupported format", { file: file.name });
        } else if (err instanceof InputDisposedError) {
            log.debug("non-isobmff indexing aborted: input disposed", { file: file.name });
        } else {
            log.warn("non-isobmff indexing failed", {
                file: file.name,
                err: err instanceof Error ? err.message : String(err),
            });
        }
        return { indexed: null };
    } finally {
        if (signal && onAbort) signal.removeEventListener("abort", onAbort);
        if (input && !input.disposed) input.dispose();
    }
}

/** Routes to the ISOBMFF moov walk or the mediabunny container scan based on
 *  filename extension. The optional signal cuts an in-flight non-ISOBMFF scan on
 *  ingest cancel (see indexNonIsobmffFile); the MP4 path is a bounded moov walk,
 *  fast enough that the worker's loop-boundary abort check suffices, so it takes
 *  no signal. */
export async function indexOneFile(file: File, captureMoov: boolean, signal?: AbortSignal): Promise<IndexedWithMoov> {
    if (isNonIsobmffContainerName(file.name)) {
        return await indexNonIsobmffFile(file, signal);
    }
    return await indexMp4FileWithMoov(file, captureMoov);
}
