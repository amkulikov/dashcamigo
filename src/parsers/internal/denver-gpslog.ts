// Denver ACG-8050WMK2 bracketed GPS log. Implemented from ExifTool
// ProcessGPSLog (QuickTimeStream.pl:3115-3131, v13.55); NOT validated against
// a real sample.
//
// This is a decode step, not a carrier: upstream runs it over the payload of
// two different atoms - the top-level `udat` (QuickTime.pm:900, "GPS
// NMEA-format log written by Datakam Player software") and the `gps ` child of
// a Pittasoft-style `free` box (QuickTime.pm:8506) - trying NMEA first and
// this format second. Both entry points are wired the same way here.
//
// One record, all ASCII, no separator required between records:
//
//   210318073213[1][N][52200970][E][006362321][+00152][100][00140][C000000]+000+000...
//   YYMMDDHHMMSS  ^  NS lat      EW lon        alt     kph  dir    kCal    accel
//
// Coordinates are DD + minutes*1e4 (lat 8 digits / lon 9), hence the /600000.
// The `[1]` slot is upstream's unnamed status field; requiring the literal 1
// is what keeps a no-fix row - if the firmware writes one - out of the output
// instead of emitting a position we cannot vouch for.
//
// Dropped fields, and why: altitude and kilocalories have no GpsRecord field,
// and the trailing +NNN run is emitted by upstream as an opaque string with
// neither a scale nor an axis mapping, so accel stays zero rather than
// invented. The run is still REQUIRED to match - it is a large part of what
// makes this signature strict.

import { type GpsRecord, KMH_TO_MS, type ParsedRecords, type SkippedLine } from "../types.js";

/**
 * The upstream record regex, transliterated with one deliberate change: its
 * leading `\b` is dropped.
 *
 * Why: the accel run ends in a digit, so back-to-back records - which the
 * single dumped record cannot rule out - put no word boundary before the next
 * timestamp, and `\b` would silently stop after the first one. Without the
 * anchor the engine simply finds the correct start by backtracking. Nothing is
 * lost in strictness: the discrimination lives in the bracket skeleton, its
 * fixed digit counts and the mandatory accel run, and a match that begins
 * mid-number fails the datetime range check below.
 *
 * Built per call - a `g` regex is stateful, and a shared instance would carry
 * lastIndex between files.
 */
function denverRecordRegex(global: boolean): RegExp {
    return new RegExp(
        String.raw`(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})` +
            String.raw`\[1\]\[([NS])\]\[(\d{8})\]\[([EW])\]\[(\d{9})\]` +
            String.raw`\[([-+]?\d*)\]\[(\d*)\]\[(\d*)\]\[C?(\d*)\](([-+]\d{3})+)`,
        global ? "g" : "",
    );
}

/** Minutes are stored as minutes*1e4, so a degree is 60*1e4 raw units. */
const MINUTES_SCALE = 600000;

/** Head of a record: datetime, status, hemisphere, latitude - 28 chars. */
const DENVER_RECORD_START_RX = /\d{12}\[1\]\[[NS]\]\[\d{8}\]/;

/**
 * True when the text begins a record. Used as the cheap head-of-atom marker,
 * where a whole record (130+ chars) does not fit. Strict enough for that job -
 * the bracket skeleton and fixed digit counts are what discriminate, not the
 * record's tail.
 */
export function hasDenverRecordStart(text: string): boolean {
    return DENVER_RECORD_START_RX.test(text);
}

/**
 * Parses every bracketed record in `text`. Returns null when none matched, so
 * a caller can fall through to another decoder on the same bytes.
 *
 * Timestamps are treated as UTC, following upstream (which stamps its
 * GPSDateTime with a trailing `Z`). There is no second clock in this format to
 * cross-check that against.
 */
export function parseDenverGpsLog(text: string, mp4Filename: string): ParsedRecords | null {
    const records: GpsRecord[] = [];
    const skipped: SkippedLine[] = [];
    let index = 0;

    for (const m of text.matchAll(denverRecordRegex(true))) {
        index++;
        const [, yy, mo, dd, hh, mi, ss, ns, latRaw, ew, lonRaw, , spdRaw, dirRaw] = m;
        if (!yy || !mo || !dd || !hh || !mi || !ss || !ns || !latRaw || !ew || !lonRaw) continue;

        const unixSeconds = toUnixSeconds(yy, mo, dd, hh, mi, ss);
        if (unixSeconds === null) {
            skipped.push({ line: index, raw: m[0].slice(0, 12), reason: "implausible datetime" });
            continue;
        }

        const lat = toDegrees(latRaw, 2);
        const lon = toDegrees(lonRaw, 3);
        if (lat === null || lon === null || lat > 90 || lon > 180) {
            skipped.push({ line: index, raw: `${latRaw}/${lonRaw}`, reason: "coordinate out of range" });
            continue;
        }
        // A `[1]`-flagged row at the null island is a firmware artifact, never a
        // real fix; emitting it would drag the whole track into the ocean.
        if (lat === 0 && lon === 0) {
            skipped.push({ line: index, raw: `${latRaw}/${lonRaw}`, reason: "zero coordinates" });
            continue;
        }

        records.push({
            unixSeconds,
            active: true,
            lat: ns === "S" ? -lat : lat,
            lon: ew === "W" ? -lon : lon,
            bearingDeg: dirRaw ? Number(dirRaw) % 360 : 0,
            speedMs: spdRaw ? Number(spdRaw) * KMH_TO_MS : 0,
            accelXg: 0,
            accelYg: 0,
            accelZg: 0,
            mp4Filename,
        });
    }

    if (records.length === 0) return null;
    return { records, skipped };
}

/**
 * DD(D) + minutes*1e4 -> unsigned decimal degrees. Returns null when the
 * minutes field is >= 60, which a genuine fix cannot produce and a
 * coincidental digit run easily can.
 */
function toDegrees(raw: string, degreeDigits: number): number | null {
    const degrees = Number(raw.slice(0, degreeDigits));
    const minutesRaw = Number(raw.slice(degreeDigits));
    if (!Number.isFinite(degrees) || !Number.isFinite(minutesRaw)) return null;
    if (minutesRaw >= 60 * 10000) return null;
    return degrees + minutesRaw / MINUTES_SCALE;
}

/**
 * `YYMMDDHHMMSS` (year is 20YY, UTC) -> unix seconds, or null when any
 * component is out of range. The range check is load-bearing for the marker:
 * Date.UTC happily rolls month 19 over into the next year, which would turn a
 * random digit run into a plausible-looking timestamp.
 */
function toUnixSeconds(yy: string, mo: string, dd: string, hh: string, mi: string, ss: string): number | null {
    const year = 2000 + Number(yy);
    const month = Number(mo);
    const day = Number(dd);
    const hour = Number(hh);
    const minute = Number(mi);
    const second = Number(ss);
    if (month < 1 || month > 12) return null;
    if (day < 1 || day > 31) return null;
    if (hour > 23 || minute > 59 || second > 59) return null;
    return Date.UTC(year, month - 1, day, hour, minute, second) / 1000;
}
