// Wolfbox / Redtiger extractor - a `gpmd`-named meta track that is NOT GPMF:
// fixed structs of int64 value/scale pairs. Runs after the gpmf primitive
// (which yields zero records on these tracks and lets the dispatcher walk
// on). Parsing and the two known offset layouts live in
// internal/wolfbox-gpmd.ts.

import { type ParsedRecords, type VendorFile, WrongFormatError } from "../types.js";
import { getFirstSampleOfTrack, type Mp4Index } from "../internal/mp4-index.js";
import { detectWolfboxVariant, extractFromWolfboxTrack, findWolfboxCandidateTrack } from "../internal/wolfbox-gpmd.js";
import type { Primitive } from "./types.js";

export const wolfboxGpmdPrimitive: Primitive = {
    id: "wolfbox-gpmd",
    displayName: "Wolfbox/Redtiger gpmd struct",
    kind: "video-embedded",

    async marker(file: VendorFile, index?: Mp4Index): Promise<boolean> {
        if (!index) return false;
        const track = findWolfboxCandidateTrack(index);
        if (!track) return false;
        // Content probe of the first sample (cached in Mp4Index): rules out
        // GPMF KLV and verifies one of the two known struct layouts.
        const first = await getFirstSampleOfTrack(index, track, file);
        if (!first || first.byteLength === 0) return false;
        return detectWolfboxVariant(new DataView(first.buffer, first.byteOffset, first.byteLength)) !== null;
    },

    async parse(file: VendorFile, index?: Mp4Index): Promise<ParsedRecords> {
        if (!index) throw new WrongFormatError("wolfbox-gpmd requires Mp4Index");
        const track = findWolfboxCandidateTrack(index);
        if (!track) throw new WrongFormatError("no gpmd/meta candidate track");
        const result = await extractFromWolfboxTrack(file, index, track);
        if (!result) throw new WrongFormatError("track samples match no known wolfbox layout");
        return result;
    },
};
