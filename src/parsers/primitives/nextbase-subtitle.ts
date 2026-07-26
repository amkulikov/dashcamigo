// Nextbase 322GW/422GW/522GW/622GW binary-subtitle GPS+accel. Fixed-size
// binary structs (uint16-BE length prefix 0x0120 / 0x0416) in a subtitle
// track, each carrying a datetime field, a y/x/z accel triple and NUL-padded
// $GPRMC/$GPGGA strings. Decoding lives in
// internal/nextbase-subtitle-extract.ts.
//
// Implemented from foreign source (nb-dashcam-tools @ b51f244,
// src/gpssampleparser.cpp). The fmt1 (322GW-family) variant is validated
// against a real clip (FH stream): 1800 monotonic records at 10 Hz with
// plausible coordinates and speed. The fmt2 (622GW) variant remains
// unvalidated on a real sample and is additionally marked untested upstream.
//
// REGISTRATION ORDER: must be listed BEFORE nmea-subtitle in
// VIDEO_EMBEDDED_PRIMITIVES. The Thinkware marker strips the same uint16-BE
// sample prefix and its RMC regex accepts '$' as a boundary, so it fires on
// the "$GPRMC" embedded in a Nextbase sample and would half-claim the file
// (coords parsed, accel lost). The reverse is safe: Thinkware's
// variable-length text cues never pass this primitive's exact-length gate.

import { type ParsedRecords, type VendorFile, WrongFormatError } from "../types.js";
import type { Mp4Index } from "../internal/mp4-index.js";
import { extractFromNextbaseSubtitleTrack, findNextbaseSubtitleTrack } from "../internal/nextbase-subtitle-extract.js";
import type { Primitive } from "./types.js";

export const nextbaseSubtitlePrimitive: Primitive = {
    id: "nextbase-subtitle",
    displayName: "Nextbase binary subtitle (322GW/422GW/522GW/622GW)",
    kind: "video-embedded",

    async marker(file: VendorFile, index?: Mp4Index): Promise<boolean> {
        if (!index) return false;
        // First-sample probe (~290 bytes), cached per-file inside Mp4Index.
        const track = await findNextbaseSubtitleTrack(file, index);
        return track !== null;
    },

    async parse(file: VendorFile, index?: Mp4Index): Promise<ParsedRecords> {
        if (!index) throw new WrongFormatError("nextbase-subtitle requires Mp4Index");
        const track = await findNextbaseSubtitleTrack(file, index);
        if (!track) {
            throw new WrongFormatError("no subtitle track with nextbase binary samples");
        }
        const result = await extractFromNextbaseSubtitleTrack(file, index, track);
        if (!result) {
            throw new WrongFormatError("nextbase subtitle track contains no valid GPRMC records");
        }
        return result;
    },
};
