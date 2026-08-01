// Persistent-folder UX (Chromium-only, capability "persistentFolder"):
//  - the FSA directory picker the landing CTA routes through,
//  - the "remember this folder" offer after a picked ingest,
//  - the recent-folder chips on the landing (unavailable ones grey out but
//    stay - a renamed-back or re-plugged folder revives its stored handle),
//  - zero-click auto-restore of the last-used folder when permission held.
//
// IndexedDB unavailability (private mode, storage off) quietly degrades the
// whole module to "picker without memory" - never a user-facing error.

import { detectCapabilities } from "../capabilities.js";
import { createLogger } from "../log.js";
import {
    enumerateFolder,
    forgetFolder,
    getLastFolder,
    listFolders,
    markFolderOpened,
    queryFolderPermission,
    rememberFolder,
    requestFolderPermission,
} from "../persist/folders.js";
import type { RememberedFolder } from "../persist/types.js";
import { t } from "../i18n/index.js";

import { dom } from "./dom.js";
import { beginPreIngestReading, endPreIngestReading } from "./ingest-overlay.js";
import { ingestFiles } from "./ingest.js";
import { notify } from "./notifications.js";
import { state } from "./state.js";

const log = createLogger("persistent-folders");

// Folders whose last open failed on read (moved/unplugged). Session-only:
// a retry click re-checks reality, and next pageload starts clean.
const unavailableIds = new Set<string>();

// Root path segment (the folder's on-disk name) -> RememberedFolder.id, for
// folders touched this session. Annotations resolve their folderId through
// this: a candidate only knows its relativePath, whose first segment is the
// root folder name on every picker path.
const folderIdByRootLabel = new Map<string, string>();

/** RememberedFolder.id owning the given root path segment, or "" when the
 *  root is not a remembered folder (ad-hoc drop / never remembered). */
export function folderIdForRootSegment(root: string): string {
    return folderIdByRootLabel.get(root) ?? "";
}

// The sidecar layer merges its file after a remembered folder opens. A
// registered hook, not an import - the sidecar module reads annotations,
// which import this module for folder-id resolution.
let folderOpenedHook: ((folder: RememberedFolder) => void) | null = null;

/** Registers the after-open hook for remembered folders. */
export function registerFolderOpenedHook(callback: (folder: RememberedFolder) => void): void {
    folderOpenedHook = callback;
}

let chipsContainer: HTMLElement | null = null;
let chipsList: HTMLElement | null = null;
let pickerInFlight = false;

/** Whether the FSA picker path should be used instead of <input webkitdirectory>. */
export function canUseDirectoryPicker(): boolean {
    const report = detectCapabilities();
    return report.capabilities.some((c) => c.id === "persistentFolder" && c.ok);
}

/**
 * Wires the landing chips and kicks off auto-restore. Call once from app.ts
 * after notifications/overlay init. No-op on browsers without the API.
 */
export function initPersistentFolders(): void {
    if (!canUseDirectoryPicker()) return;
    chipsContainer = document.getElementById("recent-folders");
    chipsList = document.getElementById("recent-folders-list");
    void refreshChips();
    void maybeAutoRestore();
}

/**
 * Opens the FSA directory picker, ingests the choice and - for a folder not
 * yet remembered - offers to remember it. The pre-ingest overlay goes up
 * before the picker for the same reason as the classic path: enumeration of a
 * big card takes seconds and the page must not look dead meanwhile.
 */
export async function openViaDirectoryPicker(): Promise<void> {
    if (pickerInFlight) return;
    if (typeof window.showDirectoryPicker !== "function") return;
    pickerInFlight = true;
    try {
        beginPreIngestReading();
        let handle: FileSystemDirectoryHandle;
        try {
            handle = await window.showDirectoryPicker({ id: "recordings", mode: "read" });
        } catch (err) {
            endPreIngestReading();
            // AbortError = the user dismissed the picker; silent, mirrors the
            // input "cancel" event on the classic path.
            if (err instanceof DOMException && err.name === "AbortError") return;
            // Anything else (enterprise policy, embedding restrictions) - fall
            // back to the classic input so the click still opens something.
            log.warn("showDirectoryPicker failed, falling back to input", {
                err: err instanceof Error ? err.message : String(err),
            });
            beginPreIngestReading();
            dom.folderInput.click();
            return;
        }
        await openFolderHandle(handle, null);
        void offerToRemember(handle);
    } finally {
        pickerInFlight = false;
    }
}

/**
 * Enumerates a handle and feeds the result to ingest. `folder` is non-null
 * when opening a REMEMBERED folder - failures then grey its chip. Assumes
 * read permission is already granted and the pre-ingest overlay is up.
 */
async function openFolderHandle(handle: FileSystemDirectoryHandle, folder: RememberedFolder | null): Promise<void> {
    let files: Awaited<ReturnType<typeof enumerateFolder>>;
    try {
        files = await enumerateFolder(handle);
    } catch (err) {
        endPreIngestReading();
        if (folder) {
            unavailableIds.add(folder.id);
            void refreshChips();
        }
        log.warn("folder enumeration failed", {
            label: handle.name,
            err: err instanceof Error ? err.message : String(err),
        });
        notify({
            severity: "warn",
            messageKey: "recentFolders.openFailed",
            messageParams: { name: handle.name },
        });
        return;
    }
    if (folder) {
        unavailableIds.delete(folder.id);
        folderIdByRootLabel.set(handle.name, folder.id);
        markFolderOpened(folder.id).catch(() => {});
        void refreshChips();
        folderOpenedHook?.(folder);
    }
    if (files.readErrors > 0) {
        notify({ severity: "warn", messageKey: "status.dropReadFailed" });
    }
    if (files.files.length === 0) {
        // ingestFiles([]) shows its own "no files" toast but does not retract
        // the pre-ingest overlay - same contract as the classic paths.
        endPreIngestReading();
    }
    await ingestFiles(files.files);
}

/** Click path for a chip: re-verify permission (prompting inside the user
 *  gesture when it lapsed), then open. */
async function openRememberedFolder(folder: RememberedFolder): Promise<void> {
    const permission = await queryFolderPermission(folder.handle);
    if (permission !== "granted") {
        const granted = await requestFolderPermission(folder.handle);
        if (!granted) {
            notify({
                severity: "warn",
                messageKey: "recentFolders.permissionDenied",
                messageParams: { name: folder.label },
            });
            return;
        }
    }
    beginPreIngestReading();
    await openFolderHandle(folder.handle, folder);
}

/**
 * Zero-click restore: most recently used folder, only when permission
 * survived the restart ("Allow on every visit" / installed PWA). A lapsed
 * permission needs a gesture for requestPermission, so those folders wait as
 * chips instead. Never fires over an existing session.
 */
async function maybeAutoRestore(): Promise<void> {
    if (state.trips.length > 0 || state.ingestInProgress) return;
    let last: RememberedFolder | null = null;
    try {
        last = await getLastFolder();
    } catch (err) {
        log.warn("persist db unavailable, skipping restore", { err: err instanceof Error ? err.message : String(err) });
        return;
    }
    if (!last) return;
    if ((await queryFolderPermission(last.handle)) !== "granted") return;
    // Re-check: the user may have started a drop while we awaited the DB.
    if (state.trips.length > 0 || state.ingestInProgress) return;
    log.info("auto-restoring last folder", { label: last.label });
    beginPreIngestReading();
    await openFolderHandle(last.handle, last);
}

/** Offers to remember a picker-chosen folder unless it already is. */
async function offerToRemember(handle: FileSystemDirectoryHandle): Promise<void> {
    try {
        const folders = await listFolders();
        for (const folder of folders) {
            try {
                if (await handle.isSameEntry(folder.handle)) {
                    await markFolderOpened(folder.id);
                    void refreshChips();
                    return;
                }
            } catch {
                // Dead stored handle - not the same folder.
            }
        }
    } catch (err) {
        // No DB - nothing to remember into; stay silent (feature degrades).
        log.warn("persist db unavailable, remember offer skipped", {
            err: err instanceof Error ? err.message : String(err),
        });
        return;
    }
    notify({
        severity: "info",
        messageKey: "recentFolders.rememberPrompt",
        messageParams: { name: handle.name },
        action: {
            labelKey: "recentFolders.rememberAction",
            onAction: () => {
                rememberFolder(handle)
                    .then((record) => {
                        folderIdByRootLabel.set(handle.name, record.id);
                        void refreshChips();
                        notify({
                            severity: "info",
                            messageKey: "recentFolders.remembered",
                            messageParams: { name: handle.name },
                        });
                    })
                    .catch((err: unknown) => {
                        log.warn("rememberFolder failed", { err: err instanceof Error ? err.message : String(err) });
                    });
            },
        },
    });
}

/** Re-renders the landing chips from the DB. Hides the block when empty. */
async function refreshChips(): Promise<void> {
    if (!chipsContainer || !chipsList) return;
    let folders: RememberedFolder[];
    try {
        folders = await listFolders();
    } catch {
        chipsContainer.hidden = true;
        return;
    }
    chipsContainer.hidden = folders.length === 0;
    chipsList.replaceChildren();
    for (const folder of folders) {
        chipsList.appendChild(buildChip(folder));
    }
}

function buildChip(folder: RememberedFolder): HTMLElement {
    const wrap = document.createElement("span");
    wrap.className = "recent-folder-chip";
    if (unavailableIds.has(folder.id)) {
        wrap.classList.add("is-unavailable");
        wrap.title = t("recentFolders.unavailableHint");
    }

    const open = document.createElement("button");
    open.type = "button";
    open.className = "recent-folder-chip__open";
    open.textContent = folder.label;
    open.addEventListener("click", () => void openRememberedFolder(folder));
    wrap.appendChild(open);

    const forget = document.createElement("button");
    forget.type = "button";
    forget.className = "recent-folder-chip__forget";
    forget.setAttribute("aria-label", t("recentFolders.forgetLabel"));
    forget.title = t("recentFolders.forgetLabel");
    forget.textContent = "×";
    forget.addEventListener("click", () => {
        forgetFolder(folder.id)
            .then(() => refreshChips())
            .catch(() => {});
    });
    wrap.appendChild(forget);

    return wrap;
}
