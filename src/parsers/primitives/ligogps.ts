// LigoGPS extractor. Encrypted/plaintext dual payload in the `ssmd`
// meta-track, used on CarCam 4CH 360-WiFi and similar SigmaStar SoCs.
// Parsing lives in internal/ligogps.ts.

import { type ParsedRecords, type VendorFile, WrongFormatError } from "../types.js";
import type { Mp4Index } from "../internal/mp4-index.js";
import { parseLigoGpsFromMp4 } from "../internal/ligogps.js";
import type { Primitive } from "./types.js";

export const ligoGpsPrimitive: Primitive = {
    id: "ligogps",
    displayName: "LigoGPS (CarCam / SigmaStar)",
    kind: "video-embedded",

    async marker(_file: VendorFile, index?: Mp4Index): Promise<boolean> {
        if (!index) return false;
        return index.hasLigoGpsMarker === true;
    },

    async parse(file: VendorFile, index?: Mp4Index): Promise<ParsedRecords> {
        if (!index) throw new WrongFormatError("ligogps requires Mp4Index");
        return parseLigoGpsFromMp4(file, index);
    },
};
