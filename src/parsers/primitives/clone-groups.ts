// Filename-only cloneAcrossGroup techniques, split from the primitives so the
// MAIN-THREAD shard planner (ui/gps-extract-shim.ts) can group files without
// importing primitives/index.ts - that registry pulls every extractor
// implementation (~90 KB min) into whatever imports it, and the shim is eager.
// Extraction itself (and the full Primitive objects) stays worker-side; each
// primitive that defines cloneAcrossGroup imports its grouper from here, so the
// grouping logic cannot drift between the shard planner and the dispatcher.
// Guarded by scripts/check-lazy-chunks.mjs.

import type { VendorFile } from "../types.js";

// `YYYYMMDD_HHMMSS<F|R>.ts` - same regex as the old Juscar vendor plugin. Used
// by both the primitive's marker (name cutoff) and the group key below.
export const RX_JUSCAR_TS_NAME = /^(\d{8})_(\d{6})([FR])\.ts$/i;

/**
 * Juscar writes an identical GPS stream into front (F.ts) and rear (R.ts) of
 * each pair - returns key "YYYYMMDD_HHMMSS" without the F/R suffix, so the
 * orchestrator parses only the first file of the group and copies records onto
 * the second. parentDir is not included: front and rear live in different
 * folders, grouping must work across that. null = not a Juscar pair name.
 */
export function juscarTsCloneGroup(file: VendorFile): string | null {
    const m = file.file.name.match(RX_JUSCAR_TS_NAME);
    if (!m) return null;
    return `${m[1]}_${m[2]}`;
}

/**
 * Every video-embedded primitive that defines cloneAcrossGroup, as
 * {id, cloneAcrossGroup} pairs - the exact subset the shard planner needs.
 * Keep in sync by construction: a new primitive with cloneAcrossGroup must
 * define its grouper here and list it below (its Primitive object then reuses
 * the same function).
 */
export const VIDEO_CLONE_GROUPERS: ReadonlyArray<{
    id: string;
    cloneAcrossGroup(file: VendorFile): string | null;
}> = [{ id: "juscar-ts", cloneAcrossGroup: juscarTsCloneGroup }];
