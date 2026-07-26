// PNDM extractor - Garmin Dash Cam family (66W, 57, Mini 2, Mini 3, Live,
// Tandem, X). 20-byte struct inside an sbtl/text/meta track. Parsing lives
// in internal/pndm-extract.ts.

import { type ParsedRecords, type VendorFile, WrongFormatError } from "../types.js";
import type { Mp4Index } from "../internal/mp4-index.js";
import { extractFromPndmTrack, findPndmTrack } from "../internal/pndm-extract.js";
import type { Primitive } from "./types.js";

export const pndmPrimitive: Primitive = {
    id: "pndm",
    displayName: "PNDM (Garmin Dash Cam)",
    kind: "video-embedded",

    async marker(file: VendorFile, index?: Mp4Index): Promise<boolean> {
        if (!index) return false;
        // findPndmTrack probes the first sample of a candidate track (~20
        // bytes), cheaper than a full parse. Cached per-file inside Mp4Index.
        const track = await findPndmTrack(file, index);
        return track !== null;
    },

    async parse(file: VendorFile, index?: Mp4Index): Promise<ParsedRecords> {
        if (!index) throw new WrongFormatError("pndm requires Mp4Index");
        const track = await findPndmTrack(file, index);
        if (!track) throw new WrongFormatError("no Garmin PNDM track found");
        const result = await extractFromPndmTrack(file, index, track);
        if (!result) {
            throw new WrongFormatError("Garmin PNDM track has no samples or mvhd creation_time is zero");
        }
        return result;
    },
};
