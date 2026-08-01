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
const DB_VERSION = 2;

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
            upgrade(db, oldVersion) {
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
            },
        });
        dbPromise.catch(() => {
            dbPromise = null;
        });
    }
    return dbPromise;
}

/** Test-only reset of the memoized connection. */
export function _resetForTests(): void {
    dbPromise = null;
}
