// Minimal NMEA-0183 parser for the `$GPRMC` sentence subset. GPRMC has
// lat/lon/speed/course/timestamp - everything needed for GpsRecord. GPGGA
// (altitude/fix-quality) is not needed.
//
// Used by:
//  - Generic NMEA plugin (Mio MiVue 5xx-9xx, Navman MiVue 530/800/850/Pro,
//    Vicovation Marcus 3+, Transcend DrivePro 100-230, DOD older NMEA models):
//    sidecar `*.NMEA`/`*.nmea` alongside the MP4, no prefix.
//  - BlackVue legacy series (DR400G-HD/DR450/500/550/650, early DR770X):
//    sidecar `*.gps` with a `[unix_ms]` prefix on each NMEA line. Very old
//    models (DR400G-HD) may have no-prefix files - not covered yet.
//  - Thinkware F-series: subtitle track in MP4 with NMEA-RMC sentences
//    separated by `\0`; the plugin splits the payload then calls parseNmeaText.
//  - Novatek Type 2 (Nextbase 512GW) and Type 12 (Kenwood): GPRMC appears
//    inside a freeGPS block at a fixed offset.
//
// Intentionally minimal: one sentence type, no checksum validation, no support
// for the other 19 sentence types. Less code = fewer divergences from real
// vendor files.
//
// TIME RULE (applies to every caller above): the RMC time+date fields come off
// the satellites and are UTC by protocol. Anything a recorder stamps beside
// them - a line prefix, a container box, a filename - is its own wall clock and
// carries the user's TZ setting, so it can never outrank the fix time.
// GpsRecord.unixSeconds is true UTC; converting to a local zone is the UI's job.

import { createLogger } from "../../log.js";
import { type GpsRecord, KNOTS_TO_MS, type ParsedRecords, type SkippedLine } from "../types.js";

const log = createLogger("nmea");

// $GSENSOR scale. Dashcam vendors use TWO different encodings:
//
//  1. **10-bit two's complement, gravity-removed** (MOV_0581.nmea, dashcam-viewer 2013):
//     only positive text values, discrete steps 0..992 ~16 apart. Values >=512
//     wrap negative via -1024. Divisor 1024. Center is 0, gravity already removed
//     by firmware.
//
//  2. **Signed-direct, gravity-included** (Vicovation Marcus 3: "$GSENSOR,-50,-384,998"):
//     minus signs are explicit, range ~±1024. Z=1024 = +1g vertical gravity. No wrap.
//
// Per-file detection: on the first $GSENSOR with an explicit '-' we switch to
// signed-direct for the entire file (sticky, scoped to one parseNmeaText call).
//
// 0,0,0 = "no shock, car moving smoothly" - magnitude sqrt(X²+Y²+Z²) gives 0
// with no sentinel needed.
const GSENSOR_LSB_PER_G = 1024;
const GSENSOR_SIGNED_BIT_BOUNDARY = 512;

interface ParseNmeaOptions {
    // Optional regex prefix before each line, capture group 1 = the camera's
    // own clock as unix-ms. BlackVue example: `/^\[(\d+)\]/` -> group 1 =
    // "[1555957502837]". Used only as a timestamp FALLBACK for a sentence whose
    // own time/date is unusable (see the TIME RULE at the top of this file).
    //
    // Missing-prefix behavior controlled by linePrefixOptional:
    //  - false (default): line without prefix is skipped - guards against
    //    unrelated lines (headers, comments) in .gps files.
    //  - true: missing prefix is fine, the line parses as plain NMEA. Needed
    //    for BlackVue DR400G-HD (legacy 2010 series writes .gps without the
    //    [ms] prefix).
    linePrefixRegex?: RegExp;
    linePrefixOptional?: boolean;
}

// A prefixed camera clock this far from satellite UTC is a TZ setting, not
// drift. Logged once per file: it is the first thing to check when a user
// reports timestamps shifted by a whole number of hours.
const CAMERA_CLOCK_OFFSET_LOG_THRESHOLD_SEC = 60;

/**
 * Parses a text file containing NMEA sentences. Returns only GPRMC records
 * with an active fix (`A`). Non-RMC and unknown lines are silently skipped;
 * `skipped` contains only real RMC parse errors (not every non-RMC line,
 * otherwise snapshot tests would be cluttered).
 *
 * The $GSENSOR custom extension (Vicovation, Mio MiVue, etc.) is attached to
 * the PREVIOUS emitted RMC record: files always sequence as
 * `RMC -> GSENSOR -> RMC -> GSENSOR -> ...`, so the accel sample logically
 * belongs to the GPS fix already emitted. The record is mutated in place (it
 * is already in `records`).
 *
 * $GSENSOR=0,0,0 means "no shock" - the record keeps its default zero accels.
 * A zero accel vector gives magnitude 0 (not 1g from |sqrt-1|) - see events.ts.
 */
export function parseNmeaText(text: string, mp4Filename: string, options: ParseNmeaOptions = {}): ParsedRecords {
    const lines = text.split(/\r?\n/);
    const records: GpsRecord[] = [];
    const skipped: SkippedLine[] = [];
    let lastRecord: GpsRecord | null = null;
    // Switches to 'signed-direct' on the first $GSENSOR line that contains an
    // explicit '-', then stays sticky for the rest of the file.
    let gsensorMode: "wrap10" | "signed-direct" = "wrap10";
    // Camera-clock minus satellite-UTC per prefixed sentence - diagnostics only,
    // never an input to a timestamp (see the one-shot log after the loop).
    const cameraClockDeltas: number[] = [];
    // Records that received a $GSENSORD (float-g) accel sample. Collected so the
    // constant DC offset that dialect carries can be removed after the whole log
    // is parsed (see removeAccelDcBias below). A Set dedupes the common
    // many-GSENSORD-per-RMC case to one entry per record.
    const floatGTargets = new Set<GpsRecord>();

    for (let i = 0; i < lines.length; i++) {
        const raw = lines[i]!;
        if (raw === "") continue;

        let nmeaPart = raw;
        let prefixUnixMs: number | null = null;

        if (options.linePrefixRegex) {
            const m = raw.match(options.linePrefixRegex);
            if (m) {
                nmeaPart = raw.slice(m[0].length);
                if (m[1]) {
                    const ms = Number(m[1]);
                    if (Number.isFinite(ms)) prefixUnixMs = ms;
                }
            } else if (!options.linePrefixOptional) {
                // Strict mode: prefix required, skip the line.
                continue;
            }
            // Optional mode: no prefix - parse as plain NMEA.
        }

        if (!nmeaPart.startsWith("$") || nmeaPart.length < 7) continue;

        // $GSENSOR,X,Y,Z custom extension - apply to the last emitted record.
        // Without a preceding RMC (GSENSOR at the very start of the file)
        // there is nowhere to attach the accel; silently skip.
        if (nmeaPart.startsWith("$GSENSOR,")) {
            // Explicit '-' in XYZ values signals signed-direct format (Vicovation
            // Marcus 3) - switch for the rest of the file (sticky).
            if (gsensorMode === "wrap10" && /,-\d/.test(nmeaPart)) {
                gsensorMode = "signed-direct";
            }
            if (lastRecord) applyGsensor(nmeaPart, lastRecord, gsensorMode);
            continue;
        }

        // $GSENSORD,X,Y,Z - Mio/Navman MiVue dialect (note the trailing D).
        // Unlike $GSENSOR's raw integer LSB form, the values are decimal g
        // already (e.g. "0.250"), so no LSB scaling. They are NOT truly
        // gravity-removed though: the camera leaves a constant ~0.3g DC vector
        // (mount tilt / sensor bias) that never decays at rest, so the raw
        // magnitude would breach the gravity-removed accel contract. That offset
        // is stripped per-axis after the loop (removeAccelDcBias). Distinct
        // prefix, so it never overlaps the $GSENSOR, branch above.
        if (nmeaPart.startsWith("$GSENSORD,")) {
            if (lastRecord) {
                applyGsensor(nmeaPart, lastRecord, "float-g");
                floatGTargets.add(lastRecord);
            }
            continue;
        }

        // Accept any talker-id (*RMC) to avoid skipping $GNRMC from multi-GNSS
        // receivers; the vast majority of dashcam files use $GPRMC.
        if (nmeaPart.slice(3, 6) !== "RMC") continue;

        // Strip `*XX` checksum if present. Not validated - vendors sometimes
        // write a corrupt checksum with valid data; losing records is worse.
        const star = nmeaPart.lastIndexOf("*");
        const body = star > 0 ? nmeaPart.slice(0, star) : nmeaPart;

        const parsed = parseRmc(body, mp4Filename, prefixUnixMs);
        if ("error" in parsed) {
            skipped.push({ line: i + 1, raw, reason: parsed.error });
            continue;
        }
        if (parsed.record) {
            if (prefixUnixMs !== null) cameraClockDeltas.push(prefixUnixMs / 1000 - parsed.record.unixSeconds);
            records.push(parsed.record);
            lastRecord = parsed.record;
        }
    }

    if (cameraClockDeltas.length > 0) {
        // Median, not mean: a few sentences with a corrupt (prefix-sourced)
        // timestamp contribute a 0 delta and must not drag the estimate.
        const offsetSec = median(cameraClockDeltas);
        if (Math.abs(offsetSec) >= CAMERA_CLOCK_OFFSET_LOG_THRESHOLD_SEC) {
            log.info("camera clock offset from satellite utc", {
                file: mp4Filename,
                offsetSec: Math.round(offsetSec),
            });
        }
    }

    // Strip the Mio/Navman $GSENSORD DC offset so the accel matches the
    // gravity-removed contract (events.ts gMagnitude). No-op for every other
    // dialect - their records never enter floatGTargets.
    if (floatGTargets.size > 0) removeAccelDcBias(floatGTargets);

    return { records, skipped };
}

/**
 * Removes the constant DC offset from Mio/Navman $GSENSORD accelerometer records.
 * That camera writes a persistent ~0.3g vector (mount tilt / sensor bias) that
 * does not decay to zero at rest, which violates the gravity-removed contract of
 * GpsRecord.accel* (see events.ts gMagnitude): without this the G-load chart
 * floats at ~0.3 and the brake/impact detector fires on the baseline. Subtracts
 * the per-axis MEDIAN over the whole log - median, not mean, so an asymmetric
 * drive (mostly braking or mostly accelerating) cannot drag the zero-reference
 * toward those peaks. Mutates the records in place (already in `records`).
 */
function removeAccelDcBias(targets: Set<GpsRecord>): void {
    const recs = Array.from(targets);
    const medX = median(recs.map((r) => r.accelXg));
    const medY = median(recs.map((r) => r.accelYg));
    const medZ = median(recs.map((r) => r.accelZg));
    for (const r of recs) {
        r.accelXg -= medX;
        r.accelYg -= medY;
        r.accelZg -= medZ;
    }
}

/** Median of a numeric array (average of the two middle values for even n). */
function median(values: number[]): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = sorted.length >> 1;
    return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

/**
 * Parses `$GSENSOR,X,Y,Z` (or the `$GSENSORD` variant) and writes the accel
 * fields of the given record. Decoding modes:
 *  - "wrap10": 10-bit two's complement (>=512 → value-1024), divisor 1024.
 *  - "signed-direct": values are already signed (explicit minus signs), no wrap,
 *    same divisor 1024 (range ~±1024 = ±1g).
 *  - "float-g": values are already decimal g (Mio/Navman $GSENSORD), no decode
 *    and no divisor.
 *
 * Exported for reuse by the subtitle-track extractor, which sees the same
 * `$GSENSOR` lines in the legacy Thinkware `$`-prefixed dialect.
 */
export function applyGsensor(line: string, target: GpsRecord, mode: "wrap10" | "signed-direct" | "float-g"): void {
    const parts = line.split(",");
    if (parts.length < 4) return;
    // Strip optional `*XX` checksum from the last field.
    const zRaw = parts[3]!;
    const star = zRaw.indexOf("*");
    // Number("") is 0, which would slip an empty/checksum-only field through the
    // isFinite guard as a real 0; treat empty as NaN so it is rejected instead.
    const toNum = (s: string): number => (s === "" ? Number.NaN : Number(s));
    const x = toNum(parts[1]!);
    const y = toNum(parts[2]!);
    const z = toNum(star >= 0 ? zRaw.slice(0, star) : zRaw);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return;
    const decode = mode === "wrap10" ? signed10 : (v: number) => v;
    // float-g values are g already; the integer modes are LSB and need scaling.
    const divisor = mode === "float-g" ? 1 : GSENSOR_LSB_PER_G;
    target.accelXg = decode(x) / divisor;
    target.accelYg = decode(y) / divisor;
    target.accelZg = decode(z) / divisor;
}

// 10-bit two's complement: 0..511 positive as-is, 512..1023 negative via wrap
// (value - 1024). Values outside 0..1023 do not appear in known files.
function signed10(v: number): number {
    if (v >= GSENSOR_SIGNED_BIT_BOUNDARY && v <= 1023) return v - 1024;
    return v;
}

type RmcResult = { record: GpsRecord | null } | { error: string };

// $GPRMC fields (after $XXRMC):
//   1: time     hhmmss.ss UTC (sub-second optional)
//   2: status   A=active, V=void
//   3: lat      ddmm.mmmm
//   4: latDir   N/S
//   5: lon      dddmm.mmmm
//   6: lonDir   E/W
//   7: speed    knots
//   8: course   degrees true
//   9: date     ddmmyy
//   10+: magvar/mode - unused
//
// `body` is the sentence WITHOUT the leading `$` requirement and WITHOUT the
// `*XX` checksum (caller strips both). parts[0] (the `GxRMC` token) is ignored,
// so a bare `GPRMC,...` from a Thinkware subtitle parses the same as `$GPRMC`.
// Exported for reuse by the subtitle-track extractor.
export function parseRmc(body: string, mp4Filename: string, prefixUnixMs: number | null): RmcResult {
    const parts = body.split(",");
    if (parts.length < 10) return { error: "rmc: too few fields" };

    const status = parts[2]!;
    if (status === "V") return { record: null }; // void - no GPS fix, skip silently
    if (status !== "A") return { error: `rmc: bad status ${JSON.stringify(status)}` };

    const lat = parseNmeaCoord(parts[3]!, parts[4]!);
    const lon = parseNmeaCoord(parts[5]!, parts[6]!);
    if (lat === null || lon === null) return { error: "rmc: bad coordinates" };

    const speedKnots = Number(parts[7]!);
    const course = Number(parts[8]!);
    if (!Number.isFinite(speedKnots) || !Number.isFinite(course)) {
        return { error: "rmc: bad speed/course" };
    }

    // Satellite time wins over the camera clock (TIME RULE at the top of the
    // file): a prefix stamped from local wall time would shift the whole track
    // by the camera's TZ. The prefix still covers a sentence whose own
    // time/date is corrupt - a shifted point beats a dropped one.
    const satelliteUnix = parseNmeaTimestamp(parts[1]!, parts[9]!);
    const unixSeconds = satelliteUnix ?? (prefixUnixMs === null ? null : prefixUnixMs / 1000);
    if (unixSeconds === null) return { error: "rmc: bad timestamp" };

    return {
        record: {
            unixSeconds,
            active: true,
            lat,
            lon,
            bearingDeg: course,
            speedMs: speedKnots * KNOTS_TO_MS,
            accelXg: 0,
            accelYg: 0,
            accelZg: 0,
            mp4Filename,
        },
    };
}

/**
 * Decodes an NMEA coordinate from `DDmm.mmmm` (lat) or `DDDmm.mmmm` (lon)
 * to decimal degrees. Sign is inverted for S/W.
 * The integer part divided by 100 gives degrees; the remainder (two digits +
 * fraction) is minutes.
 *
 * Exported for reuse in vendor plugins whose format is not NMEA as a whole
 * but whose coordinates use the same DDMM.MMMM notation (e.g. Escort).
 */
export function parseNmeaCoord(value: string, dir: string): number | null {
    if (value === "") return null;
    const num = Number(value);
    if (!Number.isFinite(num)) return null;
    const deg = Math.floor(num / 100);
    const minutes = num - deg * 100;
    let result = deg + minutes / 60;
    if (dir === "S" || dir === "W") result = -result;
    else if (dir !== "N" && dir !== "E") return null;
    return result;
}

/**
 * Converts NMEA `hhmmss.ss` (UTC) + `ddmmyy` to unix seconds UTC.
 * Two-digit year: <70 → 2000+, >=70 → 1900+ (covers all post-2000 dashcams).
 */
function parseNmeaTimestamp(timeStr: string, dateStr: string): number | null {
    if (timeStr.length < 6 || dateStr.length !== 6) return null;
    const hh = Number(timeStr.slice(0, 2));
    const mm = Number(timeStr.slice(2, 4));
    const ss = Number(timeStr.slice(4, 6));
    // Sub-second fraction after the dot is optional.
    const fracStr = timeStr.length > 6 && timeStr[6] === "." ? timeStr.slice(6) : "";
    const frac = fracStr === "" ? 0 : Number(fracStr);

    const dd = Number(dateStr.slice(0, 2));
    const mo = Number(dateStr.slice(2, 4));
    const yy = Number(dateStr.slice(4, 6));
    const year = yy < 70 ? 2000 + yy : 1900 + yy;

    if (![hh, mm, ss, dd, mo, yy].every(Number.isFinite)) return null;
    if (!Number.isFinite(frac)) return null;
    // Range validation: without it a corrupt sentence (month "99", hour "31")
    // silently rolls over into a wrong-but-plausible date instead of being
    // skipped - same contract as the filename-time techniques.
    if (mo < 1 || mo > 12 || dd < 1 || dd > 31) return null;
    if (hh > 23 || mm > 59 || ss > 60) return null; // ss=60: leap second

    const ms = Date.UTC(year, mo - 1, dd, hh, mm, ss);
    if (!Number.isFinite(ms)) return null;
    return ms / 1000 + frac;
}

// Exported for unit tests.
export const _internal = { parseNmeaCoord, parseNmeaTimestamp, parseRmc };

// Deduplicates records by unixSeconds, keeping the first in each group.
// BlackVue files can emit $GPRMC and $GNRMC with the same ms timestamp (different
// talker IDs, same GPS fix); we want exactly one record per point.
export function dedupByUnixSeconds(records: GpsRecord[]): GpsRecord[] {
    const seen = new Set<number>();
    const out: GpsRecord[] = [];
    for (const r of records) {
        if (seen.has(r.unixSeconds)) continue;
        seen.add(r.unixSeconds);
        out.push(r);
    }
    return out;
}
