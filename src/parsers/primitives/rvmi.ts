// RVMI extractor - RegistratorViewer meta-track appended on fragment export.
// Not tied to any vendor: original camera identity is lost after re-export.
// Parsing lives in internal/rvmi-extract.ts.

import { type ParsedRecords, type VendorFile, WrongFormatError } from "../types.js";
import type { Mp4Index } from "../internal/mp4-index.js";
import { extractFromRvmiTrack, findRvmiTrack } from "../internal/rvmi-extract.js";
import type { Primitive } from "./types.js";

export const rvmiPrimitive: Primitive = {
    id: "rvmi",
    displayName: "RVMI (RegistratorViewer re-export)",
    kind: "video-embedded",

    async marker(_file: VendorFile, index?: Mp4Index): Promise<boolean> {
        if (!index) return false;
        return findRvmiTrack(index) !== null;
    },

    async parse(file: VendorFile, index?: Mp4Index): Promise<ParsedRecords> {
        if (!index) throw new WrongFormatError("rvmi requires Mp4Index");
        const track = findRvmiTrack(index);
        if (!track) throw new WrongFormatError("no RVMI track");
        const result = await extractFromRvmiTrack(file, index, track);
        if (!result) throw new WrongFormatError("RVMI track has no samples");
        return result;
    },
};
