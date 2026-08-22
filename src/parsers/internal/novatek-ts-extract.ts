// Novatek-TS extractor: MPEG-TS dashcam recordings (VIOFO A119 V3 in its TS
// recording mode; filename family `YYYYMMDDHHMMSS_NNNNNN.TS`)
// that carry the classic Novatek GPS record struct in a private-data PES
// stream.
//
// Stream layout (verified on two real 180 s clips in private):
//   - PAT/PMT advertise ONLY video (HEVC, stream_type 0x24) and audio (AAC,
//     0x0f). The GPS PES (PID 0x300 in both samples) is absent from the PMT,
//     so PSI parsing cannot find it - detection is content-based, and the
//     PID is auto-detected the same way (a different firmware may use any
//     PID; see the juscar-ts precedent in juscar-ts-extract.ts).
//   - GPS PES: stream_id 0xbf (private_stream_2 - fixed 6-byte header, no
//     PTS), PES_packet_length = 1008. One PES per second, one record per
//     PES; the 1014 PES bytes span 6 TS packets (1 PUSI + 5 continuations,
//     the last one padded with adaptation-field stuffing).
//   - The 44-byte record sits at PES body offset 0 and always fits inside
//     the first (PUSI) TS packet; bytes [44..1008) of the body are zero
//     padding on every real PES observed, so this dialect is parsed from PUSI
//     packets alone, like juscar-ts-extract.ts.
//
// A second dialect shares the same PES: Blueskysea B4K (Novatek NT96670) puts
// the identical record behind a fixed 164-byte prefix (ExifTool's regex
// `^(.{164})?(.{24})A[NS][EW]`, M2TS.pm:353-375, v13.55). That pushes the
// record past the end of the PES-start packet, which is the ONE reason this
// extractor reassembles at all. Implemented from foreign source, no sample.
//
// Record struct (all little-endian) - byte-identical to the post-magic
// record geometry of a Novatek freeGPS block (internal/freegps.ts
// FieldLayout, rebased to 0):
//   [0..24)   6 x u32: hour, minute, second, year (2-digit), month, day
//   [24]      'A' fix valid / 'V' void (no fix - record skipped)
//   [25]      'N'/'S'    [26] 'E'/'W'    [27] 0x00
//   [28..32)  f32 latitude,  DDmm.mmmm
//   [32..36)  f32 longitude, DDDmm.mmmm
//   [36..40)  f32 speed in KNOTS (haversine-vs-speed median ratio 0.52-0.54
//             on both real samples ~= KNOTS_TO_MS; km/h would be 0.28)
//   [40..44)  f32 course, degrees
//
// The 2-digit year expands as 2000+yy via the shared utcSecondsFromYmdhms
// (Y2100 is a non-concern: no dashcam SD card survives 75 years, and the
// shared helper already range-gates 2000..2099).
//
// Clock: the struct time is the camera's LOCAL wall clock, not UTC - on the
// real samples it equals the filename's local time while the coordinates
// resolve to a UTC+1 zone (UTC would be one hour earlier). Records are
// flagged timeUnsynced with a per-record relStartSeconds offset, mirroring
// the Kenwood local-clock quarantine in freegps.ts: the time layer then
// re-anchors them onto the video window instead of poisoning the
// per-fingerprint TZ estimate with local-as-UTC stamps. relStartSeconds is
// relative to the FIRST record, not to frame 0 - private_stream_2 has no
// PTS, so the (~1 s) GPS warm-up gap before the first record is not
// recoverable; the error is far below the GPS-lock ambiguity.

import type { GpsRecord, ParsedRecords, SkippedLine, VendorFile } from "../types.js";
import { KNOTS_TO_MS, WrongFormatError } from "../types.js";
import { ddmmToDegrees, isCoordinateInRange } from "./ddmm.js";
import { utcSecondsFromYmdhms } from "./freegps.js";
import type { Mp4Index } from "./mp4-index.js";
import { collectPesBody, pesBodyOffset, TS_SIZE, TS_SYNC } from "./ts-walk.js";

const CHUNK_BYTES = 4 * 1024 * 1024;
const RECORD_SIZE = 44;

// Blueskysea B4K (Novatek NT96670) writes the SAME record behind a 164-byte
// prefix - ExifTool's own regex is `^(.{164})?(.{24})A[NS][EW]`
// (M2TS.pm:353-375, v13.55), i.e. the prefix is fixed-size, not something to
// hunt an anchor for. 164 + 44 overruns the 178 payload bytes a PES-start
// packet has left, so this dialect - and only this one - needs the PES
// reassembled across TS packets.
const B4K_PREFIX_BYTES = 164;

// Early-out bound for the PID lock: the format writes one GPS PES per second
// of video, so even at a generous 50 Mbps one record arrives per ~6.25 MB of
// stream - 64 MB covers >10 s of it, and a gate-passing foreign TS (e.g. the
// filename-shape fallback on an unrelated recording) must not be scanned to
// EOF (up to 1 GB) before WrongFormatError.
const PID_LOCK_LIMIT_BYTES = 64 * 1024 * 1024;

/**
 * Content probe: scans TS packets (188-byte stride, no byte-level resync) for
 * the first PUSI packet whose PES body starts with a valid Novatek GPS record
 * and returns its PID, or null when none is found in `bytes`.
 *
 * Used three ways: by the primitive's marker over Mp4Index.headerBytes, by
 * the classify gate in registry.ts (wired by the orchestrator), and by the
 * extractor below to lock the PID early. Returns null immediately when the
 * buffer does not start with a TS sync byte - O(1) rejection for MP4/MOV
 * files, so the gate can call this unconditionally.
 */
export function findNovatekTsGpsPid(bytes: Uint8Array): number | null {
    if (bytes.length < TS_SIZE || bytes[0] !== TS_SYNC) return null;
    const limit = bytes.length - TS_SIZE;
    for (let off = 0; off <= limit; off += TS_SIZE) {
        if (bytes[off] !== TS_SYNC) return null;
        const b1 = bytes[off + 1]!;
        if ((b1 & 0x40) === 0) continue; // PUSI=0
        const bodyOff = pesBodyOffset(bytes, off);
        if (bodyOff === null) continue;
        const pid = ((b1 & 0x1f) << 8) | bytes[off + 2]!;
        if (isNovatekTsRecordAt(bytes, bodyOff, off + TS_SIZE)) return pid;
        // B4K: the anchor sits past the end of this packet, so the pre-filter
        // decides whether reassembly is worth it. Without this branch the whole
        // dialect is invisible to the marker and the kind gate.
        if (looksLikeB4kRecordStart(bytes, bodyOff, off + TS_SIZE)) {
            const assembled = collectPesBody(bytes, off, bodyOff, pid, B4K_PREFIX_BYTES + RECORD_SIZE);
            if (
                typeof assembled === "object" &&
                isNovatekTsRecordAt(assembled.body, B4K_PREFIX_BYTES, assembled.body.length)
            ) {
                return pid;
            }
        }
    }
    return null;
}

/**
 * Signature check for a record at `off`: status triple 'A'/'V' + N/S + E/W +
 * zero pad, and all six datetime u32 fields in calendar range. The datetime
 * gate is what makes this safe to run on arbitrary PES bodies (video bytes
 * that happen to spell "ANE\0" would still need six in-range u32s before it).
 */
function isNovatekTsRecordAt(bytes: Uint8Array, off: number, end: number): boolean {
    if (off + RECORD_SIZE > end || off + RECORD_SIZE > bytes.length) return false;
    const fix = bytes[off + 24];
    if (fix !== 0x41 && fix !== 0x56) return false; // 'A' / 'V'
    const ns = bytes[off + 25];
    if (ns !== 0x4e && ns !== 0x53) return false;
    const ew = bytes[off + 26];
    if (ew !== 0x45 && ew !== 0x57) return false;
    if (bytes[off + 27] !== 0) return false;
    const h = u32le(bytes, off);
    const mi = u32le(bytes, off + 4);
    const s = u32le(bytes, off + 8);
    const y = u32le(bytes, off + 12);
    const mo = u32le(bytes, off + 16);
    const d = u32le(bytes, off + 20);
    if (h > 23 || mi > 59 || s > 59) return false;
    if (y > 99 || mo < 1 || mo > 12 || d < 1 || d > 31) return false;
    return true;
}

// Upper bound of each u32 in the record's hour/minute/second triple.
const B4K_CLOCK_MAX = [23, 59, 59];

/**
 * Cheap pre-filter for the B4K dialect, run on the PES-start packet ALONE: the
 * record's hour/minute/second u32 triple sits at prefix+0..12, well ahead of
 * the `A[NS][EW]` anchor at prefix+24, so it is often readable when the anchor
 * is not. Three in-range u32s make a false positive vanishingly unlikely, so
 * packets that pass are worth the cost of reassembly and the rest are not.
 *
 * This is an optimization, not a gate: with a bare 6-byte PES header the triple
 * clears the packet end by 2 bytes, so any adaptation field (PCR, discontinuity)
 * or extended PES header pushes it out of reach. A field that cannot be read
 * therefore means "cannot judge" - reassembly decides - and only a field that IS
 * readable and out of range rejects.
 */
function looksLikeB4kRecordStart(bytes: Uint8Array, bodyOff: number, packetEnd: number): boolean {
    const at = bodyOff + B4K_PREFIX_BYTES;
    const limit = Math.min(packetEnd, bytes.length);
    for (let i = 0; i < B4K_CLOCK_MAX.length; i++) {
        const fieldAt = at + i * 4;
        if (fieldAt + 4 > limit) return true;
        if (u32le(bytes, fieldAt) > B4K_CLOCK_MAX[i]!) return false;
    }
    return true;
}

function u32le(bytes: Uint8Array, off: number): number {
    return (bytes[off]! | (bytes[off + 1]! << 8) | (bytes[off + 2]! << 16) | (bytes[off + 3]! << 24)) >>> 0;
}

function f32le(bytes: Uint8Array, off: number): number {
    F32_SCRATCH_U8[0] = bytes[off]!;
    F32_SCRATCH_U8[1] = bytes[off + 1]!;
    F32_SCRATCH_U8[2] = bytes[off + 2]!;
    F32_SCRATCH_U8[3] = bytes[off + 3]!;
    return F32_SCRATCH[0]!;
}

// Little-endian float reinterpretation without allocating a DataView per
// record (the scan visits one record per second of video; a shared scratch
// buffer keeps the hot loop allocation-free). TS is little-endian scratch:
// Float32Array/Uint8Array share the same 4 bytes.
const F32_SCRATCH = new Float32Array(1);
const F32_SCRATCH_U8 = new Uint8Array(F32_SCRATCH.buffer);

/** Decode result: a record, or a skip reason for diagnostics. */
type DecodeOutcome = { record: GpsRecord } | { skipReason: string };

function decodeRecord(bytes: Uint8Array, off: number, mp4Filename: string): DecodeOutcome {
    if (bytes[off + 24] === 0x56) return { skipReason: "no gps fix (status V)" };

    const h = u32le(bytes, off);
    const mi = u32le(bytes, off + 4);
    const s = u32le(bytes, off + 8);
    const y = u32le(bytes, off + 12);
    const mo = u32le(bytes, off + 16);
    const d = u32le(bytes, off + 20);
    // Local wall-clock parsed as if UTC; the timeUnsynced flag set by the
    // caller tells the time layer this is not a real UTC stamp.
    const unixSeconds = utcSecondsFromYmdhms(y, mo, d, h, mi, s);
    if (unixSeconds === null) return { skipReason: "datetime out of range" };

    const ns = bytes[off + 25] === 0x4e ? 1 : -1;
    const ew = bytes[off + 26] === 0x45 ? 1 : -1;
    const latRaw = f32le(bytes, off + 28);
    const lonRaw = f32le(bytes, off + 32);
    const speedKnots = f32le(bytes, off + 36);
    const course = f32le(bytes, off + 40);
    if (![latRaw, lonRaw, speedKnots, course].every(Number.isFinite)) {
        return { skipReason: "non-finite float field" };
    }
    const lat = ddmmToDegrees(latRaw) * ns;
    const lon = ddmmToDegrees(lonRaw) * ew;
    if (!isCoordinateInRange(lat, "lat") || !isCoordinateInRange(lon, "lon")) {
        return { skipReason: "coordinate out of range" };
    }
    if (speedKnots < 0) return { skipReason: "negative speed" };

    return {
        record: {
            unixSeconds,
            active: true,
            lat,
            lon,
            bearingDeg: ((course % 360) + 360) % 360,
            speedMs: speedKnots * KNOTS_TO_MS,
            // No accelerometer data anywhere in the 1008-byte payload
            // (verified all-zero past the record on both real samples).
            accelXg: 0,
            accelYg: 0,
            accelZg: 0,
            mp4Filename,
        },
    };
}

/**
 * Extracts GPS records from a Novatek-TS file: one sequential pass in 4 MB
 * chunks, parsing only PUSI packets of the GPS PID (locked on first match,
 * seeded from index.headerBytes when the probe already ran).
 *
 * Contract: throws WrongFormatError when the scan finds no GPS records
 * (false-positive marker - e.g. the filename-shape fallback on a foreign TS
 * file); a stream that never locks a GPS PID aborts early after
 * PID_LOCK_LIMIT_BYTES instead of scanning to EOF. Every returned record
 * has timeUnsynced=true and relStartSeconds relative to the first record -
 * see the local-clock note in the header. Honors `signal` between chunks
 * (a full pass reads the whole file).
 */
export async function extractNovatekTsGps(
    file: VendorFile,
    index?: Mp4Index,
    signal?: AbortSignal,
): Promise<ParsedRecords> {
    // Seed the PID from headerBytes when available - skips the per-PUSI
    // signature checks on video/audio packets for the rest of the file.
    let gpsPid: number | null = index?.headerBytes ? findNovatekTsGpsPid(index.headerBytes) : null;

    const records: GpsRecord[] = [];
    const skipped: SkippedLine[] = [];
    let recordIdx = 0;

    const fileSize = file.file.size;
    let chunkStart = 0;
    // A packet split across a chunk boundary is carried over as a tail.
    let tail = new Uint8Array(0);

    while (chunkStart < fileSize) {
        if (signal?.aborted) throw new DOMException("novatek-ts scan aborted", "AbortError");
        const chunkEnd = Math.min(chunkStart + CHUNK_BYTES, fileSize);
        const fresh = new Uint8Array(await file.file.slice(chunkStart, chunkEnd).arrayBuffer());

        let buf: Uint8Array;
        if (tail.length === 0) {
            buf = fresh;
        } else {
            buf = new Uint8Array(tail.length + fresh.length);
            buf.set(tail, 0);
            buf.set(fresh, tail.length);
        }

        let off = 0;
        // Consecutive non-sync bytes seen while resyncing (see below).
        let desyncRun = 0;
        while (off + TS_SIZE <= buf.length) {
            if (buf[off] !== TS_SYNC) {
                // Desync (corrupt dump) - a 1-byte backoff re-finds alignment
                // fast, but a long syncless region must not degrade the scan
                // to a byte-wise crawl of the whole file: after a full packet
                // length without a sync byte, step by whole packets.
                desyncRun++;
                off += desyncRun >= TS_SIZE ? TS_SIZE : 1;
                continue;
            }
            desyncRun = 0;
            const b1 = buf[off + 1]!;
            const pid = ((b1 & 0x1f) << 8) | buf[off + 2]!;
            if (gpsPid !== null && pid !== gpsPid) {
                off += TS_SIZE;
                continue;
            }
            // Records live only in PES-start packets; continuations of the
            // GPS PES carry zero padding (see header).
            if ((b1 & 0x40) === 0) {
                off += TS_SIZE;
                continue;
            }
            const bodyOff = pesBodyOffset(buf, off);
            if (bodyOff === null) {
                off += TS_SIZE;
                continue;
            }
            // Two dialects share this PES. The bare struct at body offset 0
            // (A119 V3, real-sample verified) is checked first because it costs
            // one signature test; the B4K prefix dialect needs the PES
            // reassembled, so it is gated behind the cheap datetime pre-filter.
            let recordBytes: Uint8Array | null = null;
            let recordOff = 0;
            if (isNovatekTsRecordAt(buf, bodyOff, off + TS_SIZE)) {
                recordBytes = buf;
                recordOff = bodyOff;
            } else if (looksLikeB4kRecordStart(buf, bodyOff, off + TS_SIZE)) {
                const assembled = collectPesBody(buf, off, bodyOff, pid, B4K_PREFIX_BYTES + RECORD_SIZE);
                // Buffer ran out mid-PES: leave this packet for the next chunk
                // instead of judging a truncated body. "unavailable" falls
                // through to the not-a-record path so the scan keeps moving.
                if (assembled === "incomplete") break;
                if (
                    assembled !== "unavailable" &&
                    isNovatekTsRecordAt(assembled.body, B4K_PREFIX_BYTES, assembled.body.length)
                ) {
                    recordBytes = assembled.body;
                    recordOff = B4K_PREFIX_BYTES;
                }
            }

            if (recordBytes === null) {
                // On the locked PID a non-record PES is a format anomaly worth
                // a skipped entry; on unlocked PIDs it is just video/audio.
                if (gpsPid !== null) {
                    recordIdx++;
                    skipped.push({
                        line: recordIdx,
                        // `off` indexes the tail-prefixed buffer, so the
                        // absolute file offset subtracts the carried tail.
                        raw: `pes body without record signature at ~${chunkStart - tail.length + off}`,
                        reason: "novatek-ts signature mismatch on gps pid",
                    });
                }
                off += TS_SIZE;
                continue;
            }
            gpsPid = pid; // first match locks the PID
            recordIdx++;
            const outcome = decodeRecord(recordBytes, recordOff, file.file.name);
            if ("record" in outcome) {
                records.push(outcome.record);
            } else {
                skipped.push({
                    line: recordIdx,
                    // Same tail-prefix correction as the signature-mismatch
                    // diagnostic above.
                    raw: `record at ~${chunkStart - tail.length + off}`,
                    reason: outcome.skipReason,
                });
            }
            off += TS_SIZE;
        }

        tail = off < buf.length ? buf.slice(off) : new Uint8Array(0);
        chunkStart = chunkEnd;

        if (gpsPid === null && chunkStart >= PID_LOCK_LIMIT_BYTES) {
            throw new WrongFormatError(
                `novatek-ts: no gps pes signature in the leading ${PID_LOCK_LIMIT_BYTES >> 20} mib of the stream`,
            );
        }
    }

    if (records.length === 0) {
        throw new WrongFormatError("novatek-ts: no gps records found in ts stream");
    }

    // Local-clock quarantine (see header): flag every record and hand the
    // time layer trustworthy per-record offsets so reanchorUnsyncedTimes
    // places them at startUtc+offset instead of spreading evenly.
    const base = records[0]!.unixSeconds;
    for (const rec of records) {
        rec.timeUnsynced = true;
        rec.relStartSeconds = rec.unixSeconds - base;
    }
    return { records, skipped };
}
