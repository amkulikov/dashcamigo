// GPMF extractor - GoPro HERO5+ (GPS5) and HERO11/13 (GPS9) plus third-party
// firmware that writes the same sample format into a `gpmd` track. Parsing
// lives in internal/gpmf-extract.ts.

import { type ParsedRecords, type VendorFile, WrongFormatError } from "../types.js";
import type { Mp4Index } from "../internal/mp4-index.js";
import { extractFromGpmdTrack, findGpmdTrack } from "../internal/gpmf-extract.js";
import type { Primitive } from "./types.js";

export const gpmfPrimitive: Primitive = {
    id: "gpmf",
    displayName: "GPMF (GoPro / compatible)",
    kind: "video-embedded",

    async marker(_file: VendorFile, index?: Mp4Index): Promise<boolean> {
        if (!index) return false;
        return findGpmdTrack(index) !== null;
    },

    async parse(file: VendorFile, index?: Mp4Index): Promise<ParsedRecords> {
        if (!index) throw new WrongFormatError("gpmf requires Mp4Index");
        const track = findGpmdTrack(index);
        if (!track) throw new WrongFormatError("no gpmd track");
        const result = await extractFromGpmdTrack(file, index, track);
        if (!result) throw new WrongFormatError("gpmd track has no samples");
        return result;
    },
};
