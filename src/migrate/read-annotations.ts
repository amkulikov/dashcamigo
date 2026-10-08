import { buildSidecarPayload, parseSidecarPayload } from "../persist/annotations.js";
import { PERSIST_DB_NAME } from "../persist/db.js";
import type { AnnotationRecord } from "../persist/types.js";

function openExistingDatabase(factory: IDBFactory): Promise<IDBDatabase | null> {
    return new Promise((resolve, reject) => {
        // Omitting the version preserves whichever schema the old app used.
        const request = factory.open(PERSIST_DB_NAME);
        let isMissing = false;
        let isExpired = false;
        const timeout = setTimeout(() => {
            isExpired = true;
            reject(new Error("notes database open timed out"));
        }, 10_000);
        request.onupgradeneeded = () => {
            // The database can disappear between databases() and open().
            // Abort creation; even an empty recovery visit must leave no data.
            isMissing = true;
            request.transaction?.abort();
        };
        request.onerror = () => {
            clearTimeout(timeout);
            if (isMissing) resolve(null);
            else reject(request.error ?? new Error("notes database open failed"));
        };
        request.onsuccess = () => {
            clearTimeout(timeout);
            const db = request.result;
            if (isExpired) db.close();
            else resolve(db);
        };
    });
}

function readRecords(db: IDBDatabase): Promise<unknown[]> {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction("annotations", "readonly");
        const request = transaction.objectStore("annotations").getAll();
        transaction.oncomplete = () => resolve(request.result as unknown[]);
        transaction.onabort = () => reject(transaction.error ?? new Error("notes database read aborted"));
        transaction.onerror = () => reject(transaction.error ?? new Error("notes database read failed"));
    });
}

/** A null result means no notes exist here; every read/validation failure rejects. */
export async function readNotesBackup(): Promise<string | null> {
    const factory = globalThis.indexedDB;
    if (!factory || typeof factory.databases !== "function") throw new Error("notes database unavailable");
    if (!(await factory.databases()).some((db) => db.name === PERSIST_DB_NAME)) return null;
    const db = await openExistingDatabase(factory);
    if (db === null) return null;
    db.onversionchange = () => db.close();
    try {
        const records = await readRecords(db);
        if (records.length === 0) return null;
        // IndexedDB values are untrusted. Validate the complete serialized
        // backup so a corrupt or future record cannot silently disappear.
        const payload = JSON.stringify(buildSidecarPayload(records as AnnotationRecord[], Date.now()), null, 2);
        const parsed = parseSidecarPayload(payload);
        if (!parsed || parsed.rejectedEntries > 0 || parsed.records.length !== records.length) {
            throw new Error("notes database contains unsupported records");
        }
        return payload;
    } finally {
        db.close();
    }
}
