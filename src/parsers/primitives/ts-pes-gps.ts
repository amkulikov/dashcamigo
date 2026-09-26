// INNOVV / DOD LS600W / Viidure GPS in an MPEG-TS private PES. Parsing lives in
// internal/ts-pes-gps.ts.

import { type ParsedRecords, type VendorFile, WrongFormatError } from "../types.js";
import type { Mp4Index } from "../internal/mp4-index.js";
import { extractTsPesGps, findTsPesGpsStream } from "../internal/ts-pes-gps.js";
import type { Primitive } from "./types.js";

export const tsPesGpsPrimitive: Primitive = {
    id: "ts-pes-gps",
    displayName: "INNOVV / DOD / Viidure GPS in MPEG-TS PES",
    kind: "video-embedded",

    async marker(_file: VendorFile, index?: Mp4Index): Promise<boolean> {
        // Probe the payload so renamed recordings keep their GPS.
        const bytes = index?.headerBytes;
        return bytes ? findTsPesGpsStream(bytes) !== null : false;
    },

    async parse(file: VendorFile, index?: Mp4Index, signal?: AbortSignal): Promise<ParsedRecords> {
        if (!index) throw new WrongFormatError("ts-pes-gps requires Mp4Index");
        return extractTsPesGps(file, index.headerBytes, signal);
    },
};
