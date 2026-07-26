// SigmaStar (SStar) firmware extractor - GPS as constant 40-byte samples in
// an `ssmd` meta track (NOT the LigoGPS ssmd dialect and NOT the Rove
// 32-byte one; the constant-40 stsz gate keeps all ssmd dwellers disjoint).
// Known cameras: Neoline Spectrum mirror cam and a Spectrum-family 4K front
// cam (different flags base). Byte layout, verification evidence and quirks:
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
    displayName: "SigmaStar ssmd GPS (Neoline Spectrum)",
    kind: "video-embedded",

    async marker(file: VendorFile, index?: Mp4Index): Promise<boolean> {
        if (!index) return false;
        // Structural gate is sync over the moov already in memory: meta
        // handler + ssmd format + constant 40-byte samples. That alone is a
        // weak signature, so the first sample (cached in Mp4Index) must also
        // carry a known flags word and decode coherently.
        const track = findSstarSsmdTrack(index);
        if (!track) return false;
        const first = await getFirstSampleOfTrack(index, track, file);
        if (!first) return false;
        return looksLikeSstarSsmdSample(new DataView(first.buffer, first.byteOffset, first.byteLength));
    },

    async parse(file: VendorFile, index?: Mp4Index): Promise<ParsedRecords> {
        if (!index) throw new WrongFormatError("sstar-ssmd requires Mp4Index");
        const track = findSstarSsmdTrack(index);
        if (!track) throw new WrongFormatError("no 40-byte ssmd meta track");
        const result = await extractFromSstarSsmdTrack(file, index, track);
        if (!result) throw new WrongFormatError("ssmd track samples do not match the sstar layout");
        return result;
    },
};
