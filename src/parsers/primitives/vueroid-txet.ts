// Vueroid TXET extractor - Vueroid S1 4K "Infinite" (and, presumably, the
// sibling S-series firmware). 72-byte binary GPS+accel samples at ~20 Hz in
// a 'tvxt'-handler / 'mp4s'-format track. Layout, the single-hemisphere
// assumption and the local-clock quarantine live in
// internal/vueroid-txet-extract.ts; format breakdown in
// docs/format-vueroid-txet.md.

import { type ParsedRecords, type VendorFile, WrongFormatError } from "../types.js";
import type { Mp4Index } from "../internal/mp4-index.js";
import { extractFromVueroidTxetTrack, findVueroidTxetTrack } from "../internal/vueroid-txet-extract.js";
import type { Primitive } from "./types.js";

export const vueroidTxetPrimitive: Primitive = {
    id: "vueroid-txet",
    displayName: "Vueroid TXET track (S1 4K Infinite)",
    kind: "video-embedded",

    async marker(_file: VendorFile, index?: Mp4Index): Promise<boolean> {
        if (!index) return false;
        // Sync structural gate over the moov already in memory: 'tvxt'
        // handler + 'mp4s' format + constant 72-byte samples. No known
        // format collides with the non-standard 'tvxt' handler, so no
        // first-sample content probe is needed; parse() still content-gates
        // every row and throws WrongFormatError on alien bytes.
        return findVueroidTxetTrack(index) !== null;
    },

    async parse(file: VendorFile, index?: Mp4Index): Promise<ParsedRecords> {
        if (!index) throw new WrongFormatError("vueroid-txet requires Mp4Index");
        const track = findVueroidTxetTrack(index);
        if (!track) throw new WrongFormatError("no 72-byte tvxt/mp4s track");
        const result = await extractFromVueroidTxetTrack(file, index, track);
        if (!result) throw new WrongFormatError("tvxt track samples do not match the vueroid layout");
        return result;
    },
};
