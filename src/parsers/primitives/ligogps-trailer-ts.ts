// LigoGPS trailer extractor for MPEG-TS files. An unknown-vendor 2-channel
// camera (LCAI magic spelling) appends the plaintext twin of its in-stream
// encrypted LigoGPS to the end of each .ts; only the plaintext table is
// claimed. Detection is shared with the AV-side clamp in src/ts-trailer.ts;
// parsing lives in internal/ligogps.ts.
//
// No cloneAcrossGroup, unlike juscar-ts: front and rear carry near-identical
// tables but not always the same record COUNT, and their name stamps can
// differ by a second - so there is nothing safe to key a group on. Parsing
// both costs one ~8 KB tail read each, not a full-file scan.

import { parseLigoGpsTsTrailer } from "../internal/ligogps.js";
import type { ParsedRecords, VendorFile } from "../types.js";
import type { Mp4Index } from "../internal/mp4-index.js";
import type { Primitive } from "./types.js";

export const ligoGpsTrailerTsPrimitive: Primitive = {
    id: "ligogps-trailer-ts",
    displayName: "LigoGPS trailer (MPEG-TS)",
    kind: "video-embedded",

    async marker(_file: VendorFile, index?: Mp4Index): Promise<boolean> {
        // Detection ran during indexing (name-gated, two reads under 32 B) -
        // this is a sync field check, and the same field gates dispatch.
        return index?.tsGpsTrailer != null;
    },

    async parse(file: VendorFile, _index?: Mp4Index): Promise<ParsedRecords> {
        return parseLigoGpsTsTrailer(file);
    },
};
