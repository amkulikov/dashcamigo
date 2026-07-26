// Pre-ingest duplicate-file exclusion. A drop that contains byte-identical
// copies of a recording in different subfolders (the user copied the SD card
// and dropped both the original and the backup) would otherwise double trip
// footage: groupTrips puts the copy into a `|dup` frame at the same startUtc,
// so the player replays the same minute twice and totalBytes doubles.
//
// Two-tier check, designed to cost zero IO on a clean drop:
//   1. Group by (basename, size) - pure metadata, free.
//   2. Inside a colliding group, an exact relativePath match against an
//      already-kept unique is path identity - free proof, no probe (a
//      re-drop of an already-loaded folder, or a duplicate File instance for
//      the same path within one drop). Otherwise read PROBE_BYTES of head and
//      tail and compare. Distinct recordings that happen to share a name and
//      size (channel-in-folder layouts: Front/x.mp4 vs Back/x.mp4) diverge in
//      the first mdat kilobytes, so a false drop is practically impossible.
//
// Runs at the ingest chokepoint (ui/ingest.ts) BEFORE classify/indexing, so a
// duplicate never costs an SD seek. The comparison set includes files already
// loaded into trips, so a later "drop the Backup folder too" is deduped as
// well - and since the paths are byte-identical on such a re-drop, the
// relativePath short-circuit above is what makes that case free (rather than
// content-probing 500 files that state.addedKeys would drop anyway further
// downstream in ui/ingest.ts). Known limitation: a candidate already repaired
// in-memory (hvcC / phantom-track byte patches) no longer matches its on-disk
// original in the patched region - a re-dropped copy of such a file can slip
// through; rare (broken-firmware files only) and same-path re-drops are still
// caught by state.addedKeys.

import { cameraFingerprint } from "./parsers/camera-fingerprint.js";
import { matchFilenameChannel } from "./parsers/filename/index.js";
import type { VendorFile } from "./parsers/types.js";

// 64 KiB is enough to reach real mdat payload past any shared ftyp/moov
// prefix, while staying a single cheap read even on a slow SD card.
const PROBE_BYTES = 64 * 1024;

// A dropped duplicate and the copy it duplicated - for the ingest log, so a
// "my files did not load" report can be traced to the surviving path.
export interface DroppedDuplicate {
    droppedPath: string;
    keptPath: string;
}

export interface DedupResult {
    // Surviving files, in the original incoming order.
    kept: VendorFile[];
    dropped: DroppedDuplicate[];
}

/** Metadata grouping key. Only files agreeing on it are content-probed. */
function dedupKey(file: File): string {
    return `${file.name}|${file.size}`;
}

async function readBytes(file: File, start: number, end: number): Promise<Uint8Array> {
    return new Uint8Array(await file.slice(start, end).arrayBuffer());
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) return false;
    }
    return true;
}

/**
 * Content probe for two same-size files: equal head and tail PROBE_BYTES.
 * Head first - distinct recordings diverge immediately in mdat. Tail catches
 * files sharing a head (e.g. an identical moov-at-start prefix): for MP4 the
 * tail holds either the last mdat bytes or the moov with per-file timestamps,
 * both unique per recording.
 */
async function sameContent(a: File, b: File): Promise<boolean> {
    const headEnd = Math.min(PROBE_BYTES, a.size);
    const [headA, headB] = await Promise.all([readBytes(a, 0, headEnd), readBytes(b, 0, headEnd)]);
    if (!bytesEqual(headA, headB)) return false;
    if (a.size <= PROBE_BYTES) return true;
    const tailStart = Math.max(headEnd, a.size - PROBE_BYTES);
    const [tailA, tailB] = await Promise.all([readBytes(a, tailStart, a.size), readBytes(b, tailStart, b.size)]);
    return bytesEqual(tailA, tailB);
}

/**
 * Orders duplicates by which copy is worth keeping. relativePath feeds the
 * path-based channel/mode classifiers and the camera fingerprint, so:
 *  1. the copy whose path is recognised by a channel technique (Movie/Front/...)
 *     wins over a structure-less backup copy (backup/...);
 *  2. then camera cohesion - keep the copy whose camera fingerprint is shared by
 *     the most files in the drop. A camera's channels live in sibling folders
 *     (video/front, video/rear) that the fingerprint collapses to one key. If a
 *     duplicated channel survives from a DIFFERENT parent than its siblings
 *     (e.g. a partial copy with front but no rear), the channels end up with
 *     different fingerprints and stop merging into one multichannel trip.
 *     Anchoring to the most-populated fingerprint keeps a camera in one folder.
 *     `fingerprintFreq` counts the whole comparison set (see dropDuplicateFiles);
 *  3. tie-break: fewer path segments (closer to the drop root = more likely the
 *     primary SD layout), then lexicographic for determinism.
 */
function compareKeepPreference(a: VendorFile, b: VendorFile, fingerprintFreq: Map<string, number>): number {
    const aChannel = matchFilenameChannel(a).matchedId !== null ? 0 : 1;
    const bChannel = matchFilenameChannel(b).matchedId !== null ? 0 : 1;
    if (aChannel !== bChannel) return aChannel - bChannel;
    // Higher fingerprint frequency first - keeps a camera's channels together.
    const aFreq = fingerprintFreq.get(cameraFingerprint(a)) ?? 0;
    const bFreq = fingerprintFreq.get(cameraFingerprint(b)) ?? 0;
    if (aFreq !== bFreq) return bFreq - aFreq;
    const aDepth = a.relativePath.split(/[/\\]/).length;
    const bDepth = b.relativePath.split(/[/\\]/).length;
    if (aDepth !== bDepth) return aDepth - bDepth;
    return a.relativePath < b.relativePath ? -1 : a.relativePath > b.relativePath ? 1 : 0;
}

/**
 * Drops byte-identical duplicates from `incoming`, comparing both within the
 * drop and against `alreadyLoaded` (files currently in trips - a copy of an
 * already-loaded file is dropped even across separate drops). Returns the
 * survivors in the original order plus the dropped pairs for logging.
 *
 * Files unique by (name, size) pass through with zero IO. A probe read error
 * treats the pair as distinct - the file is kept and the real failure surfaces
 * later in indexing, where it is reported properly.
 *
 * Throws DOMException("AbortError") when `signal` aborts mid-probe.
 */
export async function dropDuplicateFiles(
    incoming: VendorFile[],
    alreadyLoaded: VendorFile[],
    signal?: AbortSignal,
): Promise<DedupResult> {
    const groups = new Map<string, VendorFile[]>();
    for (const vf of incoming) {
        const key = dedupKey(vf.file);
        const group = groups.get(key);
        if (group) group.push(vf);
        else groups.set(key, [vf]);
    }

    // Already-loaded files matter only for keys present in the drop.
    const loadedByKey = new Map<string, VendorFile[]>();
    for (const vf of alreadyLoaded) {
        const key = dedupKey(vf.file);
        if (!groups.has(key)) continue;
        const bucket = loadedByKey.get(key);
        if (bucket) bucket.push(vf);
        else loadedByKey.set(key, [vf]);
    }

    // Camera-fingerprint frequency over the whole comparison set (the drop plus
    // already-loaded files). compareKeepPreference uses it to keep a camera's
    // channels in one folder so dedup never splits a multichannel trip into
    // sequential single-channel frames.
    //
    // Built lazily on first demand: only colliding groups consult it (via
    // compareKeepPreference), and a unique-by-(name,size) card - the common case -
    // has none, so it pays zero cameraFingerprint() calls here. Each call walks
    // the filename technique regexes, so the unconditional per-file pass it
    // replaces was pure waste on every clean drop. Memoized, so it is still
    // computed exactly once (over the full set) when at least one group collides.
    let fingerprintFreq: Map<string, number> | null = null;
    const getFingerprintFreq = (): Map<string, number> => {
        if (fingerprintFreq) return fingerprintFreq;
        const freq = new Map<string, number>();
        const bump = (vf: VendorFile) => {
            const fp = cameraFingerprint(vf);
            freq.set(fp, (freq.get(fp) ?? 0) + 1);
        };
        for (const vf of incoming) bump(vf);
        for (const vf of alreadyLoaded) bump(vf);
        fingerprintFreq = freq;
        return freq;
    };

    const keep = new Set<VendorFile>();
    const dropped: DroppedDuplicate[] = [];
    for (const [key, group] of groups) {
        const loaded = loadedByKey.get(key);
        if (group.length === 1 && !loaded) {
            // Fast path: unique (name, size) - no probe, no IO.
            keep.add(group[0]!);
            continue;
        }
        // Probe in keep-preference order so the best copy becomes the unique
        // representative and the worse-path copies get dropped against it.
        // Already-loaded copies always win - they cannot be replaced anyway.
        const ordered = [...group].sort((x, y) => compareKeepPreference(x, y, getFingerprintFreq()));
        const uniques: VendorFile[] = loaded ? [...loaded] : [];
        for (const vf of ordered) {
            if (signal?.aborted) throw new DOMException("ingest aborted", "AbortError");
            let duplicateOf: VendorFile | null = null;
            for (const unique of uniques) {
                // Exact relativePath match is path identity, not just a (name,
                // size) collision - free to prove (B4). state.addedKeys would
                // drop this file anyway on the same-path re-drop path (see
                // module header), so skip the head+tail probe entirely.
                let equal = unique.relativePath === vf.relativePath;
                if (!equal) {
                    try {
                        equal = await sameContent(unique.file, vf.file);
                    } catch {
                        // Read failure - keep the file; indexing will surface the
                        // real error with proper user-facing reporting.
                        equal = false;
                    }
                }
                if (equal) {
                    duplicateOf = unique;
                    break;
                }
            }
            if (duplicateOf) {
                dropped.push({ droppedPath: vf.relativePath, keptPath: duplicateOf.relativePath });
            } else {
                uniques.push(vf);
                keep.add(vf);
            }
        }
    }

    return { kept: incoming.filter((vf) => keep.has(vf)), dropped };
}
