// Nextbase `gdat` extractor - Base64+JSON GPS track in a top-level atom.
// Decoding lives in internal/nextbase-gdat.ts.

import { createLogger } from "../../log.js";
import { type ParsedRecords, type VendorFile, WrongFormatError } from "../types.js";
import type { Mp4Index } from "../internal/mp4-index.js";
import { hasNextbaseGdatHead, parseNextbaseGdat } from "../internal/nextbase-gdat.js";
import type { Primitive } from "./types.js";

const log = createLogger("primitive:nextbase-gdat");

// A whole-track JSON blob, Base64-inflated by 4/3. 16 MB holds tens of
// thousands of fixes; past that the atom is not a track we can use. Unlike a
// line-based log this cannot be truncated and salvaged - a cut Base64 blob is
// simply not JSON - so the cap is a bail, not a trim.
const GDAT_MAX_BYTES = 16 * 1024 * 1024;

export const nextbaseGdatPrimitive: Primitive = {
    id: "nextbase-gdat",
    displayName: "Nextbase gdat (Base64 JSON GPS)",
    kind: "video-embedded",

    async marker(_file: VendorFile, index?: Mp4Index): Promise<boolean> {
        const head = index?.topLevelGdatAtom?.head;
        return head ? hasNextbaseGdatHead(head) : false;
    },

    async parse(file: VendorFile, index?: Mp4Index): Promise<ParsedRecords> {
        const atom = index?.topLevelGdatAtom;
        if (!atom || atom.size <= atom.headerSize) throw new WrongFormatError("no gdat atom");

        const payloadStart = atom.offset + atom.headerSize;
        const payloadEnd = atom.offset + atom.size;
        if (payloadEnd - payloadStart > GDAT_MAX_BYTES) {
            log.warn("gdat atom exceeds the read cap - left unparsed", { payloadBytes: payloadEnd - payloadStart });
            throw new WrongFormatError("gdat atom too large to decode");
        }

        const payload = new Uint8Array(await file.file.slice(payloadStart, payloadEnd).arrayBuffer());
        const parsed = parseNextbaseGdat(payload, file.file.name);
        if (!parsed) throw new WrongFormatError("gdat atom is not decodable Base64 JSON with active fixes");
        return parsed;
    },
};
