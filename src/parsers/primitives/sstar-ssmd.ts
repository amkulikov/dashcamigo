// SigmaStar (SStar) firmware GPS in an `ssmd` meta track. Sample size and
// content distinguish its dialects from LigoGPS and Rove. Layout and quirks:
// internal/sstar-ssmd-extract.ts + docs/format-sstar-ssmd.md.

import { type ParsedRecords, type VendorFile, WrongFormatError } from "../types.js";
import type { Mp4Index } from "../internal/mp4-index.js";
import { extractFromSstarSsmdTrack, findSstarSsmdTrack } from "../internal/sstar-ssmd-extract.js";
import type { Primitive } from "./types.js";

export const sstarSsmdPrimitive: Primitive = {
    id: "sstar-ssmd",
    displayName: "SigmaStar ssmd GPS",
    kind: "video-embedded",

    async marker(file: VendorFile, index?: Mp4Index): Promise<boolean> {
        if (!index) return false;
        return (await findSstarSsmdTrack(file, index)) !== null;
    },

    async parse(file: VendorFile, index?: Mp4Index): Promise<ParsedRecords> {
        if (!index) throw new WrongFormatError("sstar-ssmd requires mp4 index");
        const track = await findSstarSsmdTrack(file, index);
        if (!track) throw new WrongFormatError("no supported ssmd meta track");
        const result = await extractFromSstarSsmdTrack(file, index, track);
        if (!result) throw new WrongFormatError("ssmd track samples do not match the sstar layout");
        return result;
    },
};
