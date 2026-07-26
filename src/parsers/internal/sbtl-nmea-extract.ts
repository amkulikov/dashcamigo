// Subtitle/text-track GPS extraction. The GPS/G-sensor telemetry rides in a
// subtitle track (handler 'sbtl'/'text'/'meta') as one text cue per sample.
// Three firmware dialects exist in the wild, all handled here:
//
//  1. Thinkware gsensori dialect (F200 PRO, F800 Pro). One cue =
//       "gsensori,<range>,<sens>,X,Y,Z;GxRMC,<fields>*cc;CAR,<obd>"
//     - segments separated by ';' (sometimes "; "), the RMC sentence ends with
//       a stray CRLF before ";CAR";
//     - NMEA has NO leading '$' (GPRMC/GNRMC bare token);
//     - accel is "gsensori,<range>,<sens>,X,Y,Z" where <sens> is the divisor in
//       counts-per-g (512 for ±4g, 256 for ±8g - MMA8452Q-class sensitivity);
//       X/Y/Z are signed counts, g = count/<sens>. The three values behave as a
//       gravity-removed (dynamic) channel (observed magnitude ~0.25g while
//       driving, no axis near ±1g), matching the GpsRecord accel contract.
//       Caveat: gravity-removal is inferred from driving samples, not a proven
//       stationary clip; if a future at-rest sample reads ~±<sens> on one axis,
//       the firmware is gravity-included and the baseline must be subtracted.
//     - "CAR,..." is an opaque OBD-II channel (all-zeros without an adapter) -
//       ignored.
//  2. legacy '$'-prefixed dialect (older Thinkware F770/F750 and the synthetic
//     fixture): "$GxRMC" / "$GSENSOR" sentences separated by \0. Reusing
//     parseRmc + applyGsensor keeps this path working without a separate code
//     branch.
//  3. Mini 0806 (Ambarella) CSV dialect - see parseMini0806 below. Implemented
//     from foreign source (ExifTool v13.59 QuickTimeStream.pl:1232-1248), not
//     validated against a real sample.
//
// Thinkware note: GPS appears only in the FRONT file (REC_..._F.MP4). The real
// F200 PRO rear carries NO subtitle track at all (a track with accel-only cues
// would equally yield no records and make the primitive throw WrongFormatError,
// swallowed by the dispatcher) - the rear contributes no embedded GPS. There is
// NO front->rear clone here (no cloneAcrossGroup, unlike juscar): the trip's
// track comes entirely from the front file via Trip.records pooling. That
// pooling only works while the channels GROUP into one frame, which is not a
// given: the GPS-less rear anchors its startUtc through the mvhd/TZ estimate
// branches of deriveStartUtc while the front anchors GPS-validated, and a
// camera whose clocks disagree past the frame snap tears the channels apart
// (the BlackVue DR550DW bug class, fixed there by cloneRecordsAcrossChannels).
// On this camera the anchors agree: mvhd is stamped at recording start in the
// camera's local clock and the RTC tracks GPS to ~1 s - pinned by the real
// front+rear pair test (__fixtures__/thinkware/real-anonymized-pair.test.ts).

import type { GpsRecord, ParsedRecords, SkippedLine, VendorFile } from "../types.js";
import { subtractAxisMean, type Vec3 } from "./accel-baseline.js";
import { applyGsensor, dedupByUnixSeconds, parseNmeaCoord, parseRmc } from "./nmea.js";
import { getFirstSampleOfTrack, loadTrackSampleBuffers, type Mp4Index, type TrackInfo } from "./mp4-index.js";

const SBTL_HANDLERS: readonly string[] = ["sbtl", "text", "meta"];

// Marker signatures, checked against the first sample of a subtitle track:
//  - "gsensori," is the Thinkware G-sensor tag, present in EVERY cue (~10 Hz),
//    so it is found even before the GPS fix lands (the first ~1 s of cues carry
//    accel but no RMC). Boundary: start / ';' / '\0' / whitespace.
//  - an RMC sentence with or without '$' and a digit time field, for the legacy
//    dialect whose first cue is already a "$GxRMC". Boundary additionally allows
//    '$' and ',' so a "...;GPRMC,..." token after a leading "$" or comma matches.
// Both boundaries stop the probe from matching the inside of an unrelated word.
const THINKWARE_GSENSOR_SIG = /(^|[;\0\s])gsensori,/;
const NMEA_RMC_SIG = /(^|[;\0\s$,])G[A-Z]RMC,\d/;
// Mini 0806 CSV dialect: "A,DDMMYY,HHMMSS.sss,..." anchored at the start of
// the (tx3g-stripped) cue, exactly like ExifTool anchors on the raw sample
// data (QuickTimeStream.pl:1234, v13.59). The 'A' is the NMEA-style fix status;
// a hypothetical no-fix 'V' line would not match and yields no record - the
// same silent-void behavior as parseRmc. Anchor + two fixed-width digit fields
// keep this from claiming gsensori ("gsensori,...") or RMC ("$GxRMC,...") cues.
// LIMITATION: findNmeaSubtitleTrack probes only the FIRST sample of a track,
// while ExifTool scans every sample. Nothing is known about the Mini 0806's
// pre-GPS-fix cues - if real firmware writes something else before lock, the
// marker would miss the file. Re-verify against the first real sample.
const MINI0806_SIG = /^A,\d{6},\d{6}(\.\d+)?,/;

function hasGpsTelemetrySignature(text: string): boolean {
    return THINKWARE_GSENSOR_SIG.test(text) || NMEA_RMC_SIG.test(text) || MINI0806_SIG.test(text);
}

// tx3g / QuickTime-text subtitle samples are framed as a uint16-BE text length
// followed by the UTF-8 text (and optional trailing style boxes). Strip that
// prefix when it is self-consistent; otherwise return the bytes untouched (the
// legacy '$'-prefixed dialect and the old synthetic fixture write raw text with
// no length prefix, where the first two bytes are NMEA characters, not a
// matching length).
function stripSubtitleTextPrefix(bytes: Uint8Array): Uint8Array {
    if (bytes.length >= 2) {
        const declaredLen = (bytes[0]! << 8) | bytes[1]!;
        if (declaredLen > 0 && declaredLen <= bytes.length - 2) {
            return bytes.subarray(2, 2 + declaredLen);
        }
    }
    return bytes;
}

// Same strip with upstream's exact rule (declared length == payload length,
// QuickTimeStream.pl:1480). Used only to decide the E-PRANCE cipher gate: that
// gate keys on a leading NUL, so it must see the text without the length
// prefix, yet a cue whose length only *looks* prefixed (a raw text sample whose
// second byte happens to fit) must reach the gate whole.
function stripExactTextPrefix(bytes: Uint8Array): Uint8Array {
    if (bytes.length >= 2 && ((bytes[0]! << 8) | bytes[1]!) === bytes.length - 2) {
        return bytes.subarray(2);
    }
    return bytes;
}

// ===== Obfuscated text dialects (ExifTool Process_text pre-steps) =====
//
// Two cameras scramble the cue before writing it. Both descramble into an
// ordinary RMC sentence, so they are undone here and the rest of the pipeline
// never learns about them.
//
// Each decoder self-verifies and returns null on mismatch: the cue is only
// replaced when the result actually looks like the telemetry it claims to be.
// That matters because both gates are shape-based (a trailing `*XX~`, a
// leading NUL) and would otherwise mangle an unrelated cue into garbage.

/**
 * Roadhawk substitution table: cue bytes are offset by 43 and looked up here
 * (ExifTool 13.55 QuickTimeStream.pl:1257). The table round-trips upstream's
 * own verbatim sample, which the tests pin.
 */
const ROADHAWK_TABLE = "-I8XQWRVNZOYPUTA0B1C2SJ9K.L,M$D3E4F5G6H7";
const ROADHAWK_CUE_SIG = /\*[0-9A-F]{2}~$/;
/** Decoded shape: the accelerometer prefix ahead of the RMC sentence. */
const ROADHAWK_DECODED_SIG = /X(.*?)Y(.*?)Z(.*?)G(.*?)\$/;
const ROADHAWK_ACCEL_SIG = /^X(-?[\d.]+)Y(-?[\d.]+)Z(-?[\d.]+)G(-?[\d.]+)$/;
/**
 * Deciphered E-PRANCE shape: an arbitrary RawGSensor prefix, then the sentence
 * (upstream's `/^(.*?)(\$[A-Z]{2}RMC.*)/s`). Doubles as the decoder's
 * self-check, so an unrelated NUL-led cue is not mangled into garbage.
 */
const EPRANCE_DECODED_SIG = /^(.*?)(\$[A-Z]{2}RMC.*)$/s;
/** RawGSensor prefix: three whitespace-separated milli-g values. */
const EPRANCE_ACCEL_SIG = /^-?\d+(?:\.\d+)?(?:\s+-?\d+(?:\.\d+)?){2}$/;

function decodeRoadhawkCue(text: string): string | null {
    if (!ROADHAWK_CUE_SIG.test(text)) return null;
    let decoded = "";
    // Upstream drops the trailing `*XX~` before decoding.
    for (const ch of text.slice(0, -4)) {
        const n = ch.charCodeAt(0) - 43;
        decoded += n >= 0 && n < ROADHAWK_TABLE.length ? ROADHAWK_TABLE[n] : ch;
    }
    if (!ROADHAWK_DECODED_SIG.test(decoded)) return null;
    // Split the accel prefix off the sentence with a delimiter this file
    // already understands, so both halves arrive as their own segment.
    return decoded.replace("$", ";$");
}

/**
 * E-PRANCE B47FS difference cipher (ExifTool 13.55 QuickTimeStream.pl:1485-1498).
 * The key is recovered from known plaintext: the 4th-from-last character of a
 * cue is always the NMEA checksum's `*`. Upstream deciphers everything between
 * the leading NUL and the trailing newline, then splits the result into a
 * RawGSensor prefix and the RMC sentence and keeps only the sentence as text.
 * The two halves are rejoined with ';' here so each arrives as its own segment,
 * the way the Roadhawk dialect does it.
 *
 * `bytes` must already have the tx3g length prefix removed - the leading-NUL
 * gate would otherwise fire on that prefix's high byte.
 * Returns null when the deciphered cue is not an RMC sentence (upstream leaves
 * such a cue untouched too).
 */
function decodeEpranceCue(bytes: Uint8Array): string | null {
    if (bytes.length <= 5) return null;
    if (bytes[0] !== 0x00) return null;
    if (bytes[bytes.length - 1] !== 0x0a) return null;
    const shift = (0x2a - bytes[bytes.length - 4]!) & 0xff;
    // Shift 0 means the '*' already sits at the key position, i.e. this is a
    // plain NMEA cue and not ciphertext at all - "deciphering" it would only
    // shave off its first and last byte.
    if (shift === 0) return null;
    let decoded = "";
    for (let i = 1; i < bytes.length - 1; i++) decoded += String.fromCharCode((bytes[i]! + shift) & 0xff);
    const split = decoded.match(EPRANCE_DECODED_SIG);
    if (!split) return null;
    // Upstream maps TAB to space before RawGSensor's ValueConv splits on
    // whitespace, so the accel parser downstream sees one shape.
    const rawGSensor = split[1]!.replace(/\t/g, " ").trim();
    return rawGSensor.length > 0 ? `${rawGSensor};${split[2]!}` : split[2]!;
}

/**
 * E-PRANCE RawGSensor prefix -> g triple. Upstream's ValueConv splits the
 * prefix on whitespace and divides by 1000 (QuickTimeStream.pl:154-157), i.e.
 * the fields are milli-g. Three axes; any other shape is not accel.
 */
function parseEpranceAccel(segment: string): Vec3 | null {
    if (!EPRANCE_ACCEL_SIG.test(segment)) return null;
    const [x, y, z] = segment.split(/\s+/).map(Number);
    return { x: x! / 1000, y: y! / 1000, z: z! / 1000 };
}

/** Roadhawk accel prefix -> g triple. The 4th field is the magnitude, dropped. */
function parseRoadhawkAccel(segment: string): Vec3 | null {
    const m = segment.match(ROADHAWK_ACCEL_SIG);
    if (!m) return null;
    const x = Number(m[1]);
    const y = Number(m[2]);
    const z = Number(m[3]);
    if (![x, y, z].every(Number.isFinite)) return null;
    return { x, y, z };
}

function decodeCue(bytes: ArrayBuffer | Uint8Array): string {
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    // The length prefix goes first, like upstream (QuickTimeStream.pl:1480-1485).
    // Order is load-bearing: every tx3g cue under 256 bytes has 0x00 as its
    // high length byte, so testing the raw sample would let the E-PRANCE gate
    // claim any ordinary LF-terminated NMEA cue - whose checksum '*' sits
    // exactly at the key position - and hand back a mangled sentence.
    const eprance = decodeEpranceCue(stripExactTextPrefix(u8));
    if (eprance !== null) return eprance;
    const text = new TextDecoder("latin1").decode(stripSubtitleTextPrefix(u8));
    return decodeRoadhawkCue(text) ?? text;
}

/**
 * Finds the first subtitle/text/meta track whose first sample carries GPS
 * telemetry (a gsensori tag, an RMC sentence, or a Mini 0806 CSV line).
 * Returns null if none.
 */
export async function findNmeaSubtitleTrack(vf: VendorFile, index: Mp4Index): Promise<TrackInfo | null> {
    for (const t of index.tracks) {
        if (!t.handlerType || !SBTL_HANDLERS.includes(t.handlerType)) continue;
        const sample = await getFirstSampleOfTrack(index, t, vf);
        if (!sample) continue;
        // Strip the tx3g length prefix, then test the ASCII telemetry signature.
        if (hasGpsTelemetrySignature(decodeCue(sample))) return t;
    }
    return null;
}

// Splits one subtitle cue into segments. Both dialects use single-char
// delimiters: ';' (gsensori dialect, plus the stray CRLF before ";CAR") and
// '\0' (legacy dialect). Empty segments and surrounding whitespace are dropped.
function splitCueSegments(text: string): string[] {
    return text
        .split(/[;\0\r\n]+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
}

// Decodes a "gsensori,<range>,<sens>,X,Y,Z" segment into g (count / <sens>).
// <sens> (field 2) is the counts-per-g divisor, embedded inline so the scale
// never has to be guessed. Returns null on a malformed segment.
function parseGsensori(segment: string): Vec3 | null {
    const parts = segment.split(",");
    if (parts.length < 6) return null;
    // Number("") is 0, which would slip an empty/truncated field through the
    // isFinite guard as a real 0g; treat empty as NaN so it is rejected instead
    // (mirrors applyGsensor in nmea.ts - one PR should not split that contract).
    const toNum = (s: string): number => (s === "" ? Number.NaN : Number(s));
    const sens = toNum(parts[2]!);
    const x = toNum(parts[3]!);
    const y = toNum(parts[4]!);
    const z = toNum(parts[5]!);
    if (!Number.isFinite(sens) || sens <= 0) return null;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
    return { x: x / sens, y: y / sens, z: z / sens };
}

// Standard gravity for the Mini 0806 m/s2 -> g conversion.
const STANDARD_GRAVITY_MS2 = 9.80665;

type Mini0806Result = { record: GpsRecord; accelG: Vec3 | null } | { error: string };

// Mini 0806 (Ambarella) text-track dialect. One cue = one CSV line, e.g. the
// verbatim ExifTool example (QuickTimeStream.pl:1233, v13.59):
//   "A,270519,201555.000,3356.8925,N,08420.2071,W,000.0,331.0M,+01.84,-09.80,-00.61;\n"
// Field layout per ExifTool QuickTimeStream.pl:1232-1248 (v13.59):
//   [0] "A"  fix status (checked by MINI0806_SIG before this is called)
//   [1] date DDMMYY - the century is a hard "20"+YY prefix in ExifTool
//       ("20$3", line 1235), NOT a 70-pivot like RMC
//   [2] time HHMMSS(.sss) UTC
//   [3] lat DDmm.mmmm    [4] N/S
//   [5] lon DDDmm.mmmm   [6] E/W
//   [7] speed - ExifTool assigns it to GPSSpeed (its km/h convention) with an
//       "(NC)" not-confirmed mark; we follow that guess (km/h -> m/s). The
//       example shows 000.0 at rest, which fits any unit - re-verify against
//       the first real moving sample.
//   [8] altitude with a trailing 'M' ("331.0M") - ignored, GpsRecord carries
//       no altitude
//   [9..11] accel, raw m/s2 gravity-INCLUDED: the at-rest example reads
//       (+01.84, -09.80, -00.61) = magnitude ~9.99. Converted to g here; the
//       caller routes it through removeGsensoriBaseline so the gravity+tilt
//       baseline is subtracted and the GpsRecord contract (~0 at rest) holds.
// Implemented from foreign source (ExifTool v13.59 QuickTimeStream.pl:1232-1248),
// not validated against a real sample.
//
// Assumes MINI0806_SIG already matched `segment` (guarantees the fixed-width
// date/time shape). Returns { error } when the matched line is malformed -
// strict on time/coords/speed (a skipped-line diagnostic beats a silently
// wrong fix), lenient on accel (missing/garbled accel keeps the GPS fix with
// zeros, mirroring the gsensori path where parseGsensori returns null).
function parseMini0806(segment: string, mp4Filename: string): Mini0806Result {
    const parts = segment.split(",");
    // Fields through speed [7] are required; altitude/accel are optional.
    if (parts.length < 8) return { error: "mini0806: too few fields" };

    const dd = Number(parts[1]!.slice(0, 2));
    const mo = Number(parts[1]!.slice(2, 4));
    const yy = Number(parts[1]!.slice(4, 6));
    const hh = Number(parts[2]!.slice(0, 2));
    const mi = Number(parts[2]!.slice(2, 4));
    const ss = Number(parts[2]!.slice(4, 6));
    const fracStr = parts[2]!.slice(6); // "" or ".sss" (shape enforced by the signature)
    const frac = fracStr === "" ? 0 : Number(fracStr);
    // Range validation: without it a corrupt line (month 13, hour 31) rolls
    // over into a wrong-but-plausible date instead of being skipped - same
    // contract as parseNmeaTimestamp in nmea.ts.
    if (mo < 1 || mo > 12 || dd < 1 || dd > 31) return { error: "mini0806: bad date" };
    if (hh > 23 || mi > 59 || ss > 60 || !Number.isFinite(frac)) return { error: "mini0806: bad time" };
    const unixSeconds = Date.UTC(2000 + yy, mo - 1, dd, hh, mi, ss) / 1000 + frac;

    // ExifTool requires [NS] for lat and [EW] for lon (lines 1236-1241); check
    // the pairing explicitly because parseNmeaCoord accepts any of N/S/E/W.
    if (parts[4] !== "N" && parts[4] !== "S") return { error: "mini0806: bad latitude hemisphere" };
    if (parts[6] !== "E" && parts[6] !== "W") return { error: "mini0806: bad longitude hemisphere" };
    const lat = parseNmeaCoord(parts[3]!, parts[4]);
    const lon = parseNmeaCoord(parts[5]!, parts[6]);
    if (lat === null || lon === null) return { error: "mini0806: bad coordinates" };

    // Digits-only like ExifTool's /^\d+\.\d+$/ guard (line 1244), with the
    // fraction made optional; km/h -> m/s per the (NC) convention above.
    if (!/^\d+(\.\d+)?$/.test(parts[7]!)) return { error: "mini0806: bad speed" };
    const speedMs = Number(parts[7]!) / 3.6;

    // Accel [9..11]; the last field carries the line terminator (";\n") when
    // the segment was not pre-split - strip it like ExifTool's s/;\s*$//.
    let accelG: Vec3 | null = null;
    if (parts.length >= 12) {
        const toNum = (s: string): number => (s === "" ? Number.NaN : Number(s));
        const x = toNum(parts[9]!);
        const y = toNum(parts[10]!);
        const z = toNum(parts[11]!.replace(/;\s*$/, ""));
        if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
            accelG = { x: x / STANDARD_GRAVITY_MS2, y: y / STANDARD_GRAVITY_MS2, z: z / STANDARD_GRAVITY_MS2 };
        }
    }

    return {
        record: {
            unixSeconds,
            active: true,
            lat,
            lon,
            bearingDeg: 0, // format carries no course field; dispatcher forward-fills from trajectory
            speedMs,
            accelXg: 0,
            accelYg: 0,
            accelZg: 0,
            mp4Filename,
        },
        accelG,
    };
}

// Subtracts the mean of `samples` (all cues' accel) from each record's accel,
// in place. No-op without records, or with <2 samples: a single observation
// cannot separate the static bias from motion, so subtracting it would zero the
// only reading we have (better to keep the raw sub-threshold value than emit a
// spurious 0). Legacy dialect / no accelerometer also leaves `samples` empty.
function removeGsensoriBaseline(records: GpsRecord[], samples: Vec3[]): void {
    if (samples.length < 2 || records.length === 0) return;
    subtractAxisMean(records, samples);
}

/**
 * Extracts GPS records from a Thinkware subtitle track. Iterates every cue,
 * pairing the accel that shares a cue with its GPS fix. Returns null when the
 * track holds no valid RMC (e.g. a rear channel with accel but no GPS).
 */
export async function extractFromNmeaSubtitleTrack(
    vf: VendorFile,
    index: Mp4Index,
    track: TrackInfo,
): Promise<ParsedRecords | null> {
    const sampleBuffers = await loadTrackSampleBuffers(vf.file, index, track);
    if (!sampleBuffers) return null;

    const records: GpsRecord[] = [];
    const skipped: SkippedLine[] = [];
    // Baseline-removal inputs, fed by every dialect that carries accel except
    // the legacy "$GSENSOR" path (already gravity-removed, leaves them empty).
    // The static per-file bias (mounting tilt for gsensori, gravity+tilt for the
    // gravity-included dialects) is common to EVERY cue, so we estimate it from
    // all accel samples - for gsensori that is the ~10 Hz cue stream, a far more
    // stable mean than the ~1 Hz GPS-anchored subset - and subtract it from just
    // the records that carry an accel (baselineAccelRecords). The two arrays may
    // differ in length by design: gsensori cues often have accel but no GPS fix.
    const baselineAccelSamples: Vec3[] = [];
    const baselineAccelRecords: GpsRecord[] = [];
    // Set by the dialects whose accel is gravity-INCLUDED raw data (Mini 0806,
    // Roadhawk, E-PRANCE), so the baseline-skipped (<2 samples) edge case can be
    // zeroed below instead of leaking a ~1g floor.
    let gravityIncludedAccelSeen = false;
    // Trailing-accel target for the legacy "$GSENSOR" dialect (sequence is
    // RMC -> GSENSOR). Persists across cues since a $GSENSOR may follow its RMC
    // in the next sample. lastRecord is set by EVERY emitted RMC (gsensori ones
    // too), but that coupling is benign: a track carries exactly one dialect
    // (one firmware generation writes it), so a $GSENSOR never lands after a
    // gsensori-decoded record to overwrite its count/<sens> accel at the wrong
    // wrap10/1024 scale - the two dialects do not co-occur in a real file.
    let lastRecord: GpsRecord | null = null;
    // Sticky once a "$GSENSOR" line shows explicit '-' (Vicovation-style signed).
    let gsensorMode: "wrap10" | "signed-direct" = "wrap10";

    for (let i = 0; i < sampleBuffers.length; i++) {
        const text = decodeCue(sampleBuffers[i]!);
        // Leading-accel for the gsensori dialect: gsensori precedes its RMC in
        // the SAME cue, so scope the pending accel to this cue only.
        let pendingAccel: { x: number; y: number; z: number } | null = null;

        for (const segment of splitCueSegments(text)) {
            if (segment.startsWith("gsensori,")) {
                pendingAccel = parseGsensori(segment);
                if (pendingAccel) baselineAccelSamples.push(pendingAccel);
                continue;
            }
            // Roadhawk writes its accel as an `X..Y..Z..G..` prefix ahead of the
            // sentence in the same cue - leading-accel, exactly like gsensori.
            // Gravity is included (a resting sample reads Z ~ 1), so it joins
            // the same per-file baseline estimate.
            if (segment.startsWith("X")) {
                const roadhawkAccel = parseRoadhawkAccel(segment);
                if (roadhawkAccel) {
                    pendingAccel = roadhawkAccel;
                    baselineAccelSamples.push(roadhawkAccel);
                    gravityIncludedAccelSeen = true;
                    continue;
                }
            }
            // E-PRANCE writes its accel the same way: a milli-g triple ahead of
            // the sentence, split off by the cipher decoder. Gravity-included.
            const epranceAccel = parseEpranceAccel(segment);
            if (epranceAccel) {
                pendingAccel = epranceAccel;
                baselineAccelSamples.push(epranceAccel);
                gravityIncludedAccelSeen = true;
                continue;
            }
            // Mini 0806 CSV line - a self-contained record, checked before the
            // RMC fall-through (an "A,..." token can never be an RMC sentence).
            // Does NOT set lastRecord: the accel is inline, so a (hypothetical)
            // stray "$GSENSOR" must not overwrite it - dialects do not co-occur
            // in a real file anyway, see the lastRecord comment above.
            if (MINI0806_SIG.test(segment)) {
                const mini = parseMini0806(segment, vf.file.name);
                if ("error" in mini) {
                    skipped.push({ line: i + 1, raw: `<sbtl sample ${i + 1}>: ${segment}`, reason: mini.error });
                    continue;
                }
                if (mini.accelG) {
                    mini.record.accelXg = mini.accelG.x;
                    mini.record.accelYg = mini.accelG.y;
                    mini.record.accelZg = mini.accelG.z;
                    baselineAccelSamples.push(mini.accelG);
                    baselineAccelRecords.push(mini.record);
                    gravityIncludedAccelSeen = true;
                }
                records.push(mini.record);
                continue;
            }
            if (segment.startsWith("$GSENSOR,")) {
                // Legacy dialect: explicit '-' flips to signed-direct for the
                // rest of the track (sticky), mirroring parseNmeaText.
                if (gsensorMode === "wrap10" && /,-\d/.test(segment)) {
                    gsensorMode = "signed-direct";
                }
                if (lastRecord) applyGsensor(segment, lastRecord, gsensorMode);
                continue;
            }
            // RMC sentence, with or without '$' (Thinkware bare token). After
            // dropping any '$', the token is `GxRMC` (talker `GP`/`GN`/... + RMC),
            // so "RMC" sits at offset 2.
            const rmcStart = segment.startsWith("$") ? segment.slice(1) : segment;
            if (rmcStart.length < 6 || rmcStart.slice(2, 5) !== "RMC") continue;

            // Strip the `*XX` checksum (not validated - a corrupt checksum with
            // valid data is better kept than dropped).
            const star = rmcStart.lastIndexOf("*");
            const body = star > 0 ? rmcStart.slice(0, star) : rmcStart;

            const parsed = parseRmc(body, vf.file.name, null);
            if ("error" in parsed) {
                skipped.push({ line: i + 1, raw: `<sbtl sample ${i + 1}>: ${segment}`, reason: parsed.error });
                continue;
            }
            if (parsed.record) {
                if (pendingAccel) {
                    parsed.record.accelXg = pendingAccel.x;
                    parsed.record.accelYg = pendingAccel.y;
                    parsed.record.accelZg = pendingAccel.z;
                    baselineAccelRecords.push(parsed.record);
                }
                records.push(parsed.record);
                lastRecord = parsed.record;
            }
        }
    }

    // Every accel-carrying dialect here has a static per-file baseline (mounting
    // tilt for gsensori plus any residual gravity the firmware did not fully
    // remove; full gravity+tilt for Mini 0806, Roadhawk and E-PRANCE). The
    // GpsRecord accel contract is gravity-removed / ~0 at rest, and a non-zero
    // floor would eat into the 0.5g brake-detection headroom. Subtracting the
    // per-file mean recenters the dynamic signal at 0 and is robust whether the
    // floor is tilt bias or (residual or full) gravity. The legacy "$GSENSOR"
    // path is the one exception - already gravity-removed, so it leaves
    // baselineAccelSamples empty. Caveat: this is a DC-block, not a true
    // high-pass - it assumes the dynamic component averages to ~0 over the file.
    // A single sustained one-directional accel spanning most of the clip would
    // be partly absorbed into the mean and damped; physically implausible for a
    // multi-minute drive, but noted so "recenters at 0" is not read as a
    // guarantee for that pathological case.
    removeGsensoriBaseline(baselineAccelRecords, baselineAccelSamples);
    // Gravity-included dialects only: when the baseline could not be estimated
    // (<2 samples, removeGsensoriBaseline no-ops), the raw value still holds
    // ~1g of gravity and would fire the impact detector on the only record -
    // zero it instead (the policy removeGravityBaselineOrZero applies in
    // accel-baseline.ts). The gsensori dialect deliberately keeps its raw value
    // in that case (near-dynamic already, see removeGsensoriBaseline); dialects
    // do not co-occur in one file, so zeroing all baselineAccelRecords here
    // never touches a gsensori record.
    if (gravityIncludedAccelSeen && baselineAccelSamples.length < 2) {
        for (const r of baselineAccelRecords) {
            r.accelXg = 0;
            r.accelYg = 0;
            r.accelZg = 0;
        }
    }

    if (records.length === 0) return null;

    return {
        records: dedupByUnixSeconds(records),
        skipped,
    };
}

// Exported for unit tests. The three signature regexes are exposed
// individually so the cross-dialect negative matrix (new dialect not claimed
// by old signatures and vice versa) can be asserted per-signature.
export const _internal = {
    decodeCue,
    parseRoadhawkAccel,
    parseEpranceAccel,
    stripSubtitleTextPrefix,
    splitCueSegments,
    parseGsensori,
    parseMini0806,
    removeGsensoriBaseline,
    hasGpsTelemetrySignature,
    THINKWARE_GSENSOR_SIG,
    NMEA_RMC_SIG,
    MINI0806_SIG,
};
