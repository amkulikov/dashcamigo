// Annotations sidecar: a notes file living in the user's own
// folder (Chromium-only - needs showSaveFilePicker), so notes survive browser
// data cleanup and travel with the recordings. IndexedDB stays the working
// copy; the sidecar is an auto-synced replica merged per record (LWW +
// tombstones) whenever the folder opens.
//
// Flow: the folder row in the sidebar (ui/folder-sources.ts) offers TWO ways to
// attach a file, and the split is forced by the pickers themselves.
// showSaveFilePicker empties whatever file the user selects BEFORE it returns
// (spec: "set entry's binary data to an empty byte sequence"; verified - the
// file is 0 bytes with no writable ever opened), so it can only ever create a
// new file. Adopting a notes file that already holds records - one that
// travelled here on the card from another machine - goes through
// showOpenFilePicker, which has no such step and hands back a read-granted
// handle; write access is bought separately via requestPermission inside a
// gesture. Both paths converge on attachSidecar, which reads and validates
// BEFORE persisting the handle: a file that is not ours is never adopted, so it
// is never overwritten. After that every annotation change schedules a
// debounced atomic write (createWritable = write-to-swap, rename-on-close - a
// crash never tears the file).
//
// folderId in the file is never trusted: it is a per-profile UUID, so every
// record read from a folder's sidecar is restamped with the LOCAL folder id
// (see mergeFromSidecar). Without that, records written by another machine
// would be excluded from this machine's writes and the two profiles would
// endlessly erase each other's notes from the file.

import { createLogger } from "../log.js";
import {
    annotationContentEqual,
    buildSidecarPayload,
    mergeAnnotationLists,
    parseSidecarPayload,
} from "../persist/annotations.js";
import { ensureFileReadwritePermission, getFolder, listFolders, setFolderSidecarHandle } from "../persist/folders.js";
import type { AnnotationRecord, RememberedFolder } from "../persist/types.js";
import {
    applyMergedRecords,
    rebindFolderAnnotations,
    recordsForFolder,
    registerAnnotationsChangedHook,
} from "./annotations.js";
import { notify } from "./notifications.js";
import { registerFolderOpenedHook, registerNotesConnector } from "./folder-sources.js";
import { renderTrips } from "./sidebar.js";
import { refreshTimelineMarkers } from "./timeline-markers.js";

const log = createLogger("annotations-sidecar");

// Our own extension, not .json, and paired with excludeAcceptAllOption below:
// the dialogs then list only files we wrote. That keeps an ordinary .json of
// the user's out of reach on the create path, where a mis-click is destructive
// and irreversible (the picker empties the file, not us). Typing a foreign name
// by hand still reaches it - extension appending is implementation-defined -
// but that is a deliberate act on a Save-As dialog, not a slip.
const SIDECAR_SUGGESTED_NAME = "notes.dashcamigo";
const SIDECAR_FILE_TYPE: FilePickerAcceptType = {
    description: "dashcamigo notes",
    accept: { "application/json": [".dashcamigo"] },
};
const WRITE_DEBOUNCE_MS = 1500;

const writeTimers = new Map<string, number>();

// Folder ids whose sidecar file this session has READ and recognized as ours.
// A write is a full replace, so it must never run before this side has seen
// what the file holds - after a browser restart the stored handle is back to
// "prompt" and the open-time read fails, while the next annotation edit
// re-arms the grant and would happily overwrite another machine's notes with
// this profile's copy. A file that does not parse as ours stays out too (see
// mergeFromSidecar): whatever replaced it is not this writer's to erase.
const sidecarReadFolders = new Set<string>();
// One warning toast (unwritable or foreign file) per folder per session - the
// retry below runs on every edit, and the user can only act on the message once.
const unreadableWarned = new Set<string>();

export function initAnnotationsSidecar(): void {
    registerAnnotationsChangedHook(onAnnotationsChanged);
    registerFolderOpenedHook(onFolderOpened);
    // Connecting the file is an offer the user takes when they want it, from
    // the folder row in the sidebar - never a toast interrupting the note they
    // are in the middle of writing. Registered only where a save picker
    // exists, so the row hides the entry everywhere else.
    if (typeof window.showSaveFilePicker === "function" && typeof window.showOpenFilePicker === "function") {
        registerNotesConnector({
            create: (folder) => void createSidecarFile(folder),
            useExisting: (folder) => void adoptSidecarFile(folder),
        });
    }
    // A write still sitting in its debounce window at tab close would be
    // lost. visibilitychange->hidden fires on tab switches too, shrinking
    // the loss window; pagehide is the last reliable moment on real close
    // (beforeunload is not delivered on mobile).
    window.addEventListener("pagehide", flushPendingWrites);
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") flushPendingWrites();
    });
}

function onFolderOpened(folder: RememberedFolder): void {
    void (async () => {
        // The grant on a stored file handle is session-scoped, so after a
        // browser restart even READING the notes file fails. Every open path
        // lands here, and some of them still hold user activation (the folder
        // row's Remember click) - a no-op when activation is spent or the
        // grant is live, and the difference between merging and not merging
        // when it is not.
        if (folder.sidecarHandle) await ensureFileReadwritePermission(folder.sidecarHandle);
        // Adopt records stranded on "" or on a dead folder id BEFORE the
        // merge, so they participate in the write-back below.
        try {
            const existingIds = new Set((await listFolders()).map((f) => f.id));
            rebindFolderAnnotations(folder.id, existingIds);
        } catch {
            // No DB - session-only mode, nothing to rebind against.
        }
        await mergeFromSidecar(folder);
    })().catch((err: unknown) => {
        log.warn("sidecar open-merge failed", { err: err instanceof Error ? err.message : String(err) });
    });
}

function onAnnotationsChanged(folderId: string): void {
    // "" = the annotated trip's root folder is not remembered - nowhere to
    // put a notes file. The record still lives in IndexedDB.
    if (!folderId) return;
    void getFolder(folderId)
        .then(async (folder) => {
            // No file connected yet: nothing to write, and asking for one is
            // the folder row's job, not this hook's.
            if (!folder?.sidecarHandle) return;
            // Annotation edits happen inside clicks/keys - re-arm the
            // session-scoped readwrite grant while activation is live, or the
            // gesture-less debounced write below can only skip.
            await ensureFileReadwritePermission(folder.sidecarHandle);
            scheduleWrite(folderId);
        })
        .catch(() => {});
}

/**
 * Creates a fresh notes file for the folder. The save picker empties whatever
 * it returns, so this path can only ever end on an empty file - which is
 * exactly what "create" means, and why the extension filter matters here more
 * than anywhere else.
 */
async function createSidecarFile(folder: RememberedFolder): Promise<void> {
    if (typeof window.showSaveFilePicker !== "function") return;
    let handle: FileSystemFileHandle;
    try {
        handle = await window.showSaveFilePicker({
            id: "annotations-sidecar",
            suggestedName: SIDECAR_SUGGESTED_NAME,
            // Defaults the dialog INTO the recordings folder - the user just
            // confirms; picking elsewhere is allowed and works the same.
            startIn: folder.handle,
            excludeAcceptAllOption: true,
            types: [SIDECAR_FILE_TYPE],
        });
    } catch (err) {
        if (!isPickerDismissal(err)) {
            log.warn("sidecar create picker failed", { err: err instanceof Error ? err.message : String(err) });
        }
        return;
    }
    await attachSidecar(folder, handle);
}

/**
 * Adopts a notes file that already exists - the one that came along on the card
 * from another machine. The open picker leaves it intact, so its records are
 * still there to be read and merged.
 */
async function adoptSidecarFile(folder: RememberedFolder): Promise<void> {
    if (typeof window.showOpenFilePicker !== "function") return;
    let handle: FileSystemFileHandle | undefined;
    try {
        [handle] = await window.showOpenFilePicker({
            id: "annotations-sidecar",
            startIn: folder.handle,
            multiple: false,
            excludeAcceptAllOption: true,
            types: [SIDECAR_FILE_TYPE],
        });
    } catch (err) {
        if (!isPickerDismissal(err)) {
            log.warn("sidecar open picker failed", { err: err instanceof Error ? err.message : String(err) });
        }
        return;
    }
    if (!handle) return;
    await attachSidecar(folder, handle);
}

function isPickerDismissal(err: unknown): boolean {
    // AbortError = dismissed the dialog; the offer stays in the menu.
    return err instanceof DOMException && err.name === "AbortError";
}

/**
 * Validates a picked file and, only if it checks out, binds it to the folder
 * and merges. Reading BEFORE persisting the handle is the whole point: a file
 * we never adopt is a file the debounced writer can never overwrite. Both
 * pickers land here - for a freshly created file the read simply returns
 * nothing, which parses as an empty record set and seeds the file on merge.
 */
async function attachSidecar(folder: RememberedFolder, handle: FileSystemFileHandle): Promise<void> {
    let text: string;
    try {
        text = await (await handle.getFile()).text();
    } catch (err) {
        // Unreadable now means unwritable later - binding it would only produce
        // a folder wired to a file nothing can use.
        log.warn("sidecar read failed at attach", { err: err instanceof Error ? err.message : String(err) });
        notify({ severity: "warn", messageKey: "sidecar.writeFailed" });
        return;
    }
    if (parseSidecarPayload(text) === null) {
        // Someone else's file: hands off. It keeps its contents and the folder
        // keeps no handle, so nothing here can touch it later either.
        log.warn("picked file is not a dashcamigo notes file, not attaching");
        notify({ severity: "warn", messageKey: "sidecar.notOurFile" });
        return;
    }
    try {
        await setFolderSidecarHandle(folder.id, handle);
    } catch (err) {
        log.warn("sidecar handle save failed", { err: err instanceof Error ? err.message : String(err) });
        return;
    }
    // A different file from here on - whatever was read for the previous one
    // says nothing about this one's contents.
    sidecarReadFolders.delete(folder.id);
    unreadableWarned.delete(folder.id);
    // The open picker grants read only. Buy the write while the picker's
    // gesture may still count; if activation is already spent this is a no-op
    // and the next annotation edit re-arms it through the same helper.
    await ensureFileReadwritePermission(handle);
    notify({ severity: "info", messageKey: "sidecar.enabled" });
    const updated = await getFolder(folder.id).catch(() => null);
    if (updated?.sidecarHandle) {
        await mergeFromSidecar(updated).catch((err: unknown) => {
            log.warn("sidecar first merge failed", { err: err instanceof Error ? err.message : String(err) });
        });
    }
}

function scheduleWrite(folderId: string, delayMs: number = WRITE_DEBOUNCE_MS): void {
    const pending = writeTimers.get(folderId);
    if (pending !== undefined) clearTimeout(pending);
    writeTimers.set(
        folderId,
        window.setTimeout(() => {
            writeTimers.delete(folderId);
            void writeSidecar(folderId);
        }, delayMs),
    );
}

function flushPendingWrites(): void {
    for (const [folderId, timer] of [...writeTimers]) {
        clearTimeout(timer);
        writeTimers.delete(folderId);
        void writeSidecar(folderId);
    }
}

async function writeSidecar(folderId: string): Promise<void> {
    const folder = await getFolder(folderId).catch(() => null);
    if (!folder?.sidecarHandle) return;
    const handle = folder.sidecarHandle;
    // Not read this session: a lapsed permission at folder-open time, a
    // transient IO error, or contents that turned out not to be ours. A write
    // without a preceding read is precisely how notes made on another machine
    // get erased, so retry the read first - this call chain starts at an
    // annotation edit, which re-armed the grant inside its gesture, so the
    // retry usually succeeds. Still unread afterwards means hands off, and the
    // merge has already said why if it knew (a foreign file warns there).
    if (!sidecarReadFolders.has(folderId)) {
        await mergeFromSidecar(folder);
        if (!sidecarReadFolders.has(folderId)) {
            if (!unreadableWarned.has(folderId)) {
                unreadableWarned.add(folderId);
                log.warn("sidecar write skipped, file unreadable this session", { folder: folder.label });
                notify({ severity: "warn", messageKey: "sidecar.writeFailed" });
            }
            return;
        }
    }
    // Writes fire from a debounce timer - no user gesture, so only a still-
    // granted permission works; a lapsed one skips quietly. Recovery paths:
    // ensureFileReadwritePermission re-arms the grant inside the next
    // annotation edit's gesture, and the chip-open flow re-arms it too.
    if (typeof handle.queryPermission === "function") {
        const permission = await handle.queryPermission({ mode: "readwrite" }).catch(() => "denied" as const);
        if (permission !== "granted") {
            log.info("sidecar write skipped, permission not granted", { folder: folder.label });
            return;
        }
    }
    const records = recordsForFolder(folderId);
    // Built next to the parser (persist/annotations.ts) so the two halves of the
    // file format cannot drift apart.
    const payload = buildSidecarPayload(records, Date.now());
    try {
        const writable = await handle.createWritable();
        await writable.write(JSON.stringify(payload));
        await writable.close();
        log.info("sidecar written", { folder: folder.label, records: records.length });
    } catch (err) {
        log.warn("sidecar write failed", { err: err instanceof Error ? err.message : String(err) });
        notify({ severity: "warn", messageKey: "sidecar.writeFailed" });
    }
}

/**
 * Reads the folder's sidecar (if attached) and merges it with the local
 * records both ways: newer sidecar entries land in IndexedDB and refresh the
 * UI; a local side holding anything the file lacks triggers a converging
 * rewrite. An unreadable or malformed file is an expected local failure -
 * logged, never surfaced as an error (the IndexedDB copy still stands).
 */
async function mergeFromSidecar(folder: RememberedFolder): Promise<void> {
    const handle = folder.sidecarHandle;
    if (!handle) return;
    let text: string;
    try {
        const file = await handle.getFile();
        text = await file.text();
    } catch (err) {
        // Not readable -> not writable either (see writeSidecar): the local
        // copy stands and nothing touches the file until a read succeeds.
        log.warn("sidecar read failed", { err: err instanceof Error ? err.message : String(err) });
        return;
    }
    const parsed = parseSidecarPayload(text);
    if (parsed === null) {
        // Foreign or corrupt. Attach-time validation keeps this out of the
        // normal path, so the file changed underneath us - swapped by hand, or
        // torn by something else writing it. Deliberately NOT marked as read:
        // that is the flag writeSidecar needs before it replaces the contents,
        // so leaving it unset means nothing here can overwrite whatever is in
        // there now. The IndexedDB copy stays authoritative meanwhile.
        log.warn("sidecar file is not a dashcamigo annotations file, leaving it alone");
        if (!unreadableWarned.has(folder.id)) {
            unreadableWarned.add(folder.id);
            notify({ severity: "warn", messageKey: "sidecar.notOurFile" });
        }
        return;
    }
    // The file's contents are known from here on.
    sidecarReadFolders.add(folder.id);
    unreadableWarned.delete(folder.id);
    // Restamp: records arriving through THIS folder's sidecar belong to this
    // folder locally, whatever per-profile UUID the writing side used.
    const sidecarRecords: AnnotationRecord[] = parsed.map((record) =>
        record.folderId === folder.id ? record : { ...record, folderId: folder.id },
    );
    const local = recordsForFolder(folder.id);
    const merged = mergeAnnotationLists(local, sidecarRecords);
    const changedLocally = applyMergedRecords(merged);
    if (changedLocally > 0) {
        log.info("sidecar merged in", { records: changedLocally });
        renderTrips();
        refreshTimelineMarkers();
    }
    // Push back only when the local side holds something the file lacks: an
    // id missing from the file, a strictly newer version, or a different
    // winner at an equal timestamp (tombstone tie). An in-sync pair skips
    // the write entirely - rewriting an untouched file on every open churns
    // its mtime for nothing.
    const sidecarById = new Map(sidecarRecords.map((record) => [record.id, record]));
    const needsPush = recordsForFolder(folder.id).some((record) => {
        const inFile = sidecarById.get(record.id);
        if (!inFile) return true;
        if (inFile.updatedAt < record.updatedAt) return true;
        return inFile.updatedAt === record.updatedAt && !annotationContentEqual(inFile, record);
    });
    if (needsPush) scheduleWrite(folder.id);
}
