// Cross-session index-cache glue for progressive ingest: partition
// classified videos into cache hits (candidate rebuilt from IndexedDB, byte
// stages skipped) and misses (full pipeline), and write freshly indexed
// candidates back after their recording analysis completes.
//
// The cache is keyed by file identity (relativePath, size, lastModified)
// alone - not by folder or picker path - so the FSA restore, a classic
// webkitdirectory re-pick (Firefox/Safari) and DnD all hit the same entries:
// every picker path produces the same root-prefixed relativePath.

import type { IndexerRepair } from "../indexer.js";
import { buildVideoAssociationIndex, resolveVideoKey, type VideoAssociationIndex } from "../gps-association.js";
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

const DEPENDENCY_SEPARATOR = String.fromCharCode(1);

// Container-repair descriptors of THIS session's indexed files, keyed by the
// same file IDENTITY the cache entries are (path + size + mtime), not by path
// alone: two cards with the same folder layout produce identical paths, and a
// repair descriptor applied to the wrong file's moov would hand playback a
// patched header that does not match its bytes. A session registry (not a
// per-ingest map) because progressive and deferred cache writes can complete
// after the initial list render. A cached entry without its repair would
// describe bytes the file on disk does not have. Repairs are rare, so retaining
// these descriptors for the session is bounded in practice.
const repairByIdentity = new Map<string, IndexerRepair>();
const dependencyByIdentity = new Map<string, string>();
const writeBlockedIdentities = new Set<string>();

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

/** Whether two distinct session files collapse onto one cheap persistent key. */
export function hasIndexCacheIdentityCollision(video: ClassifiedFile, videos: VideoAssociationIndex): boolean {
    const persistentKey = cacheKeyOf(video);
    const sessionKey = vendorFileKey(video.file);
    return (videos.videosByFilename.get(video.file.file.name) ?? []).some(
        (peer) =>
            vendorFileKey(peer) !== sessionKey &&
            fileIdentityKey(fileIdentityOf(peer.file, peer.relativePath)) === persistentKey,
    );
}

/**
 * Dependency identity for one cached candidate. Card-wide GPS logs affect all
 * videos; paired GPS/accel sidecars affect only the concrete video they resolve
 * to. An edit or removal therefore invalidates every dependent cache entry,
 * without turning a one-file sidecar change into a full-card reindex.
 */
export function indexCacheDependencyKey(
    video: ClassifiedFile,
    classified: readonly ClassifiedFile[],
    videos: VideoAssociationIndex = buildVideoAssociationIndex(
        classified.filter((file) => file.role === "video").map((file) => file.file),
    ),
): string {
    const videoKey = vendorFileKey(video.file);
    const dependencies: string[] = [];

    // A second loaded file with the same basename can turn a formerly unique
    // log association into a path-resolved or ambiguous one. Include those
    // peers so a snapshot cannot retain ownership decided under old topology.
    for (const peer of videos.videosByFilename.get(video.file.file.name) ?? []) {
        if (vendorFileKey(peer) === videoKey) continue;
        dependencies.push(
            ["video-peer", fileIdentityKey(fileIdentityOf(peer.file, peer.relativePath))].join(DEPENDENCY_SEPARATOR),
        );
    }

    for (const file of classified) {
        let affectsVideo = file.role === "gps-log";
        if ((file.role === "sidecar" || file.role === "accel-sidecar") && file.sidecarMp4) {
            affectsVideo = resolveVideoKey(file.file, file.sidecarMp4, videos) === videoKey;
        }
        if (!affectsVideo) continue;
        dependencies.push(
            [
                file.role,
                file.logExtractorId ?? "",
                file.sidecarId ?? "",
                fileIdentityKey(fileIdentityOf(file.file.file, file.file.relativePath)),
            ].join(DEPENDENCY_SEPARATOR),
        );
    }
    return dependencies.sort().join(DEPENDENCY_SEPARATOR);
}

/**
 * Splits the new videos of a drop by index-cache state. Cache unavailability
 * (private mode, storage off) degrades to "everything is a miss" - the
 * pipeline must never fail because the cache did.
 */
export async function partitionByIndexCache(
    videos: ClassifiedFile[],
    classified: readonly ClassifiedFile[],
    videoAssociation: VideoAssociationIndex,
    externalInputsValid: boolean,
): Promise<IndexCachePartition> {
    if (videos.length === 0) return { cachedCandidates: [], misses: videos, cacheAvailable: true };
    const dependencyByVideoKey = new Map<string, string>();
    const collisionKeys = new Set<string>();
    for (const video of videos) {
        const key = cacheKeyOf(video);
        const dependencyKey = indexCacheDependencyKey(video, classified, videoAssociation);
        dependencyByIdentity.set(key, dependencyKey);
        dependencyByVideoKey.set(key, dependencyKey);
        if (hasIndexCacheIdentityCollision(video, videoAssociation)) collisionKeys.add(key);
        if (externalInputsValid && !collisionKeys.has(key)) writeBlockedIdentities.delete(key);
        else writeBlockedIdentities.add(key);
    }
    // A failed log/sidecar read makes a previous snapshot unsafe even when its
    // metadata dependency is unchanged. Reindex for this run and do not replace
    // the last known-good entry with a partial result.
    if (!externalInputsValid) return { cachedCandidates: [], misses: videos, cacheAvailable: false };
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
        if (collisionKeys.has(key) || !entry || entry.dependencyKey !== dependencyByVideoKey.get(key)) {
            misses.push(cf);
            continue;
        }
        hitKeys.push(key);
        const freshFile = cf.file.file;
        const freshVideoKey = vendorFileKey(cf.file);
        cachedCandidates.push({
            ...entry.candidate,
            // The on-disk bytes still carry the broken moov - re-apply the
            // repair recorded at index time, or the cached codec metadata
            // would describe a file it no longer matches.
            file: entry.repair ? applyMoovRepair(freshFile, entry.repair) : freshFile,
            sourceKey: cf.file.sourceKey,
            records: entry.candidate.records.map((record) => ({ ...record, videoKey: freshVideoKey })),
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
        const key = vendorFileKey(candidate);
        if (skipKeys.has(key)) continue;
        // applyMoovRepair is constant-size and preserves name/lastModified, so
        // the patched candidate.file still carries the ORIGINAL file identity.
        const identityKey = fileIdentityKey({
            relativePath: candidate.relativePath,
            size: candidate.file.size,
            lastModified: candidate.file.lastModified,
        });
        if (writeBlockedIdentities.has(identityKey)) continue;
        entries.push(
            buildCacheEntry(
                identityKey,
                candidate,
                repairByIdentity.get(identityKey),
                dependencyByIdentity.get(identityKey) ?? "",
            ),
        );
    }
    if (entries.length === 0) return;
    void putIndexCacheEntries(entries)
        .then(() => log.info("index cache written", { entries: entries.length }))
        .catch((err: unknown) => {
            log.warn("index cache write failed", { err: err instanceof Error ? err.message : String(err) });
        });
}
