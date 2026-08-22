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
import { looksLikeMpegTs } from "../internal/ts-walk.js";
// Name regex + group key live in clone-groups.ts so the main-thread shard
// planner shares them without importing this (worker-weight) module.
import { juscarTsCloneGroup } from "./clone-groups.js";
import type { Primitive } from "./types.js";

export const juscarTsPrimitive: Primitive = {
    id: "juscar-ts",
    displayName: "Juscar MPEG-TS (LigoGPS plaintext)",
    kind: "video-embedded",

    async marker(_file: VendorFile, index?: Mp4Index): Promise<boolean> {
        // hasLigoGpsMarker in Mp4Index searches "LIGOGPSINFO" in the first
        // 16 MB. Paired MPEG-TS sync bytes replace the old filename gate: a
        // renamed recording remains importable, while MP4 LigoGPS carriers do
        // not enter a full-file TS scan.
        return index?.hasLigoGpsMarker === true && !!index.headerBytes && looksLikeMpegTs(index.headerBytes);
    },

    async parse(file: VendorFile, index?: Mp4Index): Promise<ParsedRecords> {
        if (!index) throw new WrongFormatError("juscar-ts requires Mp4Index");
        return extractJuscarTsGps(file, index);
    },

    cloneAcrossGroup: juscarTsCloneGroup,
};
