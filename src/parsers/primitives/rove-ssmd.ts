// Rove R2-4K extractor - "RoveGPS" 32-byte binary samples in an `ssmd` meta
// track (NOT the LigoGPS ssmd dialect: that one carries the LIGOGPSINFO
// string in 64..1024-byte samples and is handled by the ligogps primitive).
// Implemented from foreign source (ExifTool 13.59 QuickTimeStream.pl:330-403),
// not validated against a real sample - layout, sentinel and the open
// hemisphere/TZ questions are documented in internal/rove-ssmd.ts.

import { type ParsedRecords, type VendorFile, WrongFormatError } from "../types.js";
import { getFirstSampleOfTrack, type Mp4Index } from "../internal/mp4-index.js";
import { extractFromRoveSsmdTrack, findRoveSsmdTrack, looksLikeRoveSsmdSample } from "../internal/rove-ssmd.js";
import type { Primitive } from "./types.js";

export const roveSsmdPrimitive: Primitive = {
    id: "rove-ssmd",
    displayName: "Rove R2-4K ssmd GPS",
    kind: "video-embedded",

    async marker(file: VendorFile, index?: Mp4Index): Promise<boolean> {
        if (!index) return false;
        // Structural gate is sync over the moov already in memory: meta
        // handler + ssmd format + constant 32-byte samples. A 32-byte meta
        // track alone is a weak signature, so the first sample (cached in
        // Mp4Index) must also carry the no-fix sentinel or decode plausibly.
        const track = findRoveSsmdTrack(index);
        if (!track) return false;
        const first = await getFirstSampleOfTrack(index, track, file);
        if (!first) return false;
        return looksLikeRoveSsmdSample(new DataView(first.buffer, first.byteOffset, first.byteLength));
    },

    async parse(file: VendorFile, index?: Mp4Index): Promise<ParsedRecords> {
        if (!index) throw new WrongFormatError("rove-ssmd requires Mp4Index");
        const track = findRoveSsmdTrack(index);
        if (!track) throw new WrongFormatError("no 32-byte ssmd meta track");
        const result = await extractFromRoveSsmdTrack(file, index, track);
        if (!result) throw new WrongFormatError("ssmd track samples do not match the rove layout");
        return result;
    },
};
