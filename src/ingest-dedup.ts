// Pre-ingest duplicate-file exclusion. A drop that contains byte-identical
// copies of a recording in different subfolders (the user copied the SD card
// and dropped both the original and the backup) would otherwise double trip
// footage: groupTrips puts the copy into a `|dup` frame at the same startUtc,
// so the player replays the same minute twice and totalBytes doubles.
//
// Two-tier check, designed to cost zero IO on a clean drop:
//   1. Group by (basename, size) - pure metadata, free.
//   2. Inside a colliding group, an exact session identity (source + path +
//      size + mtime) is free proof, no probe. Otherwise read PROBE_BYTES of
//      head and tail and compare. Distinct recordings that happen to share a
//      name and size (channel-in-folder layouts: Front/x.mp4 vs Back/x.mp4)
//      diverge in the first mdat kilobytes, so a false drop is practically
//      impossible.
//
// Runs at the ingest chokepoint (ui/ingest.ts) BEFORE classify/indexing, so a
// duplicate never costs an SD seek. The comparison set includes files already
// loaded into trips, so a later "drop the Backup folder too" is deduped as
// well. A re-read through the same remembered-folder/handle source is metadata-
// only; an ad-hoc second drop deliberately pays the probe because the browser
// exposes no trustworthy physical-source identity. Known limitation: a
// candidate already repaired in-memory (hvcC / phantom-track byte patches) no
// longer matches its on-disk original in the patched region, so a re-dropped
// copy can slip through; rare (broken-firmware files only) and same-source,
// same-metadata re-drops are still caught by state.addedKeys.

import { cameraFingerprint } from "./parsers/camera-fingerprint.js";
import { matchFilenameChannel } from "./parsers/filename/index.js";
import { RX_VIDEO_EXT } from "./parsers/registry-light.js";
import type { VendorFile } from "./parsers/types.js";
import { vendorFileKey } from "./vendor-file-key.js";

// 64 KiB is enough to reach real mdat payload past any shared ftyp/moov
// prefix, while staying a single cheap read even on a slow SD card.
const PROBE_BYTES = 64 * 1024;

// A dropped duplicate and the copy it duplicated - for the ingest log, so a
// "my files did not load" report can be traced to the surviving path.
export interface DroppedDuplicate {
    droppedPath: string;
    keptPath: string;
}

/** A duplicate proven against a file already represented by a loaded source.
 * The UI uses this evidence to keep a classic re-open on the existing source
 * row even when only auxiliary files survive the dedup pass. */
export interface DuplicateSourceMatch {
    incoming: VendorFile;
    loaded: VendorFile;
}

export interface DedupResult {
    // Surviving files, in the original incoming order.
    kept: VendorFile[];
    dropped: DroppedDuplicate[];
    sourceMatches: DuplicateSourceMatch[];
}

/** Metadata grouping key. Only files agreeing on it are content-probed. */
function dedupKey(file: File): string {
    return `${file.name}|${file.size}`;
}

async function readBytes(file: File, start: number, end: number): Promise<Uint8Array> {
    return new Uint8Array(await file.slice(start, end).arrayBuffer());
}

type ProbePart = "head" | "tail";
type ProbeReader = (file: File, part: ProbePart, start: number, end: number) => Promise<Uint8Array>;

/** Keep probes only for one collision group; input arrays keep File keys alive. */
function createProbeReader(): ProbeReader {
    const cache = new WeakMap<File, Partial<Record<ProbePart, Promise<Uint8Array>>>>();
    return (file, part, start, end) => {
        let cached = cache.get(file);
        if (!cached) {
            cached = {};
            cache.set(file, cached);
        }
        const existing = cached[part];
        if (existing) return existing;
        const pending = readBytes(file, start, end);
        cached[part] = pending;
        // A later comparison can retry a transient device failure.
        void pending.catch(() => {
            if (cached[part] === pending) delete cached[part];
        });
        return pending;
    };
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
async function sameContent(a: File, b: File, readProbe: ProbeReader): Promise<boolean> {
    const headEnd = Math.min(PROBE_BYTES, a.size);
    const [headA, headB] = await Promise.all([readProbe(a, "head", 0, headEnd), readProbe(b, "head", 0, headEnd)]);
    if (!bytesEqual(headA, headB)) return false;
    if (a.size <= PROBE_BYTES) return true;
    const tailStart = Math.max(headEnd, a.size - PROBE_BYTES);
    const [tailA, tailB] = await Promise.all([
        readProbe(a, "tail", tailStart, a.size),
        readProbe(b, "tail", tailStart, b.size),
    ]);
    return bytesEqual(tailA, tailB);
}

interface KeepPreferenceRank {
    channelRank: 0 | 1;
    depth: number;
}

/**
 * Drops byte-identical video duplicates from `incoming`, comparing both within the
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
    if (signal?.aborted) throw new DOMException("ingest aborted", "AbortError");
    const keep = new Set<VendorFile>();
    const groups = new Map<string, VendorFile[]>();
    for (const vf of incoming) {
        // Equal external bytes can belong to different recordings. Their
        // association must survive until the parser knows the video owner.
        if (!RX_VIDEO_EXT.test(vf.file.name)) {
            keep.add(vf);
            continue;
        }
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

    // Sort may invoke its comparator repeatedly for the same file. These ranks
    // depend only on immutable VendorFile metadata, so calculate each once.
    const rankCache = new WeakMap<VendorFile, KeepPreferenceRank>();
    const rankOf = (vf: VendorFile): KeepPreferenceRank => {
        const cached = rankCache.get(vf);
        if (cached) return cached;
        const rank: KeepPreferenceRank = {
            channelRank: matchFilenameChannel(vf).matchedId !== null ? 0 : 1,
            depth: vf.relativePath.split(/[/\\]/).length,
        };
        rankCache.set(vf, rank);
        return rank;
    };

    const fingerprintCache = new WeakMap<VendorFile, string>();
    const fingerprintOf = (vf: VendorFile): string => {
        const cached = fingerprintCache.get(vf);
        if (cached !== undefined) return cached;
        const fingerprint = cameraFingerprint(vf);
        fingerprintCache.set(vf, fingerprint);
        return fingerprint;
    };

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
            const fp = fingerprintOf(vf);
            freq.set(fp, (freq.get(fp) ?? 0) + 1);
        };
        for (const vf of incoming) bump(vf);
        for (const vf of alreadyLoaded) bump(vf);
        fingerprintFreq = freq;
        return freq;
    };

    /** Orders duplicate copies by recognised channel path, camera cohesion,
     * path depth, then lexicographic path. Expensive classifiers are cached
     * above and the whole-card fingerprint pass remains lazy. */
    const compareKeepPreference = (a: VendorFile, b: VendorFile): number => {
        const aRank = rankOf(a);
        const bRank = rankOf(b);
        if (aRank.channelRank !== bRank.channelRank) return aRank.channelRank - bRank.channelRank;
        const freq = getFingerprintFreq();
        const aFreq = freq.get(fingerprintOf(a)) ?? 0;
        const bFreq = freq.get(fingerprintOf(b)) ?? 0;
        if (aFreq !== bFreq) return bFreq - aFreq;
        if (aRank.depth !== bRank.depth) return aRank.depth - bRank.depth;
        return a.relativePath < b.relativePath ? -1 : a.relativePath > b.relativePath ? 1 : 0;
    };

    const dropped: DroppedDuplicate[] = [];
    const sourceMatches: DuplicateSourceMatch[] = [];
    const loadedFiles = new Set(alreadyLoaded);
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
        const ordered = [...group].sort(compareKeepPreference);
        const uniques: VendorFile[] = loaded ? [...loaded] : [];
        const readProbe = createProbeReader();
        for (const vf of ordered) {
            if (signal?.aborted) throw new DOMException("ingest aborted", "AbortError");
            let duplicateOf: VendorFile | null = null;
            for (const unique of uniques) {
                // A path is only identity inside one source, and dashcams reuse
                // paths. The full session key also carries source + size + mtime;
                // only that metadata identity may skip the content probe.
                let equal = vendorFileKey(unique) === vendorFileKey(vf);
                if (!equal) {
                    try {
                        equal = await sameContent(unique.file, vf.file, readProbe);
                    } catch (err) {
                        if (err instanceof Error && err.name === "AbortError") throw err;
                        // Read failure - keep the file; indexing will surface the
                        // real error with proper user-facing reporting.
                        equal = false;
                    }
                    if (signal?.aborted) throw new DOMException("ingest aborted", "AbortError");
                }
                if (equal) {
                    duplicateOf ??= unique;
                    if (loadedFiles.has(unique)) {
                        // Report every already-loaded physical source that is
                        // byte-identical. The folder layer must see the tie and
                        // refuse to alias a later notes-only reopen to whichever
                        // card happened to sort first.
                        sourceMatches.push({ incoming: vf, loaded: unique });
                        continue;
                    }
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

    return { kept: incoming.filter((vf) => keep.has(vf)), dropped, sourceMatches };
}
