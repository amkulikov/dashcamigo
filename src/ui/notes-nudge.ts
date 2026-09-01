// Blocking storage choice shown only after a user changes an annotation and
// the active notes file is not writable. The edit already exists in
// browser/session state, so a dismissed native picker never loses it; the
// modal itself stays blocking until the user explicitly chooses where it goes.

import { t } from "../i18n/index.js";
import { createLogger } from "../log.js";
import { registerNotesWriteAttentionHook } from "./annotations-sidecar.js";
import { registerUserAnnotationHook } from "./annotations.js";
import { getNotesConnector, refreshFolderSources, type NotesWriteAction } from "./folder-sources.js";
import { activateModal, deactivateModal } from "./modal-helper.js";

const log = createLogger("notes-storage-choice");

let modal: HTMLElement | null = null;
let body: HTMLElement | null = null;
let error: HTMLElement | null = null;
let browserButton: HTMLButtonElement | null = null;
let fileButton: HTMLButtonElement | null = null;
let pending: { action: NotesWriteAction } | null = null;
let browserOnlyThisSession = false;

export function initNotesNudge(): void {
    modal = document.getElementById("notes-storage-modal");
    body = document.getElementById("notes-storage-modal-body");
    error = document.getElementById("notes-storage-modal-error");
    browserButton = document.getElementById("notes-storage-browser") as HTMLButtonElement | null;
    fileButton = document.getElementById("notes-storage-file") as HTMLButtonElement | null;
    browserButton?.addEventListener("click", chooseBrowserStorage);
    fileButton?.addEventListener("click", chooseFileStorage);
    registerUserAnnotationHook(() => void requestStorageDecision());
    registerNotesWriteAttentionHook(() => void requestStorageDecision());
}

async function requestStorageDecision(force = false): Promise<void> {
    const connector = getNotesConnector();
    if (!connector?.canSelectFile() || !modal || !browserButton || !fileButton) return;
    if (pending && !modal.hidden) return;
    if (!force && browserOnlyThisSession) return;
    const action = await connector.prepareWrite(force);
    if (action === null) return;
    pending = { action };
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
    const connector = getNotesConnector();
    if (!pending || !connector) return;
    browserOnlyThisSession = true;
    setBusy(true);
    void connector
        .chooseBrowser()
        .catch((err: unknown) => {
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
            ? connector.create()
            : choice.action === "authorize"
              ? connector.authorize()
              : connector.useExisting(true);
    void operation
        .then((result) => {
            if (result === "connected") {
                browserOnlyThisSession = false;
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

async function refreshPendingAction(choice: { action: NotesWriteAction }): Promise<void> {
    const connector = getNotesConnector();
    if (!connector || pending !== choice) return;
    const action = await connector.prepareWrite(true);
    if (pending !== choice) return;
    if (action === null) closeModal();
    else pending = { action };
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

export function canConnectNotesBackup(): boolean {
    return getNotesConnector()?.canSelectFile() === true;
}

export async function connectNotesBackup(): Promise<void> {
    await requestStorageDecision(true);
}

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
    browserOnlyThisSession = false;
}
