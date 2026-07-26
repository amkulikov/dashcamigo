// Older 70mai "Pro" (Midrive D02/D03) GPS-box primitive. GPS is an array of
// direct 36-byte records in a top-level `GPS ` box (uppercase 4cc). Byte layout
// + decoding live in internal/gps-box-70mai.ts.
//
// Capability-gated, not vendor-gated: the marker keys on the `GPS ` box itself
// (Mp4Index.maiGpsBox), so any camera writing this exact box+record format is
// covered. parse() validates strictly (valid fix + in-range DD MM coords) and
// throws WrongFormatError on a box that is not actually this format, so a stray
// uppercase `GPS ` box from another vendor falls through to the next primitive.

import { type ParsedRecords, type VendorFile, WrongFormatError } from "../types.js";
import type { Mp4Index } from "../internal/mp4-index.js";
import { parseMaiGpsBox } from "../internal/gps-box-70mai.js";
import type { Primitive } from "./types.js";

export const gpsBox70maiPrimitive: Primitive = {
    id: "gps-box-70mai",
    displayName: "70mai Pro GPS box (direct records)",
    kind: "video-embedded",

    async marker(_file: VendorFile, index?: Mp4Index): Promise<boolean> {
        if (!index) return false;
        return index.maiGpsBox !== null;
    },

    async parse(file: VendorFile, index?: Mp4Index): Promise<ParsedRecords> {
        if (!index?.maiGpsBox) throw new WrongFormatError("gps-box-70mai requires a GPS box");
        const { offset, size } = index.maiGpsBox;
        const boxBytes = new Uint8Array(await file.file.slice(offset, offset + size).arrayBuffer());
        const parsed = parseMaiGpsBox(boxBytes, file.file.name);
        if (parsed.records.length === 0) {
            throw new WrongFormatError("GPS box present but produced no valid records");
        }
        return parsed;
    },
};
