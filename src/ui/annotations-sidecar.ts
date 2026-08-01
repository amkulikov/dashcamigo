// Annotations sidecar: a dashcamigo-notes.json living in the user's own
// folder (Chromium-only - needs showSaveFilePicker), so notes survive browser
// data cleanup and travel with the recordings. IndexedDB stays the working
// copy; the sidecar is an auto-synced replica merged per record (LWW +
// tombstones) whenever the folder opens.
//
// Flow: the first annotation in a remembered folder without a sidecar raises
// a one-time offer toast; accepting opens a save picker defaulting INTO the
// folder (startIn), and the picked file handle persists on the folder record.
// After that every annotation change schedules a debounced atomic write
// (createWritable = write-to-swap, rename-on-close - a crash never tears the
// file). On folder open the sidecar is read back and merged both ways.

import { createLogger } from "../log.js";
import { mergeAnnotationLists } from "../persist/annotations.js";
import { getFolder, setFolderSidecarHandle } from "../persist/folders.js";
import type { AnnotationRecord, RememberedFolder } from "../persist/types.js";
import { applyMergedRecords, recordsForFolder, registerAnnotationsChangedHook } from "./annotations.js";
import { notify } from "./notifications.js";
import { registerFolderOpenedHook } from "./persistent-folders.js";
import { renderTrips } from "./sidebar.js";
import { refreshTimelineMarkers } from "./timeline-markers.js";

const log = createLogger("annotations-sidecar");

const SIDECAR_SUGGESTED_NAME = "dashcamigo-notes.json";
const WRITE_DEBOUNCE_MS = 1500;

// One offer per folder per session - a declined toast must not re-pop on
// every keystroke in the note field.
const offeredFolderIds = new Set<string>();
const writeTimers = new Map<string, number>();

export function initAnnotationsSidecar(): void {
    registerAnnotationsChangedHook(onAnnotationsChanged);
    registerFolderOpenedHook((folder) => void mergeFromSidecar(folder));
}

function onAnnotationsChanged(folderId: string): void {
    // "" = the annotated trip's root folder is not remembered - nowhere to
    // put a sidecar. The record still lives in IndexedDB.
    if (!folderId) return;
    void getFolder(folderId)
        .then((folder) => {
            if (!folder) return;
            if (folder.sidecarHandle) {
                scheduleWrite(folderId);
                return;
            }
            if (typeof window.showSaveFilePicker !== "function") return;
            if (offeredFolderIds.has(folderId)) return;
            offeredFolderIds.add(folderId);
            notify({
                severity: "info",
                messageKey: "sidecar.offer",
                messageParams: { name: folder.label },
                action: {
                    labelKey: "sidecar.offerAction",
                    // The toast click is the user gesture the save picker needs.
                    onAction: () => void pickSidecarFile(folder),
                },
            });
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
    // First write immediately - the file the picker just created is empty.
    scheduleWrite(folder.id, 0);
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

async function writeSidecar(folderId: string): Promise<void> {
    const folder = await getFolder(folderId).catch(() => null);
    if (!folder?.sidecarHandle) return;
    const handle = folder.sidecarHandle;
    // Writes fire from a debounce timer - no user gesture, so only a still-
    // granted permission works; a lapsed one skips quietly and the next
    // folder-open merge (inside a gesture-adjacent flow) catches up.
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
 * UI; newer local entries trigger a sidecar rewrite. An unreadable or
 * malformed file is an expected local failure - logged, never surfaced as an
 * error (the IndexedDB copy still stands).
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
    const sidecarRecords = parseSidecar(text);
    if (sidecarRecords === null) {
        log.warn("sidecar file is not a dashcamigo annotations file, ignoring");
        return;
    }
    const local = recordsForFolder(folder.id);
    const merged = mergeAnnotationLists(local, sidecarRecords);
    const changedLocally = applyMergedRecords(merged);
    if (changedLocally > 0) {
        log.info("sidecar merged in", { records: changedLocally });
        renderTrips();
        refreshTimelineMarkers();
    }
    // The local side had records the file lacks (or newer versions) - push
    // the merged state back so the file converges too.
    if (merged.length !== sidecarRecords.length || changedLocally === 0) {
        scheduleWrite(folder.id);
    }
}

/** Parses sidecar JSON into records, or null when the file is not ours.
 *  Individual malformed entries are skipped, not fatal. */
function parseSidecar(text: string): AnnotationRecord[] | null {
    if (text.trim() === "") return [];
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        return null;
    }
    if (typeof parsed !== "object" || parsed === null) return null;
    const obj = parsed as Record<string, unknown>;
    if (obj.format !== "annotations" || !Array.isArray(obj.annotations)) return null;
    const out: AnnotationRecord[] = [];
    for (const entry of obj.annotations) {
        if (typeof entry !== "object" || entry === null) continue;
        const record = entry as Record<string, unknown>;
        const hasBase =
            typeof record.id === "string" &&
            typeof record.updatedAt === "number" &&
            typeof record.deleted === "boolean" &&
            (record.kind === "tripMeta" || record.kind === "marker");
        if (!hasBase) continue;
        out.push(entry as AnnotationRecord);
    }
    return out;
}
