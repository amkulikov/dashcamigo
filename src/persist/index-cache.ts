// Raw store operations for the cross-session index cache. UI-free; the
// pipeline glue (partitioning classified files, rebuilding candidates) lives
// in ui/ingest-cache.ts.

import { createLogger } from "../log.js";
import type { IndexerRepair } from "../indexer.js";
import type { VideoCandidate } from "../trips.js";
import { openPersistDb, type PersistDb } from "./db.js";
import { type CachedCandidateFields, type CachedFileIndex, INDEX_CACHE_VERSION } from "./types.js";

const log = createLogger("index-cache");

// Size bound, not a correctness knob: entries are per-file and record-heavy
// (a GPS-dense clip carries thousands of records), so an unbounded store
// would creep toward gigabytes over months of different cards. Oldest-first
// prune; an evicted entry only costs a reindex of that file.
const MAX_ENTRIES = 5000;

/**
 * Fetches cache entries for the given identity keys. Entries written under a
 * different INDEX_CACHE_VERSION are treated as absent (and left for the prune
 * to age out - deleting them here would put a write transaction on the hot
 * ingest path). Missing keys are simply absent from the result map.
 */
export async function getIndexCacheEntries(keys: string[]): Promise<Map<string, CachedFileIndex>> {
    const db = await openPersistDb();
    const tx = db.transaction("indexCache");
    const out = new Map<string, CachedFileIndex>();
    await Promise.all(
        keys.map(async (key) => {
            const entry = await tx.store.get(key);
            if (entry && entry.version === INDEX_CACHE_VERSION) out.set(key, entry);
        }),
    );
    await tx.done;
    return out;
}

/** Strips the live File off a candidate for storage. Pure; the stored copy is
 *  a structured-clone snapshot, so later in-session mutations don't leak in. */
export function toCachedCandidate(candidate: VideoCandidate): CachedCandidateFields {
    const { file: _file, ...fields } = candidate;
    return fields;
}

/** Assembles a store entry for a freshly indexed candidate. */
export function buildCacheEntry(
    identityKey: string,
    candidate: VideoCandidate,
    repair: IndexerRepair | undefined,
): CachedFileIndex {
    const entry: CachedFileIndex = {
        identityKey,
        version: INDEX_CACHE_VERSION,
        savedAt: Date.now(),
        candidate: toCachedCandidate(candidate),
    };
    if (repair) entry.repair = repair;
    return entry;
}

/** Writes entries (upsert by identityKey), then prunes the store to its size
 *  bound. One transaction for the batch - a torn write never leaves a partial
 *  batch visible. */
export async function putIndexCacheEntries(entries: CachedFileIndex[]): Promise<void> {
    if (entries.length === 0) return;
    const db = await openPersistDb();
    const tx = db.transaction("indexCache", "readwrite");
    for (const entry of entries) {
        void tx.store.put(entry);
    }
    await tx.done;
    await pruneIndexCache(db);
}

async function pruneIndexCache(db: PersistDb): Promise<void> {
    const count = await db.count("indexCache");
    if (count <= MAX_ENTRIES) return;
    let toDelete = count - MAX_ENTRIES;
    const tx = db.transaction("indexCache", "readwrite");
    let cursor = await tx.store.index("bySavedAt").openCursor();
    while (cursor && toDelete > 0) {
        await cursor.delete();
        toDelete--;
        cursor = await cursor.continue();
    }
    await tx.done;
    log.info("pruned index cache", { deleted: count - MAX_ENTRIES, kept: MAX_ENTRIES });
}
