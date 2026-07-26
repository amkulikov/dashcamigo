// Garmin DriveAssist 51 extractor - GPS in a `uuid` atom (direct child of
// moov, exact 16-byte usertype signature). Distinct from the PNDM
// subtitle-track format of the Garmin Dash Cam line (pndm.ts). Parsing lives
// in internal/garmin-uuid.ts; see the foreign-source note there.

import { findGarminUuidBox, parseGarminUuidBox } from "../internal/garmin-uuid.js";
import type { Mp4Index } from "../internal/mp4-index.js";
import { type ParsedRecords, type VendorFile, WrongFormatError } from "../types.js";
import type { Primitive } from "./types.js";

export const garminUuidPrimitive: Primitive = {
    id: "garmin-uuid",
    displayName: "Garmin DriveAssist 51 (uuid atom)",
    kind: "video-embedded",

    async marker(_file: VendorFile, index?: Mp4Index): Promise<boolean> {
        if (!index) return false;
        // Sync usertype scan over the already-loaded moov bytes - zero IO.
        return findGarminUuidBox(index) !== null;
    },

    async parse(file: VendorFile, index?: Mp4Index): Promise<ParsedRecords> {
        if (!index) throw new WrongFormatError("garmin-uuid requires Mp4Index");
        const box = findGarminUuidBox(index);
        // The box "vanishing" between marker and parse means the index was
        // rebuilt or the marker was never ours - either way, not our format.
        if (!box || !index.moovView) {
            throw new WrongFormatError("no garmin gps uuid atom in moov");
        }
        // Empty records are a valid result here (camera never had a fix):
        // the exact UUID signature rules out a format false-positive.
        return parseGarminUuidBox(index.moovView, box, file.file.name);
    },
};
