// Older 70mai "Pro" GPS box (Midrive D02/D03 era, 2019-2021). GPS lives in a
// top-level `GPS ` box (uppercase 4cc) as an array of fixed 36-byte records -
// NOT the freeGPS-block layout the 4K models use (freegps-70mai.ts), NOT the
// $V02 CSV sidecar (csv-70mai.ts). Three distinct 70mai GPS generations.
//
// Record layout (36-byte stride, little-endian), cross-checked against two
// independent open-source extractors (freezer52000 maigps.c, mzdun/dashcam-gps
// 70mai.cc, both MIT) and validated on a real GPS box (haversine speed vs the
// speed field = 1.00 ratio):
//   [0..3]   u32 has_record (unused)
//   [4..7]   u32 has_gps - 1 = valid fix, 0 = no fix (skip)
//   [8..11]  u32 seconds  - offset from recording start (per-record time)
//   [12..15] u32 speed    - metres per hour (/3600 -> m/s)
//   [16]     'N' / 'S'
//   [17..20] u32 latitude  in DD MM.mmm packed: deg = raw/100000,
//            minutes = (raw % 100000) / 1000  ->  deg + minutes/60
//   [21]     'E' / 'W'
//   [22..25] u32 longitude (same packing)
//   [26..35] trailing/unused
//
// Time: the box carries only a per-record `seconds` offset, no absolute UTC, so
// records are emitted `timeUnsynced` (position-only). Unlike the 4K embedded
// format (which has no per-record clock at all), the `seconds` offset IS
// trustworthy, so each record carries it as `relStartSeconds` and
// reanchorUnsyncedTimes places it at startUtc+offset rather than spreading
// evenly by index - accurate across a cold-start or mid-file GPS gap, where the
// dropped no-fix records would otherwise smear the survivors over the window.
// Speed here is a real field (no trajectory guess), unlike the 4K format.

import { type GpsRecord, type ParsedRecords, type SkippedLine } from "../types.js";

const RECORD_STRIDE = 36;
const OFF_HAS_GPS = 4;
const OFF_SECONDS = 8; // per-record relative time from recording start
const OFF_SPEED = 12;
const OFF_NS = 16;
const OFF_LAT = 17;
const OFF_EW = 21;
const OFF_LON = 22;
// Bytes the parser reads from each record (lon ends at 25).
const RECORD_MIN = OFF_LON + 4;

const METRES_PER_HOUR_TO_MS = 1 / 3600;

/** Decodes the 70mai DD MM.mmm packed u32 into decimal degrees (unsigned). */
function packedDdmmToDegrees(raw: number): number {
    const deg = Math.floor(raw / 100_000);
    const minutes = (raw % 100_000) / 1000;
    return deg + minutes / 60;
}

/**
 * Parses the payload of a top-level `GPS ` box (bytes INCLUDING the 8-byte box
 * header) into GpsRecords. Returns empty records when the box holds no valid
 * fix; the caller treats "matched box but zero records" as a format mismatch.
 *
 * `mp4Filename` binds every record to its video.
 */
export function parseMaiGpsBox(boxBytes: Uint8Array, mp4Filename: string): ParsedRecords {
    const records: GpsRecord[] = [];
    const skipped: SkippedLine[] = [];

    // Skip the 8-byte box header (size + 'GPS '); records follow.
    const payloadStart = 8;
    if (boxBytes.byteLength < payloadStart + RECORD_MIN) return { records, skipped };
    const view = new DataView(boxBytes.buffer, boxBytes.byteOffset + payloadStart, boxBytes.byteLength - payloadStart);

    const count = Math.floor(view.byteLength / RECORD_STRIDE);
    for (let i = 0; i < count; i++) {
        const base = i * RECORD_STRIDE;
        const hasGps = view.getUint32(base + OFF_HAS_GPS, true);
        if (hasGps !== 1) continue; // no fix yet - skip silently (cold start)

        const ns = view.getUint8(base + OFF_NS);
        const ew = view.getUint8(base + OFF_EW);
        // Hemisphere bytes must be sane; otherwise the record (or the whole box)
        // is not this format - record a skip and move on.
        if ((ns !== 0x4e && ns !== 0x53) || (ew !== 0x45 && ew !== 0x57)) {
            skipped.push({ line: i + 1, raw: `<GPS rec @${base}>`, reason: "bad hemisphere byte" });
            continue;
        }

        const latRaw = view.getUint32(base + OFF_LAT, true);
        const lonRaw = view.getUint32(base + OFF_LON, true);
        const lat = packedDdmmToDegrees(latRaw) * (ns === 0x4e ? 1 : -1);
        const lon = packedDdmmToDegrees(lonRaw) * (ew === 0x45 ? 1 : -1);
        if (Math.abs(lat) > 90 || Math.abs(lon) > 180) {
            skipped.push({ line: i + 1, raw: `<GPS rec @${base}>`, reason: "coordinates out of range" });
            continue;
        }

        const speedMs = view.getUint32(base + OFF_SPEED, true) * METRES_PER_HOUR_TO_MS;
        const relStartSeconds = view.getUint32(base + OFF_SECONDS, true);

        records.push({
            unixSeconds: 0, // placeholder; reanchored onto the video window
            active: true,
            lat,
            lon,
            // No heading field in the record - dispatcher forward-fills from the
            // trajectory (same as the gps0 path).
            bearingDeg: 0,
            speedMs,
            accelXg: 0,
            accelYg: 0,
            accelZg: 0,
            mp4Filename,
            timeUnsynced: true,
            // Trustworthy per-record offset from clip start -> reanchor places
            // this fix at startUtc+offset (see reanchorUnsyncedTimes).
            relStartSeconds,
        });
    }

    return { records, skipped };
}

/** Exposed for tests. */
export const _internal = { packedDdmmToDegrees };
