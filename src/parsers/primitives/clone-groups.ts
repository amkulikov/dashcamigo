// Lightweight cloneAcrossGroup techniques and path scoping, split from the
// primitives so the MAIN-THREAD shard planner (ui/gps-extract-shim.ts) can
// group files without importing primitives/index.ts - that registry pulls every extractor
// implementation (~90 KB min) into whatever imports it, and the shim is eager.
// Extraction itself (and the full Primitive objects) stays worker-side; each
// primitive that defines cloneAcrossGroup imports its grouper from here, so the
// grouping logic cannot drift between the shard planner and the dispatcher.
// Guarded by scripts/check-lazy-chunks.mjs.

import type { VendorFile } from "../types.js";
const GROUP_SEPARATOR = String.fromCharCode(0);

export function strippedParentPath(file: VendorFile, channelFolders: readonly string[]): string {
    const segments = file.relativePath.split("/").filter(Boolean);
    segments.pop();
    const channelNames = new Set(channelFolders.map((folder) => folder.toLowerCase()));
    while (segments.length > 0 && channelNames.has(segments[segments.length - 1]!.toLowerCase())) segments.pop();
    return segments.join("/").toLowerCase();
}

/** Concrete source/path scope used by orchestrators around a primitive's
 * stable cloneAcrossGroup value. Keeping this outside the primitive preserves
 * that API while preventing equal recordings in sibling trees from merging. */
export function videoCloneAffinityKey(extractorId: string, file: VendorFile, groupKey: string): string {
    const parent = strippedParentPath(file, ["front", "rear", "interior"]);
    return [extractorId, file.sourceKey ?? "", parent, groupKey].join(GROUP_SEPARATOR);
}

// `YYYYMMDD_HHMMSS<F|R>.ts` - same regex as the old Juscar vendor plugin. Used
// by both the primitive's marker (name cutoff) and the group key below.
export const RX_JUSCAR_TS_NAME = /^(\d{8})_(\d{6})([FR])\.ts$/i;

/**
 * Juscar writes an identical GPS stream into front (F.ts) and rear (R.ts) of
 * each pair - returns key "YYYYMMDD_HHMMSS" without the F/R suffix, so the
 * orchestrator parses only the first file of the group and copies records onto
 * the second. Source/path isolation is added by the orchestrator without
 * changing this primitive-level key. null = not a Juscar pair name.
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
