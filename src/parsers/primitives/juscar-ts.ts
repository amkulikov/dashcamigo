// Juscar TS extractor - MPEG-TS container with a LigoGPS payload in a
// private-data PES (plaintext). Mp4Index is valid for TS files too (first
// 16 MB stored in headerBytes), and `hasLigoGpsMarker` is set there when the
// payload is present. Parsing lives in internal/juscar-ts-extract.ts.
//
// Juscar writes an identical GPS stream into front (F.ts) and rear (R.ts) of
// each pair - cloneAcrossGroup returns key "YYYYMMDD_HHMMSS" without the F/R
// suffix, so the orchestrator parses only the first file of the group and
// copies records onto the second.

import { type ParsedRecords, type VendorFile, WrongFormatError } from "../types.js";
import type { Mp4Index } from "../internal/mp4-index.js";
import { extractJuscarTsGps } from "../internal/juscar-ts-extract.js";
// Name regex + group key live in clone-groups.ts so the main-thread shard
// planner shares them without importing this (worker-weight) module.
import { juscarTsCloneGroup, RX_JUSCAR_TS_NAME as RX_NAME } from "./clone-groups.js";
import type { Primitive } from "./types.js";

export const juscarTsPrimitive: Primitive = {
    id: "juscar-ts",
    displayName: "Juscar MPEG-TS (LigoGPS plaintext)",
    kind: "video-embedded",

    async marker(file: VendorFile, index?: Mp4Index): Promise<boolean> {
        // Name - fast cutoff. If the name doesn't match, definitely not ours.
        if (!RX_NAME.test(file.file.name)) return false;
        // hasLigoGpsMarker in Mp4Index searches "LIGOGPSINFO" in the first
        // 16 MB - final confirmation that our payload is inside.
        if (!index) return false;
        return index.hasLigoGpsMarker === true;
    },

    async parse(file: VendorFile, index?: Mp4Index): Promise<ParsedRecords> {
        if (!index) throw new WrongFormatError("juscar-ts requires Mp4Index");
        return extractJuscarTsGps(file, index);
    },

    cloneAcrossGroup: juscarTsCloneGroup,
};
