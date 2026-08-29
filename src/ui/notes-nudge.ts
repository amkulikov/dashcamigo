// One-shot nudge at the moment the user writes their first annotation: the
// note just landed in browser storage, which a browser-data cleanup wipes -
// so offer the notes file the folder menu already provides, right when the
// user first has something to lose. Shown once ever (localStorage flag).
// Browsers without writable folder handles never see it: there is nothing to
// offer from the toast, and a nudge without a remedy is just worry. The manual
// Settings download remains available everywhere.

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
    const anchorKey = record.anchor?.fileIdentityKey ?? null;
    if (record.folderId) {
        const folder = await getFolder(record.folderId).catch(() => null);
        if (folder?.sidecarHandle) {
            // Notes already live in a file - the user knows the feature.
            markSeen();
            return;
        }
        // A forgotten folder leaves its old id behind. The clip anchor can
        // still resolve the live source and let the action remember it again.
        if (!folder && !hasLiveSource(anchorKey)) return;
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
        onAction: () => void connectNotesBackup(record.folderId, anchorKey),
    });
}

/** The toast action: resolve (remembering the folder first when needed) and
 *  hand off to the same create flow the folder menu uses. */
export async function canConnectNotesBackup(folderId: string, anchorKey: string | null): Promise<boolean> {
    if (getNotesConnector() === null) return false;
    if (hasLiveSource(anchorKey)) return true;
    // An old annotation can retain the id of a folder the user has since
    // forgotten. A non-empty id alone is not actionable: connectNotesBackup
    // would find neither a stored handle nor a live source and the button
    // would be a dead click.
    return folderId !== "" && (await getFolder(folderId).catch(() => null)) !== null;
}

export async function connectNotesBackup(folderId: string, anchorKey: string | null): Promise<void> {
    const connector = getNotesConnector();
    if (!connector) return;
    const storedFolder = folderId ? await getFolder(folderId).catch(() => null) : null;
    // A forgotten folder leaves its old id on the live annotation until it is
    // remembered again. Fall back to the still-open source instead of turning
    // the backup action into a dead click.
    const folder = storedFolder ?? (await rememberLiveSource(anchorKey));
    if (!folder) {
        log.warn("notes nudge action found no folder to attach to");
        return;
    }
    if (folder.sidecarHandle) {
        // A handle that was already persisted may be stale, so this explicit
        // action is its non-destructive reconnect path.
        await connector.useExisting(folder);
        return;
    }
    // create() performs non-destructive discovery and re-reads the latest
    // folder record itself. Avoid another IndexedDB round trip here: write
    // permission still needs the activation from this click.
    await connector.create(folder);
}
