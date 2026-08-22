// Rove R2-4K (newer firmware) `ssmd` meta-track GPS extraction ("RoveGPS").
//
// IMPLEMENTED FROM FOREIGN SOURCE (ExifTool 13.59, QuickTimeStream.pl:330-403),
// NOT VALIDATED AGAINST A REAL SAMPLE - the extractor+sample+tests hard rule
// was explicitly waived for this batch. Field semantics below are ExifTool's,
// with open questions flagged.
//
// The `ssmd` sample-description name is multi-vendor: CarCam/SigmaStar LigoGPS
// (64..1024-byte encrypted chunks, internal/ligogps.ts), Chigee AIO-5 JPEG
// previews (start ff d8 ff), and the Rove R2-4K accelerometer (12-byte float
// triples, ExifTool QuickTimeStream.pl:339-343). The Rove GPS variant is the
// only one with constant 32-byte samples - that size gate plus the content
// probe keep the others out.
//
// Sample layout (32 bytes, little-endian), per ExifTool QuickTimeStream.pl:367-403
// (%Image::ExifTool::QuickTime::RoveGPS, v13.59):
//   +0   double  lat, NMEA DDmm.mmmm
//   +8   double  lon, NMEA DDDmm.mmmm
//   +16  4 bytes undefined (no spec in ExifTool; not extracted)
//   +20  u16     speed, knots (ExifTool converts *1.852 to km/h; we go to m/s
//                via the shared KNOTS_TO_MS)
//   +22  u8[6]   year-2000, month, day, hour, minute, second
//   +28  4 bytes status, ADVISORY ONLY - ExifTool itself marks them "?"
//                ("ff 01 01 00 - good GPS?", "ff 00 ff ff - no GPS?",
//                QuickTimeStream.pl:400-402); we do not gate on them. No-fix
//                samples are detected by the lat sentinel instead, which IS
//                asserted in ExifTool's ssmd Condition (QuickTimeStream.pl:
//                331-333): lat double bytes 00 00 e0 ff ff ff ef 41
//                (LE double 4294967295).
//
// Open questions (need a real sample to settle):
//   - Hemisphere: no N/S/E/W field found in the 32 bytes; ExifTool prints
//     fixed "N"/"E". Assuming the signed DDmm.mmmm convention (negative =
//     S/W), same caveat as navitel-gps0.
//   - Timestamp TZ: assumed UTC, UNVERIFIED - there is no IDIT-style local
//     anchor to compare against. If the camera actually writes local time,
//     deriveStartUtc output is off by the TZ offset; confirm against a real
//     sample before trusting trip timestamps.

import { type GpsRecord, KNOTS_TO_MS, type ParsedRecords, type SkippedLine, type VendorFile } from "../types.js";
import { utcMillisecondsFromParts } from "./calendar.js";
import { ddmmToDegrees, isCoordinateInRange } from "./ddmm.js";
import type { Mp4Index, TrackInfo } from "./mp4-index.js";
import { loadSamples, readSampleTable } from "./mp4-walker.js";

/** RoveGPS sample size - ExifTool's ssmd Condition requires exactly 32 bytes. */
export const ROVE_SSMD_SAMPLE_SIZE = 32;

// ExifTool QuickTimeStream.pl:332 (v13.59): "double value of GPSLatitude is
// 4294967295 (00 00 e0 ff ff ff ef 41) for no GPS".
const NO_FIX_LAT_SENTINEL = Uint8Array.of(0x00, 0x00, 0xe0, 0xff, 0xff, 0xff, 0xef, 0x41);

const OFF_LAT = 0;
const OFF_LON = 8;
// +16..19 undefined - intentionally not read.
const OFF_SPEED = 20;
const OFF_DATE = 22;

// Raw DDmm plausibility bounds for the content probe: 90 deg * 100 and
// 180 deg * 100. The structural signature (meta track, 32-byte samples) is
// weak on its own - these bounds plus the date-byte check are load-bearing.
const MAX_ABS_LAT_DDMM = 9000;
const MAX_ABS_LON_DDMM = 18000;

/**
 * Returns the RoveGPS candidate track: handler 'meta', sample-format 'ssmd',
 * non-empty sample table where EVERY sample is exactly 32 bytes. The constant
 * size separates RoveGPS from the other ssmd dwellers (LigoGPS 64..1024,
 * Chigee JPEG previews >1 KB, Rove accel 12 bytes). null when absent.
 */
export function findRoveSsmdTrack(index: Mp4Index): TrackInfo | null {
    if (!index.moovView) return null;
    for (const t of index.tracks) {
        if (t.handlerType !== "meta" || t.sampleFormat !== "ssmd") continue;
        const samples = readSampleTable(index.moovView, t.trakBox);
        if (!samples || samples.length === 0) continue;
        if (!samples.every((s) => s.size === ROVE_SSMD_SAMPLE_SIZE)) continue;
        return t;
    }
    return null;
}

/** True when the sample opens with the no-fix lat sentinel (cold start, no GPS). */
export function isNoFixSentinel(dv: DataView): boolean {
    if (dv.byteLength < NO_FIX_LAT_SENTINEL.length) return false;
    for (let i = 0; i < NO_FIX_LAT_SENTINEL.length; i++) {
        if (dv.getUint8(i) !== NO_FIX_LAT_SENTINEL[i]) return false;
    }
    return true;
}

/** u8 date sextet sanity check; year byte is the raw value (year - 2000). */
function dateBytesValid(
    year: number,
    month: number,
    day: number,
    hour: number,
    minute: number,
    second: number,
): boolean {
    return (
        year <= 99 && month >= 1 && month <= 12 && day >= 1 && day <= 31 && hour <= 23 && minute <= 59 && second <= 59
    );
}

/**
 * Content probe for the marker: the first sample either carries the exact
 * 8-byte no-fix sentinel (a strong signature by itself) or decodes plausibly
 * (DDmm doubles in range, date bytes in range). Anything else - not RoveGPS.
 */
export function looksLikeRoveSsmdSample(dv: DataView): boolean {
    if (dv.byteLength !== ROVE_SSMD_SAMPLE_SIZE) return false;
    if (isNoFixSentinel(dv)) return true;
    const latRaw = dv.getFloat64(OFF_LAT, true);
    const lonRaw = dv.getFloat64(OFF_LON, true);
    if (!Number.isFinite(latRaw) || Math.abs(latRaw) > MAX_ABS_LAT_DDMM) return false;
    if (!Number.isFinite(lonRaw) || Math.abs(lonRaw) > MAX_ABS_LON_DDMM) return false;
    return dateBytesValid(
        dv.getUint8(OFF_DATE),
        dv.getUint8(OFF_DATE + 1),
        dv.getUint8(OFF_DATE + 2),
        dv.getUint8(OFF_DATE + 3),
        dv.getUint8(OFF_DATE + 4),
        dv.getUint8(OFF_DATE + 5),
    );
}

/**
 * Decodes one 32-byte RoveGPS sample. Returns null for the no-fix sentinel,
 * an empty fix (lat=0 && lon=0), or implausible data (NaN doubles,
 * out-of-range coordinates or date bytes). Status bytes 28..31 are advisory
 * and never gate the decode - see the header.
 */
export function decodeRoveSsmdSample(dv: DataView, mp4Filename: string): GpsRecord | null {
    if (dv.byteLength !== ROVE_SSMD_SAMPLE_SIZE) return null;
    if (isNoFixSentinel(dv)) return null;

    const latRaw = dv.getFloat64(OFF_LAT, true);
    const lonRaw = dv.getFloat64(OFF_LON, true);
    if (!Number.isFinite(latRaw) || !Number.isFinite(lonRaw)) return null;
    // Empty fix written as zeros - same convention as gps0/wolfbox decoders.
    if (latRaw === 0 && lonRaw === 0) return null;

    const lat = ddmmToDegrees(latRaw);
    const lon = ddmmToDegrees(lonRaw);
    if (!isCoordinateInRange(lat, "lat") || !isCoordinateInRange(lon, "lon")) return null;

    const yearByte = dv.getUint8(OFF_DATE);
    const month = dv.getUint8(OFF_DATE + 1);
    const day = dv.getUint8(OFF_DATE + 2);
    const hour = dv.getUint8(OFF_DATE + 3);
    const minute = dv.getUint8(OFF_DATE + 4);
    const second = dv.getUint8(OFF_DATE + 5);
    if (!dateBytesValid(yearByte, month, day, hour, minute, second)) return null;

    // Assumed UTC - UNVERIFIED, see the header.
    const baseMs = utcMillisecondsFromParts(2000 + yearByte, month, day, hour, minute, second);
    if (baseMs === null) return null;

    const speedKnots = dv.getUint16(OFF_SPEED, true);

    return {
        unixSeconds: baseMs / 1000,
        active: true,
        lat,
        lon,
        // No course field in the 32 bytes - 0 lets downstream derive bearing
        // from the trajectory.
        bearingDeg: 0,
        speedMs: speedKnots * KNOTS_TO_MS,
        // Acceleration lives in the separate 12-byte ssmd track - not merged
        // here (would need a real sample to verify axis conventions anyway).
        accelXg: 0,
        accelYg: 0,
        accelZg: 0,
        mp4Filename,
    };
}

/**
 * Extracts GPS from a RoveGPS ssmd track. Sentinel (no-fix) samples are
 * skipped silently - routine during satellite acquisition. Returns null when
 * nothing in the track confirms the format (zero decoded records AND zero
 * sentinels); a sentinel-only track returns empty records ("matches the
 * format, carries no GPS"), per the Primitive contract.
 */
export async function extractFromRoveSsmdTrack(
    vf: VendorFile,
    index: Mp4Index,
    track: TrackInfo,
): Promise<ParsedRecords | null> {
    if (!index.moovView) return null;
    const samples = readSampleTable(index.moovView, track.trakBox);
    if (!samples || samples.length === 0) return null;
    // Re-assert the constant size (cheap) - the caller normally got the track
    // from findRoveSsmdTrack, but extract must not misread a foreign track.
    if (!samples.every((s) => s.size === ROVE_SSMD_SAMPLE_SIZE)) return null;

    const sampleBuffers = await loadSamples(vf.file, samples, index.sliceCost);
    const records: GpsRecord[] = [];
    const skipped: SkippedLine[] = [];
    let sentinelCount = 0;

    for (let i = 0; i < sampleBuffers.length; i++) {
        const buf = sampleBuffers[i];
        if (!buf) continue;
        const dv = new DataView(buf);
        if (dv.byteLength === ROVE_SSMD_SAMPLE_SIZE && isNoFixSentinel(dv)) {
            sentinelCount++;
            continue;
        }
        const rec = decodeRoveSsmdSample(dv, vf.file.name);
        if (rec === null) {
            // Non-sentinel sample that fails plausibility is NOT routine for
            // this format - keep a diagnostic trace per sample.
            skipped.push({
                line: i + 1,
                raw: `<rove-ssmd sample ${i + 1}>`,
                reason: "implausible rove ssmd record",
            });
            continue;
        }
        records.push(rec);
    }

    if (records.length === 0 && sentinelCount === 0) return null;
    return { records, skipped };
}
