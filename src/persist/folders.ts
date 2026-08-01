// Remembered-folder store plus the File System Access helpers around it:
// permission checks, dedupe via isSameEntry, recursive enumeration into
// VendorFile[]. UI-free - ui/persistent-folders.ts owns the UX on top.

import { createLogger } from "../log.js";
import type { VendorFile } from "../parsers/types.js";
import { openPersistDb } from "./db.js";
import type { RememberedFolder } from "./types.js";

const log = createLogger("persist-folders");

const LAST_FOLDER_META_KEY = "lastFolderId";

/** All remembered folders, most recently opened first. */
export async function listFolders(): Promise<RememberedFolder[]> {
    const db = await openPersistDb();
    const all = await db.getAll("folders");
    return all.sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
}

/**
 * Adds a folder to the remembered list, or refreshes the existing entry when
 * the same directory is already remembered (compared via isSameEntry, so
 * re-picking a folder never creates a duplicate). Marks it last-opened.
 */
export async function rememberFolder(handle: FileSystemDirectoryHandle): Promise<RememberedFolder> {
    const db = await openPersistDb();
    const existing = await db.getAll("folders");
    for (const folder of existing) {
        let same = false;
        try {
            same = await handle.isSameEntry(folder.handle);
        } catch {
            // isSameEntry can reject on a dead stored handle - treat as distinct;
            // the stale entry stays greyed in the list until the user forgets it.
        }
        if (same) {
            const updated: RememberedFolder = {
                ...folder,
                handle,
                label: handle.name,
                lastOpenedAt: Date.now(),
            };
            await db.put("folders", updated);
            await setLastFolderId(db, updated.id);
            return updated;
        }
    }
    const record: RememberedFolder = {
        id: crypto.randomUUID(),
        handle,
        label: handle.name,
        addedAt: Date.now(),
        lastOpenedAt: Date.now(),
    };
    await db.put("folders", record);
    await setLastFolderId(db, record.id);
    return record;
}

/** Removes a folder from the list (annotations keyed by folderId stay - the
 *  user may remember the folder again later and they re-attach). */
export async function forgetFolder(id: string): Promise<void> {
    const db = await openPersistDb();
    await db.delete("folders", id);
    const last = await db.get("meta", LAST_FOLDER_META_KEY);
    if (last === id) await db.delete("meta", LAST_FOLDER_META_KEY);
}

/** Stamps the folder as most recently opened; drives the auto-restore pick. */
export async function markFolderOpened(id: string): Promise<void> {
    const db = await openPersistDb();
    const folder = await db.get("folders", id);
    if (!folder) return;
    folder.lastOpenedAt = Date.now();
    await db.put("folders", folder);
    await setLastFolderId(db, id);
}

/** The folder auto-restore should target, or null when none is remembered. */
export async function getLastFolder(): Promise<RememberedFolder | null> {
    const db = await openPersistDb();
    const id = await db.get("meta", LAST_FOLDER_META_KEY);
    if (!id) return null;
    return (await db.get("folders", id)) ?? null;
}

async function setLastFolderId(db: Awaited<ReturnType<typeof openPersistDb>>, id: string): Promise<void> {
    await db.put("meta", id, LAST_FOLDER_META_KEY);
}

/**
 * Permission state of a stored handle without prompting. "granted" does NOT
 * mean the folder still exists - only an actual read reveals a moved or
 * unplugged folder (NotFoundError at enumeration time). Returns "denied" when
 * the API is absent or the query itself throws.
 */
export async function queryFolderPermission(handle: FileSystemDirectoryHandle): Promise<PermissionState> {
    try {
        if (typeof handle.queryPermission !== "function") return "denied";
        return await handle.queryPermission({ mode: "read" });
    } catch (err) {
        log.warn("queryPermission failed", { err: err instanceof Error ? err.message : String(err) });
        return "denied";
    }
}

/**
 * Prompts for read access on a stored handle. Must be called from a user
 * gesture - the browser rejects gesture-less requestPermission calls.
 */
export async function requestFolderPermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
    try {
        if (typeof handle.requestPermission !== "function") return false;
        return (await handle.requestPermission({ mode: "read" })) === "granted";
    } catch (err) {
        log.warn("requestPermission failed", { err: err instanceof Error ? err.message : String(err) });
        return false;
    }
}

export interface FolderEnumeration {
    files: VendorFile[];
    /** Entries that failed to read and were skipped - one unreadable file must
     *  not abort the whole folder (mirrors the DnD traversal contract). */
    readErrors: number;
}

/**
 * Recursively lists a directory handle into VendorFile[]. relativePath is
 * prefixed with the root folder name to match the webkitRelativePath shape of
 * the classic <input webkitdirectory> path - filename techniques and the
 * cross-session cache identity rely on the two picker paths producing
 * identical paths for the same folder. Throws when the root itself cannot be
 * read (folder moved/unplugged/permission revoked - caller decides the UX);
 * per-child failures are counted and skipped.
 */
export async function enumerateFolder(handle: FileSystemDirectoryHandle): Promise<FolderEnumeration> {
    const out: VendorFile[] = [];
    const errors = { count: 0 };
    await walkDirectory(handle, handle.name, out, errors);
    return { files: out, readErrors: errors.count };
}

// Iteration errors here propagate to the caller: for the root that is the
// "whole folder is gone" signal; for subdirectories the recursive call site
// below catches them into the skip counter.
async function walkDirectory(
    dir: FileSystemDirectoryHandle,
    prefix: string,
    out: VendorFile[],
    errors: { count: number },
): Promise<void> {
    for await (const child of dir.values()) {
        if (child.kind === "file") {
            try {
                const file = await child.getFile();
                out.push({ file, relativePath: `${prefix}/${child.name}` });
            } catch (err) {
                errors.count++;
                log.warn("fsa: failed to read file entry", {
                    name: child.name,
                    err: err instanceof Error ? err.message : String(err),
                });
            }
        } else {
            try {
                await walkDirectory(child, `${prefix}/${child.name}`, out, errors);
            } catch (err) {
                errors.count++;
                log.warn("fsa: failed to read directory", {
                    name: child.name,
                    err: err instanceof Error ? err.message : String(err),
                });
            }
        }
    }
}
