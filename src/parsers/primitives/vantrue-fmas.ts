// Vantrue N2S FMAS extractor - a `gpmd`-named meta track that is NOT GPMF:
// fixed binary records with an 8-byte 'FMAS\0\0\0\0' prefix. Runs after the
// gpmf primitive (which yields zero records on FMAS bytes and lets the
// dispatcher walk on) and after wolfbox-gpmd (whose variant detection rejects
// FMAS: variant B needs >= 0xf8-byte samples, variant A reads 'FMAS' as a
// non-0/1 status int). Unlike wolfbox there is NO meta-handler fallback -
// ExifTool routes FMAS strictly via the gpmd sample-format condition
// '^FMAS\0\0\0\0' (QuickTimeStream.pl:196-201, v13.59). Record layout and
// parsing live in internal/vantrue-fmas.ts.

import { findTrackBySampleFormat, getFirstSampleOfTrack, type Mp4Index } from "../internal/mp4-index.js";
import { extractFromFmasTrack, hasFmasFirstSamplePrefix } from "../internal/vantrue-fmas.js";
import { type ParsedRecords, type VendorFile, WrongFormatError } from "../types.js";
import type { Primitive } from "./types.js";

export const vantrueFmasPrimitive: Primitive = {
    id: "vantrue-fmas",
    displayName: "Vantrue FMAS gpmd struct",
    kind: "video-embedded",

    async marker(file: VendorFile, index?: Mp4Index): Promise<boolean> {
        if (!index) return false;
        const track = findTrackBySampleFormat(index, ["gpmd"]);
        if (!track) return false;
        // Content probe of the first sample (cached in Mp4Index): strict
        // 8-byte 'FMAS\0\0\0\0' prefix check only.
        const first = await getFirstSampleOfTrack(index, track, file);
        if (!first) return false;
        return hasFmasFirstSamplePrefix(first);
    },

    async parse(file: VendorFile, index?: Mp4Index): Promise<ParsedRecords> {
        if (!index) throw new WrongFormatError("vantrue-fmas requires Mp4Index");
        const track = findTrackBySampleFormat(index, ["gpmd"]);
        if (!track) throw new WrongFormatError("no gpmd track");
        const result = await extractFromFmasTrack(file, index, track);
        if (!result) throw new WrongFormatError("track samples match no fmas layout");
        return result;
    },
};
