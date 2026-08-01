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
import { buildCacheEntry, getIndexCacheEntries, putIndexCacheEntries } from "../persist/index-cache.js";
import type { CachedFileIndex } from "../persist/types.js";
import type { VideoCandidate } from "../trips.js";
import { applyMoovRepair, vendorFileKey } from "./ingest-candidate.js";

const log = createLogger("ingest-cache");

export interface IndexCachePartition {
    /** Rebuilt candidates for identity-matched entries; repair re-applied. */
    cachedCandidates: VideoCandidate[];
    /** Files that need the full byte pipeline. */
    misses: ClassifiedFile[];
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
    if (videos.length === 0) return { cachedCandidates: [], misses: videos };
    let entries: Map<string, CachedFileIndex>;
    try {
        entries = await getIndexCacheEntries(videos.map(cacheKeyOf));
    } catch (err) {
        log.warn("index cache unavailable, running full pipeline", {
            err: err instanceof Error ? err.message : String(err),
        });
        return { cachedCandidates: [], misses: videos };
    }
    const cachedCandidates: VideoCandidate[] = [];
    const misses: ClassifiedFile[] = [];
    for (const cf of videos) {
        const entry = entries.get(cacheKeyOf(cf));
        if (!entry) {
            misses.push(cf);
            continue;
        }
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
    }
    return { cachedCandidates, misses };
}

/**
 * Fire-and-forget write of this run's freshly indexed candidates. A failed
 * write only costs a future reindex - never surfaces past a warn log.
 * `skipKeys` (vendorFileKey set) excludes heavy-deferred files: their records
 * are not extracted yet, and caching the empty state would freeze "no GPS"
 * across sessions.
 */
export function scheduleIndexCacheWrite(
    candidates: VideoCandidate[],
    repairByKey: ReadonlyMap<string, IndexerRepair>,
    skipKeys: ReadonlySet<string>,
): void {
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
        entries.push(buildCacheEntry(identityKey, candidate, repairByKey.get(key)));
    }
    if (entries.length === 0) return;
    void putIndexCacheEntries(entries)
        .then(() => log.info("index cache written", { entries: entries.length }))
        .catch((err: unknown) => {
            log.warn("index cache write failed", { err: err instanceof Error ? err.message : String(err) });
        });
}
