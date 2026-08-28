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

import { t } from "../i18n/index.js";
import type { I18nKey } from "../i18n/keys.js";
import { createLogger } from "../log.js";
import type { VendorFile } from "../parsers/types.js";
import {
    buildSidecarPayload,
    compareAnnotationVersions,
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
const SIDECAR_EXTENSION = ".dashcamigo";
function sidecarFileType(): FilePickerAcceptType {
    return {
        description: t("sidecar.fileDescription"),
        accept: { "application/json": [".dashcamigo"] },
    };
}
const WRITE_DEBOUNCE_MS = 1500;
type SidecarDiscovery = "none" | "attached" | "blocked";

const writeTimers = new Map<string, number>();
// File writes are full replacements. Serialize them in this tab, then take a
// cross-tab Web Lock where available so two dashcamigo tabs cannot both read
// the same old snapshot and close competing writable streams over each other.
const writeQueues = new Map<string, Promise<void>>();
// Remember/open paths can converge on the same folder. Sharing the in-flight
// task prevents two scans from racing to attach the same discovered file.
const folderOpenTasks = new Map<string, Promise<void>>();

// Folder ids whose sidecar file was most recently READ and recognized as ours.
// A failed or foreign-file read clears the flag immediately. Every write still
// re-reads under its lock; this set drives UI truthfulness and the warning
// dedupe, not permission to reuse an arbitrarily old snapshot.
const sidecarReadFolders = new Set<string>();
// One warning toast (unwritable or foreign file) per folder per session - the
// retry below runs on every edit, and the user can only act on the message once.
const unreadableWarned = new Set<string>();
const writeFailureWarned = new Set<string>();

export function initAnnotationsSidecar(): void {
    registerAnnotationsChangedHook(onAnnotationsChanged);
    registerFolderOpenedHook(onFolderOpened);
    // Connecting the file is an offer the user takes when they want it, from
    // the folder row in the sidebar - never a toast interrupting the note they
    // are in the middle of writing. Registered only where a save picker
    // exists, so the row hides the entry everywhere else.
    if (typeof window.showSaveFilePicker === "function" && typeof window.showOpenFilePicker === "function") {
        registerNotesConnector({
            create: createSidecarFile,
            useExisting: adoptSidecarFile,
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

/**
 * Read-only merge of the notes files that arrived INSIDE an ingest batch. The
 * file travels with the recordings, so every open path sees it as a plain
 * File - the classic picker, drag-and-drop, a browser without the folder
 * pickers, a fresh profile. Nothing here writes back or binds a handle: the
 * write side stays behind an explicit or auto attach, so this cannot touch
 * the file on disk. folderId from the file is restamped to the batch's local
 * id ("" for an unremembered folder - a later Remember re-keys via rebind).
 * An unremembered import does not steal an existing live local binding for a
 * record already known in this profile.
 */
export async function mergeNotesFilesFromBatch(files: VendorFile[], folderId: string): Promise<void> {
    const validFiles: Array<{ vendorFile: VendorFile; records: AnnotationRecord[] }> = [];
    for (const vendorFile of files) {
        if (!vendorFile.file.name.toLowerCase().endsWith(SIDECAR_EXTENSION)) continue;
        let parsed: AnnotationRecord[] | null;
        try {
            parsed = parseSidecarPayload(await vendorFile.file.text());
        } catch (err) {
            log.warn("notes file in batch unreadable", { err: err instanceof Error ? err.message : String(err) });
            continue;
        }
        if (parsed === null) {
            // Wrong contents under our extension - not worth a toast on every
            // folder open; the file is simply not merged.
            log.warn("notes-like file in batch is not ours, skipped", { name: vendorFile.file.name });
            continue;
        }
        validFiles.push({ vendorFile, records: parsed });
    }
    if (validFiles.length > 1) {
        // The writable auto-adopt path also refuses this ambiguity. Merging all
        // files read-only would be worse: unrelated backups could silently
        // cross-pollinate browser storage before the user picks the right one.
        log.warn("multiple notes files in ingest batch, none merged", { files: validFiles.length });
        return;
    }
    const found = validFiles[0];
    if (!found) return;
    const restamped = found.records.map((record) => (record.folderId === folderId ? record : { ...record, folderId }));
    let preserveFolderIds: ReadonlySet<string> | undefined;
    if (!folderId) {
        // Do not detach a record already owned by a still-remembered folder
        // merely because the same batch arrived through a handle-less picker.
        // Dead ids are deliberately absent so reopening after Forget can move
        // the record back to "" and make its markers visible again.
        preserveFolderIds = new Set((await listFolders().catch(() => [])).map((folder) => folder.id));
    }
    const changed = applyMergedRecords(restamped, { preserveFolderIds });
    if (changed > 0) {
        log.info("notes file merged from batch", { name: found.vendorFile.file.name, records: changed });
        renderTrips();
        refreshTimelineMarkers();
    }
}

/**
 * Where this folder's annotations actually land right now, as the editor
 * modals' hint key: browser-only, or browser + the connected notes file. ""
 * (no remembered folder) is always browser-only.
 */
export async function annotationStorageHintKey(folderId: string): Promise<I18nKey> {
    if (!folderId) return "annotations.storageHint";
    const folder = await getFolder(folderId).catch(() => null);
    if (!folder?.sidecarHandle || !sidecarReadFolders.has(folderId) || writeFailureWarned.has(folderId)) {
        return "annotations.storageHint";
    }
    return (await hasFileReadwritePermission(folder.sidecarHandle))
        ? "annotations.storageHintFile"
        : "annotations.storageHint";
}

function onFolderOpened(folder: RememberedFolder): Promise<void> {
    const existing = folderOpenTasks.get(folder.id);
    if (existing) return existing;
    const task = openFolderSidecar(folder).catch((err: unknown) => {
        log.warn("sidecar open-merge failed", { err: err instanceof Error ? err.message : String(err) });
    });
    folderOpenTasks.set(folder.id, task);
    void task.finally(() => {
        if (folderOpenTasks.get(folder.id) === task) folderOpenTasks.delete(folder.id);
    });
    return task;
}

async function openFolderSidecar(folder: RememberedFolder): Promise<void> {
    // Another open path may have attached the file while this one was waiting
    // on IndexedDB. Always make the decision from the latest stored record.
    const current = (await getFolder(folder.id).catch(() => null)) ?? folder;
    // The grant on a stored file handle is session-scoped, so after a browser
    // restart even READING the notes file fails. Every open path lands here,
    // and some of them still hold user activation (the folder row's Remember
    // click) - a no-op when activation is spent or the grant is live, and the
    // difference between merging and not merging when it is not.
    if (current.sidecarHandle) await ensureFileReadwritePermission(current.sidecarHandle);
    // Adopt records stranded on "" or on a dead folder id BEFORE the merge,
    // so they participate in the write-back below.
    try {
        const existingIds = new Set((await listFolders()).map((f) => f.id));
        rebindFolderAnnotations(current.id, existingIds);
    } catch {
        // No DB - session-only mode, nothing to rebind against.
    }
    if (!current.sidecarHandle) {
        // No file bound in THIS profile, but the folder itself may carry one
        // (written by another machine/profile - that is the whole point of the
        // file living next to the recordings). Complete adoption before the
        // caller offers to create a file, so it cannot race past discovery.
        await autoAdoptSidecar(current);
        return;
    }
    await mergeFromSidecar(current);
}

/**
 * Scans the folder ROOT (where the create path puts the file) for exactly one
 * notes file and attaches it as if the user had picked it. Zero found: the
 * common case, silence. Two or more: no honest guess, leave it to the manual
 * menu. A file that does not parse as ours is skipped with a log only - the
 * every-open cadence of this path would turn attachSidecar's warning toast
 * into a nag.
 */
async function autoAdoptSidecar(folder: RememberedFolder): Promise<SidecarDiscovery> {
    let found: FileSystemFileHandle | null = null;
    try {
        for await (const child of folder.handle.values()) {
            if (child.kind !== "file" || !child.name.toLowerCase().endsWith(SIDECAR_EXTENSION)) continue;
            if (found) {
                log.warn("multiple notes files in folder root, not auto-attaching", { folder: folder.label });
                return "blocked";
            }
            found = child;
        }
    } catch (err) {
        // Folder unreadable right now (unplugged mid-open, permission lapsed).
        log.warn("notes auto-adopt scan failed", { err: err instanceof Error ? err.message : String(err) });
        return "blocked";
    }
    if (!found) return "none";
    try {
        if (parseSidecarPayload(await (await found.getFile()).text()) === null) {
            log.warn("notes-like file in folder root is not ours, not auto-attaching", { name: found.name });
            return "blocked";
        }
    } catch (err) {
        log.warn("notes auto-adopt read failed", { err: err instanceof Error ? err.message : String(err) });
        return "blocked";
    }
    return (await attachSidecar(folder, found)) ? "attached" : "blocked";
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
            const writable = await ensureFileReadwritePermission(folder.sidecarHandle);
            if (!writable) {
                notifyWriteFailure(folderId);
                return;
            }
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
    const current = (await getFolder(folder.id).catch(() => null)) ?? folder;
    if (current.sidecarHandle) return;
    // Last safety check immediately before the destructive Save-As picker. If
    // a notes-like file is already present, either adopt it automatically or
    // route through the non-destructive Open picker so the user can choose.
    // This also covers a scan that saw multiple/unsupported/unreadable files:
    // uncertainty must never become permission to create over one of them.
    const discovery = await autoAdoptSidecar(current);
    if (discovery === "attached") return;
    if (discovery === "blocked") {
        await adoptSidecarFile(current);
        return;
    }
    let handle: FileSystemFileHandle;
    try {
        handle = await window.showSaveFilePicker({
            id: "annotations-sidecar",
            suggestedName: SIDECAR_SUGGESTED_NAME,
            // Defaults the dialog INTO the recordings folder - the user just
            // confirms; picking elsewhere is allowed and works the same.
            startIn: current.handle,
            excludeAcceptAllOption: true,
            types: [sidecarFileType()],
        });
    } catch (err) {
        if (!isPickerDismissal(err)) {
            log.warn("sidecar create picker failed", { err: err instanceof Error ? err.message : String(err) });
        }
        return;
    }
    await attachSidecar(current, handle);
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
            types: [sidecarFileType()],
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
async function attachSidecar(folder: RememberedFolder, handle: FileSystemFileHandle): Promise<boolean> {
    let text: string;
    try {
        text = await (await handle.getFile()).text();
    } catch (err) {
        // Unreadable now means unwritable later - binding it would only produce
        // a folder wired to a file nothing can use.
        log.warn("sidecar read failed at attach", { err: err instanceof Error ? err.message : String(err) });
        notify({ severity: "warn", messageKey: "sidecar.writeFailed" });
        return false;
    }
    if (parseSidecarPayload(text) === null) {
        // Someone else's file: hands off. It keeps its contents and the folder
        // keeps no handle, so nothing here can touch it later either.
        log.warn("picked file is not a dashcamigo notes file, not attaching");
        notify({ severity: "warn", messageKey: "sidecar.notOurFile" });
        return false;
    }
    try {
        await setFolderSidecarHandle(folder.id, handle);
    } catch (err) {
        log.warn("sidecar handle save failed", { err: err instanceof Error ? err.message : String(err) });
        return false;
    }
    // A different file from here on - whatever was read for the previous one
    // says nothing about this one's contents.
    sidecarReadFolders.delete(folder.id);
    unreadableWarned.delete(folder.id);
    writeFailureWarned.delete(folder.id);
    // The open picker grants read only. Buy the write while the picker's
    // gesture may still count; if activation is already spent this is a no-op
    // and the next annotation edit re-arms it through the same helper.
    const writable = await ensureFileReadwritePermission(handle);
    const updated = await getFolder(folder.id).catch(() => null);
    let readable = false;
    if (updated?.sidecarHandle) {
        readable = await mergeFromSidecar(updated).catch((err: unknown) => {
            log.warn("sidecar first merge failed", { err: err instanceof Error ? err.message : String(err) });
            return false;
        });
    }
    const enabled = writable && readable;
    if (enabled) notify({ severity: "info", messageKey: "sidecar.enabled" });
    else notifyWriteFailure(folder.id);
    return updated?.sidecarHandle !== undefined;
}

function scheduleWrite(folderId: string, delayMs: number = WRITE_DEBOUNCE_MS): void {
    const pending = writeTimers.get(folderId);
    if (pending !== undefined) clearTimeout(pending);
    writeTimers.set(
        folderId,
        window.setTimeout(() => {
            writeTimers.delete(folderId);
            enqueueWrite(folderId);
        }, delayMs),
    );
}

function flushPendingWrites(): void {
    for (const [folderId, timer] of [...writeTimers]) {
        clearTimeout(timer);
        writeTimers.delete(folderId);
        enqueueWrite(folderId);
    }
}

function enqueueWrite(folderId: string): void {
    const previous = writeQueues.get(folderId) ?? Promise.resolve();
    const queued = previous
        .catch(() => {})
        .then(() => withSidecarWriteLock(folderId, () => writeSidecar(folderId)))
        .catch((err: unknown) => {
            log.warn("sidecar queued write failed", { err: err instanceof Error ? err.message : String(err) });
        });
    writeQueues.set(folderId, queued);
    void queued.finally(() => {
        if (writeQueues.get(folderId) === queued) writeQueues.delete(folderId);
    });
}

async function withSidecarWriteLock(folderId: string, write: () => Promise<void>): Promise<void> {
    if (typeof navigator !== "undefined" && navigator.locks) {
        await navigator.locks.request(`dashcamigo:annotations-sidecar:${folderId}`, write);
        return;
    }
    await write();
}

async function writeSidecar(folderId: string): Promise<void> {
    const folder = await getFolder(folderId).catch(() => null);
    if (!folder?.sidecarHandle) return;
    const handle = folder.sidecarHandle;
    // Re-read immediately before EVERY full-replace write while this tab (and,
    // with Web Locks, every current-version tab) holds the folder lock. This
    // folds in edits made since folder-open instead of overwriting them from a
    // session-old snapshot. A failed/foreign read means hands off.
    const readable = await mergeFromSidecar(folder, false);
    if (!readable) {
        if (!unreadableWarned.has(folderId)) {
            unreadableWarned.add(folderId);
            log.warn("sidecar write skipped, file unreadable", { folder: folder.label });
            notify({ severity: "warn", messageKey: "sidecar.writeFailed" });
        }
        return;
    }
    // Writes fire from a debounce timer - no user gesture, so only a still-
    // granted permission works; a lapsed one skips quietly. Recovery paths:
    // ensureFileReadwritePermission re-arms the grant inside the next
    // annotation edit's gesture, and the chip-open flow re-arms it too.
    if (!(await hasFileReadwritePermission(handle))) {
        log.info("sidecar write skipped, permission not granted", { folder: folder.label });
        notifyWriteFailure(folderId);
        return;
    }
    const records = recordsForFolder(folderId);
    // Built next to the parser (persist/annotations.ts) so the two halves of the
    // file format cannot drift apart.
    const payload = buildSidecarPayload(records, Date.now());
    try {
        const writable = await handle.createWritable();
        await writable.write(JSON.stringify(payload));
        await writable.close();
        writeFailureWarned.delete(folderId);
        log.info("sidecar written", { folder: folder.label, records: records.length });
    } catch (err) {
        log.warn("sidecar write failed", { err: err instanceof Error ? err.message : String(err) });
        notifyWriteFailure(folderId);
    }
}

/**
 * Reads the folder's sidecar (if attached) and merges it with the local
 * records both ways: newer sidecar entries land in IndexedDB and refresh the
 * UI; a local side holding anything the file lacks triggers a converging
 * rewrite. An unreadable or malformed file is an expected local failure -
 * logged, never surfaced as an error (the IndexedDB copy still stands).
 */
async function mergeFromSidecar(folder: RememberedFolder, schedulePush = true): Promise<boolean> {
    const handle = folder.sidecarHandle;
    if (!handle) return false;
    let text: string;
    try {
        const file = await handle.getFile();
        text = await file.text();
    } catch (err) {
        // Not readable -> not writable either (see writeSidecar): the local
        // copy stands and nothing touches the file until a read succeeds.
        log.warn("sidecar read failed", { err: err instanceof Error ? err.message : String(err) });
        sidecarReadFolders.delete(folder.id);
        return false;
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
        sidecarReadFolders.delete(folder.id);
        if (!unreadableWarned.has(folder.id)) {
            unreadableWarned.add(folder.id);
            notify({ severity: "warn", messageKey: "sidecar.notOurFile" });
        }
        return false;
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
        return !inFile || compareAnnotationVersions(record, inFile) > 0;
    });
    if (needsPush && schedulePush) scheduleWrite(folder.id);
    return true;
}

async function hasFileReadwritePermission(handle: FileSystemFileHandle): Promise<boolean> {
    if (typeof handle.queryPermission !== "function") return true;
    try {
        return (await handle.queryPermission({ mode: "readwrite" })) === "granted";
    } catch {
        return false;
    }
}

function notifyWriteFailure(folderId: string): void {
    if (writeFailureWarned.has(folderId)) return;
    writeFailureWarned.add(folderId);
    notify({ severity: "warn", messageKey: "sidecar.writeFailed" });
}

/** Clears session-only coordination state between unit tests. */
export function _resetForTests(): void {
    for (const timer of writeTimers.values()) clearTimeout(timer);
    writeTimers.clear();
    writeQueues.clear();
    folderOpenTasks.clear();
    sidecarReadFolders.clear();
    unreadableWarned.clear();
    writeFailureWarned.clear();
}
