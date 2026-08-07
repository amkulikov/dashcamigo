// LigoGPS file-trailer extractor. Beferich J18 (and relatives) append a
// zero-padded trailer after the last top-level box with an encrypted
// LIGOGPSINFO directory plus a plaintext twin table; only the plaintext
// table is claimed. Parsing lives in internal/ligogps.ts.

import { type ParsedRecords, type VendorFile, WrongFormatError } from "../types.js";
import type { Mp4Index } from "../internal/mp4-index.js";
import { hasLigoTrailerMarker, LIGO_TRAILER_PROBE_BYTES, parseLigoGpsTrailer } from "../internal/ligogps.js";
import type { Primitive } from "./types.js";

export const ligoGpsTrailerPrimitive: Primitive = {
    id: "ligogps-trailer",
    displayName: "LigoGPS trailer (Beferich)",
    kind: "video-embedded",

    async marker(file: VendorFile, index?: Mp4Index): Promise<boolean> {
        const end = index?.lastTopLevelBoxEnd;
        if (index === undefined || end === null || end === undefined) return false;
        if (end >= index.fileSize) return false; // box structure covers the file - no trailer
        try {
            const probeEnd = Math.min(index.fileSize, end + LIGO_TRAILER_PROBE_BYTES);
            const head = new Uint8Array(await file.file.slice(end, probeEnd).arrayBuffer());
            return hasLigoTrailerMarker(head);
        } catch {
            // IO failure - treat as no marker; the walk moves on.
            return false;
        }
    },

    async parse(file: VendorFile, index?: Mp4Index): Promise<ParsedRecords> {
        if (!index) throw new WrongFormatError("ligogps-trailer requires Mp4Index");
        return parseLigoGpsTrailer(file, index);
    },
};
