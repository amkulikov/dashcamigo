// Last-used notes-file state. Recording folders keep no file handle or storage
// choice: a file discovered in the currently opened folder takes priority,
// otherwise this independent fallback is reused.

import { openPersistDb } from "./db.js";
import type { NotesFileRecord, RememberedFolder } from "./types.js";

// Stable store key introduced with DB v4. Its value is an implementation
// detail; the record itself is the last-used fallback, not a global file.
const NOTES_FILE_STATE_ID = "global";

interface LegacyRememberedFolder extends RememberedFolder {
    sidecarHandle?: FileSystemFileHandle;
    sidecarAccess?: "file";
    notesStorage?: "browser";
}

let migrationPromise: Promise<NotesFileRecord> | null = null;

/** Removes folder-scoped notes state and promotes the most recently used
 * legacy file to the independent fallback. The folder records' last-opened
 * timestamps are the only old state that can represent "last used". */
export function migrateLegacyNotesFileState(): Promise<NotesFileRecord> {
    migrationPromise ??= runLegacyMigration().catch((err: unknown) => {
        migrationPromise = null;
        throw err;
    });
    return migrationPromise;
}

async function runLegacyMigration(): Promise<NotesFileRecord> {
    const db = await openPersistDb();
    const tx = db.transaction(["folders", "notesFile"], "readwrite");
    const notesStore = tx.objectStore("notesFile");
    const folderStore = tx.objectStore("folders");
    const [saved, folders] = await Promise.all([notesStore.get(NOTES_FILE_STATE_ID), folderStore.getAll()]);
    let state = saved;
    if (!state) {
        const pickedHandles = (folders as LegacyRememberedFolder[])
            .filter((folder) => folder.sidecarHandle && folder.sidecarAccess === "file")
            .sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
        if (pickedHandles[0]) {
            state = {
                id: NOTES_FILE_STATE_ID,
                handle: pickedHandles[0]!.sidecarHandle,
                access: "file",
            };
            await notesStore.put(state);
        }
    }
    for (const raw of folders as LegacyRememberedFolder[]) {
        if (!("sidecarHandle" in raw || "sidecarAccess" in raw || "notesStorage" in raw)) continue;
        const folder = { ...raw };
        delete folder.sidecarHandle;
        delete folder.sidecarAccess;
        delete folder.notesStorage;
        await folderStore.put(folder);
    }
    await tx.done;
    return state ?? { id: NOTES_FILE_STATE_ID };
}

export async function getNotesFileState(): Promise<NotesFileRecord> {
    await migrateLegacyNotesFileState();
    const db = await openPersistDb();
    return (await db.get("notesFile", NOTES_FILE_STATE_ID)) ?? { id: NOTES_FILE_STATE_ID };
}

export async function setNotesFileHandle(
    handle: FileSystemFileHandle,
    access: "file" | "derived" = "file",
): Promise<void> {
    await migrateLegacyNotesFileState();
    const db = await openPersistDb();
    await db.put("notesFile", { id: NOTES_FILE_STATE_ID, handle, access });
}

export async function setNotesStorage(storage: "browser" | null): Promise<void> {
    const current = await getNotesFileState();
    const next: NotesFileRecord = { ...current };
    if (storage === "browser") next.storage = storage;
    else delete next.storage;
    const db = await openPersistDb();
    await db.put("notesFile", next);
}

/** Test-only reset for the memoized migration. */
export function _resetForTests(): void {
    migrationPromise = null;
}
