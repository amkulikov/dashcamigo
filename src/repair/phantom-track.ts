// Repair of "phantom" media tracks - a track that declares samples in its
// sample table but points at no actual data. Observed on a dashcam (Normal/Front
// avc1 clip) after a failed finalization: the video track is intact, but the
// AAC audio track has stco with all chunk offsets = 0 and stsz with all sample
// sizes = 0, while still declaring 1875 samples (120 s of audio that was never
// written to mdat).
//
// In the browser this surfaces as a fatal:
//   PipelineStatus::PIPELINE_ERROR_READ: FFmpegDemuxer: demuxer seek failed
// Chrome reads moov fine (loadedmetadata fires, dimensions known), then on the
// first read/seek it tries to seek the phantom track to offset 0 / size 0,
// av_seek_frame fails, and the error tears down the whole pipeline - the intact
// video dies with it. avc1 plays via the native <video> path (createObjectURL),
// so nothing else in the pipeline catches this.
//
// Fix: zero the entry_count fields of the phantom track's stts/stsc/stsz/stco
// (or co64) so the track declares 0 samples. The demuxer then has nothing to
// seek - video plays, the dead track is silently empty (its audio data does not
// exist and cannot be recovered: the offset/size tables are gone). The patch is
// in-place and constant-size - every byte offset in the file stays valid, so it
// is a pure entry_count rewrite spliced back via zero-copy Blob concatenation,
// exactly like repair/hvcc.ts.

import { createLogger } from "../log.js";
import { findBox, findMoovInFile, iterBoxes, readHandlerType } from "../parsers/internal/mp4-walker.js";

const log = createLogger("repair:phantom-track");

/** Result of a successful repair. */
export interface RepairedPhantomTracks {
    /** New File wrapper with the phantom tracks' sample counts zeroed. Zero-copy: the original is not loaded into RAM. */
    file: File;
    /** Handler types of the neutralized tracks ('soun', 'meta', ...) - for diagnostics/logging. */
    neutralized: string[];
}

// A non-video track is "phantom" when it declares samples but every chunk
// offset is 0 (points into the ftyp/start, i.e. nowhere) OR the total sample
// size is 0 (no bytes anywhere). A healthy track never has a chunk offset of 0
// - offset 0 is the ftyp box - so all-zero offsets are an unambiguous defect.
// Kept deliberately narrow: only the exact "track points at no data" shape, so
// we never neutralize a track the browser could actually play.

/**
 * Scans the file for phantom non-video tracks and, if any are found, returns a
 * File wrapper with their sample-table counts zeroed. Returns null when no
 * phantom track is present (the file is then used as-is - we never make a
 * playable file worse).
 *
 * Only non-video tracks are touched: a phantom VIDEO track would mean the clip
 * has no picture to show, and zeroing it gains nothing - there is nothing to
 * fall back to. The realistic case is a dead audio track killing intact video.
 *
 * Each stage is wrapped so an unexpected structure cannot abort ingest; on any
 * doubt the original file is returned unchanged (null).
 */
export async function repairPhantomTracks(file: File): Promise<RepairedPhantomTracks | null> {
    // moov can sit at the tail (our own export and many dashcams do this), so
    // walk top-level headers instead of reading a fixed front window.
    const moov = await findMoovInFile(file).catch((err) => {
        log.debug("phantom scan: findMoovInFile failed", {
            file: file.name,
            err: err instanceof Error ? err.message : String(err),
        });
        return null;
    });
    if (!moov) return null;

    let edits: PhantomEdit[];
    try {
        edits = findPhantomTracks(moov.bytes);
    } catch (err) {
        log.debug("phantom scan: box walk failed", {
            file: file.name,
            err: err instanceof Error ? err.message : String(err),
        });
        return null;
    }
    if (edits.length === 0) return null;

    // Patch a copy of the moov bytes: every edit is a u32 entry_count → 0 at an
    // offset relative to moov start. Constant-size, so all file offsets hold.
    const patchedMoov = new Uint8Array(moov.bytes);
    const dv = new DataView(patchedMoov.buffer, patchedMoov.byteOffset, patchedMoov.byteLength);
    for (const edit of edits) {
        for (const off of edit.countOffsets) dv.setUint32(off, 0);
    }

    // Zero-copy splice: only the moov bytes (tens of KB) are materialized; the
    // huge mdat is referenced lazily through file.slice(). Same pattern as
    // repair/hvcc.ts.
    const patchedBlob = new Blob(
        [file.slice(0, moov.fileStart), patchedMoov as unknown as BlobPart, file.slice(moov.fileEnd)],
        { type: file.type },
    );
    const patchedFile = new File([patchedBlob], file.name, {
        type: file.type,
        lastModified: file.lastModified,
    });

    const neutralized = edits.map((e) => e.handler);
    log.info("neutralized phantom track(s)", {
        file: file.name,
        tracks: edits.map((e) => ({ handler: e.handler, declaredSamples: e.declaredSamples, reason: e.reason })),
    });

    return { file: patchedFile, neutralized };
}

// ====== implementation ======

export interface PhantomEdit {
    /** handler_type of the track ('soun', 'meta', ...). */
    handler: string;
    /** Sample count the broken table declared (for diagnostics). */
    declaredSamples: number;
    /** Why it was flagged. */
    reason: "zero-offsets" | "zero-size";
    /** moov-relative byte offsets of the u32 entry_count fields to zero (stts/stsc/stsz/stco|co64). */
    countOffsets: number[];
}

/**
 * Walks moov/trak/mdia/minf/stbl for every non-video track and returns an edit
 * per phantom track. Offsets in the returned edits are relative to the start of
 * `moovBytes` (which is what the caller patches). Exported for the indexer's
 * repair detection (src/repair/moov-repair.ts), which already holds the moov
 * bytes, and for repairPhantomTracks below.
 */
export function findPhantomTracks(moovBytes: Uint8Array): PhantomEdit[] {
    const dv = new DataView(moovBytes.buffer, moovBytes.byteOffset, moovBytes.byteLength);
    const moov = findBox(dv, 0, dv.byteLength, "moov");
    if (!moov) return [];

    const edits: PhantomEdit[] = [];
    for (const trak of iterBoxes(dv, moov.payloadStart, moov.end)) {
        if (trak.type !== "trak") continue;
        const handler = readHandlerType(dv, trak);
        // Only neutralize non-video tracks. 'vide' is the picture we are trying
        // to save; a null handler is an unknown structure - leave it alone.
        if (handler === null || handler === "vide") continue;

        const mdia = findBox(dv, trak.payloadStart, trak.end, "mdia");
        if (!mdia) continue;
        const minf = findBox(dv, mdia.payloadStart, mdia.end, "minf");
        if (!minf) continue;
        const stbl = findBox(dv, minf.payloadStart, minf.end, "stbl");
        if (!stbl) continue;

        const stts = findBox(dv, stbl.payloadStart, stbl.end, "stts");
        const stsc = findBox(dv, stbl.payloadStart, stbl.end, "stsc");
        const stsz = findBox(dv, stbl.payloadStart, stbl.end, "stsz");
        const stco = findBox(dv, stbl.payloadStart, stbl.end, "stco");
        const co64 = findBox(dv, stbl.payloadStart, stbl.end, "co64");
        const chunks = stco ?? co64;
        // Need the sample-size table to know how many samples are declared, and
        // a chunk-offset table to test the "points nowhere" condition.
        if (!stsz || !chunks) continue;

        // A truncated header-only stsz/chunks box (size 8-15) cannot carry the
        // fields we read (sample_size + sample_count) and write (entry_count).
        // Reading past its end throws RangeError on the last box in the buffer -
        // that throw used to discard the whole index (A7). "Cannot verify" is
        // treated as "not phantom": a corrupt table is not the exact no-data
        // shape we neutralize.
        if (stsz.payloadStart + 12 > stsz.end) continue; // ver/flags(4)+sample_size(4)+sample_count(4)
        if (chunks.payloadStart + 8 > chunks.end) continue; // ver/flags(4)+entry_count(4)

        const declaredSamples = dv.getUint32(stsz.payloadStart + 8); // stsz: ver/flags(4) + sample_size(4) + sample_count(4)
        if (declaredSamples === 0) continue; // already empty - not phantom, nothing to fix

        const reason = phantomReason(dv, stsz, stco, co64);
        if (reason === null) continue;

        // Zero every count we have. A fully consistent 0-sample track (some
        // demuxers re-check stts/stsz agreement) - leaving one nonzero risks a
        // different inconsistency error. stts/stsc are optional; only zero their
        // entry_count when the box actually has room for the field, else a blind
        // write would clobber the 4 bytes of a neighbor box (G6).
        const countOffsets: number[] = [stsz.payloadStart + 8, chunks.payloadStart + 4];
        if (stts && stts.payloadStart + 8 <= stts.end) countOffsets.push(stts.payloadStart + 4);
        if (stsc && stsc.payloadStart + 8 <= stsc.end) countOffsets.push(stsc.payloadStart + 4);

        edits.push({ handler, declaredSamples, reason, countOffsets });
    }
    return edits;
}

/**
 * Returns the phantom reason if the track points at no data, else null:
 *   - "zero-offsets": every stco/co64 chunk offset is 0.
 *   - "zero-size": stsz declares per-sample sizes that are all 0 (sample_size
 *     header field 0 and every entry 0). A fixed sample_size > 0 means real
 *     bytes, so it is never phantom by size.
 */
function phantomReason(
    dv: DataView,
    stsz: { payloadStart: number; end: number },
    stco: { payloadStart: number; end: number } | null,
    co64: { payloadStart: number; end: number } | null,
): "zero-offsets" | "zero-size" | null {
    if (stco && allChunkOffsetsZero(dv, stco.payloadStart, stco.end, 4)) return "zero-offsets";
    if (co64 && allChunkOffsetsZero(dv, co64.payloadStart, co64.end, 8)) return "zero-offsets";
    if (allSampleSizesZero(dv, stsz.payloadStart, stsz.end)) return "zero-size";
    return null;
}

/** True when the chunk-offset table is non-empty and every offset is 0. */
function allChunkOffsetsZero(dv: DataView, payloadStart: number, end: number, entryBytes: number): boolean {
    if (payloadStart + 8 > end) return false; // entry_count truncated - cannot verify
    const entryCount = dv.getUint32(payloadStart + 4);
    if (entryCount === 0) return false;
    const arrayStart = payloadStart + 8;
    if (arrayStart + entryCount * entryBytes > end) return false; // corrupt bounds - do not flag
    for (let i = 0; i < entryCount; i++) {
        const off = arrayStart + i * entryBytes;
        // For co64 a nonzero high word alone already means a real offset.
        if (entryBytes === 8 && dv.getUint32(off) !== 0) return false;
        if (dv.getUint32(off + entryBytes - 4) !== 0) return false;
    }
    return true;
}

/** True when stsz uses a per-sample table (header size 0) and every entry is 0. */
function allSampleSizesZero(dv: DataView, payloadStart: number, end: number): boolean {
    if (payloadStart + 8 > end) return false; // sample_size field truncated - cannot verify
    const sampleSize = dv.getUint32(payloadStart + 4);
    if (sampleSize !== 0) return false; // fixed nonzero size = real bytes
    if (payloadStart + 12 > end) return false; // sample_count field truncated - cannot verify
    const sampleCount = dv.getUint32(payloadStart + 8);
    if (sampleCount === 0) return false;
    const arrayStart = payloadStart + 12;
    if (arrayStart + sampleCount * 4 > end) return false; // corrupt bounds - do not flag
    for (let i = 0; i < sampleCount; i++) {
        if (dv.getUint32(arrayStart + i * 4) !== 0) return false;
    }
    return true;
}
