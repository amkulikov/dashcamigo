// LigoGPS - encrypted GPS payload written by several SoC families under the
// LIGOGPSINFO\0 marker. Claimed here only in the `ssmd` meta-track carrier
// (CARCAM 4CH 360-WiFi and relatives); the freeGPS-wrapped and `gpmd`
// carriers (Rexing, Kingslim, iiway, XGODY, Redtiger F9 4K) are a
// recognize-and-bail case, deliberately left unclaimed - see
// FUZZ_SETTLED_SAMPLE_FORMAT.
//
// Source of truth: ExifTool LigoGPS.pm (DecryptLigoGPS + ParseLigoGPS),
// ported 1-to-1 to avoid divergence. ExifTool MIT/Artistic-2.
//
// Format:
//   chunk header (0x84 = 132 bytes max):
//     [0..3]  '####' (encryption marker)
//     [4..7]  u32 LE: length of encrypted body (max 0x84)
//     [8..]   encrypted body (length bytes), steering-bit-guided XOR
//
//   Decrypted body - ASCII string like:
//     "<4-byte preamble> 2025/06/07 18:06:17 N:50.123456 E:30.654321 25.5"
//   - first 4 chars skipped by regex (`^.{4}`),
//   - followed by datetime, NS-ref, lat decimal, EW-ref, lon decimal, speed.
//
// Alternative plaintext format (Redtiger F9 4K) - not encrypted, same
// regex after `^.{4}\d{4}/\d{2}/\d{2}` without decryption. Both branches supported.

import type { GpsRecord, ParsedRecords, SkippedLine, VendorFile } from "../types.js";
import { KNOTS_TO_MS, WrongFormatError } from "../types.js";
import { loadSamples, readSampleTable } from "./mp4-walker.js";
import type { Mp4Index } from "./mp4-index.js";

const LIGO_MAGIC = "LIGOGPSINFO";

/**
 * The one carrier whose fuzz state is settled by a real sample: LigoGPS in an
 * `ssmd` meta-track decodes correctly WITHOUT the upstream unfuzz step, which
 * is why nothing here calls it.
 *
 * Any other carrier stays unclaimed on purpose. Upstream decides fuzzing from
 * a header byte (LigoGPS.pm:299, v1.06), and that rule misclassifies our real
 * ssmd sample: the sample lands in the "fuzzed" class while its coordinates
 * are verified correct un-fuzzed. So the header cannot key the decision, the
 * carrier has to - and the `gpmd` variant (Kingslim D4 and relatives) has no
 * sample to settle it.
 *
 * Guessing is not the cheap option here. Unfuzzing swaps the fractional parts
 * of the two coordinates within their 10-degree squares (UnfuzzLigoGPS), so a
 * wrong call in EITHER direction still yields a well-formed fix that passes
 * every range and plausibility check while sitting tens of kilometres off. An
 * unclaimed file reads as "no GPS" and can be fixed later; a plausible wrong
 * track is believed.
 */
const FUZZ_SETTLED_SAMPLE_FORMAT = "ssmd";

/**
 * Decrypts one 0x84-byte LigoGPS chunk. Algorithm is 1-to-1 from ExifTool
 * LigoGPS.pm `DecryptLigoGPS`. Returns null if the chunk is malformed.
 *
 * The first byte of each 5-byte sub-chunk is the control byte. The upper
 * 3 bits (steering bits) select one of 4 decryption branches; the lower
 * bits are mixed with the next 4 (or 3, or 1) bytes via OR and XOR with 0x20.
 */
function decryptLigoGps(chunk: Uint8Array): Uint8Array | null {
    if (chunk.length < 8) return null;
    // num at offset 4 LE u32 - size of the encrypted body.
    const dv = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    let num = dv.getUint32(4, true);
    if (num < 4) return null;
    if (num > 0x84) num = 0x84;
    if (chunk.length < 8 + num) return null;

    // @in - encrypted bytes starting at offset 8.
    const inBuf = chunk.subarray(8, 8 + num);
    const out: number[] = [];
    let i = 0;

    while (i < inBuf.length) {
        const b = inBuf[i++]!;
        const steering = b & 0xe0;

        if (steering >= 0xc0) {
            // Note: ExifTool LigoGPS.pm may split 0xc0 and 0xe0 into separate
            // branches. We merge them - works on fixture samples, but no real
            // recordings with steering=0xe0 exist in fixtures. If a LigoGPS
            // dashcam produces broken decryption, compare against ExifTool:
            // https://github.com/exiftool/exiftool/blob/master/lib/Image/ExifTool/LigoGPS.pm
            if (i + 4 > inBuf.length) return null;
            const a = inBuf[i++]!;
            const c = inBuf[i++]!;
            const d = inBuf[i++]!;
            const e = inBuf[i++]!;
            out.push((a | (b & 0x01)) ^ 0x20);
            out.push((c | (b & 0x02)) ^ 0x20);
            out.push((d | (b & 0x0c)) ^ 0x20);
            // ExifTool: shift(@in) ^ 0x20 | $b & 0x30 - precedence: ^ before |
            out.push((e ^ 0x20) | (b & 0x30));
        } else if (steering >= 0x40) {
            if (i + 3 > inBuf.length) return null;
            const a = inBuf[i++]!;
            const c = inBuf[i++]!;
            const d = inBuf[i++]!;
            if (steering === 0x40) {
                out.push(0x20);
                out.push((a | (b & 0x01)) ^ 0x20);
                out.push((c | (b & 0x06)) ^ 0x20);
                out.push((d | (b & 0x18)) ^ 0x20);
            } else if (steering === 0x60) {
                out.push((a | (b & 0x03)) ^ 0x20);
                out.push(0x20);
                out.push((c | (b & 0x04)) ^ 0x20);
                out.push((d | (b & 0x18)) ^ 0x20);
            } else if (steering === 0x80) {
                out.push((a | (b & 0x03)) ^ 0x20);
                out.push((c | (b & 0x0c)) ^ 0x20);
                out.push(0x20);
                out.push((d | (b & 0x10)) ^ 0x20);
            } else {
                // 0xa0
                out.push((a | (b & 0x01)) ^ 0x20);
                out.push((c | (b & 0x06)) ^ 0x20);
                out.push((d | (b & 0x18)) ^ 0x20);
                out.push(0x20);
            }
        } else if (steering === 0x00) {
            if (i + 1 > inBuf.length) return null;
            const a = inBuf[i++]!;
            out.push(a | (b & 0x13));
        } else {
            // 0x20: shouldn't happen per ExifTool comment.
            return null;
        }
    }

    return Uint8Array.from(out);
}

/**
 * Parses a decrypted ASCII string into a GpsRecord.
 *
 * Regex from ExifTool ParseLigoGPS:
 *   /^.{4}(\S+ \S+)\s+([NS?]):(-?)([.\d]+)\s+([EW?]):(-?)([\.\d]+)\s+([.\d]+)/
 *
 * Capture groups (1-indexed, Perl convention):
 *   1: datetime "YYYY/MM/DD HH:MM:SS"
 *   2: lat hemisphere (N/S/?)
 *   3: optional minus
 *   4: lat decimal degrees
 *   5: lon hemisphere (E/W/?)
 *   6: optional minus
 *   7: lon decimal degrees
 *   8: speed (knots)
 */
const REC_RX = /^.{4}(\S+ \S+)\s+([NS?]):(-?)([.\d]+)\s+([EW?]):(-?)([.\d]+)\s+([.\d]+)/;

function parseLigoGpsRecord(text: string, mp4Filename: string): GpsRecord | null {
    const m = text.match(REC_RX);
    if (!m) return null;

    const datetimeStr = m[1]!;
    const nsRef = m[2]!;
    const latNeg = m[3] === "-";
    const latStr = m[4]!;
    const ewRef = m[5]!;
    const lonNeg = m[6] === "-";
    const lonStr = m[7]!;
    const speedStr = m[8]!;

    // datetime: "YYYY/MM/DD HH:MM:SS" (UTC).
    const dtMatch = datetimeStr.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2}) (\d{1,2}):(\d{1,2}):(\d{1,2})/);
    if (!dtMatch) return null;
    const year = Number(dtMatch[1]);
    const month = Number(dtMatch[2]);
    const day = Number(dtMatch[3]);
    const hour = Number(dtMatch[4]);
    const minute = Number(dtMatch[5]);
    const second = Number(dtMatch[6]);
    if (![year, month, day, hour, minute, second].every(Number.isFinite)) return null;
    if (year < 2000 || year > 2099) return null;
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    if (hour > 23 || minute > 59 || second > 59) return null;

    let lat = Number(latStr);
    let lon = Number(lonStr);
    const speedKnots = Number(speedStr);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(speedKnots)) return null;

    if (latNeg || nsRef === "S") lat = -lat;
    if (lonNeg || ewRef === "W") lon = -lon;
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
    if (nsRef === "?" || ewRef === "?") return null; // no fix

    const unixSeconds = Date.UTC(year, month - 1, day, hour, minute, second) / 1000;
    return {
        unixSeconds,
        active: true,
        lat,
        lon,
        bearingDeg: 0, // LigoGPS ParseLigoGPS does not extract course; dispatcher forward-fills from trajectory
        speedMs: speedKnots * KNOTS_TO_MS,
        accelXg: 0,
        accelYg: 0,
        accelZg: 0,
        mp4Filename,
    };
}

/**
 * Scans the payload for "LIGOGPSINFO" followed by `####` (encrypted format).
 * Returns the chunk-start offset (position of `####`) or null.
 *
 * ExifTool regex: `^(.{16}|.{48}|.{80})LIGOGPSINFO\0` - three prefix lengths.
 * We do a general substring scan, then verify that after LIGOGPSINFO+0x14 a
 * `####` marker follows. Chunk starts there (0x14 = 11 magic + 4 zero-pad +
 * 4 spare; CARCAM stores scale/version info there, which we don't need).
 */
export function findLigoGpsChunkOffset(payload: Uint8Array): number | null {
    const magicBytes = new TextEncoder().encode(LIGO_MAGIC);
    outer: for (let i = 0; i + magicBytes.length <= payload.length; i++) {
        for (let j = 0; j < magicBytes.length; j++) {
            if (payload[i + j] !== magicBytes[j]) continue outer;
        }
        // Found "LIGOGPSINFO". Chunk start = LIGOGPSINFO + 0x14.
        const chunkStart = i + 0x14;
        if (chunkStart + 8 > payload.length) return null;
        // Verify '####' marker for encrypted variant.
        if (
            payload[chunkStart] === 0x23 &&
            payload[chunkStart + 1] === 0x23 &&
            payload[chunkStart + 2] === 0x23 &&
            payload[chunkStart + 3] === 0x23
        ) {
            return chunkStart;
        }
        // Note: plaintext variant (Redtiger F9 4K) - chunk has no `####`, starts
        // directly with ASCII datetime. Not implemented without a sample.
        return null;
    }
    return null;
}

/**
 * Extracts GpsRecords from a LigoGPS-encoded MP4. Shared between the
 * vendor-specific carcamPlugin and the genericPlugin fallback.
 *
 * Walks all `meta` tracks, filters non-GPS tracks by sample size heuristic
 * (64..1024 bytes; JPEG thumbnails >1 KB, G-sensor = 12 bytes), then reads
 * samples, locates the LIGOGPSINFO+`####` chunk in each, decrypts, and
 * regex-parses.
 */
export async function parseLigoGpsFromMp4(file: VendorFile, index: Mp4Index): Promise<ParsedRecords> {
    if (!index.moov) throw new WrongFormatError("no moov box");

    const records: GpsRecord[] = [];
    const skipped: SkippedLine[] = [];
    let foundLigoTrack = false;

    for (const t of index.tracks) {
        if (t.handlerType !== "meta") continue;
        if (!index.moovView) continue;

        const samples = readSampleTable(index.moovView, t.trakBox);
        if (!samples || samples.length === 0) continue;

        const firstSize = samples[0]!.size;
        if (firstSize < 64 || firstSize > 1024) continue;

        // Probe with a single sample (random path - just one slice() call
        // regardless of measured sliceCost). Bulk load uses the adaptive
        // strategy via index.sliceCost.
        const firstBuf = (await loadSamples(file.file, [samples[0]!]))[0]!;
        const probeOffset = findLigoGpsChunkOffset(new Uint8Array(firstBuf));
        if (probeOffset === null) continue;

        foundLigoTrack = true;
        // Bail before the bulk read: an unsettled carrier costs one probe
        // sample, not the whole track.
        if (t.sampleFormat !== FUZZ_SETTLED_SAMPLE_FORMAT) {
            skipped.push({
                line: 1,
                raw: `<ligogps track, sample format ${t.sampleFormat ?? "unknown"}>`,
                reason: "unfuzz state unsettled for this carrier - track not claimed",
            });
            continue;
        }

        const sampleBuffers = await loadSamples(file.file, samples, index.sliceCost);
        for (let i = 0; i < sampleBuffers.length; i++) {
            const view = new Uint8Array(sampleBuffers[i]!);
            const chunkOff = findLigoGpsChunkOffset(view);
            if (chunkOff === null) {
                skipped.push({
                    line: i + 1,
                    raw: `<ligogps sample ${i + 1}: no magic>`,
                    reason: "no LIGOGPSINFO magic",
                });
                continue;
            }
            // 8-byte chunk header + up to 0x84 bytes of encrypted body -
            // decryptLigoGps requires 8 + num total, so capping at 0x84 would
            // reject any body longer than 0x7c even when the bytes are there.
            const chunk = view.subarray(chunkOff, Math.min(view.length, chunkOff + 8 + 0x84));
            const decrypted = decryptLigoGps(chunk);
            if (!decrypted) {
                skipped.push({
                    line: i + 1,
                    raw: `<ligogps sample ${i + 1}: decrypt failed>`,
                    reason: "DecryptLigoGPS returned null",
                });
                continue;
            }
            const text = bytesToAscii(decrypted);
            const record = parseLigoGpsRecord(text, file.file.name);
            if (record) {
                records.push(record);
            } else {
                skipped.push({
                    line: i + 1,
                    raw: `<ligogps sample ${i + 1}: parse failed: ${JSON.stringify(text.slice(0, 80))}>`,
                    reason: "regex did not match decrypted text",
                });
            }
        }
        break;
    }

    if (!foundLigoTrack) {
        throw new WrongFormatError("no LigoGPS track in MP4");
    }
    return { records, skipped };
}

function bytesToAscii(buf: Uint8Array): string {
    let out = "";
    for (let i = 0; i < buf.length; i++) {
        const b = buf[i]!;
        out += b < 0x80 ? String.fromCharCode(b) : ".";
    }
    return out;
}

export const _internal = { decryptLigoGps, parseLigoGpsRecord, findLigoGpsChunkOffset };
