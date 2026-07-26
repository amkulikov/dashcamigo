// Injection of a gpmd metadata track into a finished MP4 (without re-encoding
// the mediabunny output).
//
// Context. Mediabunny does not support meta-tracks - its Output handles only
// video/audio/subtitle (with a fixed sample format 'wvtt' for the last one).
// To add GPMF telemetry (github.com/gopro/gpmf-parser), we post-process the
// already-finalized export:
//
//   1. Mediabunny streams a normal MP4 to disk via FSA. After output.finalize()
//      the file is closed and atomically committed.
//   2. We re-open the handle, read the box tree (moov-at-end in our mediabunny
//      configuration with fastStart: false), and parse moov.
//   3. We append at end-of-file: first a new mdat block with the GPMF sample
//      payloads (densely packed, mdat header [size:u32]['mdat']), then an
//      augmented moov: original moov + our custom gpmd-trak, with
//      mvhd.next_track_ID incremented by 1.
//   4. The old moov stays in place, but players read the tail-moov (last by
//      file offset wins in most implementations; for correctness we truncate -
//      see trade-off below).
//
// Trade-off: truncate vs append. Truncating the file at moov.start is cleaner
// (one moov in the file), but requires two FSA syscalls: writable.truncate() +
// sequential write of the tail. Append-only (just adding the new moov at the
// end) is simpler and works with most players (they scan to the last moov), but
// leaves a broken "dangling" old moov inside the file. We use truncate: one
// correct moov, byte-exact standard MP4.
//
// Performance. moov for a 1-hour 4K HEVC trip is ~2-3 MB - safe to read into
// memory. Writing the tail (samples + new moov) is also megabytes. We do not
// rewrite the main mdat (tens of GB for 4K) - mdat is not touched at all.

import { findBox, findMoovInFile, type Box } from "../parsers/internal/mp4-walker.js";
import { ascii, box, concat, fourCC, fullBox, identityMatrix, u16, u32 } from "./iso-write.js";
import { type GpmfSample, packGpmfSamples } from "../parsers/internal/gpmf-pack.js";
import { createLogger } from "../log.js";
import { captureSentryException } from "../sentry.js";
import type { Trip } from "../trips.js";

const log = createLogger("export:gpmd");

/** moov box bytes plus its absolute file offset, as handed to us by mediabunny's
 *  onMoov callback during muxing. Lets the post-process locate moov without
 *  re-reading the finished file (a full getFile() copy on the in-memory handle). */
export interface CapturedMoov {
    /** Absolute offset of the moov box start in the output file (= where the
     *  injection truncates and appends). */
    startAbs: number;
    /** The full moov box bytes (including the 8-byte header). */
    bytes: Uint8Array;
}

/**
 * Packs the trip's GPS records for [startTripSec, endTripSec) into GPMF samples
 * and injects a gpmd track into the already-finalized mp4 at `handle`. Single
 * entry point shared by the stream-copy (export.ts) and transcode
 * (export-flow.ts) paths so the pack args and error policy live in one place.
 *
 * Injection is purely additive on a valid mp4: on failure the clip on disk stays
 * intact (just without telemetry), so non-abort errors are logged and swallowed
 * and the function returns false. AbortError is re-thrown - the caller's outer
 * handler owns cancellation. Returns true when the gpmd track was written.
 */
export async function injectClipGpmf(args: {
    handle: FileSystemFileHandle;
    trip: Trip;
    // Clip range on the trip's FOOTAGE (content) axis - the same axis the
    // stream-copy video track is built on (pauses removed). Keeping gpmd and
    // video on one axis is what guarantees they stay the same length and in sync.
    clipContentStartSec: number;
    clipContentEndSec: number;
    signal?: AbortSignal;
    // moov bytes + absolute offset captured from mediabunny's onMoov callback
    // during muxing. When present, injection skips re-reading the finished file
    // to locate moov - which on the in-memory export handle means avoiding a full
    // multi-GB getFile() snapshot. Absent on the re-encode path (muxed in a
    // worker), which falls back to a file walk.
    capturedMoov?: CapturedMoov;
}): Promise<boolean> {
    const { handle, trip, clipContentStartSec, clipContentEndSec, signal, capturedMoov } = args;
    // The gpmd sample table is packed for exactly [clipContentStartSec,
    // clipContentEndSec) on the footage axis, but the stream-copy video track
    // starts at the keyframe BEFORE startInFile (getKeyPacket snaps backward), so
    // the video front edge can sit up to ~1 GOP earlier than the gpmd front edge.
    // Alignment is by ABSOLUTE GPSU UTC, which every GPMF block carries
    // (encodeGpsuTimestamp) and which the mainstream readers (gpmf-parser,
    // Telemetry Overlay, GoPro Quik) key off - so this is correct for them. Only
    // a player that aligns the meta track by track-relative offset would see
    // telemetry shifted by the snap; not worth changing the produced track (and
    // re-baselining) for that uncommon case.
    const samples = packGpmfSamples(
        trip.records,
        trip.timeline,
        clipContentStartSec,
        clipContentEndSec - clipContentStartSec,
        { includeAccel: true },
    );
    try {
        await injectGpmdTrack(handle, samples, signal, capturedMoov);
        return true;
    } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") throw err;
        log.error("gpmd injection failed", err);
        // Swallowed (the clip is saved WITHOUT telemetry, user gets only a warn
        // toast) - so this never reaches the export funnel. But GPMF is a hard
        // product requirement (the whole RAM path exists to preserve it), so a
        // silent failure here is a real defect worth seeing.
        captureSentryException(err, {
            fingerprint: ["gpmd_inject_failed", err instanceof Error ? err.name : "unknown"],
            tags: { sample_count: String(samples.length) },
        });
        return false;
    }
}

/**
 * Timescale for the gpmd track. 1000 (millisecond) is precise enough for
 * second-grain GPS samples and fits within the 32-bit stts sample_delta even
 * for multi-hour clips.
 */
const GPMD_TIMESCALE = 1000;

/**
 * Injects a gpmd track into an existing MP4 file (truncate + append).
 *
 * @param handle  file handle (FSA or ponyfill). Must support getFile() and
 *                createWritable({keepExistingData: true}).
 * @param samples GPMF samples from packGpmfSamples (one sample per clip
 *                second, payload + duration).
 */
export async function injectGpmdTrack(
    handle: FileSystemFileHandle,
    samples: GpmfSample[],
    signal?: AbortSignal,
    capturedMoov?: CapturedMoov,
): Promise<void> {
    if (samples.length === 0) {
        log.warn("no GPMF samples - skipping injection");
        return;
    }
    const throwIfAborted = (): void => {
        if (signal?.aborted) throw new DOMException("aborted", "AbortError");
    };
    throwIfAborted();

    // Step 1. Locate the moov box. Prefer the bytes + offset captured from
    // mediabunny's onMoov callback during muxing - that avoids re-reading the
    // finished file, which on the in-memory export handle means a full multi-GB
    // getFile() snapshot just to walk a few box headers. Fall back to a forward
    // walk (re-encode path: muxed in a worker, no callback bytes on hand).
    // Mediabunny with fastStart:false places moov AFTER mdat; findMoovInFile
    // reads 16-byte headers and skips mdat without reading its payload.
    let moovStartAbs: number;
    let moovBytes: Uint8Array;
    if (capturedMoov) {
        moovStartAbs = capturedMoov.startAbs;
        moovBytes = capturedMoov.bytes;
    } else {
        const file = await handle.getFile();
        const found = await findMoovInFile(file);
        if (!found) {
            throw new Error("moov box not found - injecting gpmd not supported");
        }
        moovStartAbs = found.fileStart;
        moovBytes = found.bytes;
    }
    throwIfAborted();
    const moovEndAbs = moovStartAbs + moovBytes.byteLength;

    log.info("found moov", {
        moovStart: moovStartAbs,
        moovSize: moovBytes.byteLength,
        source: capturedMoov ? "onMoov" : "walk",
        sampleCount: samples.length,
    });

    // Step 2. Extract mvhd from moov for (a) timescale - not used directly
    // (the gpmd track has its own timescale), but needed for tkhd duration in
    // movie-timescale; (b) current next_track_ID so our new trak gets the
    // correct id.
    const moovBoxLocal: Box = {
        type: "moov",
        start: 0,
        end: moovBytes.byteLength,
        payloadStart: 8,
    };
    const moovDv = new DataView(moovBytes.buffer, moovBytes.byteOffset, moovBytes.byteLength);
    const mvhd = findBox(moovDv, moovBoxLocal.payloadStart, moovBoxLocal.end, "mvhd");
    if (!mvhd) throw new Error("mvhd not found inside moov");

    const movieTimescale = readMovieTimescale(moovDv, mvhd);
    const nextTrackId = readMvhdNextTrackId(moovDv, mvhd);

    // Step 3. Compute clip duration (seconds) - sum of sample durations.
    let clipDurationSec = 0;
    for (const s of samples) clipDurationSec += s.durationSec;

    // Step 4. Build the new mdat block with GPMF payloads.
    // Layout: [size:u32 BE]['mdat':4][payload1][payload2]...[payloadN]
    const sampleSizes: number[] = samples.map((s) => s.payload.byteLength);
    let mdatPayloadSize = 0;
    for (const sz of sampleSizes) mdatPayloadSize += sz;
    const mdatHeaderSize = 8;
    const mdatTotalSize = mdatHeaderSize + mdatPayloadSize;

    // Absolute offset of the new mdat = moovStartAbs (where we truncate).
    // Sample offset = mdat_start + 8 (after header) + cumulative sizes.
    const newMdatAbsStart = moovStartAbs;
    const firstSampleAbsOffset = newMdatAbsStart + mdatHeaderSize;

    // Step 5. Build the gpmd trak. Sample offsets must be absolute file offsets
    // (stco/co64 store offsets from the beginning of the FILE, not from moov).
    const gpmdTrak = buildGpmdTrak({
        trackId: nextTrackId,
        movieTimescale,
        gpmdTimescale: GPMD_TIMESCALE,
        clipDurationSec,
        sampleSizes,
        sampleDurationsTicks: samples.map((s) => Math.max(1, Math.round(s.durationSec * GPMD_TIMESCALE))),
        firstSampleAbsOffset,
        useCo64: firstSampleAbsOffset > 0xffffffff,
    });

    // Step 6. Build the augmented moov: copy the original moov, increment
    // next_track_ID in mvhd by 1, and append our trak at the end of
    // moov.children. Simplest path: do not deep-parse moov; patch
    // mvhd.next_track_ID in-place and reassemble the moov block manually:
    // header + old payload (with patched mvhd) + our trak.
    const augmentedMoov = buildAugmentedMoov(moovBytes, mvhd, gpmdTrak);

    // Step 7. Write. Open writable for read+write (keepExistingData), truncate
    // to moovStartAbs (discarding the old moov), then write the new mdat and
    // augmented moov. Truncate first so the file cannot have a dangling old
    // moov after our new one.
    // FSA contract: createWritable returns a buffered stream. Truncate/write
    // are staged in a swap file (Chrome) or staging area; the original file is
    // mutated atomically at close(). abort() drops all staged ops, so a throw
    // anywhere between createWritable and close leaves the original MP4 intact.
    // We keep close() inside try so that if it throws (e.g. disk full at flush
    // time), abort() still gets a chance to drop the swap.
    const writable = await handle.createWritable({ keepExistingData: true });
    let closed = false;
    try {
        throwIfAborted();
        await writable.truncate(moovStartAbs);
        // Mdat header: size + 'mdat'.
        const mdatHeader = new Uint8Array(8);
        new DataView(mdatHeader.buffer).setUint32(0, mdatTotalSize, false);
        mdatHeader.set(fourCC("mdat"), 4);

        // Build the whole tail - mdat header + all sample payloads + augmented
        // moov - as ONE contiguous buffer and commit it in a SINGLE positional
        // write at newMdatAbsStart. The payloads are densely packed at sequential
        // offsets, so the concat is byte-identical to the old per-sample write
        // loop. The tail is only a few MB even for a multi-hour clip (one small
        // GPS sample per second; see the file-header note), so holding it in RAM
        // is cheap - and it replaces thousands of awaited write() calls (one per
        // GPS second) with one, cutting the JS<->FSA + Promise overhead the loop
        // paid per sample. On native FSA the small writes were coalesced into the
        // swap file anyway, so the saving is call overhead, not disk I/O.
        // Cast Uint8Array<ArrayBufferLike> → <ArrayBuffer> same as in export.ts:
        // TS5 distinguishes these types; FSA write expects the former; our buffers
        // are created with plain new Uint8Array() from a plain ArrayBuffer.
        const tail = concat([mdatHeader, ...samples.map((s) => s.payload), augmentedMoov]);
        // Last cancel-before-commit checkpoint. The truncate above already ran,
        // but the committed file is only mutated at writable.close(), so an abort
        // here still leaves the original mp4 intact. The per-sample mid-write
        // checkpoints are gone, but the single write of a few-MB tail completes in
        // well under a second, so cancel latency stays bounded.
        throwIfAborted();
        await writable.write({
            type: "write",
            position: newMdatAbsStart,
            data: tail as Uint8Array<ArrayBuffer>,
        });
        const newFileSize = newMdatAbsStart + tail.byteLength;

        log.info("gpmd track injected", {
            mdatBytes: mdatTotalSize,
            moovBytes: augmentedMoov.byteLength,
            newFileSize,
            originalMoovEnd: moovEndAbs,
        });
        await writable.close();
        closed = true;
    } catch (err) {
        // Drop the swap. Without abort, FSA may still flush the buffered
        // truncate on GC and corrupt the file. Skip if close already ran.
        if (!closed) {
            try {
                await writable.abort(err instanceof Error ? err.message : String(err));
            } catch {
                /* ignore: writable may already be in a broken state */
            }
        }
        throw err;
    }
}

// ===== Reading mvhd fields =====

/**
 * Reads timescale from mvhd. Supports both versions (v0 - 32-bit fields,
 * v1 - 64-bit creation/modification, rest same as v0).
 */
function readMovieTimescale(moovDv: DataView, mvhd: Box): number {
    const version = moovDv.getUint8(mvhd.payloadStart);
    const fields = mvhd.payloadStart + 4; // skip version+flags
    const tsOffset = version === 1 ? fields + 16 : fields + 8;
    return moovDv.getUint32(tsOffset);
}

/**
 * Reads next_track_ID from mvhd. It is the last field of the mvhd payload
 * (4-byte u32), at end - 4 (after matrix and pre_defined).
 */
function readMvhdNextTrackId(moovDv: DataView, mvhd: Box): number {
    const offset = mvhd.end - 4;
    return moovDv.getUint32(offset);
}

// ===== Construction of augmented moov =====

/**
 * Builds a new moov blob: copy of the original (with incremented next_track_ID
 * in mvhd) + the new gpmd trak at the end. The moov box header size is
 * recomputed for the new total.
 *
 * Note: moov exceeding uint32 (4 GB) would require the original moov to be
 * close to that size already, which is unrealistic. No 64-bit support needed.
 */
function buildAugmentedMoov(originalMoov: Uint8Array, mvhd: Box, gpmdTrak: Uint8Array): Uint8Array {
    // Single-copy build: out = [new 8-byte moov header][original payload][gpmd
    // trak]. Copy the original payload straight into out and patch next_track_ID
    // in place - no intermediate "patched"/"oldPayload" buffers (moov can be MBs,
    // and this runs once per stream-copy and once per re-encode export).
    const newSize = originalMoov.byteLength + gpmdTrak.byteLength;
    const out = new Uint8Array(newSize);
    const outView = new DataView(out.buffer);
    // moov box header: size (u32, big-endian) + "moov".
    outView.setUint32(0, newSize, false);
    out.set(fourCC("moov"), 4);
    // Original payload (everything after its own 8-byte header), copied once.
    out.set(originalMoov.subarray(8), 8);
    // Append the gpmd trak right after the original payload.
    out.set(gpmdTrak, originalMoov.byteLength);
    // Increment next_track_ID in mvhd, in place. moov starts at offset 0 in both
    // the source and out and the header stays 8 bytes, so the mvhd offset
    // (mvhd.end - 4, in moov-relative coords) is identical in out.
    const nextTrackIdOffset = mvhd.end - 4;
    outView.setUint32(nextTrackIdOffset, outView.getUint32(nextTrackIdOffset) + 1, false);
    return out;
}

// ===== Construction of gpmd trak =====

interface BuildGpmdTrakArgs {
    trackId: number;
    movieTimescale: number;
    gpmdTimescale: number;
    clipDurationSec: number;
    sampleSizes: number[];
    sampleDurationsTicks: number[];
    firstSampleAbsOffset: number;
    useCo64: boolean;
}

/**
 * Builds a complete trak box for the gpmd track with handler='meta' and
 * sample format='gpmd'. Structure (ISO/IEC 14496-12):
 *
 *   trak
 *     tkhd      track header (id, duration in movie-timescale, flags)
 *     mdia
 *       mdhd    media header (gpmd-timescale, total duration)
 *       hdlr    handler (handler_type='meta', name="GPMF")
 *       minf
 *         nmhd  null media header (for non-AV tracks)
 *         dinf
 *           dref
 *             url   self-reference
 *         stbl
 *           stsd  sample description (one entry with FourCC='gpmd')
 *           stts  sample time-to-sample (durations in gpmd-timescale)
 *           stsc  sample-to-chunk (all in one chunk)
 *           stsz  sample sizes (per-sample)
 *           stco  chunk offsets (one - our newMdatAbsStart + header)
 */
function buildGpmdTrak(args: BuildGpmdTrakArgs): Uint8Array {
    const trakChildren = concat([buildTkhd(args), buildMdia(args)]);
    return box("trak", trakChildren);
}

function buildTkhd(args: BuildGpmdTrakArgs): Uint8Array {
    // version=0 (32-bit fields). Flags=0x3 = track_enabled (0x1) + track_in_movie (0x2).
    // track_in_preview (0x4) is not needed for a metadata track.
    const durationInMovieTimescale = Math.max(1, Math.round(args.clipDurationSec * args.movieTimescale));
    return fullBox("tkhd", 0, 0x3, [
        u32(0), // creation_time
        u32(0), // modification_time
        u32(args.trackId), // track_ID
        u32(0), // reserved
        u32(durationInMovieTimescale),
        new Uint8Array(8), // reserved
        u16(0), // layer
        u16(0), // alternate_group
        u16(0), // volume (0 for non-audio tracks)
        u16(0), // reserved
        identityMatrix(),
        u32(0), // width (32-bit fixed-point - 0 for metadata track)
        u32(0), // height
    ]);
}

function buildMdia(args: BuildGpmdTrakArgs): Uint8Array {
    return box("mdia", concat([buildMdhd(args), buildHdlr(), buildMinf(args)]));
}

function buildMdhd(args: BuildGpmdTrakArgs): Uint8Array {
    const duration = Math.max(1, Math.round(args.clipDurationSec * args.gpmdTimescale));
    // version=0 (32-bit). Language='und' (0x55c4 = 21*32+30*32+04 actually:
    // each char minus 0x60, packed in 5 bits, 16-bit total). 'und' = 0x55c4.
    return fullBox("mdhd", 0, 0, [
        u32(0), // creation_time
        u32(0), // modification_time
        u32(args.gpmdTimescale),
        u32(duration),
        u16(0x55c4), // language = "und"
        u16(0), // pre_defined
    ]);
}

function buildHdlr(): Uint8Array {
    // pre_defined (0) + handler_type ('meta') + reserved×3 + name (nul-terminated).
    return fullBox("hdlr", 0, 0, [
        u32(0), // pre_defined
        fourCC("meta"),
        u32(0), // reserved
        u32(0), // reserved
        u32(0), // reserved
        ascii("GPMF", true),
    ]);
}

function buildMinf(args: BuildGpmdTrakArgs): Uint8Array {
    return box("minf", concat([buildNmhd(), buildDinf(), buildStbl(args)]));
}

function buildNmhd(): Uint8Array {
    return fullBox("nmhd", 0, 0, new Uint8Array(0));
}

function buildDinf(): Uint8Array {
    // dref with one url entry (self-reference, flags=0x1).
    const url = fullBox("url ", 0, 0x1, new Uint8Array(0));
    const dref = fullBox("dref", 0, 0, concat([u32(1), url]));
    return box("dinf", dref);
}

function buildStbl(args: BuildGpmdTrakArgs): Uint8Array {
    return box(
        "stbl",
        concat([
            buildStsdGpmd(),
            buildStts(args),
            buildStsc(args),
            buildStsz(args),
            args.useCo64 ? buildCo64(args) : buildStco(args),
        ]),
    );
}

function buildStsdGpmd(): Uint8Array {
    // SampleEntry for gpmd: 6 reserved bytes + u16 data_reference_index.
    // Standard SampleEntry box layout (ISO/IEC 14496-12 §8.5.2):
    //   [size:u32][type:'gpmd'][reserved×6:u8 = 0][data_reference_index:u16 = 1]
    // No additional config boxes inside - GPMF is self-describing KLV; the
    // player parses the stream without auxiliary configuration.
    const gpmdEntry = box(
        "gpmd",
        concat([
            new Uint8Array(6), // reserved
            u16(1), // data_reference_index
        ]),
    );
    return fullBox(
        "stsd",
        0,
        0,
        concat([
            u32(1), // entry_count
            gpmdEntry,
        ]),
    );
}

function buildStts(args: BuildGpmdTrakArgs): Uint8Array {
    // Group consecutive equal delta durations into one entry (sample_count,
    // sample_delta) for efficiency. Nearly all deltas equal the timescale;
    // the last one may be shorter.
    interface SttsEntry {
        count: number;
        delta: number;
    }
    const entries: SttsEntry[] = [];
    for (const dt of args.sampleDurationsTicks) {
        const last = entries[entries.length - 1];
        if (last && last.delta === dt) last.count++;
        else entries.push({ count: 1, delta: dt });
    }

    const payload: Uint8Array[] = [u32(entries.length)];
    for (const e of entries) {
        payload.push(u32(e.count), u32(e.delta));
    }
    return fullBox("stts", 0, 0, concat(payload));
}

function buildStsc(args: BuildGpmdTrakArgs): Uint8Array {
    // One entry: first chunk (1-based), all samples in it, sample_description_index=1.
    return fullBox(
        "stsc",
        0,
        0,
        concat([
            u32(1), // entry_count
            u32(1), // first_chunk
            u32(args.sampleSizes.length), // samples_per_chunk
            u32(1), // sample_description_index
        ]),
    );
}

function buildStsz(args: BuildGpmdTrakArgs): Uint8Array {
    // sample_size=0 means per-sample size table.
    const payload: Uint8Array[] = [
        u32(0), // sample_size = 0 (variable)
        u32(args.sampleSizes.length), // sample_count
    ];
    for (const sz of args.sampleSizes) payload.push(u32(sz));
    return fullBox("stsz", 0, 0, concat(payload));
}

function buildStco(args: BuildGpmdTrakArgs): Uint8Array {
    // One chunk - all samples packed densely in our mdat. Offset = first sample.
    return fullBox(
        "stco",
        0,
        0,
        concat([
            u32(1), // entry_count
            u32(args.firstSampleAbsOffset),
        ]),
    );
}

function buildCo64(args: BuildGpmdTrakArgs): Uint8Array {
    // 64-bit variant for files > 4 GB.
    const offsetU8 = new Uint8Array(8);
    const dv = new DataView(offsetU8.buffer);
    const hi = Math.floor(args.firstSampleAbsOffset / 0x100000000);
    const lo = args.firstSampleAbsOffset >>> 0;
    dv.setUint32(0, hi, false);
    dv.setUint32(4, lo, false);
    return fullBox("co64", 0, 0, concat([u32(1), offsetU8]));
}
