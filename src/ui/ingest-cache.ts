// Cross-session index-cache glue for the eager ingest pipeline: partition
// classified videos into cache hits (candidate rebuilt from IndexedDB, byte
// stages skipped) and misses (full pipeline), and write freshly indexed
// candidates back at the end of an ingest.
//
// The cache is keyed by file identity (relativePath, size, lastModified)
// alone - not by folder or picker path - so the FSA restore, a classic
// webkitdirectory re-pick (Firefox/Safari) and DnD all hit the same entries:
// every picker path produces the same root-prefixed relativePath.

import type { IndexerRepair } from "../indexer.js";
import { createLogger } from "../log.js";
import type { ClassifiedFile } from "../parsers/registry.js";
import { fileIdentityKey, fileIdentityOf } from "../persist/identity.js";
import {
    buildCacheEntry,
    getIndexCacheEntries,
    putIndexCacheEntries,
    touchIndexCacheEntries,
} from "../persist/index-cache.js";
import type { CachedFileIndex, FileIdentity } from "../persist/types.js";
import type { VideoCandidate } from "../trips.js";
import { applyMoovRepair, vendorFileKey } from "./ingest-candidate.js";

const log = createLogger("ingest-cache");

// Container-repair descriptors of THIS session's indexed files, keyed by the
// same file IDENTITY the cache entries are (path + size + mtime), not by path
// alone: two cards with the same folder layout produce identical paths, and a
// repair descriptor applied to the wrong file's moov would hand playback a
// patched header that does not match its bytes. A session registry (not a
// per-ingest map) because cache writes no longer happen only in the eager
// ingest tail: the lazy hydration path and the on-click heavy-GPS load write
// entries long after their ingest returned, and a cached entry without its
// repair would describe bytes the file on disk does not have. Rare entries
// (repairs are the exception), session lifetime.
const repairByIdentity = new Map<string, IndexerRepair>();

/**
 * Records a file's container repair for later cache writes. Call wherever the
 * indexer reports one, with the identity of the ORIGINAL file - applyMoovRepair
 * is constant-size and preserves name/lastModified, so the patched file's
 * identity is the same either way.
 */
export function registerCandidateRepair(identity: FileIdentity, repair: IndexerRepair): void {
    repairByIdentity.set(fileIdentityKey(identity), repair);
}

export interface IndexCachePartition {
    /** Rebuilt candidates for identity-matched entries; repair re-applied. */
    cachedCandidates: VideoCandidate[];
    /** Files that need the full byte pipeline. */
    misses: ClassifiedFile[];
    /** False when the cache store itself failed (private mode, storage off) -
     *  the "next time is faster" promise would be a lie then. */
    cacheAvailable: boolean;
}

function cacheKeyOf(cf: ClassifiedFile): string {
    return fileIdentityKey(fileIdentityOf(cf.file.file, cf.file.relativePath));
}

/**
 * Splits the new videos of a drop by index-cache state. Cache unavailability
 * (private mode, storage off) degrades to "everything is a miss" - the
 * pipeline must never fail because the cache did.
 */
export async function partitionByIndexCache(videos: ClassifiedFile[]): Promise<IndexCachePartition> {
    if (videos.length === 0) return { cachedCandidates: [], misses: videos, cacheAvailable: true };
    let entries: Map<string, CachedFileIndex>;
    try {
        entries = await getIndexCacheEntries(videos.map(cacheKeyOf));
    } catch (err) {
        log.warn("index cache unavailable, running full pipeline", {
            err: err instanceof Error ? err.message : String(err),
        });
        return { cachedCandidates: [], misses: videos, cacheAvailable: false };
    }
    const cachedCandidates: VideoCandidate[] = [];
    const misses: ClassifiedFile[] = [];
    const hitKeys: string[] = [];
    for (const cf of videos) {
        const key = cacheKeyOf(cf);
        const entry = entries.get(key);
        if (!entry) {
            misses.push(cf);
            continue;
        }
        hitKeys.push(key);
        const freshFile = cf.file.file;
        cachedCandidates.push({
            ...entry.candidate,
            // The on-disk bytes still carry the broken moov - re-apply the
            // repair recorded at index time, or the cached codec metadata
            // would describe a file it no longer matches.
            file: entry.repair ? applyMoovRepair(freshFile, entry.repair) : freshFile,
            // Recomputed for THIS machine by the pipeline's checkCanPlay - a
            // verdict cached on another browser/GPU must not stick.
            canPlay: true,
        });
    }
    if (cachedCandidates.length > 0) {
        log.info("index cache hits", { hits: cachedCandidates.length, total: videos.length });
        // Mark the hits as USED so the volume prune keeps what the user
        // actually opens. Fire-and-forget, off the ingest critical path.
        void touchIndexCacheEntries(hitKeys).catch(() => {});
    }
    return { cachedCandidates, misses, cacheAvailable: true };
}

/**
 * Fire-and-forget write of freshly indexed candidates. A failed write only
 * costs a future reindex - never surfaces past a warn log. `skipKeys`
 * (vendorFileKey set) excludes files whose snapshot must not stick: records
 * not extracted yet (heavy-deferred) or extraction crashed - caching the
 * empty state would freeze "no GPS" across sessions. Repairs come from the
 * session registry (registerCandidateRepair).
 */
export function scheduleIndexCacheWrite(candidates: VideoCandidate[], skipKeys: ReadonlySet<string>): void {
    const entries: CachedFileIndex[] = [];
    for (const candidate of candidates) {
        const key = vendorFileKey({ file: candidate.file, relativePath: candidate.relativePath });
        if (skipKeys.has(key)) continue;
        // applyMoovRepair is constant-size and preserves name/lastModified, so
        // the patched candidate.file still carries the ORIGINAL file identity.
        const identityKey = fileIdentityKey({
            relativePath: candidate.relativePath,
            size: candidate.file.size,
            lastModified: candidate.file.lastModified,
        });
        entries.push(buildCacheEntry(identityKey, candidate, repairByIdentity.get(identityKey)));
    }
    if (entries.length === 0) return;
    void putIndexCacheEntries(entries)
        .then(() => log.info("index cache written", { entries: entries.length }))
        .catch((err: unknown) => {
            log.warn("index cache write failed", { err: err instanceof Error ? err.message : String(err) });
        });
}
