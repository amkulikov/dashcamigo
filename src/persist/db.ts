// The one IndexedDB database behind the persistent-folder feature. The Danger
// zone reset (ui/reset.ts) wipes it along with every other database on the
// origin - deliberate: "reset all app state" includes remembered folders and
// annotations.
//
// Availability is not guaranteed (private mode, storage disabled, quota):
// every caller must treat a rejected open as "feature degrades to
// session-only", never as a crash.

import { type DBSchema, type IDBPDatabase, openDB } from "idb";
import type { AnnotationRecord, CachedFileIndex, RememberedFolder } from "./types.js";

const DB_NAME = "dashcamigo";
const DB_VERSION = 3;

interface PersistDbSchema extends DBSchema {
    folders: { key: string; value: RememberedFolder };
    annotations: {
        key: string;
        value: AnnotationRecord;
        indexes: { byFolder: string };
    };
    /** Small key-value pairs (e.g. the last-opened folder id). */
    meta: { key: string; value: string };
    /** Cached indexing results, identity-keyed (see index-cache.ts). */
    indexCache: {
        key: string;
        value: CachedFileIndex;
        indexes: { bySavedAt: number };
    };
}

export type PersistDb = IDBPDatabase<PersistDbSchema>;

let dbPromise: Promise<PersistDb> | null = null;

/**
 * Opens the persist database, creating/migrating the schema as needed. The
 * connection is shared for the tab lifetime (memoized promise). Rejects when
 * IndexedDB is unavailable; a failed open is NOT memoized so a later call may
 * retry.
 */
export function openPersistDb(): Promise<PersistDb> {
    if (dbPromise === null) {
        dbPromise = openDB<PersistDbSchema>(DB_NAME, DB_VERSION, {
            upgrade(db, oldVersion, _newVersion, transaction) {
                if (oldVersion < 1) {
                    db.createObjectStore("folders", { keyPath: "id" });
                    const annotations = db.createObjectStore("annotations", { keyPath: "id" });
                    annotations.createIndex("byFolder", "folderId");
                    db.createObjectStore("meta");
                }
                if (oldVersion < 2) {
                    // savedAt index drives the size-bound prune (oldest first).
                    const cache = db.createObjectStore("indexCache", { keyPath: "identityKey" });
                    cache.createIndex("bySavedAt", "savedAt");
                }
                if (oldVersion === 2) {
                    // Format 2 stores independent metadata/GPS artifacts and
                    // cannot read the old whole-candidate snapshots. Reclaim
                    // them once during the schema migration instead of leaving
                    // unreachable payloads to consume the user's cache budget.
                    transaction.objectStore("indexCache").clear();
                    transaction.objectStore("meta").put("0", "indexCacheBytes");
                }
            },
            blocking(_currentVersion, _blockedVersion, _event) {
                // Another context wants a version change (schema bump in a
                // newer tab, or deleteDatabase from the Danger-zone reset).
                // Without closing here, that context blocks FOREVER - idb only
                // listens for versionchange when this callback is provided.
                void closePersistDb();
            },
            terminated() {
                // The browser killed the connection on its own (storage
                // pressure, a backend crash). Dropping the memo lets the next
                // call reopen; keeping it would leave every later annotation
                // and cache write failing silently for the tab's lifetime.
                dbPromise = null;
            },
        });
        dbPromise.catch(() => {
            dbPromise = null;
        });
    }
    return dbPromise;
}

/**
 * Closes the shared connection (no-op when never opened or already failed).
 * The next openPersistDb() reopens. Used before deleteDatabase in the reset
 * flow - a live connection turns the delete into a silent "blocked" that the
 * reset would misreport as success.
 */
export async function closePersistDb(): Promise<void> {
    const pending = dbPromise;
    if (pending === null) return;
    dbPromise = null;
    try {
        (await pending).close();
    } catch {
        // The open itself failed - nothing to close.
    }
}
