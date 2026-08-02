// Annotations sidecar: a dashcamigo-notes.json living in the user's own
// folder (Chromium-only - needs showSaveFilePicker), so notes survive browser
// data cleanup and travel with the recordings. IndexedDB stays the working
// copy; the sidecar is an auto-synced replica merged per record (LWW +
// tombstones) whenever the folder opens.
//
// Flow: the folder row in the sidebar (ui/folder-sources.ts) offers to
// connect a file for a remembered folder; that click opens a save picker
// defaulting INTO the folder (startIn), the picked file handle persists on
// the folder record, and the file is MERGED before anything is written - the
// user may have picked a pre-existing notes file from another machine. After
// that every annotation change schedules a debounced atomic write
// (createWritable = write-to-swap, rename-on-close - a crash never tears the
// file).
//
// folderId in the file is never trusted: it is a per-profile UUID, so every
// record read from a folder's sidecar is restamped with the LOCAL folder id
// (see mergeFromSidecar). Without that, records written by another machine
// would be excluded from this machine's writes and the two profiles would
// endlessly erase each other's notes from the file.

import { createLogger } from "../log.js";
import { annotationContentEqual, mergeAnnotationLists, parseSidecarPayload } from "../persist/annotations.js";
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

const SIDECAR_SUGGESTED_NAME = "dashcamigo-notes.json";
const WRITE_DEBOUNCE_MS = 1500;

const writeTimers = new Map<string, number>();

export function initAnnotationsSidecar(): void {
    registerAnnotationsChangedHook(onAnnotationsChanged);
    registerFolderOpenedHook(onFolderOpened);
    // Connecting the file is an offer the user takes when they want it, from
    // the folder row in the sidebar - never a toast interrupting the note they
    // are in the middle of writing. Registered only where a save picker
    // exists, so the row hides the entry everywhere else.
    if (typeof window.showSaveFilePicker === "function") {
        registerNotesConnector((folder) => void pickSidecarFile(folder));
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

async function pickSidecarFile(folder: RememberedFolder): Promise<void> {
    if (typeof window.showSaveFilePicker !== "function") return;
    let handle: FileSystemFileHandle;
    try {
        handle = await window.showSaveFilePicker({
            id: "annotations-sidecar",
            suggestedName: SIDECAR_SUGGESTED_NAME,
            // Defaults the dialog INTO the recordings folder - the user just
            // confirms; picking elsewhere is allowed and works the same.
            startIn: folder.handle,
            types: [{ description: "dashcamigo notes", accept: { "application/json": [".json"] } }],
        });
    } catch (err) {
        // AbortError = dismissed the dialog; the offer returns next session.
        if (!(err instanceof DOMException && err.name === "AbortError")) {
            log.warn("sidecar picker failed", { err: err instanceof Error ? err.message : String(err) });
        }
        return;
    }
    try {
        await setFolderSidecarHandle(folder.id, handle);
    } catch (err) {
        log.warn("sidecar handle save failed", { err: err instanceof Error ? err.message : String(err) });
        return;
    }
    notify({ severity: "info", messageKey: "sidecar.enabled" });
    // NEVER blind-write here: showSaveFilePicker happily returns an existing
    // file (a notes file from another machine travelling with the SD card),
    // and the first write is a full overwrite. Merging handles both cases -
    // an existing file contributes its records, an empty one triggers the
    // converging write that seeds it.
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
    const payload = {
        app: "dashcamigo",
        format: "annotations",
        version: 1,
        savedAt: Date.now(),
        annotations: recordsForFolder(folderId),
    };
    try {
        const writable = await handle.createWritable();
        await writable.write(JSON.stringify(payload));
        await writable.close();
        log.info("sidecar written", { folder: folder.label, records: payload.annotations.length });
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
        log.warn("sidecar read failed", { err: err instanceof Error ? err.message : String(err) });
        return;
    }
    const parsed = parseSidecarPayload(text);
    if (parsed === null) {
        log.warn("sidecar file is not a dashcamigo annotations file, ignoring");
        return;
    }
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
