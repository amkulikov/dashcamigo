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
    ensureFileReadwritePermission,
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
import { fileIdentityKey, fileIdentityOf } from "../persist/identity.js";
import type { RememberedFolder } from "../persist/types.js";
import type { VendorFile } from "../parsers/types.js";
import { t } from "../i18n/index.js";

import { dom } from "./dom.js";
import { beginPreIngestReading, endPreIngestReading } from "./ingest-overlay.js";
import { ingestFiles } from "./ingest.js";
import { notify } from "./notifications.js";

const log = createLogger("persistent-folders");

// Latest known liveness per folder, fed by the render-time probe and by
// actual open attempts. Session-only - reality is re-probed on every render.
const availabilityById = new Map<string, FolderAvailability>();

// File identity key -> RememberedFolder.id, for every file enumerated out of
// a remembered folder this session. Annotations resolve their folderId
// through this. Far tighter than keying on the root folder NAME (which
// collides the moment two SD cards share one on-disk name), though not
// absolute: a byte-for-byte backup of a folder under the same leaf name
// yields identical keys (size and mtime survive copying), and the handle
// exposes no path to tell the two apart - last opened wins there.
const folderIdByFileKey = new Map<string, string>();

/** RememberedFolder.id that produced the file with this identity key, or ""
 *  when the file did not come out of a remembered folder (ad-hoc drop /
 *  never remembered). */
export function folderIdForFileKey(identityKey: string): string {
    return folderIdByFileKey.get(identityKey) ?? "";
}

function registerFolderFiles(folderId: string, files: VendorFile[]): void {
    for (const vendorFile of files) {
        folderIdByFileKey.set(fileIdentityKey(fileIdentityOf(vendorFile.file, vendorFile.relativePath)), folderId);
    }
}

/** Drops a forgotten folder's session state - a later annotation must not
 *  resolve to the dead id (it would be invisible to every sidecar path). */
function purgeFolderSessionState(folderId: string): void {
    for (const [key, id] of folderIdByFileKey) {
        if (id === folderId) folderIdByFileKey.delete(key);
    }
    availabilityById.delete(folderId);
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
            // No overlay here: if the failed picker call consumed the user
            // activation, this programmatic click is silently blocked and an
            // overlay would sit over a dead page with nothing to retract it.
            log.warn("showDirectoryPicker failed, falling back to input", {
                err: err instanceof Error ? err.message : String(err),
            });
            dom.folderInput.click();
            return;
        }
        const enumerated = await openFolderHandle(handle, null);
        if (enumerated) void offerToRemember(handle, enumerated);
    } finally {
        pickerInFlight = false;
    }
}

/**
 * Enumerates a handle and feeds the result to ingest. `folder` is non-null
 * when opening a REMEMBERED folder - failures then grey its chip. Assumes
 * read permission is already granted and the pre-ingest overlay is up.
 * Returns the enumerated files (the caller may bind them to a folder record
 * later), or null when the folder could not be read.
 */
async function openFolderHandle(
    handle: FileSystemDirectoryHandle,
    folder: RememberedFolder | null,
): Promise<VendorFile[] | null> {
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
        return null;
    }
    if (folder) {
        availabilityById.set(folder.id, "available");
        registerFolderFiles(folder.id, files.files);
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
    return files.files;
}

// Chip-open guard, mirroring pickerInFlight: a double-click must not start
// two multi-second folder walks and two sidecar merges in parallel.
let chipOpenInFlight = false;

/** Click path for a chip: re-verify permission (prompting inside the user
 *  gesture when it lapsed), then open. */
async function openRememberedFolder(folder: RememberedFolder): Promise<void> {
    if (chipOpenInFlight || pickerInFlight) return;
    chipOpenInFlight = true;
    try {
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
        // Same click, second grant: the sidecar's readwrite permission is
        // session-scoped and the debounced writes cannot prompt on their own.
        if (folder.sidecarHandle) await ensureFileReadwritePermission(folder.sidecarHandle);
        beginPreIngestReading();
        await openFolderHandle(folder.handle, folder);
    } finally {
        chipOpenInFlight = false;
    }
}

/** Offers to remember a picker-chosen folder unless it already is. `files` is
 *  the enumeration the open just produced - bound to the folder record so the
 *  session's annotations resolve their folderId. */
async function offerToRemember(handle: FileSystemDirectoryHandle, files: VendorFile[]): Promise<void> {
    try {
        const folders = await listFolders();
        for (const folder of folders) {
            try {
                if (await handle.isSameEntry(folder.handle)) {
                    // Already remembered, picked fresh via the picker - behaves
                    // like a chip open: bind files, stamp, merge the sidecar.
                    registerFolderFiles(folder.id, files);
                    availabilityById.set(folder.id, "available");
                    await markFolderOpened(folder.id);
                    void refreshChips();
                    folderOpenedHook?.(folder);
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
                        registerFolderFiles(record.id, files);
                        availabilityById.set(record.id, "available");
                        void refreshChips();
                        // The hook adopts annotations made before this click
                        // (they carry folderId "") into the fresh record; the
                        // sidecar merge inside is a no-op (no handle yet).
                        folderOpenedHook?.(record);
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
    const labels = disambiguatedLabels(folders);
    const chipById = new Map<string, HTMLElement>();
    for (const folder of folders) {
        const chip = buildChip(folder, labels.get(folder.id) ?? folder.label);
        chipById.set(folder.id, chip);
        chipsList.appendChild(chip);
    }
    syncForgetAllButton(folders.length > 1);
    const renderToken = ++chipsRenderToken;
    for (const folder of folders) {
        void probeFolderAvailability(folder.handle).then((availability) => {
            // A newer render has its own probes in flight - a slow answer
            // from this one must not overwrite their fresher result (the map
            // seeds the next render's initial chip state).
            if (renderToken !== chipsRenderToken) return;
            availabilityById.set(folder.id, availability);
            const chip = chipById.get(folder.id);
            if (chip?.isConnected) applyAvailability(chip, availability);
        });
    }
}

// Monotonic render stamp for the probe staleness check above.
let chipsRenderToken = 0;

/**
 * Display labels, with duplicates suffixed " (2)", " (3)"... in addedAt order
 * (stable across re-renders, unlike the lastOpenedAt chip order). The handle
 * exposes only the folder's leaf name - two SD cards named "DCIM" are
 * otherwise indistinguishable in the list.
 */
function disambiguatedLabels(folders: RememberedFolder[]): Map<string, string> {
    const byLabel = new Map<string, RememberedFolder[]>();
    for (const folder of folders) {
        const bucket = byLabel.get(folder.label);
        if (bucket) bucket.push(folder);
        else byLabel.set(folder.label, [folder]);
    }
    const out = new Map<string, string>();
    for (const bucket of byLabel.values()) {
        if (bucket.length === 1) continue;
        bucket.sort((a, b) => a.addedAt - b.addedAt);
        bucket.forEach((folder, index) => {
            if (index > 0) out.set(folder.id, `${folder.label} (${index + 1})`);
        });
    }
    return out;
}

function buildChip(folder: RememberedFolder, displayLabel: string): HTMLElement {
    const wrap = document.createElement("span");
    wrap.className = "recent-folder-chip";

    const open = document.createElement("button");
    open.type = "button";
    open.className = "recent-folder-chip__open";

    const status = document.createElement("span");
    status.className = "recent-folder-chip__status";
    status.setAttribute("aria-hidden", "true");
    open.appendChild(status);
    // The label lives in its own block-level span: inline-flex turns a bare
    // text node into an anonymous flex item, where text-overflow does not
    // apply and a long folder name would clip without the ellipsis.
    const labelSpan = document.createElement("span");
    labelSpan.className = "recent-folder-chip__label";
    labelSpan.textContent = displayLabel;
    open.appendChild(labelSpan);
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
            .then(() => {
                purgeFolderSessionState(folder.id);
                return refreshChips();
            })
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

// Single instance living in the card header, attached/detached per render.
let forgetAllButton: HTMLElement | null = null;

function syncForgetAllButton(shouldShow: boolean): void {
    if (!shouldShow) {
        forgetAllButton?.remove();
        return;
    }
    if (!forgetAllButton) {
        const forgetAll = document.createElement("button");
        forgetAll.type = "button";
        forgetAll.className = "recent-folders-forget-all";
        forgetAll.textContent = t("recentFolders.forgetAll");
        forgetAll.addEventListener("click", () => {
            forgetAllFolders()
                .then(() => {
                    // Only remembered-folder ids ever enter these maps, and
                    // none of them exists anymore.
                    folderIdByFileKey.clear();
                    availabilityById.clear();
                    return refreshChips();
                })
                .catch(() => {});
        });
        forgetAllButton = forgetAll;
    }
    chipsContainer?.querySelector(".recent-folders-head")?.appendChild(forgetAllButton);
}
