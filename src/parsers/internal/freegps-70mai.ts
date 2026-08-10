// 70mai embedded freeGPS - the layout newer 4K 70mai models (A810, M500, ...)
// write INSIDE the MP4, instead of the older $V02 CSV sidecar (csv-70mai).
//
// It is a `freeGPS ` block like Novatek's, but a different dialect than the
// VIOFO/Vantrue variants in freegps.ts, with two defining differences:
//
//  1. Coordinates are int32 * 1e5 NMEA ddmm.mmmm (degrees*100 + minutes), NOT
//     decimal degrees and NOT Novatek's DDDmm.mmmm float. Verified two ways:
//     the on-video OSD coordinate stamp matches the ddmm digits exactly
//     (a decimal read of the same int32 lands tens of km away - up to 0.4 deg
//     inside a degree cell), and ExifTool's A810 branch (QuickTimeStream.pl,
//     GPSType 19) reads the same offsets as Get32s/1e5 + minutes conversion.
//
//  2. There is NO trustworthy per-record timestamp. The only time field is a
//     single constant file-start unix at offset 0x169, and it carries the known
//     70mai "+8h Beijing time" firmware bias (same bug handled in csv-70mai.ts)
//     AND no per-point granularity. So every record is emitted as
//     `timeUnsynced` (position-only): deriveStartUtc ignores them for TZ/start
//     inference and reanchorUnsyncedTimes spreads them across the video window -
//     the exact path the CSV cold-start rows already use.
//
// Block layout (byte offsets from the 8-byte `freeGPS ` magic):
//   [8..9]    u16 LE block tag; equals [14..15], and [10..11] == 0  (signature)
//   [26]      'A' (0x41) active fix / 'V' (0x56) void
//   [27..30]  int32 LE latitude  ddmm.mmmm * 1e5  (signed: negative = S)
//   [31..34]  int32 LE longitude ddmm.mmmm * 1e5  (signed: negative = W)
//   [35..38]  int32 LE heading degrees, [0..360)
//   [39..42]  int32 LE speed, km/h (ExifTool reads it the same way; on real
//             samples it sits at 3.6x the trajectory m/s). Left unused: its
//             behavior at a standstill / through a signal gap is unverified,
//             while the trajectory-derived speed is validated - see
//             finalize70maiRecords.
//   [0x169]   int32 LE constant file-start unix (8h-shifted) - unused.
//
// Blocks repeat once per video frame (~28-30x per GPS second); identical
// consecutive fixes are collapsed in finalize70maiRecords (and again globally
// by dedupRecords, which keys timeUnsynced rows on position only).

import { haversineKm } from "../../parser.js";
import { ddmmToDegrees } from "./ddmm.js";
import type { GpsRecord } from "../types.js";

// Field offsets from the freeGPS magic start.
const OFF_TAG = 8;
const OFF_TAG_ZERO = 10;
const OFF_TAG_MIRROR = 14;
const OFF_ACTIVE = 26;
const OFF_LAT = 27;
const OFF_LON = 31;
const OFF_HEADING = 35;

// Smallest window the parser touches (heading ends at byte 38).
const MIN_BLOCK_LEN = OFF_HEADING + 4;

const COORD_SCALE = 1e5; // int32 -> ddmm.mmmm
const ACTIVE = 0x41; // 'A'
const VOID = 0x56; // 'V'

// Whether the value is a plausible NMEA ddmm.mmmm coordinate: the minutes part
// is < 60 by construction, so a value failing this is not this dialect (a
// decimal-degrees int32 read as ddmm trips it on most fixes).
function isValidDdmm(ddmm: number, maxDegrees: number): boolean {
    if (!Number.isFinite(ddmm)) return false;
    const abs = Math.abs(ddmm);
    const minutes = abs - Math.floor(abs / 100) * 100;
    if (minutes >= 60) return false;
    return Math.abs(ddmmToDegrees(ddmm)) <= maxDegrees;
}

// `freeGPS ` magic bytes - the view passed by the scanner starts here; verify
// defensively so the parser is safe to call directly (tests, future callers).
const MAGIC = [0x66, 0x72, 0x65, 0x65, 0x47, 0x50, 0x53, 0x20];

function startsWithMagic(view: DataView): boolean {
    if (view.byteLength < MAGIC.length) return false;
    for (let i = 0; i < MAGIC.length; i++) {
        if (view.getUint8(i) !== MAGIC[i]) return false;
    }
    return true;
}

/**
 * Whether the block is a 70mai-dialect freeGPS block. The signature is the
 * self-referential tag (u16@8 == u16@14, u16@10 == 0) plus an active/void byte
 * and in-range ddmm.mmmm coordinates (minutes < 60, degrees within 90/180).
 * Strong enough that real VIOFO/Novatek Type-3 blocks (which have 0x00 at
 * offset 26 and unrelated tag bytes) never match - verified against
 * SilverStone F1 / 2E Drive samples.
 */
export function is70maiFreeGpsBlock(view: DataView): boolean {
    if (view.byteLength < MIN_BLOCK_LEN) return false;
    if (!startsWithMagic(view)) return false;
    if (view.getUint16(OFF_TAG, true) !== view.getUint16(OFF_TAG_MIRROR, true)) return false;
    if (view.getUint16(OFF_TAG_ZERO, true) !== 0) return false;
    const active = view.getUint8(OFF_ACTIVE);
    if (active !== ACTIVE && active !== VOID) return false;
    const latDdmm = view.getInt32(OFF_LAT, true) / COORD_SCALE;
    const lonDdmm = view.getInt32(OFF_LON, true) / COORD_SCALE;
    if (!isValidDdmm(latDdmm, 90) || !isValidDdmm(lonDdmm, 180)) return false;
    if (latDdmm === 0 && lonDdmm === 0) return false;
    return true;
}

/**
 * Parses one 70mai freeGPS block into a position-only GpsRecord. Returns an
 * empty array for a non-70mai block or a void fix; a one-element array
 * otherwise (the block carries a single fix - the array shape comes from the
 * multi-record ParseFreeGpsBlock contract). unixSeconds is a placeholder (the
 * block has no usable per-record clock) and speedMs is left at 0 - both are
 * filled in later (reanchorUnsyncedTimes for time, finalize70maiRecords for
 * speed). The record is flagged `timeUnsynced` so the time layer treats it
 * accordingly.
 *
 * Signature matches the ParseFreeGpsBlock contract so it can be injected into
 * the shared streamScanFreeGps scanner.
 */
export function parse70maiFreeGpsBlock(view: DataView, mp4Filename: string): GpsRecord[] {
    if (!is70maiFreeGpsBlock(view)) return [];
    if (view.getUint8(OFF_ACTIVE) !== ACTIVE) return []; // void fix, skip

    const lat = ddmmToDegrees(view.getInt32(OFF_LAT, true) / COORD_SCALE);
    const lon = ddmmToDegrees(view.getInt32(OFF_LON, true) / COORD_SCALE);
    let bearingDeg = view.getInt32(OFF_HEADING, true);
    // Heading is degrees already; clamp obvious garbage to 0 (trajectory bearing
    // is not reconstructed here - a single bad heading is harmless).
    if (!Number.isFinite(bearingDeg) || bearingDeg < 0 || bearingDeg >= 360) bearingDeg = 0;

    return [
        {
            unixSeconds: 0, // placeholder, reanchored onto the video window
            active: true,
            lat,
            lon,
            bearingDeg,
            speedMs: 0, // filled from the trajectory in finalize70maiRecords
            accelXg: 0,
            accelYg: 0,
            accelZg: 0,
            mp4Filename,
            timeUnsynced: true,
        },
    ];
}

/**
 * Collapses the per-frame repeats into one record per GPS fix and fills speedMs
 * from the trajectory. The 70mai block has no reliable speed field, but its
 * fixes are ~1 Hz, so the haversine distance between consecutive fixes is the
 * speed in m/s (dt ~ 1 s). This is approximate - the true cadence can be a few
 * percent off 1 Hz and reanchorUnsyncedTimes later spaces the points by the
 * real video duration - but it is honest (no invented unit scale) and good
 * enough for the speed chart. The first point copies the second so it is not
 * stuck at 0. An implausibly high value means the dt~1s assumption broke (a GPS
 * gap/reacquire put two valid fixes far apart, not real motion); above a sane
 * vehicle ceiling we drop it to 0 rather than show a 1000+ km/h spike.
 */
// ~324 km/h - any car dashcam reading above this is a GPS jump, not motion, so
// the trajectory speed is meaningless and zeroed (honest "unknown" over a wrong
// spike). Generous on purpose: it must not clip genuine fast highway driving.
const MAX_PLAUSIBLE_SPEED_MS = 90;

export function finalize70maiRecords(records: GpsRecord[]): GpsRecord[] {
    const uniq: GpsRecord[] = [];
    for (const r of records) {
        const last = uniq[uniq.length - 1];
        if (last && last.lat === r.lat && last.lon === r.lon) continue;
        uniq.push(r);
    }
    for (let i = 1; i < uniq.length; i++) {
        const prev = uniq[i - 1]!;
        const cur = uniq[i]!;
        // Shared great-circle helper (parser.ts), km -> m; dt ~ 1 s so m == m/s.
        const v = haversineKm(prev.lat, prev.lon, cur.lat, cur.lon) * 1000;
        cur.speedMs = v > MAX_PLAUSIBLE_SPEED_MS ? 0 : v;
    }
    if (uniq.length > 1) uniq[0]!.speedMs = uniq[1]!.speedMs;
    return uniq;
}
