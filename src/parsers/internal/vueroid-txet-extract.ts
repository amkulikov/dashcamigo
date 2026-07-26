// Vueroid TXET track GPS+accel extraction (Vueroid S1 4K "Infinite" and
// compatible firmware). GPS lives in a dedicated track with handler 'tvxt'
// and stsd sample-format 'mp4s', constant 72-byte binary samples at ~20 Hz
// (1192 samples per 60 s clip). The file head also carries top-level `free`
// boxes whose payload starts with "RECO" (config blobs tagged 1cva / TXET) -
// they corroborate the format but the structural track gate below is strict
// enough on its own, and header bytes are not always probed.
//
// Reverse-engineered from two real S1 4K Infinite clips (2384 samples); no
// public spec exists. Sample layout (all little-endian):
//   [0x00..0x28)  reserved - all zeros in the observed corpus
//   0x28  f32  accel axis A ("g"-like unit, gravity-included; see below)
//   0x2c  f32  accel axis B
//   0x30  f32  accel axis C
//   0x34  u8   read as lat hemisphere: 1 = N, 0 = S (ASSUMPTION - below)
//   0x35  u8   read as lon hemisphere: 1 = E, 0 = W (ASSUMPTION - below)
//   0x36  u16  altitude, meters (not emitted - GpsRecord has no altitude)
//   0x38  f32  speed, km/h (verified: haversine-of-coords ratio 0.98)
//   0x3c  f32  latitude, NMEA DDmm.mmmm, unsigned
//   0x40  f32  longitude, NMEA DDDmm.mmmm, unsigned
//   0x44  u32  camera-local wall clock stored as fake unix-UTC, 1 Hz
//              granularity (equals the local filename time and the mvhd
//              creation_time, which for the verified clips is provably NOT
//              UTC - a "day" recording at 08:54 in lon ~-121 territory)
//
// Coordinates and the clock field advance at 1 Hz; accel and speed carry
// real ~20 Hz dynamics. The last sample of every observed clip is a fully
// zeroed terminator row.
//
// HEMISPHERE ASSUMPTION (single-hemisphere corpus): every fix row in the
// corpus has (0x34, 0x35) = (1, 0) and the sample region is N/W, matching
// "1=N, 0=W". But the zeroed terminator rows carry (0, 0), so the pair is
// equally consistent with a u16 fix-status field that we never need (no-fix
// rows are already skipped via zero coordinates). Nothing else in the file
// (freeRECO config boxes, stsd esds, the other 70 bytes) carries a
// hemisphere. REVALIDATE on the first S- or E-hemisphere sample (Vueroid is
// a Korean brand - a domestic clip is N/E): if such a clip decodes to a
// negative longitude, byte 0x35 is not "east" and this mapping is wrong.
//
// Accel: the three floats are quantized to 1/256 and show ~20 Hz dynamics
// that correlate with the speed derivative, but the static (gravity) vector
// magnitude is ~0.6-0.67 rather than 1.0, so the absolute scale is NOT
// confirmed as g. We keep the values as-is and remove the static component
// with the shared per-file mean subtraction (accel-baseline.ts) - the
// magnitude-based brake detector then sees a zero floor at rest and
// plausible sub-g dynamics; axis-to-vehicle mapping stays unknown (harmless:
// downstream consumes the magnitude).

import { KMH_TO_MS } from "../types.js";
import type { GpsRecord, ParsedRecords, SkippedLine, VendorFile } from "../types.js";
import { subtractAxisMean, type Vec3 } from "./accel-baseline.js";
import { ddmmToDegrees } from "./ddmm.js";
import type { Mp4Index, TrackInfo } from "./mp4-index.js";
import { loadSamples, readMediaTimescale, readSampleStartsInTicks, readSampleTable } from "./mp4-walker.js";

/** Constant sample size - the structural gate alongside handler/format. */
export const VUEROID_TXET_SAMPLE_SIZE = 72;

const OFF_ACCEL = 0x28;
const OFF_LAT_NORTH = 0x34;
const OFF_LON_EAST = 0x35;
// 0x36 u16 altitude - documented above, intentionally not read.
const OFF_SPEED_KMH = 0x38;
const OFF_LAT_DDMM = 0x3c;
const OFF_LON_DDMM = 0x40;
const OFF_LOCAL_UNIX = 0x44;

// Clock plausibility window for the content gate: the structural signature
// (a 72-byte data track) is not unique enough on its own, so a row whose
// wall-clock lands outside the century is treated as alien content.
const MIN_PLAUSIBLE_UNIX = Date.UTC(2000, 0, 1) / 1000;
const MAX_PLAUSIBLE_UNIX = Date.UTC(2100, 0, 1) / 1000;

// A dashcam that reports faster than this is broken data, not a car.
const MAX_PLAUSIBLE_SPEED_KMH = 1000;

/**
 * Returns the Vueroid TXET candidate track: handler 'tvxt', sample-format
 * 'mp4s', non-empty sample table where EVERY sample is exactly 72 bytes.
 * 'tvxt' is a non-standard handler type not used by any other known format,
 * and 'mp4s' alone is generic - the pair plus the constant size is the gate.
 * null when absent.
 */
export function findVueroidTxetTrack(index: Mp4Index): TrackInfo | null {
    if (!index.moovView) return null;
    for (const t of index.tracks) {
        if (t.handlerType !== "tvxt" || t.sampleFormat !== "mp4s") continue;
        const samples = readSampleTable(index.moovView, t.trakBox);
        if (!samples || samples.length === 0) continue;
        if (!samples.every((s) => s.size === VUEROID_TXET_SAMPLE_SIZE)) continue;
        return t;
    }
    return null;
}

/** Decoded fields of one plausible fix row (before baseline removal). */
interface DecodedRow {
    lat: number;
    lon: number;
    /** 0 when the speed float is garbage on an otherwise valid row. */
    speedMs: number;
    /** True when the speed float passed the strict plausibility check -
     *  the content gate for claiming counts only such rows. */
    speedValid: boolean;
    /** Camera-local wall clock; null when outside the plausible century
     *  (dead-RTC row) - the caller decides between a per-row skip and the
     *  whole-file media-time fallback. */
    localUnix: number | null;
    accel: Vec3;
}

/**
 * Decodes one 72-byte row. Returns:
 *   - "zero" for the zeroed no-fix/terminator row (lat and lon raw both 0) -
 *     routine, skipped silently by the caller;
 *   - null when the coordinate/hemisphere fields fail plausibility (alien
 *     content or corruption) - a garbage speed or clock alone does NOT
 *     reject the row: the coordinate is still valid, so those fields
 *     degrade (speedMs 0 / localUnix null) instead;
 *   - the decoded fields otherwise.
 */
export function decodeVueroidTxetRow(dv: DataView): DecodedRow | "zero" | null {
    if (dv.byteLength !== VUEROID_TXET_SAMPLE_SIZE) return null;

    const latRaw = dv.getFloat32(OFF_LAT_DDMM, true);
    const lonRaw = dv.getFloat32(OFF_LON_DDMM, true);
    // Zeroed row: GPS not fixed yet, or the end-of-clip terminator the
    // firmware writes as the last sample of every observed clip.
    if (latRaw === 0 && lonRaw === 0) return "zero";

    // Hemisphere flag bytes are 0/1 in every observed fix row - any other
    // value marks foreign bytes (e.g. ASCII text) in a look-alike track.
    const northFlag = dv.getUint8(OFF_LAT_NORTH);
    const eastFlag = dv.getUint8(OFF_LON_EAST);
    if (northFlag > 1 || eastFlag > 1) return null;

    // Unsigned DDmm floats: sign lives in the flags, minutes must be < 60.
    if (!Number.isFinite(latRaw) || latRaw < 0 || latRaw % 100 >= 60) return null;
    if (!Number.isFinite(lonRaw) || lonRaw < 0 || lonRaw % 100 >= 60) return null;
    const latAbs = ddmmToDegrees(latRaw);
    const lonAbs = ddmmToDegrees(lonRaw);
    if (latAbs > 90 || lonAbs > 180) return null;

    const localUnixRaw = dv.getUint32(OFF_LOCAL_UNIX, true);
    const localUnix = localUnixRaw >= MIN_PLAUSIBLE_UNIX && localUnixRaw <= MAX_PLAUSIBLE_UNIX ? localUnixRaw : null;

    // Same policy as sstar-ssmd: garbage speed on a row whose coordinates
    // validate means "speed unknown" (0), not a dropped coordinate.
    const speedKmh = dv.getFloat32(OFF_SPEED_KMH, true);
    const speedValid = Number.isFinite(speedKmh) && speedKmh >= 0 && speedKmh <= MAX_PLAUSIBLE_SPEED_KMH;

    return {
        lat: northFlag === 1 ? latAbs : -latAbs,
        lon: eastFlag === 1 ? lonAbs : -lonAbs,
        speedMs: speedValid ? speedKmh * KMH_TO_MS : 0,
        speedValid,
        localUnix,
        accel: {
            x: dv.getFloat32(OFF_ACCEL, true),
            y: dv.getFloat32(OFF_ACCEL + 4, true),
            z: dv.getFloat32(OFF_ACCEL + 8, true),
        },
    };
}

/**
 * Extracts GPS records from a Vueroid TXET track at the full ~20 Hz sample
 * rate (coords step at 1 Hz inside, but speed/accel carry real 20 Hz
 * dynamics - thinning to 1 Hz would lose braking peaks, and ~1200 records
 * per minute is cheap; rvmi keeps its full gReV rate for the same reason).
 *
 * Timestamps: the wall-clock field is camera-LOCAL stored as fake UTC (see
 * the header), so every record is flagged `timeUnsynced` with
 * `relStartSeconds` = media-time offset; the time layer re-anchors them onto
 * the video window derived from filename/mvhd + TZ estimation. Per-record
 * `unixSeconds` = first fix's clock + media-time delta (monotonic,
 * fractional, but still in the camera-local frame - do not trust as UTC).
 *
 * Returns null when the track is structurally broken (no sample table /
 * stts / timescale) or when the content gate fails (alien content - caller
 * turns null into WrongFormatError). The gate is as strict as full per-row
 * validation: it needs a zeroed row or at least one row passing EVERY field
 * check - the speed/clock leniency applied to individual rows never widens
 * what claims the file. One deliberate exception: when every row fails ONLY
 * the clock check (battery-dead RTC), the rows are emitted timeUnsynced
 * with pure media-time pacing instead of rejecting the file. A track of
 * only zeroed rows returns empty records ("matches the format, no GPS").
 */
export async function extractFromVueroidTxetTrack(
    vf: VendorFile,
    index: Mp4Index,
    track: TrackInfo,
): Promise<ParsedRecords | null> {
    if (!index.moovView) return null;
    const samples = readSampleTable(index.moovView, track.trakBox);
    if (!samples || samples.length === 0) return null;
    // Re-assert the constant size - extract must not misread a foreign track
    // when called with a track the finder did not produce.
    if (!samples.every((s) => s.size === VUEROID_TXET_SAMPLE_SIZE)) return null;

    // Media time gives the 20 Hz pacing (stts deltas ~50 ms); the 1 Hz clock
    // field alone cannot order samples within a second.
    const sampleStartTicks = readSampleStartsInTicks(index.moovView, track.trakBox);
    const mediaTimescale = readMediaTimescale(index.moovView, track.trakBox);
    if (!sampleStartTicks || !mediaTimescale || mediaTimescale <= 0) return null;
    if (sampleStartTicks.length < samples.length) return null;

    const buffers = await loadSamples(vf.file, samples, index.sliceCost);

    const skipped: SkippedLine[] = [];
    const rows: { sampleIndex: number; tick: number; row: DecodedRow }[] = [];
    let zeroRows = 0;

    for (let i = 0; i < buffers.length; i++) {
        const buf = buffers[i];
        if (!buf) continue;
        const row = decodeVueroidTxetRow(new DataView(buf));
        if (row === "zero") {
            zeroRows++;
            continue;
        }
        if (row === null) {
            // Non-zero row failing plausibility is not routine for this
            // format - keep a per-sample diagnostic trace.
            skipped.push({
                line: i + 1,
                raw: `<vueroid-txet sample ${i + 1}>`,
                reason: "implausible vueroid txet record",
            });
            continue;
        }
        rows.push({ sampleIndex: i, tick: sampleStartTicks[i]!, row });
    }

    // Content gate (see the contract above): the per-row speed/clock
    // leniency must not let alien content claim the file.
    const hasFullyValidRow = rows.some((e) => e.row.speedValid && e.row.localUnix !== null);
    // Battery-dead RTC: every row fails ONLY the clock check while
    // coordinates (and at least one speed) validate.
    const allClocksDead =
        rows.length > 0 && rows.every((e) => e.row.localUnix === null) && rows.some((e) => e.row.speedValid);
    if (!hasFullyValidRow && !allClocksDead && zeroRows === 0) return null;

    const records: GpsRecord[] = [];
    // Clock anchor = first fix row with a plausible wall-clock, at that
    // row's media time. Unused in the dead-RTC fallback.
    let baseLocalUnix: number | null = null;
    let baseTick = 0;

    for (const { sampleIndex, tick, row } of rows) {
        if (!allClocksDead && row.localUnix === null) {
            // Isolated clock corruption in a file whose clock otherwise
            // works - skip the row rather than guessing its second.
            skipped.push({
                line: sampleIndex + 1,
                raw: `<vueroid-txet sample ${sampleIndex + 1}>`,
                reason: "camera clock outside the plausible range",
            });
            continue;
        }
        if (baseLocalUnix === null && row.localUnix !== null) {
            baseLocalUnix = row.localUnix;
            baseTick = tick;
        }
        const relStartSeconds = tick / mediaTimescale;
        records.push({
            // Dead-RTC fallback carries no wall-clock at all - media time is
            // the only axis, and timeUnsynced already quarantines the value.
            unixSeconds: baseLocalUnix === null ? relStartSeconds : baseLocalUnix + (tick - baseTick) / mediaTimescale,
            active: true,
            lat: row.lat,
            lon: row.lon,
            // No course field in the 72 bytes - 0 lets downstream derive
            // bearing from the trajectory.
            bearingDeg: 0,
            speedMs: row.speedMs,
            accelXg: row.accel.x,
            accelYg: row.accel.y,
            accelZg: row.accel.z,
            mp4Filename: vf.file.name,
            // Camera-local clock, not UTC - quarantine from TZ/start
            // inference; relStartSeconds lets the re-anchor keep the real
            // per-record pacing (see the header).
            timeUnsynced: true,
            relStartSeconds,
        });
    }

    // Static-component (gravity) removal - GpsRecord.accel*g contract wants
    // ~0 at rest. The records still hold the raw firmware accel here
    // (nothing mutates it between decode and this point), so they double as
    // the sample set. With <2 fixes the mean cannot separate bias from
    // motion: zero the accel so a gravity-included floor never reaches the
    // brake detector (same policy as nextbase-subtitle).
    if (records.length >= 2) {
        const rawAccels: Vec3[] = records.map((r) => ({ x: r.accelXg, y: r.accelYg, z: r.accelZg }));
        subtractAxisMean(records, rawAccels);
    } else {
        for (const r of records) {
            r.accelXg = 0;
            r.accelYg = 0;
            r.accelZg = 0;
        }
    }

    return { records, skipped };
}
