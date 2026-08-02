// Raw store operations for the cross-session index cache. UI-free; the
// pipeline glue (partitioning classified files, rebuilding candidates) lives
// in ui/ingest-cache.ts.

import { createLogger } from "../log.js";
import type { IndexerRepair } from "../indexer.js";
import type { VideoCandidate } from "../trips.js";
import { openPersistDb, type PersistDb } from "./db.js";
import { type CachedCandidateFields, type CachedFileIndex, INDEX_CACHE_VERSION } from "./types.js";

const log = createLogger("index-cache");

// Size bound, not a correctness knob: without one the store would creep
// toward gigabytes over months of different cards. Bounded by DATA VOLUME,
// not entry count - a GPS-dense clip weighs orders of magnitude more than an
// empty one, and a terabyte archive is tens of thousands of clips, so a count
// cap either starves it or lets the dense case blow up the browser profile.
// Oldest savedAt first (savedAt refreshes on use - LRU-ish); an evicted entry
// only costs a reindex of that file.
const MAX_TOTAL_BYTES = 512 * 1024 * 1024;
// Backstop against pathological tiny-entry counts (volume alone would admit
// millions of empty-record entries, and every prune walks a cursor).
const MAX_ENTRIES = 50_000;
// A cache hit refreshes savedAt only past this age - re-writing thousands of
// untouched entries on every open of a daily folder would be pure churn.
const TOUCH_MIN_AGE_MS = 24 * 60 * 60 * 1000;
// Running total of `bytes` across entries, kept in the meta store and updated
// in the same transaction as every put/delete - the prune trigger without a
// full-store walk.
const TOTAL_BYTES_META_KEY = "indexCacheBytes";

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

/**
 * Refreshes savedAt on the given entries so the volume prune sees them as
 * recently USED, not just once written - a folder opened weekly must outlive
 * one indexed yesterday and never touched again. Entries younger than
 * TOUCH_MIN_AGE_MS are left alone (bounds the write churn of routine opens).
 */
export async function touchIndexCacheEntries(keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    const db = await openPersistDb();
    const now = Date.now();
    const tx = db.transaction("indexCache", "readwrite");
    let touched = 0;
    await Promise.all(
        keys.map(async (key) => {
            const entry = await tx.store.get(key);
            if (!entry || entry.version !== INDEX_CACHE_VERSION) return;
            if (now - entry.savedAt < TOUCH_MIN_AGE_MS) return;
            entry.savedAt = now;
            void tx.store.put(entry);
            touched++;
        }),
    );
    await tx.done;
    if (touched > 0) log.info("refreshed cache recency", { touched });
}

/** Strips the live File off a candidate for storage. Pure; the stored copy is
 *  a structured-clone snapshot, so later in-session mutations don't leak in. */
export function toCachedCandidate(candidate: VideoCandidate): CachedCandidateFields {
    const { file: _file, ...fields } = candidate;
    return fields;
}

/**
 * Approximate stored size of an entry in bytes: the JSON length of the
 * candidate fields (records dominate) plus the repair's patched-moov buffer.
 * An estimate is enough - the prune needs relative weight, not accounting.
 */
export function approxEntryBytes(candidate: CachedCandidateFields, repair: IndexerRepair | undefined): number {
    // Uint8Array does not JSON-stringify usefully - add its raw length instead.
    const repairBytes = repair ? repair.patchedMoov.byteLength + 256 : 0;
    return JSON.stringify(candidate).length + repairBytes + 256;
}

/** Assembles a store entry for a freshly indexed candidate. */
export function buildCacheEntry(
    identityKey: string,
    candidate: VideoCandidate,
    repair: IndexerRepair | undefined,
): CachedFileIndex {
    const cachedCandidate = toCachedCandidate(candidate);
    const entry: CachedFileIndex = {
        identityKey,
        version: INDEX_CACHE_VERSION,
        savedAt: Date.now(),
        bytes: approxEntryBytes(cachedCandidate, repair),
        candidate: cachedCandidate,
    };
    if (repair) entry.repair = repair;
    return entry;
}

/** Writes entries (upsert by identityKey), then prunes the store to its size
 *  bound. Puts and the running-total update share one transaction - a torn
 *  write can neither leave a partial batch visible nor desync the total. */
export async function putIndexCacheEntries(entries: CachedFileIndex[]): Promise<void> {
    if (entries.length === 0) return;
    const db = await openPersistDb();
    const tx = db.transaction(["indexCache", "meta"], "readwrite");
    const store = tx.objectStore("indexCache");
    const meta = tx.objectStore("meta");
    let delta = 0;
    for (const entry of entries) {
        // Upsert accounting: replacing an entry swaps its bytes, it does not add.
        const previous = await store.get(entry.identityKey);
        delta += (entry.bytes ?? 0) - (previous?.bytes ?? 0);
        void store.put(entry);
    }
    const total = (await readTotalBytes(meta)) + delta;
    await meta.put(String(total), TOTAL_BYTES_META_KEY);
    await tx.done;
    await pruneIndexCache(db, total);
}

async function readTotalBytes(meta: { get(key: string): Promise<string | undefined> }): Promise<number> {
    const raw = await meta.get(TOTAL_BYTES_META_KEY);
    const parsed = raw === undefined ? 0 : Number(raw);
    return Number.isFinite(parsed) ? parsed : 0;
}

async function pruneIndexCache(db: PersistDb, totalHint: number): Promise<void> {
    const countTx = db.transaction("indexCache");
    const count = await countTx.store.count();
    await countTx.done;
    if (totalHint <= MAX_TOTAL_BYTES && count <= MAX_ENTRIES) return;

    // Count/total and the deletions share one transaction - a check taken
    // outside it can race a concurrent batch write and over-delete.
    const tx = db.transaction(["indexCache", "meta"], "readwrite");
    const store = tx.objectStore("indexCache");
    const meta = tx.objectStore("meta");
    let total = await readTotalBytes(meta);
    let entriesLeft = await store.count();
    let deleted = 0;
    let cursor = await store.index("bySavedAt").openCursor();
    while (cursor && (total > MAX_TOTAL_BYTES || entriesLeft > MAX_ENTRIES)) {
        const entry = cursor.value;
        // A pre-`bytes` entry never contributed to the total (subtracts 0);
        // a version-mismatched one is unreadable anyway - the walk clears
        // both as it reaches them, reclaiming space the total cannot see.
        total -= entry.bytes ?? 0;
        entriesLeft--;
        deleted++;
        await cursor.delete();
        cursor = await cursor.continue();
    }
    if (deleted > 0) await meta.put(String(Math.max(0, total)), TOTAL_BYTES_META_KEY);
    await tx.done;
    if (deleted > 0) {
        log.info("pruned index cache", { deleted, kept: entriesLeft, totalBytes: Math.max(0, total) });
    }
}
