// Persistent-folder UX (Chromium-only, capability "persistentFolder"):
//  - the FSA directory picker the landing CTA routes through,
//  - the "remember this folder" offer after a picked ingest,
//  - the recent-folder chips on the landing: one-click reopen, a status dot
//    per chip (a background liveness probe colors it), forget one / forget
//    all. Nothing opens without a click - a remembered folder is an offer,
//    not an autostart. Unavailable chips grey out but stay: a renamed-back or
//    re-plugged folder revives its stored handle.
//
// IndexedDB unavailability (private mode, storage off) quietly degrades the
// whole module to "picker without memory" - never a user-facing error.

import { detectCapabilities } from "../capabilities.js";
import { createLogger } from "../log.js";
import {
    enumerateFolder,
    type FolderAvailability,
    forgetAllFolders,
    forgetFolder,
    listFolders,
    markFolderOpened,
    probeFolderAvailability,
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

const log = createLogger("persistent-folders");

// Latest known liveness per folder, fed by the render-time probe and by
// actual open attempts. Session-only - reality is re-probed on every render.
const availabilityById = new Map<string, FolderAvailability>();

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
 * Wires the landing chips. Call once from app.ts after notifications/overlay
 * init. No-op on browsers without the API.
 */
export function initPersistentFolders(): void {
    if (!canUseDirectoryPicker()) return;
    chipsContainer = document.getElementById("recent-folders");
    chipsList = document.getElementById("recent-folders-list");
    void refreshChips();
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
            availabilityById.set(folder.id, "unavailable");
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
        availabilityById.set(folder.id, "available");
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

/** Re-renders the landing chips from the DB and kicks off a background
 *  liveness probe per folder - the status dots recolor as answers arrive.
 *  Hides the block when nothing is remembered. */
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
    const chipById = new Map<string, HTMLElement>();
    for (const folder of folders) {
        const chip = buildChip(folder);
        chipById.set(folder.id, chip);
        chipsList.appendChild(chip);
    }
    if (folders.length > 1) chipsList.appendChild(buildForgetAllButton());
    for (const folder of folders) {
        void probeFolderAvailability(folder.handle).then((availability) => {
            availabilityById.set(folder.id, availability);
            const chip = chipById.get(folder.id);
            // A refresh may have re-rendered meanwhile - never touch a
            // detached chip, the new render probes again anyway.
            if (chip?.isConnected) applyAvailability(chip, availability);
        });
    }
}

function buildChip(folder: RememberedFolder): HTMLElement {
    const wrap = document.createElement("span");
    wrap.className = "recent-folder-chip";

    const open = document.createElement("button");
    open.type = "button";
    open.className = "recent-folder-chip__open";

    const status = document.createElement("span");
    status.className = "recent-folder-chip__status";
    status.setAttribute("aria-hidden", "true");
    open.appendChild(status);
    open.appendChild(document.createTextNode(folder.label));
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

    const known = availabilityById.get(folder.id);
    if (known) applyAvailability(wrap, known);
    return wrap;
}

/** Colors a chip by liveness: green = readable right now, red+greyed = gone
 *  (moved/unplugged; still clickable - a re-plug revives the handle), amber =
 *  permission lapsed, a click re-prompts. */
function applyAvailability(chip: HTMLElement, availability: FolderAvailability): void {
    chip.classList.toggle("is-available", availability === "available");
    chip.classList.toggle("is-unavailable", availability === "unavailable");
    chip.classList.toggle("is-unknown", availability === "unknown");
    if (availability === "unavailable") chip.title = t("recentFolders.unavailableHint");
    else if (availability === "unknown") chip.title = t("recentFolders.permissionHint");
    else chip.removeAttribute("title");
}

function buildForgetAllButton(): HTMLElement {
    const forgetAll = document.createElement("button");
    forgetAll.type = "button";
    forgetAll.className = "recent-folders-forget-all";
    forgetAll.textContent = t("recentFolders.forgetAll");
    forgetAll.addEventListener("click", () => {
        forgetAllFolders()
            .then(() => refreshChips())
            .catch(() => {});
    });
    return forgetAll;
}
