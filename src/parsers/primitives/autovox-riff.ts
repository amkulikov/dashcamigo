// Auto-Vox RIFF-trailer extractor: GPS + accelerometer chunks appended after
// the last ISOBMFF box. Parsing lives in internal/autovox-riff.ts.

import { type ParsedRecords, type VendorFile, WrongFormatError } from "../types.js";
import type { Mp4Index } from "../internal/mp4-index.js";
import { hasAutoVoxTrailerSignature, MAX_TRAILER_BYTES, parseAutoVoxTrailer } from "../internal/autovox-riff.js";
import type { Primitive } from "./types.js";

/** Start of the trailing region, or null when the file has no bytes past its
 *  last top-level box. */
function trailerStart(index: Mp4Index): number | null {
    const end = index.lastTopLevelBoxEnd;
    if (end === null || end >= index.fileSize) return null;
    return end;
}

export const autoVoxRiffPrimitive: Primitive = {
    id: "autovox-riff",
    displayName: "Auto-Vox (RIFF trailer)",
    kind: "video-embedded",

    async marker(_file: VendorFile, index?: Mp4Index): Promise<boolean> {
        // The head of the trailing region is already in the index (the kind
        // gate needs it synchronously), so the marker costs no IO.
        if (!index?.trailerHead) return false;
        return hasAutoVoxTrailerSignature(index.trailerHead);
    },

    async parse(file: VendorFile, index?: Mp4Index): Promise<ParsedRecords> {
        if (!index) throw new WrongFormatError("autovox-riff requires Mp4Index");
        const start = trailerStart(index);
        if (start === null) throw new WrongFormatError("no trailing region after the last box");

        const end = Math.min(index.fileSize, start + MAX_TRAILER_BYTES);
        const trailer = new Uint8Array(await file.file.slice(start, end).arrayBuffer());
        const parsed = parseAutoVoxTrailer(trailer, file.file.name);
        if (!parsed) throw new WrongFormatError("RIFF trailer carries no decodable gps0 records");
        return parsed;
    },
};
