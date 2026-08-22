// Pure, DOM-free core of the ingest orchestrator. ingest.ts itself pulls in the
// sidebar/overlay/modal DOM graph (not importable under vitest's node
// environment), so the logic that has no such dependency lives here and is
// unit-tested directly in ingest-core.test.ts.

import type { DispatchedEmbeddedGpsResult } from "../parsers/registry.js";
import { mergeAccelSamples } from "../parsers/registry-light.js";
import type { AccelSample, GpsRecord, VendorFile } from "../parsers/types.js";
import type { VideoCandidate } from "../trips.js";
import { vendorFileKey } from "../vendor-file-key.js";

/**
 * Wraps a File list into VendorFile (file + relativePath). Path comes from webkitRelativePath
 * (set by the browser for <input webkitdirectory>). DnD has its own assembly path - see file-sources.ts.
 * Falls back to file.name if webkitRelativePath is empty.
 */
export function toVendorFiles(files: File[]): VendorFile[] {
    return files.map((f) => ({
        file: f,
        relativePath: f.webkitRelativePath || f.name,
    }));
}

/** Counts file distribution by extension (lowercase with dot). Files without an extension use key "". Used in the ingest startup log to diagnose what the user dropped. */
export function countByExtension(vfiles: VendorFile[]): Record<string, number> {
    const out: Record<string, number> = {};
    for (const vf of vfiles) {
        const name = vf.file.name;
        const dot = name.lastIndexOf(".");
        const ext = dot >= 0 ? name.slice(dot).toLowerCase() : "";
        out[ext] = (out[ext] ?? 0) + 1;
    }
    return out;
}

/** Generic distribution counter by string key. Used for the byVendor breakdown in the ingest startup log. */
export function countByField<T>(items: T[], key: (item: T) => string): Record<string, number> {
    const out: Record<string, number> = {};
    for (const it of items) {
        const k = key(it);
        out[k] = (out[k] ?? 0) + 1;
    }
    return out;
}

/**
 * Whether an embedded-GPS result carries records, clock evidence, attribution
 * or accelerometer samples that downstream state must retain.
 */
export function embeddedResultHasEffect(result: DispatchedEmbeddedGpsResult): boolean {
    return (
        result.records.length > 0 ||
        result.videoStartUtcHintByFileKey.size > 0 ||
        result.localClockOffsetHintByFileKey.size > 0 ||
        result.accelByFileKey.size > 0 ||
        result.winningExtractorByFileKey.size > 0
    );
}

/** Merges file-keyed accel after candidates have their final startUtc anchors. */
export function mergeAccelIntoCandidates(
    records: GpsRecord[],
    accelByFileKey: Map<string, AccelSample[]>,
    candidates: readonly VideoCandidate[],
): number {
    const startUtcByFileKey = new Map<string, number>();
    for (const candidate of candidates) startUtcByFileKey.set(vendorFileKey(candidate), candidate.startUtc);
    return mergeAccelSamples(records, accelByFileKey, startUtcByFileKey);
}
