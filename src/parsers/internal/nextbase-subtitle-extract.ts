// Nextbase 322GW/422GW/522GW/622GW binary-subtitle GPS+accel extraction.
//
// Implemented from foreign source (nb-dashcam-tools, github.com/skyhisi/
// nb-dashcam-tools @ b51f244, src/gpssampleparser.cpp + doc/camera-file-format.md).
// fmt1 is validated against a real 322GW-family clip (FH stream): 1800
// monotonic records at 10 Hz with plausible coordinates and speed. fmt2
// (622GW) is still known only from the upstream decoder (whose end-position
// Q_ASSERTs pass on real 322GW files) and remains unvalidated on a real
// sample.
//
// Carrier: a subtitle (sbtl/text) track; every sample is one fixed-size binary
// struct framed exactly like a tx3g cue - uint16-BE length prefix + payload
// (gpssampleparser.cpp:105,150-161). Two formats, discriminated by the length
// prefix value, never by model string:
//
//  fmt1 (322GW/422GW/522GW, format code 1, gpssampleparser.cpp:49-51):
//    prefix 0x0120 = 288. Payload: 4 always-zero bytes (cpp:123), 16-byte
//    datetime field (doc says 14-char ASCII "%Y%m%d%H%M%S"; code skips 16 -
//    code authoritative via the end-position assert, the 2 extra bytes are
//    padding; cpp:195-196), int32-LE y/x/z accel at +20/+24/+28 with
//    g = value/1280 and Y NEGATED (cpp:198-200), 128-byte NUL-padded $GPRMC
//    at +32 (cpp:209), 128-byte $GPGGA at +160 (cpp:214).
//  fmt2 (622GW, format code 2, cpp:52; upstream marks the whole branch
//    "// Untested" at cpp:237 - this variant is DOUBLY unverified):
//    prefix 0x0416 = 1046. Payload: 4 zero bytes, 24-byte skip (cpp:241),
//    int16-LE y/x/z accel at +28/+30/+32 with g = value/2048, Y negated
//    (cpp:243-245), 756 unknown bytes (cpp:252), $GPRMC at +790, $GPGGA
//    at +918.
//
// GGA is deliberately NOT parsed: GpsRecord has no altitude/hdop/sats fields
// and nmea.ts scopes GGA out - RMC alone carries everything we store.
//
// NMEA checksums are never valid on these cameras (camera-file-format.md:31,
// cpp:289 "Remove checksum, don't check it, never valid") - parseRmc already
// skips validation, which is exactly why it is reused here.
//
// Accel caveat: upstream says nothing about whether the values are
// gravity-removed. The GpsRecord contract is gravity-removed / ~0 at rest, and
// a gravity-included ~1g floor would poison impact detection. Until a real
// sample settles it, the per-file mean is subtracted (same DC-block approach
// as removeGsensoriBaseline in sbtl-nmea-extract.ts) - robust whether the
// floor is mounting tilt or full gravity. With fewer than 2 accel samples the
// mean is meaningless, so accel is ZEROED rather than passed through raw
// (unlike the Thinkware path, whose gravity-removal was inferred from real
// driving data; here raw values are entirely unverified).

import type { GpsRecord, ParsedRecords, SkippedLine, VendorFile } from "../types.js";
import { subtractAxisMean, type Vec3 } from "./accel-baseline.js";
import { dedupByUnixSeconds, parseRmc } from "./nmea.js";
import { getFirstSampleOfTrack, loadTrackSampleBuffers, type Mp4Index, type TrackInfo } from "./mp4-index.js";

const NEXTBASE_HANDLERS: readonly string[] = ["sbtl", "text", "meta"];

// 128-byte NUL-padded NMEA fields (gpssampleparser.cpp:209,214,256,261).
const NMEA_FIELD_LEN = 128;
// 4 always-zero bytes right after the length prefix (gpssampleparser.cpp:123).
const PREFIX_ZEROS_LEN = 4;
// Upstream accepts only the exact "$GPRMC" talker (gpssampleparser.cpp:295) -
// the marker checks the same literal so the signature stays strict.
const RMC_MAGIC = [0x24, 0x47, 0x50, 0x52, 0x4d, 0x43]; // "$GPRMC"

export interface NextbaseVariant {
    id: "nextbase-fmt1" | "nextbase-fmt2";
    /** Value of the uint16-BE length prefix = payload length in bytes. */
    payloadLen: number;
    /** Payload-relative offset of the y-accel field (file order y, x, z). */
    accelOffset: number;
    /** Accel integer width: 4 = int32 LE (fmt1), 2 = int16 LE (fmt2). */
    accelBytes: 2 | 4;
    /** Raw counts per 1 g. */
    accelLsbPerG: number;
    /** Payload-relative offset of the 128-byte NUL-padded $GPRMC field. */
    rmcOffset: number;
}

// fmt1: 4 zeros + 16B datetime -> accel at 20, RMC at 20+12=32, GGA at 160,
// total 288 (gpssampleparser.cpp:195-216, camera-file-format.md:33-45).
const FMT1: NextbaseVariant = {
    id: "nextbase-fmt1",
    payloadLen: 0x0120,
    accelOffset: 20,
    accelBytes: 4,
    accelLsbPerG: 1280,
    rmcOffset: 32,
};

// fmt2: 4 zeros + 24B skip -> accel at 28, +756 unknown -> RMC at 34+756=790,
// GGA at 918, total 1046 (gpssampleparser.cpp:240-261). Upstream-untested.
const FMT2: NextbaseVariant = {
    id: "nextbase-fmt2",
    payloadLen: 0x0416,
    accelOffset: 28,
    accelBytes: 2,
    accelLsbPerG: 2048,
    rmcOffset: 790,
};

const VARIANTS: readonly NextbaseVariant[] = [FMT1, FMT2];

// Structural gate: exact length-prefix value, prefix consistent with the
// actual sample size, and the 4 always-zero bytes. Shared by the marker and
// the per-sample extraction loop.
function detectVariantStructure(sample: Uint8Array): NextbaseVariant | null {
    if (sample.byteLength < 2) return null;
    const declaredLen = (sample[0]! << 8) | sample[1]!;
    const variant = VARIANTS.find((v) => v.payloadLen === declaredLen);
    if (!variant) return null;
    if (sample.byteLength < 2 + variant.payloadLen) return null;
    for (let i = 0; i < PREFIX_ZEROS_LEN; i++) {
        if (sample[2 + i] !== 0) return null;
    }
    return variant;
}

// Marker probe: structure AND the literal "$GPRMC" at the per-format fixed
// offset. The triple gate (unusual length value + zeros + RMC-at-exact-offset)
// makes a false positive on another vendor's subtitle track practically
// impossible.
//
// Known miss mode: the probe reads only the FIRST sample. Whether the
// firmware writes the "$GPRMC" literal into pre-fix samples (vs an all-NUL
// field) is unverifiable without a real recording - a file whose first sample
// has an empty RMC field would not be claimed. A void fix ("$GPRMC,,V,...")
// still carries the literal and IS claimed.
export function detectNextbaseVariant(sample: Uint8Array): NextbaseVariant | null {
    const variant = detectVariantStructure(sample);
    if (!variant) return null;
    const rmcStart = 2 + variant.rmcOffset;
    for (let i = 0; i < RMC_MAGIC.length; i++) {
        if (sample[rmcStart + i] !== RMC_MAGIC[i]) return null;
    }
    return variant;
}

/**
 * Finds the first subtitle/text/meta track whose first sample matches the
 * Nextbase binary-subtitle signature. Returns null if none.
 *
 * NOTE for the registry: this primitive MUST be registered BEFORE
 * nmea-subtitle. The Thinkware extractor strips the same uint16-BE prefix
 * (sbtl-nmea-extract.ts stripSubtitleTextPrefix: 288 <= 290-2 is
 * self-consistent) and its NMEA_RMC_SIG regex allows '$' as a boundary, so it
 * fires on the embedded "$GPRMC" and would half-claim a Nextbase file (RMC
 * coords yes, accel lost). The reverse direction is safe: Thinkware cues are
 * variable-length text and never pass the exact-length structural gate here.
 */
export async function findNextbaseSubtitleTrack(vf: VendorFile, index: Mp4Index): Promise<TrackInfo | null> {
    for (const t of index.tracks) {
        if (!t.handlerType || !NEXTBASE_HANDLERS.includes(t.handlerType)) continue;
        const sample = await getFirstSampleOfTrack(index, t, vf);
        if (!sample) continue;
        if (detectNextbaseVariant(sample) !== null) return t;
    }
    return null;
}

// Decodes the y/x/z accel triple of one sample into g. File order is y, x, z;
// Y is negated per upstream (gpssampleparser.cpp:198-200, 243-245). The
// result is RAW (pre-baseline-removal) - see the header caveat.
function decodeAccel(sample: Uint8Array, variant: NextbaseVariant): Vec3 {
    const view = new DataView(sample.buffer, sample.byteOffset, sample.byteLength);
    const base = 2 + variant.accelOffset;
    const read =
        variant.accelBytes === 4
            ? (fieldIndex: number) => view.getInt32(base + fieldIndex * 4, true)
            : (fieldIndex: number) => view.getInt16(base + fieldIndex * 2, true);
    return {
        y: -read(0) / variant.accelLsbPerG,
        x: read(1) / variant.accelLsbPerG,
        z: read(2) / variant.accelLsbPerG,
    };
}

// Reads the 128-byte NUL-padded NMEA field at the variant's RMC offset and
// returns the trimmed ASCII text (empty string when the field is all NULs).
function readRmcField(sample: Uint8Array, variant: NextbaseVariant): string {
    const start = 2 + variant.rmcOffset;
    const raw = sample.subarray(start, start + NMEA_FIELD_LEN);
    const nul = raw.indexOf(0);
    const text = new TextDecoder("latin1").decode(nul >= 0 ? raw.subarray(0, nul) : raw);
    return text.trim();
}

// Per-file accel baseline removal (see the header caveat). With >=2 samples
// the mean is subtracted in place (same DC-block as removeGsensoriBaseline in
// sbtl-nmea-extract.ts); with fewer the accel is ZEROED - raw values are
// unverified and a gravity-included ~1g floor must never reach impact
// detection.
function removeAccelBaseline(records: GpsRecord[], samples: Vec3[]): void {
    if (records.length === 0) return;
    if (samples.length < 2) {
        // <2 samples: raw values are unverified and a gravity-included ~1g floor
        // must never reach impact detection - zero them (see the header caveat).
        for (const r of records) {
            r.accelXg = 0;
            r.accelYg = 0;
            r.accelZg = 0;
        }
        return;
    }
    subtractAxisMean(records, samples);
}

/**
 * Extracts GPS records from a Nextbase binary subtitle track. Iterates every
 * sample, decoding the accel triple and the embedded RMC sentence. Returns
 * null when the track yields no valid RMC records (e.g. the whole clip is
 * pre-fix).
 */
export async function extractFromNextbaseSubtitleTrack(
    vf: VendorFile,
    index: Mp4Index,
    track: TrackInfo,
): Promise<ParsedRecords | null> {
    const sampleBuffers = await loadTrackSampleBuffers(vf.file, index, track);
    if (!sampleBuffers) return null;

    const records: GpsRecord[] = [];
    const skipped: SkippedLine[] = [];
    // All structurally-valid samples' raw accel (typically 1 Hz, one per
    // sample) - the population for the per-file mean. Records that carried a
    // valid fix get the baseline subtracted at the end.
    const accelSamples: Vec3[] = [];

    for (let i = 0; i < sampleBuffers.length; i++) {
        const sample = new Uint8Array(sampleBuffers[i]!);

        // Upstream skips tiny samples without error (length prefix <= 4,
        // gpssampleparser.cpp:118-120) - mirror that silently.
        if (sample.byteLength >= 2) {
            const declaredLen = (sample[0]! << 8) | sample[1]!;
            if (declaredLen <= PREFIX_ZEROS_LEN) continue;
        }

        const variant = detectVariantStructure(sample);
        if (!variant) {
            skipped.push({
                line: i + 1,
                raw: `<nextbase sample ${i + 1}: ${sample.byteLength} bytes>`,
                reason: "sample does not match the nextbase length-prefix structure",
            });
            continue;
        }

        const accel = decodeAccel(sample, variant);
        accelSamples.push(accel);

        const rmcText = readRmcField(sample, variant);
        // All-NUL field = no fix yet; nothing to report.
        if (rmcText === "") continue;
        // Extraction is slightly laxer than the marker: any $GxRMC talker is
        // accepted (matches parseNmeaText's stance) - the file was already
        // claimed by the strict "$GPRMC" marker, so this only adds tolerance
        // for a hypothetical multi-GNSS firmware, never new false claims.
        if (!/^\$G[A-Z]RMC,/.test(rmcText)) {
            skipped.push({
                line: i + 1,
                raw: `<nextbase sample ${i + 1}>: ${rmcText}`,
                reason: "rmc field does not start with $GxRMC",
            });
            continue;
        }

        // Strip the `*XX` checksum - never valid on these cameras
        // (camera-file-format.md:31), data is kept regardless.
        const star = rmcText.lastIndexOf("*");
        const body = star > 0 ? rmcText.slice(0, star) : rmcText;

        const parsed = parseRmc(body, vf.file.name, null);
        if ("error" in parsed) {
            skipped.push({ line: i + 1, raw: `<nextbase sample ${i + 1}>: ${rmcText}`, reason: parsed.error });
            continue;
        }
        // parsed.record === null is a void fix (status V) - skipped silently.
        if (parsed.record) {
            parsed.record.accelXg = accel.x;
            parsed.record.accelYg = accel.y;
            parsed.record.accelZg = accel.z;
            records.push(parsed.record);
        }
    }

    removeAccelBaseline(records, accelSamples);

    if (records.length === 0) return null;

    return {
        records: dedupByUnixSeconds(records),
        skipped,
    };
}

// Exported for unit tests.
export const _internal = {
    detectVariantStructure,
    decodeAccel,
    readRmcField,
    removeAccelBaseline,
    FMT1,
    FMT2,
};
