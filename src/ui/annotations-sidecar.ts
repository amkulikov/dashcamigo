// Annotations backup: a notes file living in the user's own recordings folder
// (Chromium-only - needs a writable directory handle), so notes survive browser
// data cleanup and travel with the recordings. IndexedDB stays the working copy;
// the sidecar is an auto-synced replica merged per record (LWW + tombstones)
// whenever the folder opens.
//
// Creating uses directoryHandle.getFileHandle({ create: true }), which returns
// an existing file intact instead of the destructive Save-As picker behavior.
// Both create and adopt read and validate before persisting the file handle. A
// partially readable file is imported read-only: valid records are recovered,
// but the file is never replaced because that would erase unknown records.
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
import {
    ensureDirectoryReadwritePermission,
    ensureFileReadwritePermission,
    getFolder,
    listFolders,
    setFolderSidecarHandle,
} from "../persist/folders.js";
import type { AnnotationRecord, RememberedFolder } from "../persist/types.js";
import {
    annotationStoreAvailable,
    allAnnotationRecords,
    applyMergedRecords,
    rebindFolderAnnotations,
    recordsForFolder,
    registerAnnotationPersistenceStatusHook,
    registerAnnotationsChangedHook,
    scopeAnnotationRecordsToFolder,
    waitForAnnotationsReady,
} from "./annotations.js";
import { notify } from "./notifications.js";
import {
    type IngestNotesFileStatus,
    refreshFolderSources,
    registerFolderOpenedHook,
    registerNotesConnector,
} from "./folder-sources.js";
import { renderTrips } from "./sidebar.js";
import { refreshTimelineMarkers } from "./timeline-markers.js";

const log = createLogger("annotations-sidecar");

// Our own extension plus excludeAcceptAllOption keeps ordinary JSON files out
// of the non-destructive picker used to connect an existing backup.
const SIDECAR_SUGGESTED_NAME = "notes.dashcamigo";
const SIDECAR_EXTENSION = ".dashcamigo";
const WRITE_DEBOUNCE_MS = 1500;
function sidecarFileType(): FilePickerAcceptType {
    return {
        description: t("sidecar.fileDescription"),
        accept: { "application/json": [".dashcamigo"] },
    };
}
type SidecarDiscovery = "none" | "attached" | "blocked";

// File writes are full replacements. Serialize them in this tab, then take a
// cross-tab Web Lock where available so two dashcamigo tabs cannot both read
// the same old snapshot and close competing writable streams over each other.
const writeQueues = new Map<string, Promise<void>>();
// A burst (rebind, marker re-stamp, multi-field clear) becomes one full-file
// replacement. Besides latency, this avoids needless writes to removable media.
const writeTimers = new Map<string, number>();
// Includes the async folder/permission lookup that happens before a write
// reaches writeQueues. A reset must wait for this stage too, or it can wipe the
// folder record while the latest edit is still deciding where to save.
const pendingChangeWrites = new Set<Promise<void>>();
// Remember/open paths can converge on the same folder. Sharing the in-flight
// task prevents two scans from racing to attach the same discovered file.
const folderOpenTasks = new Map<string, Promise<void>>();

// Folder ids whose sidecar file was most recently READ and recognized as ours.
// A failed or foreign-file read clears the flag immediately. Every write still
// re-reads under its lock; this set is the safety gate for replacing the file,
// not a connection-health flag. Its absence just after a page reload means
// "not checked yet", not "broken".
const sidecarReadFolders = new Set<string>();
// A persisted handle that has not been touched in this page is still a saved
// connection. Keep actual read failures separate so a reload does not invent a
// red reconnect state, while a handle that really failed remains honest in UI.
const sidecarReadFailures = new Set<string>();
// Recognized files with at least one malformed/unknown record stay strictly
// read-only. Valid records are recovered, but replacing the file would turn a
// partial recovery into permanent data loss.
const partialSidecarFolders = new Set<string>();
// One warning toast (unwritable or foreign file) per folder per session - the
// retry below runs on every edit, and the user can only act on the message once.
const unreadableWarned = new Set<string>();
const writeFailureWarned = new Set<string>();

export function initAnnotationsSidecar(): void {
    registerAnnotationsChangedHook(onAnnotationsChanged);
    registerAnnotationPersistenceStatusHook((available) => {
        refreshFolderSources();
        if (!available) notify({ severity: "error", messageKey: "annotations.browserSaveFailed" });
    });
    registerFolderOpenedHook(onFolderOpened);
    // Folder sources exist only on the directory-handle path. The open picker
    // is needed for adopting a backup outside the selected folder.
    if (typeof window.showOpenFilePicker === "function") {
        registerNotesConnector({
            create: createSidecarFile,
            useExisting: adoptSidecarFile,
            status: sidecarStatus,
            browserStorageReady: annotationStoreAvailable,
        });
    }
    window.addEventListener("pagehide", () => void flushPendingSidecarWrites());
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") void flushPendingSidecarWrites();
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
export async function mergeNotesFilesFromBatch(
    files: VendorFile[],
    folderId: string,
): Promise<IngestNotesFileStatus[]> {
    const notesFiles = files.filter((vendorFile) => isNotesBackupName(vendorFile.file.name));
    if (notesFiles.length > 1) {
        log.warn("multiple notes files in ingest batch, none merged", { files: notesFiles.length });
        notify({ severity: "warn", messageKey: "sidecar.multipleFound" });
        return notesFiles.map((vendorFile) => ingestNotesStatus(vendorFile, "multiple"));
    }
    const vendorFile = notesFiles[0];
    if (!vendorFile) return [];
    await waitForAnnotationsReady();
    let parsed: ReturnType<typeof parseSidecarPayload>;
    try {
        parsed = parseSidecarPayload(await vendorFile.file.text());
    } catch (err) {
        log.warn("notes file in batch unreadable", { err: err instanceof Error ? err.message : String(err) });
        notify({ severity: "error", messageKey: "sidecar.importFailed" });
        return [ingestNotesStatus(vendorFile, "unreadable")];
    }
    if (parsed === null) {
        log.warn("notes-like file in batch is not ours, skipped", { name: vendorFile.file.name });
        notify({ severity: "error", messageKey: "sidecar.notOurFile" });
        return [ingestNotesStatus(vendorFile, "invalid")];
    }
    const restamped = folderId
        ? await folderScopedSidecarRecords(parsed.records, folderId)
        : parsed.records.map((record) => (record.folderId === "" ? record : { ...record, folderId: "" }));
    let preserveFolderIds: ReadonlySet<string> | undefined;
    if (!folderId) {
        // Do not detach a record already owned by a still-remembered folder
        // merely because the same batch arrived through a handle-less picker.
        // Dead ids are deliberately absent so reopening after Forget can move
        // the record back to "" and make its markers visible again.
        preserveFolderIds = new Set((await listFolders().catch(() => [])).map((folder) => folder.id));
    }
    const changed = applyMergedRecords(restamped, { preserveFolderIds });
    if (parsed.rejectedEntries > 0) {
        notify({
            severity: "error",
            messageKey: "sidecar.partialReadOnly",
            messageParams: { n: parsed.rejectedEntries },
        });
    }
    if (changed > 0) {
        log.info("notes file merged from batch", { name: vendorFile.file.name, records: changed });
        renderTrips();
        refreshTimelineMarkers();
    }
    return [ingestNotesStatus(vendorFile, parsed.rejectedEntries > 0 ? "partial" : "loaded")];
}

function ingestNotesStatus(vendorFile: VendorFile, state: IngestNotesFileStatus["state"]): IngestNotesFileStatus {
    const segments = vendorFile.relativePath.split(/[/\\]/).filter(Boolean);
    return {
        sourceKey: vendorFile.sourceKey ?? "unscoped",
        root: segments.length > 1 ? segments[0]! : "",
        fileName: vendorFile.file.name,
        state,
    };
}

export function isNotesBackupName(name: string): boolean {
    return name.toLowerCase().endsWith(SIDECAR_EXTENSION);
}

/** Downloads one portable snapshot for browsers that cannot keep a writable
 * file connected. It uses the same validated format as folder auto-sync. */
export async function downloadPortableNotesBackup(): Promise<void> {
    await waitForAnnotationsReady();
    const records = allAnnotationRecords();
    if (records.length === 0) {
        notify({ severity: "info", messageKey: "sidecar.exportEmpty" });
        return;
    }
    const blob = new Blob([JSON.stringify(buildSidecarPayload(records, Date.now()))], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `dashcamigo-notes-${new Date().toISOString().slice(0, 10)}${SIDECAR_EXTENSION}`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    notify({ severity: "info", messageKey: "sidecar.exported" });
}

/** Imports a portable snapshot without ever writing back to the selected file.
 * Unknown folder ids are cleared; open folders can then reclaim records by
 * clip identity, and marker anchors make new backups portable too. */
export async function importPortableNotesBackup(file: File): Promise<void> {
    await waitForAnnotationsReady();
    let parsed: ReturnType<typeof parseSidecarPayload>;
    try {
        parsed = parseSidecarPayload(await file.text());
    } catch (err) {
        log.warn("portable notes backup read failed", { err: err instanceof Error ? err.message : String(err) });
        notify({ severity: "error", messageKey: "sidecar.importFailed" });
        return;
    }
    if (!parsed) {
        notify({ severity: "error", messageKey: "sidecar.notOurFile" });
        return;
    }
    const folders = await listFolders().catch(() => []);
    const liveFolderIds = new Set(folders.map((folder) => folder.id));
    const recordsBefore = new Map(
        folders.map((folder) => [folder.id, new Map(recordsForFolder(folder.id).map((record) => [record.id, record]))]),
    );
    const portable = parsed.records.map((record) =>
        liveFolderIds.has(record.folderId) ? record : { ...record, folderId: "" },
    );
    const changed = applyMergedRecords(portable, { preserveFolderIds: liveFolderIds });
    let rebound = 0;
    for (const folder of folders) rebound += rebindFolderAnnotations(folder.id, liveFolderIds);
    for (const folder of folders) {
        if (!folder.sidecarHandle) continue;
        const before = recordsBefore.get(folder.id) ?? new Map<string, AnnotationRecord>();
        const after = recordsForFolder(folder.id);
        const didChange = before.size !== after.length || after.some((record) => before.get(record.id) !== record);
        if (didChange) onAnnotationsChanged(folder.id);
    }
    if (changed > 0 || rebound > 0) {
        renderTrips();
        refreshTimelineMarkers();
    }
    notify({
        severity: "info",
        messageKey: "sidecar.imported",
        messageParams: { n: parsed.records.length },
    });
    if (parsed.rejectedEntries > 0) {
        notify({
            severity: "error",
            messageKey: "sidecar.partialReadOnly",
            messageParams: { n: parsed.rejectedEntries },
        });
    }
}

/**
 * Where this folder's annotations actually land right now, plus the honest
 * next action for the editor modal. "" means there is no remembered folder.
 */
export interface AnnotationStorageState {
    hintKey: I18nKey;
    backupAction: "create" | "reconnect" | null;
}

export async function annotationStorageState(folderId: string): Promise<AnnotationStorageState> {
    const browserReady = annotationStoreAvailable();
    if (!folderId) {
        return {
            hintKey: browserReady ? "annotations.storageHint" : "annotations.storageHintSession",
            backupAction: browserReady ? "create" : null,
        };
    }
    const folder = await getFolder(folderId).catch(() => null);
    if (partialSidecarFolders.has(folderId)) {
        return {
            hintKey: browserReady ? "annotations.storageHintReconnect" : "annotations.storageHintSession",
            backupAction: "reconnect",
        };
    }
    if (!folder?.sidecarHandle) {
        const needsReconnect = partialSidecarFolders.has(folderId) || writeFailureWarned.has(folderId);
        return {
            hintKey: browserReady
                ? needsReconnect
                    ? "annotations.storageHintReconnect"
                    : "annotations.storageHint"
                : "annotations.storageHintSession",
            backupAction: needsReconnect ? "reconnect" : folder || browserReady ? "create" : null,
        };
    }
    if (sidecarReadFailures.has(folderId) || partialSidecarFolders.has(folderId) || writeFailureWarned.has(folderId)) {
        return {
            hintKey: browserReady ? "annotations.storageHintReconnect" : "annotations.storageHintSession",
            backupAction: "reconnect",
        };
    }
    const fileReady = await hasFileReadwritePermission(folder.sidecarHandle);
    if (!fileReady) {
        return {
            hintKey: browserReady ? "annotations.storageHintReconnect" : "annotations.storageHintSession",
            backupAction: "reconnect",
        };
    }
    return {
        hintKey: browserReady ? "annotations.storageHintFile" : "annotations.storageHintFileOnly",
        backupAction: null,
    };
}

async function sidecarStatus(folder: RememberedFolder): Promise<"missing" | "connected" | "ready" | "needsAttention"> {
    if (!folder.sidecarHandle) {
        return partialSidecarFolders.has(folder.id) || writeFailureWarned.has(folder.id) ? "needsAttention" : "missing";
    }
    if (
        sidecarReadFailures.has(folder.id) ||
        partialSidecarFolders.has(folder.id) ||
        writeFailureWarned.has(folder.id)
    ) {
        return "needsAttention";
    }
    const permission = await fileReadwritePermissionState(folder.sidecarHandle);
    // A stored handle commonly returns "prompt" after reload. The connection
    // still exists; loading the remembered folder supplies the user gesture
    // that resumes access. Only an explicit denial is a broken connection.
    return permission === "granted" ? "ready" : permission === "prompt" ? "connected" : "needsAttention";
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
    await rebindAnnotationsToFolder(current.id);
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
        const parsed = parseSidecarPayload(await (await found.getFile()).text());
        if (parsed === null) {
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
    const task = getFolder(folderId)
        .then(async (folder): Promise<void> => {
            // No file connected yet: nothing to write, and asking for one is
            // the folder row's job, not this hook's.
            if (!folder?.sidecarHandle) return;
            // Annotation edits happen inside clicks/keys - re-arm the
            // session-scoped readwrite grant while activation is live, or the
            // later gesture-less writes can only skip.
            const writable = await ensureFileReadwritePermission(folder.sidecarHandle);
            if (!writable) {
                notifyWriteFailure(folderId);
                return;
            }
            scheduleWrite(folderId);
        })
        .catch(() => {});
    pendingChangeWrites.add(task);
    void task.finally(() => pendingChangeWrites.delete(task));
}

/**
 * Creates the fixed-name backup inside the recordings folder. getFileHandle
 * never truncates an existing entry: a file appearing between discovery and
 * creation is returned intact and goes through the same validation as an
 * explicitly adopted file.
 */
async function createSidecarFile(folder: RememberedFolder): Promise<void> {
    if (folder.sidecarHandle) return;
    // Permission prompts require transient user activation. Ask before the
    // potentially long root scan / IndexedDB recovery below can consume the
    // click's activation window.
    if (!(await ensureDirectoryReadwritePermission(folder.handle))) {
        notify({ severity: "warn", messageKey: "sidecar.folderWriteDenied" });
        return;
    }
    const current = (await getFolder(folder.id).catch(() => null)) ?? folder;
    if (current.sidecarHandle) return;
    // A portable import can have found this trip only after ingest rebuilt the
    // timeline (for example after a root rename). Re-run ownership recovery at
    // the actual create gesture so those visible notes are included in the new
    // folder backup rather than silently left in browser-only storage.
    await rebindAnnotationsToFolder(current.id);
    // A found file is adopted; ambiguity or an unreadable/foreign file routes
    // to the explicit non-destructive picker.
    const discovery = await autoAdoptSidecar(current);
    if (discovery === "attached") return;
    if (discovery === "blocked") {
        await adoptSidecarFile(current);
        return;
    }
    let handle: FileSystemFileHandle;
    try {
        handle = await current.handle.getFileHandle(SIDECAR_SUGGESTED_NAME, { create: true });
    } catch (err) {
        log.warn("sidecar create failed", { err: err instanceof Error ? err.message : String(err) });
        notify({ severity: "error", messageKey: "sidecar.createFailed" });
        return;
    }
    await attachSidecar(current, handle);
}

async function rebindAnnotationsToFolder(folderId: string): Promise<void> {
    try {
        const existingIds = new Set((await listFolders()).map((folder) => folder.id));
        rebindFolderAnnotations(folderId, existingIds);
    } catch {
        // No DB - session-only mode, nothing to rebind against.
    }
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
    // requestPermission is gesture-gated as well. Do it immediately after the
    // picker returns, before parsing and merge bookkeeping; attachSidecar will
    // verify the resulting grant again before it persists anything writable.
    await ensureFileReadwritePermission(handle);
    await attachSidecar(folder, handle);
}

function isPickerDismissal(err: unknown): boolean {
    // AbortError = dismissed the dialog; the offer stays in the menu.
    return err instanceof DOMException && err.name === "AbortError";
}

/**
 * Validates a picked file and, only if it is fully readable and writable,
 * binds it to the folder. A partial file still contributes every valid record,
 * but is not bound and therefore cannot be overwritten later.
 */
async function attachSidecar(folder: RememberedFolder, handle: FileSystemFileHandle): Promise<boolean> {
    let text: string;
    try {
        text = await (await handle.getFile()).text();
    } catch (err) {
        // Unreadable now means unwritable later - binding it would only produce
        // a folder wired to a file nothing can use.
        log.warn("sidecar read failed at attach", { err: err instanceof Error ? err.message : String(err) });
        notify({ severity: "error", messageKey: "sidecar.writeFailed" });
        return false;
    }
    const parsed = parseSidecarPayload(text);
    if (parsed === null) {
        // Someone else's file: hands off. It keeps its contents and the folder
        // keeps no handle, so nothing here can touch it later either.
        log.warn("picked file is not a dashcamigo notes file, not attaching");
        notify({ severity: "error", messageKey: "sidecar.notOurFile" });
        return false;
    }
    const isAlreadyUsed = await isSidecarUsedByAnotherFolder(folder.id, handle);
    if (isAlreadyUsed === null) {
        notify({ severity: "error", messageKey: "sidecar.handleSaveFailed" });
        return false;
    }
    if (isAlreadyUsed) {
        notify({ severity: "error", messageKey: "sidecar.alreadyConnected" });
        return false;
    }
    const restamped = await folderScopedSidecarRecords(parsed.records, folder.id);
    const changed = applyMergedRecords(mergeAnnotationLists(recordsForFolder(folder.id), restamped));
    if (changed > 0) {
        renderTrips();
        refreshTimelineMarkers();
    }
    if (parsed.rejectedEntries > 0) {
        partialSidecarFolders.add(folder.id);
        refreshFolderSources();
        notify({
            severity: "error",
            messageKey: "sidecar.partialReadOnly",
            messageParams: { n: parsed.rejectedEntries },
        });
        return false;
    }
    if (!(await ensureFileReadwritePermission(handle))) {
        notifyWriteFailure(folder.id);
        return false;
    }
    try {
        await setFolderSidecarHandle(folder.id, handle);
    } catch (err) {
        log.warn("sidecar handle save failed", { err: err instanceof Error ? err.message : String(err) });
        notify({ severity: "error", messageKey: "sidecar.handleSaveFailed" });
        return false;
    }
    // A different file from here on - whatever was read for the previous one
    // says nothing about this one's contents.
    sidecarReadFolders.delete(folder.id);
    sidecarReadFailures.delete(folder.id);
    partialSidecarFolders.delete(folder.id);
    unreadableWarned.delete(folder.id);
    writeFailureWarned.delete(folder.id);
    // The open picker grants read only. Buy the write while the picker's
    // gesture may still count; if activation is already spent this is a no-op
    // and the next annotation edit re-arms it through the same helper.
    const updated = await getFolder(folder.id).catch(() => null);
    let readable = false;
    if (updated?.sidecarHandle) {
        // The explicit write below seeds/converges the file. Scheduling a push
        // here as well would replace it twice when local records are newer.
        readable = await mergeFromSidecar(updated, false).catch((err: unknown) => {
            log.warn("sidecar first merge failed", { err: err instanceof Error ? err.message : String(err) });
            return false;
        });
    }
    const enabled = readable && (await withSidecarWriteLock(folder.id, () => writeSidecar(folder.id)));
    if (enabled) {
        refreshFolderSources();
        notify({ severity: "info", messageKey: "sidecar.enabled", messageParams: { file: handle.name } });
    } else notifyWriteFailure(folder.id);
    return enabled;
}

async function isSidecarUsedByAnotherFolder(folderId: string, handle: FileSystemFileHandle): Promise<boolean | null> {
    let folders: RememberedFolder[];
    try {
        folders = await listFolders();
    } catch (err) {
        log.warn("sidecar ownership check failed", { err: err instanceof Error ? err.message : String(err) });
        return null;
    }
    for (const other of folders) {
        if (other.id === folderId || !other.sidecarHandle) continue;
        try {
            if (await handle.isSameEntry(other.sidecarHandle)) return true;
        } catch (err) {
            // Failing open would permit one physical file to back two logical
            // folders and cross-pollinate their notes on the next write.
            log.warn("sidecar identity check failed", { err: err instanceof Error ? err.message : String(err) });
            return null;
        }
    }
    return false;
}

async function folderScopedSidecarRecords(
    records: readonly AnnotationRecord[],
    folderId: string,
): Promise<AnnotationRecord[]> {
    await waitForAnnotationsReady();
    const liveFolderIds = await listFolders()
        .then((folders) => new Set(folders.map((folder) => folder.id)))
        .catch(() => undefined);
    return scopeAnnotationRecordsToFolder(records, folderId, liveFolderIds);
}

function scheduleWrite(folderId: string, delayMs: number = WRITE_DEBOUNCE_MS): void {
    const pending = writeTimers.get(folderId);
    if (pending !== undefined) clearTimeout(pending);
    writeTimers.set(
        folderId,
        window.setTimeout(() => {
            writeTimers.delete(folderId);
            void enqueueWrite(folderId);
        }, delayMs),
    );
}

function flushScheduledWrites(): void {
    for (const [folderId, timer] of [...writeTimers]) {
        clearTimeout(timer);
        writeTimers.delete(folderId);
        void enqueueWrite(folderId);
    }
}

function enqueueWrite(folderId: string): Promise<void> {
    const previous = writeQueues.get(folderId) ?? Promise.resolve();
    const queued = previous
        .catch(() => {})
        .then(() => withSidecarWriteLock(folderId, async () => void (await writeSidecar(folderId))))
        .catch((err: unknown) => {
            log.warn("sidecar queued write failed", { err: err instanceof Error ? err.message : String(err) });
        });
    writeQueues.set(folderId, queued);
    void queued.finally(() => {
        if (writeQueues.get(folderId) === queued) writeQueues.delete(folderId);
    });
    return queued;
}

/** Waits until every write already requested in this tab has settled. Used
 * before destructive local reset and as a best-effort page-hide flush. */
export async function flushPendingSidecarWrites(): Promise<void> {
    while (pendingChangeWrites.size > 0 || writeTimers.size > 0 || writeQueues.size > 0) {
        if (pendingChangeWrites.size > 0) await Promise.allSettled([...pendingChangeWrites]);
        flushScheduledWrites();
        if (writeQueues.size > 0) await Promise.allSettled([...writeQueues.values()]);
    }
}

async function withSidecarWriteLock<T>(folderId: string, write: () => Promise<T>): Promise<T> {
    if (typeof navigator !== "undefined" && navigator.locks) {
        return navigator.locks.request(`dashcamigo:annotations-sidecar:${folderId}`, write);
    }
    return write();
}

async function writeSidecar(folderId: string): Promise<boolean> {
    const folder = await getFolder(folderId).catch(() => null);
    if (!folder?.sidecarHandle) return false;
    const handle = folder.sidecarHandle;
    // Queued writes may outlive the edit gesture, so only a still-granted
    // permission works. Recovery paths:
    // ensureFileReadwritePermission re-arms the grant inside the next
    // annotation edit's gesture, and the chip-open flow re-arms it too.
    if (!(await hasFileReadwritePermission(handle))) {
        log.info("sidecar write skipped, permission not granted", { folder: folder.label });
        notifyWriteFailure(folderId);
        return false;
    }
    let writable: FileSystemWritableFileStream | null = null;
    try {
        // Acquire the file lock BEFORE the merge read. Otherwise two origins or
        // browser profiles can both read the old snapshot, then take turns
        // replacing it and let the second one erase the first one's edit.
        writable = await handle.createWritable({ mode: "exclusive" });
        const readable = await mergeFromSidecar(folder, false);
        if (!readable) {
            await writable.abort().catch(() => {});
            writable = null;
            if (!unreadableWarned.has(folderId)) {
                unreadableWarned.add(folderId);
                log.warn("sidecar write skipped, file unreadable", { folder: folder.label });
                notifyWriteFailure(folderId);
            }
            return false;
        }
        const records = recordsForFolder(folderId);
        const payload = buildSidecarPayload(records, Date.now());
        await writable.write(JSON.stringify(payload));
        await writable.close();
        writable = null;
        const verifiedText = await (await handle.getFile()).text();
        // An empty file is accepted at attach time as a safe creation target,
        // but it cannot verify a completed JSON replacement (especially when
        // this folder currently has zero records to check one-by-one).
        const verified = verifiedText.trim() ? parseSidecarPayload(verifiedText) : null;
        const verifiedById = new Map(verified?.records.map((record) => [record.id, record]) ?? []);
        if (
            !verified ||
            verified.rejectedEntries > 0 ||
            records.some((record) => {
                const saved = verifiedById.get(record.id);
                return !saved || compareAnnotationVersions(saved, record) < 0;
            })
        ) {
            throw new Error("backup verification failed");
        }
        const recovered = writeFailureWarned.delete(folderId);
        if (recovered) refreshFolderSources();
        log.info("sidecar written", { folder: folder.label, records: records.length });
        return true;
    } catch (err) {
        await writable?.abort().catch(() => {});
        log.warn("sidecar write failed", { err: err instanceof Error ? err.message : String(err) });
        notifyWriteFailure(folderId);
        return false;
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
        const changed = sidecarReadFolders.delete(folder.id) || !sidecarReadFailures.has(folder.id);
        sidecarReadFailures.add(folder.id);
        if (changed) refreshFolderSources();
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
        sidecarReadFailures.add(folder.id);
        if (!unreadableWarned.has(folder.id)) {
            unreadableWarned.add(folder.id);
            refreshFolderSources();
            notify({ severity: "warn", messageKey: "sidecar.notOurFile" });
        }
        return false;
    }
    if (parsed.rejectedEntries > 0) {
        const sidecarRecords = await folderScopedSidecarRecords(parsed.records, folder.id);
        const changedLocally = applyMergedRecords(mergeAnnotationLists(recordsForFolder(folder.id), sidecarRecords));
        if (changedLocally > 0) {
            renderTrips();
            refreshTimelineMarkers();
        }
        sidecarReadFolders.delete(folder.id);
        sidecarReadFailures.delete(folder.id);
        partialSidecarFolders.add(folder.id);
        refreshFolderSources();
        if (!unreadableWarned.has(folder.id)) {
            unreadableWarned.add(folder.id);
            notify({
                severity: "error",
                messageKey: "sidecar.partialReadOnly",
                messageParams: { n: parsed.rejectedEntries },
            });
        }
        return false;
    }
    // The file's contents are known from here on.
    sidecarReadFolders.add(folder.id);
    const recoveredFromReadFailure = sidecarReadFailures.delete(folder.id);
    const recoveredFromPartial = partialSidecarFolders.delete(folder.id);
    if (recoveredFromReadFailure || recoveredFromPartial) refreshFolderSources();
    unreadableWarned.delete(folder.id);
    // Restamp: records arriving through THIS folder's sidecar belong to this
    // folder locally, whatever per-profile UUID the writing side used.
    const sidecarRecords = await folderScopedSidecarRecords(parsed.records, folder.id);
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
    else if (!needsPush && writeFailureWarned.delete(folder.id)) refreshFolderSources();
    return true;
}

async function hasFileReadwritePermission(handle: FileSystemFileHandle): Promise<boolean> {
    return (await fileReadwritePermissionState(handle)) === "granted";
}

async function fileReadwritePermissionState(handle: FileSystemFileHandle): Promise<PermissionState> {
    if (typeof handle.queryPermission !== "function") return "granted";
    try {
        return await handle.queryPermission({ mode: "readwrite" });
    } catch {
        return "denied";
    }
}

function notifyWriteFailure(folderId: string): void {
    if (writeFailureWarned.has(folderId)) return;
    writeFailureWarned.add(folderId);
    refreshFolderSources();
    notify({
        severity: "error",
        messageKey: "sidecar.writeFailed",
        actionKey: "sidecar.reconnect",
        onAction: () => {
            void getFolder(folderId).then((folder) => {
                if (folder) void adoptSidecarFile(folder);
            });
        },
    });
}

/** Clears session-only coordination state between unit tests. */
export function _resetForTests(): void {
    for (const timer of writeTimers.values()) clearTimeout(timer);
    writeTimers.clear();
    writeQueues.clear();
    pendingChangeWrites.clear();
    folderOpenTasks.clear();
    sidecarReadFolders.clear();
    sidecarReadFailures.clear();
    partialSidecarFolders.clear();
    unreadableWarned.clear();
    writeFailureWarned.clear();
}
