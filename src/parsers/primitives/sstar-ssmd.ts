// SigmaStar (SStar) firmware extractor - GPS as constant 40-byte direct or
// 56-byte KTRX samples in an `ssmd` meta track (NOT the LigoGPS dialect and
// NOT the Rove 32-byte one). Known cameras: Neoline Spectrum family and the
// iZEEKER iD300. Byte layout, verification evidence and quirks:
// internal/sstar-ssmd-extract.ts + docs/format-sstar-ssmd.md.

import { type ParsedRecords, type VendorFile, WrongFormatError } from "../types.js";
import { getFirstSampleOfTrack, type Mp4Index } from "../internal/mp4-index.js";
import {
    extractFromSstarSsmdTrack,
    findSstarSsmdTrack,
    looksLikeSstarSsmdSample,
} from "../internal/sstar-ssmd-extract.js";
import type { Primitive } from "./types.js";

export const sstarSsmdPrimitive: Primitive = {
    id: "sstar-ssmd",
    displayName: "SigmaStar ssmd GPS",
    kind: "video-embedded",

    async marker(file: VendorFile, index?: Mp4Index): Promise<boolean> {
        if (!index) return false;
        // Structural gate is sync over the moov already in memory: meta
        // handler + ssmd format + one supported constant sample size. That
        // alone is a weak signature, so the first sample (cached in Mp4Index)
        // must also carry a dialect-specific marker and decode coherently.
        const track = findSstarSsmdTrack(index);
        if (!track) return false;
        const first = await getFirstSampleOfTrack(index, track, file);
        if (!first) return false;
        return looksLikeSstarSsmdSample(new DataView(first.buffer, first.byteOffset, first.byteLength));
    },

    async parse(file: VendorFile, index?: Mp4Index): Promise<ParsedRecords> {
        if (!index) throw new WrongFormatError("sstar-ssmd requires Mp4Index");
        const track = findSstarSsmdTrack(index);
        if (!track) throw new WrongFormatError("no supported ssmd meta track");
        const result = await extractFromSstarSsmdTrack(file, index, track);
        if (!result) throw new WrongFormatError("ssmd track samples do not match the sstar layout");
        return result;
    },
};
