// Kenwood DRV-series extractor - dispatches the two carriers decoded in
// internal/kenwood.ts:
//
//   1. VIDEOUUU udta records. Primary location: a TOP-LEVEL udta atom
//      (Mp4Index.topLevelUdtaAtoms - every file-level udta is head-checked,
//      so a generic leading udta cannot shadow the carrier). moov/udta is
//      also checked - ExifTool only documents the top-level form, but
//      moovView is already in memory, so the check costs nothing and covers
//      firmware that nests the same payload conventionally.
//   2. CCCC trailer right after the last top-level atom
//      (Mp4Index.lastTopLevelBoxEnd) - an O(1) ~40-byte probe.
//
// Carriers are tried in that order and the FIRST one yielding records wins:
// no upstream evidence exists of one file carrying both, and concatenating
// two carriers that duplicate the same fixes would double every track point.
//
// Implemented from foreign source (ExifTool 13.59 QuickTimeStream.pl:
// 2855-2900, 2994-3041 + QuickTime.pm:826-833, 10179-10184), not validated
// against a real sample. Time/unit caveats: see internal/kenwood.ts.

import { extendArray } from "../../array-extend.js";
import type { Mp4Index } from "../internal/mp4-index.js";
import {
    findKenwoodMoovUdta,
    hasKenwoodTrailerMarker,
    hasKenwoodUdtaMarker,
    KENWOOD_TRAILER_PROBE_BYTES,
    parseKenwoodTrailer,
    parseKenwoodUdta,
} from "../internal/kenwood.js";
import { type ParsedRecords, type VendorFile, WrongFormatError } from "../types.js";
import type { Primitive } from "./types.js";

/** Cap on the udta payload read. udta records are ~70-120 bytes/sec of
 *  recording -> a 1 h clip stays under 0.5 MB; 4 MB is corrupt-data armor,
 *  not a real-world bound. */
const UDTA_READ_CAP = 4 << 20;

/** Cap on the trailer read, same reasoning at 121 bytes/sec. */
const TRAILER_READ_CAP = 4 << 20;

/** O(1) probe at the last-top-level-box-end offset for the CCCC trailer
 *  marker. False when the box structure covers the whole file (no trailing
 *  junk - the common case, no IO at all). */
async function probeKenwoodTrailer(file: File, index: Mp4Index): Promise<boolean> {
    const end = index.lastTopLevelBoxEnd;
    // typeof guard doubles as armor against stub indexes lacking the field.
    if (typeof end !== "number") return false;
    if (end + KENWOOD_TRAILER_PROBE_BYTES > index.fileSize) return false;
    try {
        const head = new Uint8Array(await file.slice(end, end + KENWOOD_TRAILER_PROBE_BYTES).arrayBuffer());
        return hasKenwoodTrailerMarker(head);
    } catch {
        return false; // IO failure - degrade to "no trailer"
    }
}

export const kenwoodPrimitive: Primitive = {
    id: "kenwood",
    displayName: "Kenwood (VIDEOUUU udta / CCCC trailer)",
    kind: "video-embedded",

    async marker(file: VendorFile, index?: Mp4Index): Promise<boolean> {
        if (!index) return false;
        for (const udta of index.topLevelUdtaAtoms) {
            if (udta.head && hasKenwoodUdtaMarker(udta.head)) return true;
        }
        if (findKenwoodMoovUdta(index) !== null) return true;
        return await probeKenwoodTrailer(file.file, index);
    },

    async parse(file: VendorFile, index?: Mp4Index): Promise<ParsedRecords> {
        if (!index) throw new WrongFormatError("kenwood requires Mp4Index");
        let matchedCarrier = false;
        // Skipped entries survive across carriers: a marker that matched but
        // decoded nothing is exactly what a diagnostics report needs to show.
        const skipped: ParsedRecords["skipped"] = [];
        const finish = (parsed: ParsedRecords): ParsedRecords | null => {
            matchedCarrier = true;
            extendArray(skipped, parsed.skipped);
            return parsed.records.length > 0 ? { records: parsed.records, skipped } : null;
        };

        // Carrier 1a: top-level udta - every atom whose head carries the
        // VIDEOUUU literal, in file order (a generic udta may precede it).
        for (const udta of index.topLevelUdtaAtoms) {
            if (!udta.head || !hasKenwoodUdtaMarker(udta.head)) continue;
            const payloadStart = udta.offset + udta.headerSize;
            const payloadEnd = Math.min(udta.offset + udta.size, payloadStart + UDTA_READ_CAP);
            const payload = new Uint8Array(await file.file.slice(payloadStart, payloadEnd).arrayBuffer());
            const done = finish(parseKenwoodUdta(payload, file.file.name));
            if (done) return done;
        }

        // Carrier 1b: moov/udta (payload already in moovView - no IO).
        const moovUdta = findKenwoodMoovUdta(index);
        if (moovUdta && index.moovView) {
            const mv = index.moovView;
            const payload = new Uint8Array(
                mv.buffer,
                mv.byteOffset + moovUdta.payloadStart,
                moovUdta.end - moovUdta.payloadStart,
            );
            const done = finish(parseKenwoodUdta(payload, file.file.name));
            if (done) return done;
        }

        // Carrier 2: CCCC trailer.
        if (await probeKenwoodTrailer(file.file, index)) {
            const start = index.lastTopLevelBoxEnd as number;
            const end = Math.min(index.fileSize, start + TRAILER_READ_CAP);
            const bytes = new Uint8Array(await file.file.slice(start, end).arrayBuffer());
            const done = finish(parseKenwoodTrailer(bytes, file.file.name));
            if (done) return done;
        }

        if (!matchedCarrier) {
            throw new WrongFormatError("no kenwood gps carrier (VIDEOUUU udta or CCCC trailer) found");
        }
        // A carrier literal matched but every record was void/corrupt: the
        // file IS this format, it just has no decodable GPS - empty records,
        // not WrongFormatError (mirrors the Primitive.parse contract).
        return { records: [], skipped };
    },
};
