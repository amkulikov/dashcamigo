// Plain-text GPS log in a top-level atom (`udat`, `nbmt`) - NMEA or the Denver
// bracketed dialect. Parsing lives in internal/text-gpslog-atom.ts.
//
// Two primitives over one decoder because the two carriers belong at different
// points of the walk: `udat` is nobody else's atom, while `nbmt` is a Nextbase
// atom competing with Nextbase's own sample-validated track formats. See the
// registration comments in index.ts.

import { type ParsedRecords, type VendorFile, WrongFormatError } from "../types.js";
import type { Mp4Index } from "../internal/mp4-index.js";
import { hasTextGpsLogAtom, tryExtractTextGpsLog } from "../internal/text-gpslog-atom.js";
import type { Primitive } from "./types.js";

export const gpsLogAtomPrimitive: Primitive = {
    id: "gpslog-atom",
    displayName: "GPS log in a top-level text atom (udat)",
    kind: "video-embedded",

    async marker(_file: VendorFile, index?: Mp4Index): Promise<boolean> {
        // Sync: the atom heads are read during indexing, like the udta
        // carriers. No IO here.
        return index ? hasTextGpsLogAtom(index, ["udat"]) : false;
    },

    async parse(file: VendorFile, index?: Mp4Index): Promise<ParsedRecords> {
        if (!index) throw new WrongFormatError("gpslog-atom requires Mp4Index");
        const parsed = await tryExtractTextGpsLog(file, index, ["udat"]);
        if (!parsed) throw new WrongFormatError("the udat atom carries no NMEA or Denver records");
        return parsed;
    },
};

/**
 * The Nextbase `nbmt` half. Same decoders, separate registration: upstream
 * documents nothing about this atom's payload, so it must never outrank a
 * Nextbase track format that is validated against a real sample and carries
 * accel the text log has no field for.
 */
export const gpsLogNbmtPrimitive: Primitive = {
    id: "gpslog-atom-nbmt",
    displayName: "GPS log in the Nextbase nbmt text atom",
    kind: "video-embedded",

    async marker(_file: VendorFile, index?: Mp4Index): Promise<boolean> {
        return index ? hasTextGpsLogAtom(index, ["nbmt"]) : false;
    },

    async parse(file: VendorFile, index?: Mp4Index): Promise<ParsedRecords> {
        if (!index) throw new WrongFormatError("gpslog-atom-nbmt requires Mp4Index");
        const parsed = await tryExtractTextGpsLog(file, index, ["nbmt"]);
        if (!parsed) throw new WrongFormatError("the nbmt atom carries no NMEA or Denver records");
        return parsed;
    },
};
