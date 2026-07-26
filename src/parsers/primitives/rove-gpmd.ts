// Rove Stealth 4K: XOR-0xAA encrypted ASCII GPS in the samples of a `gpmd`
// track. Same record format as the Azdome freeGPS blocks and the Lamax S9
// `gps0` atom - see internal/xor-ascii-gps.ts; only the carrier differs.
//
// ExifTool routes it by an stsd-level condition (`gpmd_Rove`,
// QuickTimeStream.pl:189, v13.55): a `gpmd` sample opening with
// `\0\0\xf2\xe1\xf0\xeeTT`. That is a real signature, not a heuristic - those
// bytes are the encrypted literal "XKZD\xfe\xfe".
//
// Ordering: runs AFTER gpmf / wolfbox-gpmd / vantrue-fmas, which own the other
// `gpmd` dialects. Each rejects the others by content, so order is cost, not
// correctness.

import { type GpsRecord, type ParsedRecords, type VendorFile, WrongFormatError } from "../types.js";
import { getFirstSampleOfTrack, type Mp4Index, type TrackInfo } from "../internal/mp4-index.js";
import { loadSamples, readSampleTable } from "../internal/mp4-walker.js";
import { removeGravityBaselineOrZero } from "../internal/accel-baseline.js";
import {
    decodeXorAsciiGpsText,
    decryptXorAscii,
    hasXorAsciiSignature,
    XOR_ASCII_MIN_LENGTH,
} from "../internal/xor-ascii-gps.js";
import type { Primitive } from "./types.js";

// The signature sits two bytes into the sample (the record's own preamble).
const SIGNATURE_OFFSET = 2;

/** The gpmd/meta track this format could live in, if any. */
function findGpmdTrack(index: Mp4Index): TrackInfo | null {
    if (!index.moovView) return null;
    return index.tracks.find((t) => t.sampleFormat === "gpmd" || t.handlerType === "meta") ?? null;
}

export const roveGpmdPrimitive: Primitive = {
    id: "rove-gpmd",
    displayName: "Rove Stealth 4K gpmd (XOR-0xAA ASCII)",
    kind: "video-embedded",

    async marker(file: VendorFile, index?: Mp4Index): Promise<boolean> {
        if (!index?.moovView) return false;
        const track = findGpmdTrack(index);
        if (!track) return false;
        // Through the index cache, not a direct read: the gpmd/meta primitives
        // ahead of this one probe the same first sample, so one file pays one
        // read for the whole marker walk instead of one per primitive.
        const first = await getFirstSampleOfTrack(index, track, file);
        if (!first || first.length < XOR_ASCII_MIN_LENGTH) return false;
        return hasXorAsciiSignature(first, SIGNATURE_OFFSET);
    },

    async parse(file: VendorFile, index?: Mp4Index): Promise<ParsedRecords> {
        if (!index?.moovView) throw new WrongFormatError("rove-gpmd requires a parsed moov");
        const track = findGpmdTrack(index);
        if (!track) throw new WrongFormatError("no gpmd track");
        const samples = readSampleTable(index.moovView, track.trakBox);
        if (!samples || samples.length === 0) throw new WrongFormatError("gpmd track has no samples");

        const buffers = await loadSamples(file.file, samples, index.sliceCost);
        const records: GpsRecord[] = [];
        for (const buf of buffers) {
            const bytes = new Uint8Array(buf);
            if (bytes.length < XOR_ASCII_MIN_LENGTH) continue;
            if (!hasXorAsciiSignature(bytes, SIGNATURE_OFFSET)) continue;
            const record = decodeXorAsciiGpsText(decryptXorAscii(bytes, 0, bytes.length), file.file.name);
            // No-fix samples carry accel and a clock only - skipped, not an error.
            if (record) records.push(record);
        }
        if (records.length === 0) throw new WrongFormatError("gpmd track carries no decodable xor-ascii records");

        // The triple is gravity-included; the per-file mean is the bias estimate.
        removeGravityBaselineOrZero(records);
        return { records, skipped: [] };
    },
};
