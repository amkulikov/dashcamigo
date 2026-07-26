// PNDM (Garmin Dash Cam) extraction. Vendor-agnostic utility used by
// garminPlugin (by filename or classifyByContent) and genericPlugin as a
// fallback. PNDM magic is searched in the first sample of sbtl/text/meta tracks.

import { type GpsRecord, MPH_TO_MS, type ParsedRecords, type SkippedLine, type VendorFile } from "../types.js";
import { readMediaTimescale, readMvhdCreationUnixSec, readSampleStartsInTicks } from "./mp4-walker.js";
import { getFirstSampleOfTrack, loadTrackSampleBuffers, type Mp4Index, type TrackInfo } from "./mp4-index.js";

const FIXED_POINT_SCALE = 180 / 0x80000000;
const PNDM_HANDLERS: readonly string[] = ["sbtl", "text", "meta"];

/**
 * Returns the track with PNDM magic in its first sample, or null.
 * Iterates over all sbtl/text/meta tracks (Garmin uses any of them depending
 * on model/firmware). First-sample reads are cached via Mp4Index.firstSampleCache.
 */
export async function findPndmTrack(vf: VendorFile, index: Mp4Index): Promise<TrackInfo | null> {
    for (const t of index.tracks) {
        if (!t.handlerType || !PNDM_HANDLERS.includes(t.handlerType)) continue;
        const sample = await getFirstSampleOfTrack(index, t, vf);
        if (!sample) continue;
        const view = new DataView(sample.buffer, sample.byteOffset, sample.byteLength);
        if (findPndmMagic(view) !== null) return t;
    }
    return null;
}

/**
 * Extracts all PNDM records from the given track. Timestamps come from
 * mvhd.creation_time + stts offset (same approach as the original garmin.ts).
 * Returns null if the track has no samples or mvhd creation_time is zero
 * (cannot compute absolute time without a baseline).
 */
export async function extractFromPndmTrack(
    vf: VendorFile,
    index: Mp4Index,
    track: TrackInfo,
): Promise<ParsedRecords | null> {
    // Guard kept although loadTrackSampleBuffers re-checks: the reads below
    // need index.moovView narrowed to non-null.
    if (!index.moovView) return null;
    const sampleBuffers = await loadTrackSampleBuffers(vf.file, index, track);
    if (!sampleBuffers) return null;

    const baseUnix = readMvhdCreationUnixSec(index.moovView);
    if (baseUnix === null) {
        // Without a baseline records would get a 1970 epoch - signal to the
        // caller that the Garmin format was detected but time cannot be anchored.
        return null;
    }

    const sampleStartTicks = readSampleStartsInTicks(index.moovView, track.trakBox);
    const mediaTimescale = readMediaTimescale(index.moovView, track.trakBox);
    const useStts =
        sampleStartTicks !== null &&
        mediaTimescale !== null &&
        mediaTimescale > 0 &&
        sampleStartTicks.length >= sampleBuffers.length;
    // Fallback rate when stts is unavailable: average sample rate from track
    // duration. A fixed 1 Hz assumption would be wrong when the actual rate
    // differed from 1 sample/sec. If durationSec is also missing we have no
    // temporal anchor at all and must skip the file.
    const fallbackSecPerSample =
        !useStts && index.durationSec && index.durationSec > 0 && sampleBuffers.length > 1
            ? index.durationSec / (sampleBuffers.length - 1)
            : null;

    const records: GpsRecord[] = [];
    const skipped: SkippedLine[] = [];

    for (let i = 0; i < sampleBuffers.length; i++) {
        const buf = sampleBuffers[i]!;
        const view = new DataView(buf);
        const offset = findPndmMagic(view);
        if (offset === null) {
            skipped.push({
                line: i + 1,
                raw: `<garmin sample ${i + 1}: no PNDM magic>`,
                reason: "no PNDM magic in sample",
            });
            continue;
        }
        if (offset + 20 > view.byteLength) {
            skipped.push({
                line: i + 1,
                raw: `<garmin sample ${i + 1}: truncated>`,
                reason: "sample shorter than 20-byte PNDM struct",
            });
            continue;
        }
        const speedMph = view.getUint16(offset + 8, true);
        const latRaw = view.getInt32(offset + 12, true);
        const lonRaw = view.getInt32(offset + 16, true);

        const lat = latRaw * FIXED_POINT_SCALE;
        const lon = lonRaw * FIXED_POINT_SCALE;
        if (lat === 0 && lon === 0) continue;
        if (Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;

        let sampleOffsetSec: number;
        if (useStts) {
            sampleOffsetSec = sampleStartTicks![i]! / mediaTimescale!;
        } else if (fallbackSecPerSample !== null) {
            sampleOffsetSec = i * fallbackSecPerSample;
        } else if (sampleBuffers.length === 1) {
            // Single sample: anchor at baseUnix. fallbackSecPerSample requires
            // N>=2 (avoids division by zero). One record at baseUnix is still
            // a valid, usable fix.
            sampleOffsetSec = 0;
        } else {
            // Without stts and without total duration we have no way to derive
            // a per-sample timestamp. Skip the file rather than emit wrong
            // 1 Hz-assumed timestamps that would put map markers and chart
            // events at incorrect positions.
            skipped.push({
                line: i + 1,
                raw: `<garmin sample ${i + 1}: no stts and no durationSec>`,
                reason: "no temporal anchor (stts missing, mvhd durationSec missing)",
            });
            continue;
        }
        records.push({
            unixSeconds: baseUnix + sampleOffsetSec,
            active: true,
            lat,
            lon,
            bearingDeg: 0, // PNDM has no course field; dispatcher forward-fills from trajectory
            speedMs: speedMph * MPH_TO_MS,
            accelXg: 0,
            accelYg: 0,
            accelZg: 0,
            mp4Filename: vf.file.name,
        });
    }

    return { records, skipped };
}

function findPndmMagic(view: DataView): number | null {
    if (view.byteLength >= 4 && readFourCC(view, 0) === "PNDM") return 0;
    if (view.byteLength >= 8 && readFourCC(view, 4) === "PNDM") return 4;
    return null;
}

function readFourCC(view: DataView, offset: number): string {
    return String.fromCharCode(
        view.getUint8(offset),
        view.getUint8(offset + 1),
        view.getUint8(offset + 2),
        view.getUint8(offset + 3),
    );
}
