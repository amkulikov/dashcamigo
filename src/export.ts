// Range export via mediabunny - stream copy without re-encoding.
//
// Pipeline:
// - Input + BlobSource per source file, EncodedPacketSink to iterate
//   already-encoded packets.
// - Output + EncodedVideoPacketSource/EncodedAudioPacketSource: one output
//   for the whole export, packets from all source files feed the same source.
// - StreamTarget with an FSA-compatible WritableStream: writes directly to
//   disk without accumulating the full MP4 in RAM.
// - fastStart: false - moov at end of file, mdat streamed to the writer as
//   packets arrive. Only the moov sample table stays in RAM (~24 bytes per
//   sample = ~2.6 MB per hour of 4K HEVC). The 'in-memory' alternative puts
//   moov first but buffers the entire mdat until finalize - OOMs on long clips.
//   Players handle both layouts equally (moov-at-end means a seek to EOF first).
//
// Multi-source stitching: per source file we iterate packets in the target
// range via getKeyPacket+getNextPacket and push them into source.add() with
// a shifted timestamp (shift = realStart of current file + sum of previous
// durations). Mediabunny assembles a correct MP4 with a continuous timeline.
//
// Trim precision: one GOP (~1 s for 70mai). getKeyPacket() snaps the range
// start to the nearest preceding keyframe - without the snap the first frame
// of the output range cannot be decoded.
//
// We intentionally do NOT use the sink.packets(startPacket) async iterator
// (reverted in the same commit as seamless.ts): in seamless the regression was
// obvious - "Media segment did not contain any coded frames for track 1" in
// Chrome MSE and stalling video. The export path cannot trigger that
// (fastStart: false, moov-at-end, not fragmented), but we keep the manual loop
// for consistency and to avoid a separate AV skew on large clips. Returning to
// the iterator would require an interleaved feed (V/A packets in ascending pts
// order), not "all video first, then all audio".

import {
    Input,
    Output,
    Mp4OutputFormat,
    StreamTarget,
    EncodedVideoPacketSource,
    EncodedAudioPacketSource,
    AudioSampleSource,
    EncodedPacketSink,
    type EncodedPacket,
    type AudioCodec,
} from "mediabunny";

import { VIDEO_INPUT_FORMATS } from "./video-formats.js";
import { DEGENERATE_VIDEO_PACKET_MAX_BYTES } from "./transcode/normalize-degenerate-video.js";
import { type AdpcmAudioReader, openAdpcmAudioAuto } from "./transcode/adpcm-audio.js";
import { createEncodeAudioSource, resolveEncodeAudioCodec } from "./transcode/capabilities.js";
import { createLogger } from "./log.js";
import { createRetryingBlobSource } from "./retrying-blob-source.js";
import { type AudioTrackFormat, sliceCandidatesForRange } from "./export-range.js";
import { injectClipGpmf, type CapturedMoov } from "./export/gpmd-inject.js";
import { closeWritableWithWatchdog } from "./export/writable-finalize.js";
import { clipBasename, formatBytes, formatTime } from "./ui/format.js";

const log = createLogger("export");

import type { Trip } from "./trips.js";
import { tripCandidatesByChannel } from "./trips.js";
import type { Channel } from "./parsers/types.js";
import { t } from "./i18n/index.js";

interface ExportProgress {
    // human-readable stage label for the UI
    stage: string;
    // optional 0..100 completion for a determinate progress bar (stream-copy);
    // omitted on stages that have no meaningful percentage (analyzing, writing
    // header, saving file).
    pct?: number;
    // True on the final disk-commit phase: the FSA writer.close() flush has no
    // observable progress (native close is opaque), so the bar switches to an
    // indeterminate animation instead of freezing at ~100% and reading as a hang.
    indeterminate?: boolean;
}

export interface ExportClipResult {
    basename: string;
    // True when a gpmd telemetry track was actually written. When withGpmf was
    // requested but this is false, injection failed (logged in gpmd-inject) and
    // the caller surfaces it to the user. False also when withGpmf=false - the
    // caller gates the notice on the request flag, so that case is a no-op.
    gpmfInjected: boolean;
    // True when audio was requested but dropped because the range's segments
    // carry mixed audio formats (a single output audio track cannot span them).
    // The caller surfaces a notice; the clip itself saved fine, just silent.
    audioDroppedHeterogeneous: boolean;
}

interface ExportClipArgs {
    trip: Trip;
    // Channel to export (front/rear/interior). Single-channel trips only have
    // front - always pass "front". For multi-channel models the caller passes
    // the channel chosen in the UI. Frames without this channel are skipped:
    // the selected camera simply has no recording at that moment.
    channel: Channel;
    startTripSec: number;
    endTripSec: number;
    withAudio: boolean;
    // Whether to embed a GPMF GPS metadata track inside the MP4. Done as a
    // post-process AFTER output.finalize() (see gpmd-inject.ts). Requires
    // mp4Handle for re-opening the writable with keepExistingData. Not
    // supported on fallback-blob browsers (incognito FF/Safari); the caller
    // must hide this option in that scenario.
    withGpmf: boolean;
    // FSA writable (createWritable()) or equivalent. Must support
    // .write({type:'write', position, data}) or plain .write(uint8Array) -
    // mediabunny StreamTarget handles both.
    mp4Writable: FileSystemWritableFileStream;
    // FSA handle. Required for post-process gpmd track injection after
    // finalize (writable is already closed - re-open via handle.createWritable
    // with keepExistingData). Optional when withGpmf=false.
    mp4Handle?: FileSystemFileHandle;
    onProgress: (p: ExportProgress) => void;
    signal?: AbortSignal;
}

export async function exportClip({
    trip,
    channel,
    startTripSec,
    endTripSec,
    withAudio,
    withGpmf,
    mp4Writable,
    mp4Handle,
    onProgress,
    signal,
}: ExportClipArgs): Promise<ExportClipResult> {
    if (signal?.aborted) throw new DOMException("aborted", "AbortError");

    const exportStart = performance.now();

    // startTripSec/endTripSec are footage-axis (content) seconds, the single
    // coordinate system the whole export chain shares.
    const segments = sliceCandidatesForRange(
        tripCandidatesByChannel(trip, channel),
        trip.timeline,
        startTripSec,
        endTripSec,
    );
    if (segments.length === 0) throw new Error("range covers no files");

    // mediabunny StreamTarget expects WritableStream<{type, data, position}>;
    // FSA FileSystemWritableFileStream natively supports such chunks via
    // .write({type, position, data}). Wrap it 1-to-1, also tracking total
    // bytes written for the "saving to disk" progress stage.
    let totalBytesWritten = 0;
    const targetWritable = new WritableStream<{ type: "write"; position: number; data: Uint8Array }>({
        async write(chunk) {
            if (signal?.aborted) throw new DOMException("aborted", "AbortError");
            // TS5 distinguishes Uint8Array<ArrayBuffer> from Uint8Array<ArrayBufferLike>;
            // FSA write expects the former, mediabunny yields the latter. Cast is safe -
            // SharedArrayBuffer never arrives here in a browser context.
            await mp4Writable.write({
                type: "write",
                position: chunk.position,
                data: chunk.data as Uint8Array<ArrayBuffer>,
            });
            totalBytesWritten += chunk.data.byteLength;
        },
        async close() {
            // Watchdog + breadcrumb around the actual disk/stream commit - the
            // step that historically hung at "Finalizing" with no error. Pass the
            // total bytes so the watchdog deadline scales with output size (a
            // multi-GB flush to slow media legitimately takes minutes).
            await closeWritableWithWatchdog(mp4Writable, log, "stream-copy", totalBytesWritten);
        },
        async abort(reason) {
            try {
                await mp4Writable.abort(reason);
            } catch {
                /* ignore */
            }
        },
    });

    // Timer for the final save phase (after onMoov) - ticks once per second,
    // showing elapsed time and file size. FSA writer.close() can take minutes
    // on large clips (atomic temp→final commit); without feedback the user
    // thinks the app has frozen.
    let savePhaseTimer: ReturnType<typeof setInterval> | null = null;
    const stopSavePhaseTimer = (): void => {
        if (savePhaseTimer !== null) {
            clearInterval(savePhaseTimer);
            savePhaseTimer = null;
        }
    };

    // moov bytes + offset captured from mediabunny's onMoov callback below. Handed
    // to the GPMF post-process so it locates moov without re-reading the finished
    // file - on the in-memory export handle that re-read is a full multi-GB
    // getFile() copy. Null until onMoov fires (during finalize, before injection).
    let capturedMoov: CapturedMoov | null = null;

    const output = new Output({
        // fastStart: false → moov-at-end, mdat streamed without buffering in RAM
        // (see file header comment). false is ALSO mediabunny's auto-default for a
        // StreamTarget (the undefined default picks 'in-memory' only for a
        // BufferTarget, 'false' otherwise); we set it explicitly to document intent.
        format: new Mp4OutputFormat({
            fastStart: false,
            // onMoov fires when the moov box is written, still inside finalize().
            // After this only FSA writer.close() remains (atomic temp→disk commit).
            onMoov: (data: Uint8Array, position: number) => {
                // Capture moov for the GPMF post-process so it skips re-reading
                // the file. Copy the bytes (~MB) - mediabunny may reuse the buffer
                // after the callback. position is the absolute moov offset = where
                // the injection truncates and appends.
                capturedMoov = { startAbs: position, bytes: data.slice() };
                // Start the ticking timer so the user sees progress during the
                // final writer.close() wait.
                const startMs = performance.now();
                const tick = (): void => {
                    const elapsedSec = (performance.now() - startMs) / 1000;
                    onProgress({
                        stage: t("export.progress.savingFile", {
                            written: formatBytes(totalBytesWritten),
                            elapsed: formatTime(elapsedSec, true),
                        }),
                        // close() flush is opaque - drive an indeterminate bar so
                        // a minutes-long commit to slow media does not look frozen.
                        indeterminate: true,
                    });
                };
                tick();
                savePhaseTimer = setInterval(tick, 1000);
            },
        }),
        // 4 MiB chunks instead of the 16 MiB default: at 4K HEVC ~6 Mbit/s,
        // 16 MB = ~21 s of video between actual mp4Writable.write() calls,
        // making the progress bar appear frozen. 4 MB = ~5 s at the same
        // bitrate; the OS-level FSA buffer absorbs the extra syscalls fine.
        target: new StreamTarget(targetWritable, { chunked: true, chunkSize: 4 * 1024 * 1024 }),
    });

    // Progress throttled to once per 200 ms to avoid spamming the UI at ~30 fps
    // (one packet per video frame + audio). Position is in the global export
    // timeline (videoAccumSec + current shifted pts) so the percentage grows
    // correctly across all source files.
    // Clip footage duration. The range is already on the content axis (pauses
    // removed), matching reportProgress (videoAccumSec, also content-time), so
    // the bar reaches 100% even when the range spans a pause.
    const totalDurationSec = Math.max(0.001, endTripSec - startTripSec);
    let lastProgressMs = 0;
    // processedSec - how many seconds of the clip have been pushed so far
    const reportProgress = (processedSec: number): void => {
        const now = performance.now();
        if (now - lastProgressMs < 200) return;
        lastProgressMs = now;
        const pct = Math.min(99, Math.floor((processedSec / totalDurationSec) * 100));
        onProgress({
            stage: t("export.progress.processing", {
                processed: formatTime(processedSec, true),
                total: formatTime(totalDurationSec, true),
                pct,
            }),
            pct,
        });
    };

    onProgress({ stage: t("export.progress.analyzing") });

    // The first source file must be opened BEFORE output.start() to detect
    // codecs (HEVC/AVC, AAC) and register track sources. We keep this input
    // alive for the full export - its codecs define the output tracks.
    const firstInput = new Input({
        source: createRetryingBlobSource(segments[0]!.file, signal),
        formats: VIDEO_INPUT_FORMATS,
    });

    const firstVideoTrack = await firstInput.getPrimaryVideoTrack();
    if (!firstVideoTrack) {
        firstInput.dispose();
        // Technical error messages stay in English by Go-style convention
        // (no period, lowercase). They surface to the user only via the
        // generic "Error: ..." plate in export-modal, which is rare and
        // already reads like a debug breadcrumb.
        throw new Error(`no video track in file ${segments[0]!.file.name}`);
    }
    const videoCodec = await firstVideoTrack.getCodec();
    if (!videoCodec) {
        firstInput.dispose();
        throw new Error(`unable to detect video codec in file ${segments[0]!.file.name}`);
    }
    // Preflight the decoder config before output.start(). The first video
    // packet carries it into the moov sample entry; if it is null the muxer
    // throws mid-export ("metadata must include a decoder configuration"),
    // after output.start() already opened the writable - the user has committed
    // the save dialog and gets a truncated file instead of a clean failure.
    const firstVideoDecoderConfig = await firstVideoTrack.getDecoderConfig();
    if (!firstVideoDecoderConfig) {
        firstInput.dispose();
        throw new Error(`unable to read video decoder config in file ${segments[0]!.file.name}`);
    }
    // Pass the display-matrix rotation to the output, otherwise clips from
    // cameras that write rotated MP4s open sideways in OS players. mediabunny
    // writes it into the tkhd-matrix of the output container. Taken from the
    // first segment - rotation is consistent across all files of one camera.
    const videoRotation = await firstVideoTrack.getRotation();
    const videoSource = new EncodedVideoPacketSource(videoCodec);
    output.addVideoTrack(videoSource, { rotation: videoRotation });

    let audioSource: EncodedAudioPacketSource | null = null;
    let audioCodec: AudioCodec | null = null;
    let audioDroppedHeterogeneous = false;
    // IMA-ADPCM path: mediabunny cannot read this codec, so we decode it to
    // PCM-s16 ourselves and feed an AudioSampleSource instead of stream-copying.
    let adpcmSource: AudioSampleSource | null = null;
    let adpcmReader: AdpcmAudioReader | null = null;
    if (withAudio) {
        // A multi-file range may splice clips with different audio formats (e.g.
        // an original mono-16k recording next to a 48k-stereo re-export dropped
        // back into the same folder). Stream-copy muxes every packet under the
        // first segment's decoder config, so a later format would play as
        // corruption - drop audio and let the caller warn instead. Single-file
        // ranges cannot be heterogeneous, so skip the probe (saves N header reads).
        if (segments.length > 1) {
            // Reuse firstInput (already open for video codec detection) for the
            // probe's first file - one moov read instead of two.
            const { uniform } = await probeAudioUniformity(
                segments.map((s) => s.file),
                {
                    reuseFirstInput: firstInput,
                },
            );
            if (!uniform) {
                audioDroppedHeterogeneous = true;
                log.warn("mixed audio formats across segments, exporting without audio");
            }
        }
        const firstAudioTrack = audioDroppedHeterogeneous ? null : await firstInput.getPrimaryAudioTrack();
        if (firstAudioTrack) {
            audioCodec = await firstAudioTrack.getCodec();
            // Same preflight as video, but a null audio decoder config is a
            // benign "export without audio" rather than a hard failure: decide
            // the audio track up front so a missing config never reaches the
            // muxer on the first audio packet (which would throw mid-export).
            const firstAudioDecoderConfig = audioCodec ? await firstAudioTrack.getDecoderConfig() : null;
            if (audioCodec && firstAudioDecoderConfig) {
                audioSource = new EncodedAudioPacketSource(audioCodec);
                output.addAudioTrack(audioSource);
            } else if (audioCodec) {
                log.warn("audio track present but no decoder config, exporting without audio", {
                    file: segments[0]!.file.name,
                });
                audioCodec = null;
            } else {
                // getCodec() returned null: mediabunny does not recognise the
                // codec. The known case is Mio/Navman IMA ADPCM in a QuickTime
                // `ms ` entry - we decode it ourselves. Prefer encoding to AAC
                // (else Opus): the alternative, lossless pcm-s16, muxes as `ipcm`
                // in an MP4 (mediabunny's non-QuickTime PCM fourcc), which Apple
                // players / QuickTime do not play - so a stream-copy export would
                // produce a file that fails to open "in any player", the exact
                // thing the user wants. AAC is small and universal; the source is
                // 4-bit ADPCM so the re-encode is transparent. pcm-s16 stays only
                // as the no-encoder fallback (Safari < 26 has no AudioEncoder),
                // where lossless-but-niche still beats silent. Any other unknown
                // codec falls through to a no-audio export.
                const reader = await openAdpcmAudioAuto(segments[0]!.file);
                if (reader) {
                    adpcmReader = reader;
                    // Encode to AAC/Opus where the browser has an encoder; the
                    // shared factory pins the exact 48k/stereo config the probe
                    // checked. Note: like the re-encode pipeline's ADPCM path, an
                    // encoder that throws mid-export (rare: probe passed but encode
                    // fails) aborts the export rather than degrading to silent -
                    // accepted as parity with feedSegmentAudioAdpcm, not a per-path
                    // special case. pcm-s16 only when there is no encoder at all.
                    const encodeCodec = await resolveEncodeAudioCodec();
                    adpcmSource = encodeCodec
                        ? createEncodeAudioSource(encodeCodec)
                        : new AudioSampleSource({ codec: "pcm-s16" });
                    output.addAudioTrack(adpcmSource);
                    log.info("audio is ima adpcm, transcoding", {
                        outputCodec: encodeCodec ?? "pcm-s16",
                        channels: reader.channels,
                        sampleRate: reader.sampleRate,
                    });
                } else {
                    log.warn("unsupported audio codec, exporting without audio", {
                        file: segments[0]!.file.name,
                    });
                }
            }
        }
    }

    await output.start();

    // Startup info log. Emitted after codec detection and segment calculation
    // so the breakdown is complete. Diagnoses most export bug reports:
    // "no audio" → audioCodec=null; "sideways video" → rotation=90/270;
    // "longer than selected" → totalDurationSec vs output mp4;
    // "too slow" → segmentsCount + sourceTotalBytes.
    log.info("export started", {
        channel,
        videoCodec,
        audioCodec,
        adpcm: adpcmSource !== null,
        withAudio,
        rotation: videoRotation,
        segmentsCount: segments.length,
        startTripSec: Math.round(startTripSec * 100) / 100,
        endTripSec: Math.round(endTripSec * 100) / 100,
        totalDurationSec: Math.round(totalDurationSec * 100) / 100,
        sourceTotalBytes: segments.reduce((s, seg) => s + seg.file.size, 0),
        firstFile: segments[0]!.file.name,
    });

    // Each subsequent source file shifts timestamps forward by the sum of
    // already-added durations to produce a continuous output timeline.
    let videoAccumSec = 0;
    let audioAccumSec = 0;
    // Decoder config (avcC/hvcC payload, audio config) is submitted exactly
    // once with the first packet - mediabunny populates the sample entry in moov.
    let videoDecoderConfigPushed = false;
    let audioDecoderConfigPushed = false;

    try {
        for (let segIdx = 0; segIdx < segments.length; segIdx++) {
            if (signal?.aborted) throw new DOMException("aborted", "AbortError");

            const seg = segments[segIdx]!;
            // No UI update at file boundaries - reportProgress in the loop
            // updates the stage on the first packet of the new file. Showing the
            // filename here would resize the modal on every transition (long names).

            const input =
                segIdx === 0
                    ? firstInput
                    : new Input({ source: createRetryingBlobSource(seg.file, signal), formats: VIDEO_INPUT_FORMATS });

            try {
                const v = segIdx === 0 ? firstVideoTrack : await input.getPrimaryVideoTrack();
                if (!v) {
                    log.warn("no video track, skipping segment", { file: seg.file.name });
                    const skipDur = seg.endInFile - seg.startInFile;
                    videoAccumSec += skipDur;
                    audioAccumSec += skipDur;
                    continue;
                }
                const a = audioSource
                    ? segIdx === 0
                        ? await firstInput.getPrimaryAudioTrack()
                        : await input.getPrimaryAudioTrack()
                    : null;

                const videoDecCfg = await v.getDecoderConfig();
                const audioDecCfg = a ? await a.getDecoderConfig() : null;

                const videoSink = new EncodedPacketSink(v);
                const audioSink = a ? new EncodedPacketSink(a) : null;

                // Keyframe snap: getKeyPacket(timestamp) returns the last
                // key-packet with pts <= timestamp. Without the snap the first
                // frame of the output range cannot be decoded.
                // verifyKeyPackets bitstream-checks the container flag: a vendor
                // that mislabels a delta packet as key would otherwise give an
                // undecodable export head. The check parses bytes we load anyway
                // for the copy, so it costs CPU, not IO (mediabunny's own decode
                // sinks enable it by default).
                const videoStartPacket = await videoSink.getKeyPacket(seg.startInFile, {
                    verifyKeyPackets: true,
                });
                if (!videoStartPacket) {
                    log.warn("no keyframe in range, skipping segment", {
                        file: seg.file.name,
                        startInFile: seg.startInFile,
                    });
                    const skipDur = seg.endInFile - seg.startInFile;
                    videoAccumSec += skipDur;
                    audioAccumSec += skipDur;
                    continue;
                }
                const videoStartShift = videoStartPacket.timestamp;
                let videoLastEndSec = videoStartShift;
                let videoCount = 0;

                let pkt: EncodedPacket | null = videoStartPacket;
                while (pkt) {
                    if (signal?.aborted) throw new DOMException("aborted", "AbortError");
                    if (pkt.timestamp >= seg.endInFile) break;
                    // Skip degenerate packets: some muxers (seen on Matroska
                    // re-exports) emit an empty ~4-byte access unit (a zero-length
                    // NAL) about once a second. A coded H.264/HEVC picture is always
                    // larger; a <=4-byte packet carries no picture. Copied verbatim
                    // it makes strict decoders (QuickTime/VLC) fail to split NAL
                    // units and freeze on the last keyframe until the next one. The
                    // surrounding frames keep their timestamps, so dropping it just
                    // holds the previous frame ~33 ms longer - invisible.
                    if (pkt.byteLength <= DEGENERATE_VIDEO_PACKET_MAX_BYTES) {
                        pkt = await videoSink.getNextPacket(pkt, { verifyKeyPackets: true });
                        continue;
                    }
                    // clone carries data/type/duration/sideData over, overriding only
                    // the timestamp (shifted onto the continuous output timeline). The
                    // type it copies is the verifyKeyPackets-corrected one from the
                    // getNextPacket below, so the output sync-sample table stays right.
                    const shifted = pkt.clone({ timestamp: pkt.timestamp - videoStartShift + videoAccumSec });
                    const meta = videoDecoderConfigPushed ? undefined : { decoderConfig: videoDecCfg ?? undefined };
                    await videoSource.add(shifted, meta);
                    videoDecoderConfigPushed = true;
                    videoLastEndSec = pkt.timestamp + pkt.duration;
                    videoCount++;
                    reportProgress(videoAccumSec + (videoLastEndSec - videoStartShift));
                    // Verify each packet's key/delta flag too: pkt.type above is
                    // copied verbatim into the output sync-sample table, so a
                    // mislabeled flag in the source would corrupt seeking in the
                    // exported file, not just the head.
                    pkt = await videoSink.getNextPacket(pkt, { verifyKeyPackets: true });
                }

                // Align audio to the real video start (after keyframe snap)
                // to keep AV in sync. getPacket(t) returns the packet with
                // pts <= t (latest by presentation time).
                let audioCount = 0;
                let audioRangeSec = 0;
                if (adpcmSource && adpcmReader) {
                    // IMA-ADPCM: decode this segment's range to PCM-s16 and feed
                    // the AudioSampleSource. Align the audio to the real video
                    // start (videoStartShift, after the keyframe snap) so AV stays
                    // in sync; advance the output timeline by audioAccumSec.
                    const reader = segIdx === 0 ? adpcmReader : await openAdpcmAudioAuto(seg.file);
                    if (reader) {
                        audioRangeSec = await reader.feedRange(
                            adpcmSource,
                            videoStartShift,
                            seg.endInFile,
                            audioAccumSec,
                            signal,
                        );
                    }
                } else if (audioSink && audioSource) {
                    const audioStartPacket = await audioSink.getPacket(videoStartShift);
                    if (audioStartPacket) {
                        const audioStartShift = audioStartPacket.timestamp;
                        let audioLastEndSec = audioStartShift;
                        let apkt: EncodedPacket | null = audioStartPacket;
                        while (apkt) {
                            if (signal?.aborted) throw new DOMException("aborted", "AbortError");
                            if (apkt.timestamp >= seg.endInFile) break;
                            const shifted = apkt.clone({
                                timestamp: apkt.timestamp - audioStartShift + audioAccumSec,
                            });
                            const meta = audioDecoderConfigPushed
                                ? undefined
                                : { decoderConfig: audioDecCfg ?? undefined };
                            await audioSource.add(shifted, meta);
                            audioDecoderConfigPushed = true;
                            audioLastEndSec = apkt.timestamp + apkt.duration;
                            audioCount++;
                            apkt = await audioSink.getNextPacket(apkt);
                        }
                        audioRangeSec = audioLastEndSec - audioStartShift;
                    }
                }

                const videoSegDur = videoLastEndSec - videoStartShift;
                videoAccumSec += videoSegDur;
                // Advance audio by its OWN measured range so the audio track stays
                // contiguous and monotonic (mediabunny requires non-decreasing PTS
                // per track). Anchoring it to videoSegDur instead would overlap the
                // next file's audio backwards whenever the audio start packet sits
                // before the video keyframe (audioRangeSec > videoSegDur) - a
                // non-monotonic-timestamp throw. The small cross-track drift this
                // leaves on long multi-file exports is the accepted trade-off.
                // Fallback to videoSegDur only when the file carries no audio, so
                // audioAccumSec still advances and the next file's audio does not
                // land at the start of the timeline and overlap.
                audioAccumSec += audioRangeSec > 0 ? audioRangeSec : videoSegDur;

                // One log per source file, not per packet. Useful for diagnosing
                // AV stitching issues (mismatched video/audio durations are the
                // first sign of drift).
                log.debug("segment copied", {
                    file: seg.file.name,
                    startInFile: Number(seg.startInFile.toFixed(2)),
                    endInFile: Number(seg.endInFile.toFixed(2)),
                    videoPackets: videoCount,
                    audioPackets: audioCount,
                });
            } finally {
                if (segIdx > 0) input.dispose();
            }
        }
    } finally {
        firstInput.dispose();
    }

    if (signal?.aborted) throw new DOMException("aborted", "AbortError");
    onProgress({ stage: t("export.progress.writingHeader") });

    // finalize() does three things in sequence:
    //  1. Flushes remaining pending packets to the target.
    //  2. Serializes the moov box (~24 B per sample - several MB for hour-long
    //     clips) and writes it to the END of the file (fastStart: false).
    //     onMoov fires here → savePhaseTimer starts.
    //  3. Closes targetWritable → mp4Writable.close() → FSA commits the
    //     temp file to its final path. Slowest part on large clips + slow disks.
    try {
        await output.finalize();
    } finally {
        stopSavePhaseTimer();
    }

    // A cancel that lands between finalize and here: the mp4 is already
    // committed (too late to undo), but the user DID cancel - surface
    // AbortError so the UI shows "cancelled" instead of a success view for a
    // cancelled export.
    if (signal?.aborted) throw new DOMException("aborted", "AbortError");

    // GPMF injection (post-process). Done AFTER finalize - mediabunny has
    // already closed the writable and FSA committed the mp4 to disk. Re-open
    // via handle and append the gpmd track in truncate+append mode (see
    // gpmd-inject.ts). If withGpmf=true but mp4Handle is absent (caller bug),
    // warn and skip rather than failing the entire export.
    let gpmfInjected = false;
    if (withGpmf) {
        if (!mp4Handle) {
            log.warn("withGpmf=true but mp4Handle not provided - skipping injection");
        } else {
            onProgress({ stage: t("export.progress.embeddingGps") });
            // GPMF lives on the footage axis, matching the stream-copy video
            // track. The range is already content-sec, so pass it through.
            gpmfInjected = await injectClipGpmf({
                handle: mp4Handle,
                trip,
                clipContentStartSec: startTripSec,
                clipContentEndSec: endTripSec,
                signal,
                capturedMoov: capturedMoov ?? undefined,
            });
        }
    }

    // Final log. durationMs covers the full time from exportClip start to
    // finalize() completion (including FSA writer.close() / save phase).
    // Shows the "stream copy vs disk commit" split for "export is slow"
    // reports - per-segment packet counts in the debug log narrow it further.
    log.info("export done", {
        durationMs: Math.round(performance.now() - exportStart),
        outputBytes: totalBytesWritten,
        segmentsCount: segments.length,
        gpmfInjected,
    });

    return {
        basename: clipBasename(trip, startTripSec, endTripSec),
        gpmfInjected,
        audioDroppedHeterogeneous,
    };
}

/**
 * Probes each file's primary audio track and reports whether all audio-bearing
 * files share one {codec, sampleRate, channels}. That uniformity is the
 * precondition for a single output audio track: the re-encode AAC source rejects
 * a mid-track input-format change, and stream-copy muxes every packet under the
 * first file's decoder config (a later mismatch would corrupt the audio). Files
 * with no audio track are ignored - on the re-encode path they become silence.
 *
 * `format` is the shared format (from the first audio-bearing file), or null when
 * no file carries audio - the re-encode pipelines reuse it as the silence format
 * so gap-fill matches the real samples. Cheap: reads each file's header for track
 * metadata, no decode.
 *
 * `opts.reuseFirstInput` lets the caller pass an already-open Input for files[0]
 * (the same one it will reuse in the export loop): the probe borrows it instead of
 * opening a second one, and never disposes it. Saves a full moov read of the first
 * file - the dominant "Preparing" cost on single-file recordings, where that one
 * file is the whole trip and its moov is large.
 */
export async function probeAudioUniformity(
    files: File[],
    opts: { reuseFirstInput?: Input } = {},
): Promise<{ uniform: boolean; format: AudioTrackFormat | null; firstHasDecoderConfig: boolean }> {
    let first: AudioTrackFormat | null = null;
    // For the first audio-bearing track: does it actually carry a decoder config?
    // A readable codec tag with a damaged/absent config (power-cut esds, corrupt
    // stbl) cannot mux a valid stream-copy track - the muxer throws on the first
    // packet's missing config. resolveAudioPlan reads this to drop audio benignly
    // instead of crashing the export mid-stream (exportClip guards the same case
    // inline below). ADPCM (codec null) is decoded by us, so its lack of a
    // container decoder config is irrelevant here.
    let firstHasDecoderConfig = false;
    let uniform = true;
    for (let i = 0; i < files.length; i++) {
        const file = files[i]!;
        // Borrow the caller's already-open Input for files[0] so its moov is read
        // once across the probe + the export loop (see reuseFirstInput above). A
        // borrowed Input is never disposed here - the caller owns its lifecycle.
        const borrowed = i === 0 ? opts.reuseFirstInput : undefined;
        const input = borrowed ?? new Input({ source: createRetryingBlobSource(file), formats: VIDEO_INPUT_FORMATS });
        try {
            const track = await input.getPrimaryAudioTrack();
            if (!track) continue;
            const fmt: AudioTrackFormat = {
                codec: await track.getCodec(),
                sampleRate: await track.getSampleRate(),
                numberOfChannels: await track.getNumberOfChannels(),
            };
            if (!first) {
                first = fmt;
                firstHasDecoderConfig = fmt.codec != null && (await track.getDecoderConfig()) != null;
            } else if (
                fmt.codec !== first.codec ||
                fmt.sampleRate !== first.sampleRate ||
                fmt.numberOfChannels !== first.numberOfChannels
            ) {
                uniform = false;
                break;
            }
        } catch (err) {
            // A single unreadable header must not force-drop audio for the whole
            // range; skip this file (best effort). A real mismatch that slips
            // through surfaces later as a loud mediabunny error, not silent
            // corruption.
            log.warn("audio format probe failed", { file: file.name, err: String(err) });
        } finally {
            if (!borrowed) input.dispose();
        }
    }
    return { uniform, format: first, firstHasDecoderConfig };
}
