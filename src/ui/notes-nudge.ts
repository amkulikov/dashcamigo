// One-shot nudge at the moment the user writes their first annotation: the
// note just landed in browser storage, which a browser-data cleanup wipes -
// so offer the notes file the folder menu already provides, right when the
// user first has something to lose. Shown once ever (localStorage flag).
// Browsers without the save picker never see it: there is nothing to offer,
// and a nudge without a remedy is just worry.

import { createLogger } from "../log.js";
import { getFolder } from "../persist/folders.js";
import type { AnnotationRecord } from "../persist/types.js";
import { registerUserAnnotationHook } from "./annotations.js";
import { getNotesConnector, hasLiveSource, rememberLiveSource } from "./folder-sources.js";
import { notify } from "./notifications.js";

const log = createLogger("notes-nudge");

const SEEN_KEY = "dashcamigo:notes-nudge";

function wasSeen(): boolean {
    try {
        return localStorage.getItem(SEEN_KEY) === "1";
    } catch {
        return false;
    }
}

function markSeen(): void {
    try {
        localStorage.setItem(SEEN_KEY, "1");
    } catch {
        // Private mode - the nudge may repeat next session, harmless.
    }
}

/** Wires the nudge to the user-edit hook. Call once from app.ts. */
export function initNotesNudge(): void {
    registerUserAnnotationHook(onUserAnnotation);
}

function onUserAnnotation(record: AnnotationRecord): void {
    if (wasSeen()) return;
    if (getNotesConnector() === null) return;
    void evaluate(record).catch((err: unknown) => {
        log.warn("notes nudge evaluation failed", { err: err instanceof Error ? err.message : String(err) });
    });
}

async function evaluate(record: AnnotationRecord): Promise<void> {
    // A trip-meta record names its anchor file; a marker carries only a UTC,
    // so its source can be resolved only when the session has a single one.
    const anchorKey = record.kind === "tripMeta" ? record.anchor.fileIdentityKey : null;
    if (record.folderId) {
        const folder = await getFolder(record.folderId).catch(() => null);
        if (!folder) return;
        if (folder.sidecarHandle) {
            // Notes already live in a file - the user knows the feature.
            markSeen();
            return;
        }
    } else if (!hasLiveSource(anchorKey)) {
        // Ad-hoc drop / classic picker: no folder handle, nowhere to put a
        // file. Deliberately NOT marked seen - an annotation on a
        // picker-opened folder later can still be offered.
        return;
    }
    markSeen();
    notify({
        severity: "info",
        messageKey: "notesNudge.message",
        actionKey: "notesNudge.action",
        onAction: () => void connectNotesFile(record.folderId, anchorKey),
    });
}

/** The toast action: resolve (remembering the folder first when needed) and
 *  hand off to the same create flow the folder menu uses. Runs inside the
 *  click, so the save picker still has its user activation. */
async function connectNotesFile(folderId: string, anchorKey: string | null): Promise<void> {
    const connector = getNotesConnector();
    if (!connector) return;
    const folder = folderId
        ? ((await getFolder(folderId).catch(() => null)) ?? null)
        : await rememberLiveSource(anchorKey);
    if (!folder) {
        log.warn("notes nudge action found no folder to attach to");
        return;
    }
    // Remembering can auto-attach a notes file already sitting in the folder
    // (annotations-sidecar's folder-opened hook). Re-read before offering to
    // CREATE one - a second file next to an adopted one only sows confusion.
    // The hook runs async, so a still-in-flight adopt can slip past this;
    // attachSidecar merges before any write either way, so nothing is lost.
    const fresh = (await getFolder(folder.id).catch(() => null)) ?? folder;
    if (fresh.sidecarHandle) return;
    connector.create(fresh);
}
