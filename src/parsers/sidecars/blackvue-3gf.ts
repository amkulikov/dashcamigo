// Sidecar handler for BlackVue `.3gf` - binary G-sensor log alongside the
// `.mp4`/`.gps` on legacy models (DR400G-HD, DR450/500/550/650, early DR770X
// firmware) and DR590X (GPS-less but has accelerometer).
//
// Originally implemented from foreign source; the layout below is now
// confirmed by a real standalone DR550DW `.3gf` (see __fixtures__/blackvue,
// real-anonymized.3gf). Sources (both read BIG-endian and break at the
// 0xFFFFFFFF sentinel):
//   - ExifTool QuickTimeStream.pl:2686-2708 Process_3gf (v13.59): Get32u ms +
//     3x Get16s under QuickTime's default 'MM' byte order, `last if
//     $tc == 0xffffffff`.
//   - blackclue/blackclue/blackclue.py:82-99 (byte-identical copy bundled in
//     bartbroere/blackvue-acc as blackclue.py:284-296): int.from_bytes(...,
//     'big'), break on time_ms == 0xffffffff; firmware pads the pre-allocated
//     block with 0xFF after the terminator.
// The references parse the EMBEDDED '3gf' atom inside the MP4; the DR550DW
// sample confirms the standalone SD-card sidecar shares that byte layout.
//
// Record format - headerless dense array of 10-byte BIG-endian records:
//   [0..3]  u32 BE  ms_since_start    (from the start of the MP4 recording;
//                                      0xFFFFFFFF = end-of-data sentinel)
//   [4..5]  i16 BE  Y  (vertical)     g = raw / 128
//   [6..7]  i16 BE  X  (lateral)      g = raw / 128
//   [8..9]  i16 BE  Z  (longitudinal) g = raw / 128
//   Sample rate ~10 Hz (recoverable from ms_since_start).
//
// Scale = raw / 128 (not ExifTool's /10): on the DR550DW sample the vertical
// axis Y sits at ~1g (mean 0.99g) over the whole clip, matching blackvue-acc's
// "1G ~= 128" anchor; /10 would read ~10g. G_DIVISOR stays 128.
//
// Axis mapping Y/X/Z -> vertical/lateral/longitudinal, all confirmed on the
// real DR550DW clips:
//   Y (file) -> accelZg (vertical, gravity axis)   -- ~1g at rest
//   X (file) -> accelXg (lateral)                  -- turns
//   Z (file) -> accelYg (longitudinal/forward)     -- braking/accel, +Z = forward
// X vs Z was pinned by cross-correlating each axis against the GPS ground truth
// from the paired `.gps`: longitudinal accel = d(speed)/dt tracks Z (r~0.9 on
// the clip with real braking), lateral accel = speed x d(heading)/dt tracks X
// (r~0.8). Only the assignment matters for a per-axis reading; brake detection
// keys on |G| magnitude (events.ts), which is invariant to it.

import { createLogger } from "../../log.js";
import type { AccelSample, AccelSidecarHandler, VendorFile } from "../types.js";
import { matchBlackvueSidecarBasename } from "./_basename.js";
import { readSidecarBytes } from "./_read.js";

const log = createLogger("blackvue-3gf");

const RX_3GF = /\.3gf$/i;
const RECORD_SIZE = 10;
const G_DIVISOR = 128;

// End-of-data sentinel (and the value every all-0xFF padding record reads as,
// in either byte order - so a single break covers both).
const SENTINEL_MS = 0xffffffff;

export const blackvue3gfSidecar: AccelSidecarHandler = {
    id: "blackvue-3gf",
    matches(file: VendorFile, knownVideos: Set<string>): string | null {
        return matchBlackvueSidecarBasename(file, knownVideos, RX_3GF);
    },
    async parseAccel(file: VendorFile, signal?: AbortSignal): Promise<AccelSample[]> {
        const buf = await readSidecarBytes(file, signal);
        return parse3gfBuffer(buf);
    },
};

/**
 * Parses a .3gf buffer as an array of 10-byte records, big-endian by default
 * (see the header comment for sources). Iteration stops at the first record
 * whose ms field is 0xFFFFFFFF - the end-of-data sentinel; the 0xFF padding
 * that follows it reads as the same value, so a raw byteLength/10 count never
 * ingests padding as samples. A trailing partial record is silently ignored
 * (guards against truncated logs).
 *
 * Defensive endianness auto-detect: the DR550DW sample confirms BE, but the
 * parser historically read LE - if some firmware actually writes LE, a hard
 * flip would break it. Both orders are decoded over the leading records and the
 * one whose ms sequence looks like a real ~10 Hz cadence wins; ambiguity falls
 * back to BE (the confirmed layout).
 */
export function parse3gfBuffer(buf: ArrayBuffer): AccelSample[] {
    const dv = new DataView(buf);
    const numRecords = Math.floor(dv.byteLength / RECORD_SIZE);

    // Records before the sentinel. The sentinel position is endian-neutral
    // (all-FF u32 is 0xFFFFFFFF either way), so this count is safe to compute
    // before the byte order is known.
    let dataRecords = numRecords;
    for (let i = 0; i < numRecords; i++) {
        if (dv.getUint32(i * RECORD_SIZE, false) === SENTINEL_MS) {
            dataRecords = i;
            break;
        }
    }

    // 1-2 records cannot establish a cadence - ambiguity is expected there,
    // default to BE silently. With 3+ records an ambiguous result is worth a
    // warning: it means the file does not look like a ~10 Hz log in either
    // byte order.
    let littleEndian = false;
    if (dataRecords >= 3) {
        const detected = detect3gfByteOrder(dv, dataRecords);
        if (detected === null) {
            log.warn("ambiguous 3gf byte order, defaulting to big-endian", { records: dataRecords });
        } else {
            littleEndian = detected === "le";
        }
    }

    const out: AccelSample[] = [];
    for (let i = 0; i < numRecords; i++) {
        const off = i * RECORD_SIZE;
        const msSinceStart = dv.getUint32(off, littleEndian);
        if (msSinceStart === SENTINEL_MS) break;
        const yRaw = dv.getInt16(off + 4, littleEndian);
        const xRaw = dv.getInt16(off + 6, littleEndian);
        const zRaw = dv.getInt16(off + 8, littleEndian);
        // File axis → our contract (gravity-removed after merge):
        //   file Y (vertical)           -> accelZg
        //   file X (lateral)            -> accelXg
        //   file Z (longitudinal/fwd)   -> accelYg
        // Gravity (~1g on vertical axis Y) is not subtracted here; the merge
        // step does that once the trip startUtc and optional calibration are known.
        out.push({
            msSinceStart,
            accelXg: xRaw / G_DIVISOR,
            accelYg: zRaw / G_DIVISOR,
            accelZg: yRaw / G_DIVISOR,
        });
    }
    return out;
}

// Auto-detect window: enough deltas for a meaningful median, cheap to scan.
const DETECT_MAX_RECORDS = 16;
// A plausible inter-sample delta range. Nominal cadence is ~10 Hz (100 ms);
// the bounds are generous (500 Hz .. 0.5 Hz) because the point is not to
// validate the cadence but to discriminate real ms values from byte-swapped
// garbage (a swapped small ms lands in the billions).
const DETECT_MIN_DELTA_MS = 20;
const DETECT_MAX_DELTA_MS = 2000;

/**
 * Picks the byte order whose leading ms sequence is non-decreasing with a
 * median delta inside the plausible cadence window. Returns null when neither
 * or both orders qualify (caller decides the fallback).
 */
function detect3gfByteOrder(dv: DataView, dataRecords: number): "be" | "le" | null {
    const count = Math.min(DETECT_MAX_RECORDS, dataRecords);
    const beOk = msSequencePlausible(dv, count, false);
    const leOk = msSequencePlausible(dv, count, true);
    if (beOk === leOk) return null;
    return beOk ? "be" : "le";
}

function msSequencePlausible(dv: DataView, count: number, littleEndian: boolean): boolean {
    const deltas: number[] = [];
    let prev: number | null = null;
    for (let i = 0; i < count; i++) {
        const ms = dv.getUint32(i * RECORD_SIZE, littleEndian);
        if (prev !== null) {
            if (ms < prev) return false; // non-monotonic - not this byte order
            deltas.push(ms - prev);
        }
        prev = ms;
    }
    if (deltas.length === 0) return false;
    deltas.sort((a, b) => a - b);
    const median = deltas[deltas.length >> 1]!;
    return median >= DETECT_MIN_DELTA_MS && median <= DETECT_MAX_DELTA_MS;
}
