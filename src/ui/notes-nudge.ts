// Blocking storage choice shown only after a user changes an annotation and
// there is no usable, narrowly scoped notes-file connection. The annotation
// is already in the in-memory/browser store by then, so cancelling a native
// picker never loses the edit. The dialog itself cannot be dismissed: the
// user either connects one file or explicitly chooses browser-only storage.

import { t } from "../i18n/index.js";
import { createLogger } from "../log.js";
import { getFolder, setFolderNotesStorage } from "../persist/folders.js";
import type { AnnotationRecord, RememberedFolder } from "../persist/types.js";
import { registerNotesWriteAttentionHook } from "./annotations-sidecar.js";
import { registerUserAnnotationHook } from "./annotations.js";
import {
    getNotesConnector,
    hasLiveSource,
    refreshFolderSources,
    rememberLiveSource,
    type NotesWriteAction,
} from "./folder-sources.js";
import { activateModal, deactivateModal } from "./modal-helper.js";

const log = createLogger("notes-storage-choice");

let modal: HTMLElement | null = null;
let body: HTMLElement | null = null;
let error: HTMLElement | null = null;
let browserButton: HTMLButtonElement | null = null;
let fileButton: HTMLButtonElement | null = null;
let pending: { folder: RememberedFolder; action: NotesWriteAction } | null = null;
const browserOnlyThisSession = new Set<string>();

/** Wires the mandatory choice to real user edits and write failures. */
export function initNotesNudge(): void {
    modal = document.getElementById("notes-storage-modal");
    body = document.getElementById("notes-storage-modal-body");
    error = document.getElementById("notes-storage-modal-error");
    browserButton = document.getElementById("notes-storage-browser") as HTMLButtonElement | null;
    fileButton = document.getElementById("notes-storage-file") as HTMLButtonElement | null;
    browserButton?.addEventListener("click", chooseBrowserStorage);
    fileButton?.addEventListener("click", chooseFileStorage);
    registerUserAnnotationHook(onUserAnnotation);
    registerNotesWriteAttentionHook((folderId) => void requestStorageDecision(folderId, null));
}

function onUserAnnotation(record: AnnotationRecord): void {
    const anchorKey = record.anchor?.fileIdentityKey ?? null;
    void requestStorageDecision(record.folderId, anchorKey).catch((err: unknown) => {
        log.warn("notes storage choice evaluation failed", {
            err: err instanceof Error ? err.message : String(err),
        });
    });
}

async function requestStorageDecision(folderId: string, anchorKey: string | null, force = false): Promise<void> {
    const connector = getNotesConnector();
    if (!connector || !modal || !browserButton || !fileButton) return;
    if (pending && !modal.hidden) return;
    const storedFolder = folderId ? await getFolder(folderId).catch(() => null) : null;
    const folder = storedFolder ?? (await rememberLiveSource(anchorKey));
    if (!folder) return;
    if (!force && (folder.notesStorage === "browser" || browserOnlyThisSession.has(folder.id))) return;
    const action = await connector.prepareWrite(folder, force);
    if (action === null) return;
    pending = { folder, action };
    if (body) {
        body.textContent = t(
            connector.browserStorageReady() ? "notesStorageModal.body" : "notesStorageModal.bodySession",
        );
    }
    browserButton.textContent = t(
        connector.browserStorageReady() ? "notesStorageModal.browserOnly" : "notesStorageModal.sessionOnly",
    );
    setBusy(false);
    if (error) error.hidden = true;
    modal.hidden = false;
    activateModal(modal, { onClose: () => {}, initialFocus: fileButton });
}

function chooseBrowserStorage(): void {
    const choice = pending;
    if (!choice) return;
    browserOnlyThisSession.add(choice.folder.id);
    setBusy(true);
    void setFolderNotesStorage(choice.folder.id, "browser")
        .catch((err: unknown) => {
            // The in-session choice still holds. A private/storage-disabled
            // browser may ask again after reload, which is safer than silently
            // claiming the preference was persisted.
            log.warn("browser-only notes choice could not be saved", {
                err: err instanceof Error ? err.message : String(err),
            });
        })
        .finally(() => {
            refreshFolderSources();
            closeModal();
        });
}

function chooseFileStorage(): void {
    const choice = pending;
    const connector = getNotesConnector();
    if (!choice || !connector) return;
    setBusy(true);
    if (error) error.hidden = true;
    const operation =
        choice.action === "create"
            ? connector.create(choice.folder)
            : choice.action === "authorize"
              ? connector.authorize(choice.folder)
              : connector.useExisting(choice.folder);
    void operation
        .then((result) => {
            if (result === "connected") {
                browserOnlyThisSession.delete(choice.folder.id);
                closeModal();
                return;
            }
            if (result === "failed") {
                if (error) error.hidden = false;
                void refreshPendingAction(choice).finally(() => setBusy(false));
            } else setBusy(false);
        })
        .catch((err: unknown) => {
            log.warn("notes file connection failed", { err: err instanceof Error ? err.message : String(err) });
            if (error) error.hidden = false;
            void refreshPendingAction(choice).finally(() => setBusy(false));
        });
}

async function refreshPendingAction(choice: { folder: RememberedFolder; action: NotesWriteAction }): Promise<void> {
    const connector = getNotesConnector();
    if (!connector || pending !== choice) return;
    const folder = (await getFolder(choice.folder.id).catch(() => null)) ?? choice.folder;
    const action = await connector.prepareWrite(folder, true);
    if (pending !== choice) return;
    if (action === null) closeModal();
    else pending = { folder, action };
}

function setBusy(busy: boolean): void {
    if (browserButton) browserButton.disabled = busy;
    if (fileButton) {
        fileButton.disabled = busy;
        if (busy) fileButton.setAttribute("aria-busy", "true");
        else fileButton.removeAttribute("aria-busy");
    }
}

function closeModal(): void {
    pending = null;
    setBusy(false);
    if (!modal) return;
    modal.hidden = true;
    deactivateModal(modal);
}

export async function canConnectNotesBackup(folderId: string, anchorKey: string | null): Promise<boolean> {
    if (getNotesConnector() === null) return false;
    if (hasLiveSource(anchorKey)) return true;
    return folderId !== "" && (await getFolder(folderId).catch(() => null)) !== null;
}

/** Opens the same explicit storage decision from an editor's storage link. */
export async function connectNotesBackup(folderId: string, anchorKey: string | null): Promise<void> {
    await requestStorageDecision(folderId, anchorKey, true);
}

/** Test-only reset for module-level DOM and choice state. */
export function _resetForTests(): void {
    if (modal && !modal.hidden) {
        modal.hidden = true;
        deactivateModal(modal);
    }
    modal = null;
    body = null;
    error = null;
    browserButton = null;
    fileButton = null;
    pending = null;
    browserOnlyThisSession.clear();
}
