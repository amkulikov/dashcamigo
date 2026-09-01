// The SOURCES list: which folders the loaded trips came out of (with the
// remember/notes controls), plus remembered folders that are NOT loaded yet -
// one click loads them into the session. The landing chips
// (persistent-folders.ts) answer the same "what can I open" question before
// the first ingest; this list takes over afterwards, because the landing is
// one-way - once trips are loaded it never comes back.
//
// Deliberately the LOW-level module of the folder feature: it owns the
// file-identity -> remembered-folder binding that every annotation resolves
// through, so ingest / persistent-folders / annotations-sidecar depend on it
// and never the other way round.
//
// Live picker sources are keyed by handle object, not their display name. Two
// cards commonly expose the same root name (DCIM); collapsing them would bind
// both cards' annotations to whichever folder opened last.

import { t } from "../i18n/index.js";
import type { DuplicateSourceMatch } from "../ingest-dedup.js";
import { createLogger } from "../log.js";
import type { VendorFile } from "../parsers/types.js";
import {
    type FolderAvailability,
    forgetFolder,
    getFolder,
    listFolders,
    probeFolderAvailability,
    rememberFolder,
} from "../persist/folders.js";
import { fileIdentityKey, fileIdentityOf } from "../persist/identity.js";
import type { RememberedFolder } from "../persist/types.js";

import { buildLucideIcon } from "./icons.js";
import { notify } from "./notifications.js";
import type { IngestOrigin } from "./state.js";

const log = createLogger("folder-sources");

interface FolderSource {
    /** Root folder name; "" for files dropped without a folder around them. */
    key: string;
    /** Live handle - present only on the FSA path, the only one that can
     *  remember or re-read the folder later. */
    handle: FileSystemDirectoryHandle | null;
    /** Remembered-folder id, "" while the folder is only a session source. */
    folderId: string;
    availability: FolderAvailability | null;
    /** Identity keys of every file this source contributed. Kept (instead of
     *  the VendorFiles) because binding a late "remember" needs exactly these
     *  and nothing else - and a Set of strings is cheap to hold for a whole
     *  card. */
    identityKeys: Set<string>;
    /** Opaque per-ingest scopes contributed by this physical source. */
    sourceKeys: Set<string>;
    /** Cheap path-independent identities used only to verify that a folder
     *  re-selected for reading is the folder behind this read-only row. */
    fileFingerprints: Set<string>;
    /** A notes file merged from the ingest batch but not yet attached as a
     *  writable backup. This also applies to a live, unremembered folder: its
     *  directory handle can reopen the source, but the batch supplied only a
     *  File snapshot for the notes merge. */
    readOnlyNotes: IngestNotesFileStatus | null;
}

export type IngestNotesFileState = "loaded" | "partial" | "invalid" | "unreadable" | "multiple";

export interface IngestNotesFileStatus {
    sourceKey: string;
    root: string;
    fileName: string;
    state: IngestNotesFileState;
}

// Insertion-ordered: the first folder the user opened stays first, so the row
// under the CTA does not reshuffle as more cards are added.
const sourcesByKey = new Map<string, FolderSource>();
let sourceKeyByHandle = new WeakMap<FileSystemDirectoryHandle, string>();
let nextHandleSourceId = 1;
let nextFolderDomId = 1;

// File identity key -> RememberedFolder.id, for every file that came out of a
// remembered folder this session. Annotations resolve their folderId through
// this. Far tighter than keying on the root folder NAME (which collides the
// moment two SD cards share one on-disk name), though not absolute: a
// byte-for-byte backup of a folder yields identical persistent keys. The
// per-ingest source scope below disambiguates those copies while both are open.
const folderIdByFileKey = new Map<string, string>();
const OWNERSHIP_SEPARATOR = String.fromCharCode(1);

function ownershipKey(identityKey: string, sourceKey: string): string {
    return `${sourceKey}${OWNERSHIP_SEPARATOR}${identityKey}`;
}

/** RememberedFolder.id that produced the file with this identity key, or ""
 *  when the file did not come out of a remembered folder (ad-hoc drop /
 *  never remembered). */
export function folderIdForFileKey(identityKey: string, sourceKey?: string): string {
    if (sourceKey !== undefined) {
        const exact = folderIdByFileKey.get(ownershipKey(identityKey, sourceKey));
        // A scoped caller knows which physical ingest produced the file. If
        // that source is not bound, borrowing the sole owner of an identical
        // file from another open card would silently send notes to that card.
        return exact ?? "";
    }
    const owners = new Set<string>();
    for (const [key, folderId] of folderIdByFileKey) {
        if (key.endsWith(`${OWNERSHIP_SEPARATOR}${identityKey}`)) owners.add(folderId);
    }
    return owners.size === 1 ? [...owners][0]! : "";
}

/** Drops a forgotten folder's session state - a later annotation must not
 *  resolve to the dead id (it would be invisible to every sidecar path).
 *  Only for forgetting from the landing, where no trip of that folder is
 *  open; forgetting an ACTIVE source deliberately keeps the binding (see
 *  onForget below). */
export function purgeFolderSessionState(folderId: string): void {
    for (const [key, id] of folderIdByFileKey) {
        if (id === folderId) folderIdByFileKey.delete(key);
    }
    for (const source of sourcesByKey.values()) {
        if (source.folderId === folderId) source.folderId = "";
    }
    // The forgotten folder must also leave the "not loaded yet" rows.
    refreshRememberedFolders();
}

/** Same as purgeFolderSessionState, for the landing's "forget all" - none of
 *  the remembered ids exists anymore. */
export function purgeAllFolderSessionState(): void {
    folderIdByFileKey.clear();
    for (const source of sourcesByKey.values()) source.folderId = "";
    refreshRememberedFolders();
}

/** Clears the module-level session state between unit tests. */
export function _resetForTests(): void {
    sourcesByKey.clear();
    folderIdByFileKey.clear();
    sourceKeyByHandle = new WeakMap();
    nextHandleSourceId = 1;
    nextFolderDomId = 1;
    rememberedCache = [];
    rememberedAvailability.clear();
    folderOpenedHook = null;
    notesConnector = null;
    readOnlyNotesFolderConnector = null;
}

// The sidecar layer merges its file after a folder opens or is remembered. A
// registered hook, not an import - the sidecar module reads annotations, which
// resolve their folder id through this module.
let folderOpenedHook: ((folder: RememberedFolder) => void | Promise<void>) | null = null;

/** Registers the after-open hook for remembered folders. */
export function registerFolderOpenedHook(callback: (folder: RememberedFolder) => void | Promise<void>): void {
    folderOpenedHook = callback;
}

/** Notifies the sidecar layer that a folder is now open/remembered. */
export async function notifyFolderOpened(folder: RememberedFolder): Promise<void> {
    try {
        await folderOpenedHook?.(folder);
    } catch (err) {
        // Notes-file IO must not turn a successfully opened recordings folder
        // into a failed open. The sidecar layer logs its own expected failures;
        // this boundary catches any unexpected hook rejection.
        log.warn("folder-opened hook failed", { err: err instanceof Error ? err.message : String(err) });
    }
}

export type NotesBackupStatus = "missing" | "connected" | "ready" | "needsAttention";
export type NotesConnectResult = "connected" | "cancelled" | "failed";
export type NotesWriteAction = "create" | "connect" | "authorize";

/** Actions and live status for the notes backup. */
export interface NotesConnector {
    create(folder: RememberedFolder): Promise<NotesConnectResult>;
    useExisting(folder: RememberedFolder): Promise<NotesConnectResult>;
    connectPicked(folder: RememberedFolder, handle: FileSystemFileHandle): Promise<NotesConnectResult>;
    authorize(folder: RememberedFolder): Promise<NotesConnectResult>;
    prepareWrite(folder: RememberedFolder, force?: boolean): Promise<NotesWriteAction | null>;
    status(folder: RememberedFolder): Promise<NotesBackupStatus>;
    browserStorageReady(): boolean;
}

// Notes-file actions for a folder. Registered by annotations-sidecar.ts, absent
// until it initializes (and on browsers without the pickers, where the menu
// entries stay hidden).
let notesConnector: NotesConnector | null = null;

/** Registers the notes-file actions for the source menu. */
export function registerNotesConnector(connector: NotesConnector): void {
    notesConnector = connector;
}

/** The registered notes-file actions, or null on browsers without the
 *  pickers (the connector never registers there). */
export function getNotesConnector(): NotesConnector | null {
    return notesConnector;
}

/** The session source holding this file, live handles only - or, with null,
 *  the SOLE live-handle source of the session (for records that carry no file
 *  anchor; with several sources there is no honest guess, so none). */
function liveSourceFor(identityKey: string | null): FolderSource | null {
    const live = [...sourcesByKey.values()].filter((source) => source.handle !== null);
    if (identityKey === null) return live.length === 1 ? live[0]! : null;
    const matching = live.filter((source) => source.identityKeys.has(identityKey));
    return matching.length === 1 ? matching[0]! : null;
}

/** True when a folder with a live handle backs this file (or, with null, when
 *  exactly one such folder is open) - the precondition for offering to keep a
 *  notes file next to the recordings. */
export function hasLiveSource(identityKey: string | null): boolean {
    return liveSourceFor(identityKey) !== null;
}

/**
 * Resolves the live source for the key (see liveSourceFor) to its
 * RememberedFolder, creating the record the same way the row's Remember
 * button does when the folder is not remembered yet. Returns null when there
 * is no live source or the store refused.
 */
export async function rememberLiveSource(identityKey: string | null): Promise<RememberedFolder | null> {
    const source = liveSourceFor(identityKey);
    if (!source?.handle) return null;
    if (source.folderId) return (await getFolder(source.folderId).catch(() => null)) ?? null;
    try {
        const record = await rememberFolder(source.handle);
        bindSourceToFolder(source.handle, record);
        // Adopts annotations made before this point (they carry folderId "")
        // and merges a notes file the folder may already hold.
        await notifyFolderOpened(record);
        refreshRememberedFolders();
        return record;
    } catch (err) {
        log.warn("rememberFolder failed", { err: err instanceof Error ? err.message : String(err) });
        return null;
    }
}

// Loads a remembered folder into the session (permission re-prompt included).
// Registered by persistent-folders.ts, which owns the open flow - a direct
// import would cycle, it already imports this module.
let rememberedFolderOpener: ((folder: RememberedFolder) => void) | null = null;

/** Registers the click action for a remembered-but-not-loaded row. */
export function registerRememberedFolderOpener(callback: (folder: RememberedFolder) => void): void {
    rememberedFolderOpener = callback;
}

// A plain <input webkitdirectory> gives us only File snapshots. Chromium can
// upgrade that row after the user re-selects the folder for read access and
// separately picks the notes file; persistent-folders owns that flow.
let readOnlyNotesFolderConnector: ((sourceId: string) => Promise<void>) | null = null;

export function registerReadOnlyNotesFolderConnector(callback: (sourceId: string) => Promise<void>): void {
    readOnlyNotesFolderConnector = callback;
}

// Remembered folders as last read from the store, for the "not loaded yet"
// rows. A cache because rendering is synchronous; refreshed on init, on every
// store mutation this module makes, and on tab return.
let rememberedCache: RememberedFolder[] = [];
// Liveness per remembered folder id (session-local, re-probed on refresh).
const rememberedAvailability = new Map<string, FolderAvailability>();

/** Re-reads the remembered folders and re-renders; kicks a liveness probe per
 *  not-yet-loaded folder. Safe to call any time - store errors just leave the
 *  unloaded rows out. */
function refreshRememberedFolders(): void {
    listFolders()
        .then((folders) => {
            rememberedCache = folders;
            renderSources();
            for (const folder of unloadedRemembered()) {
                void probeFolderAvailability(folder.handle).then((availability) => {
                    if (rememberedAvailability.get(folder.id) === availability) return;
                    rememberedAvailability.set(folder.id, availability);
                    renderSources();
                });
            }
        })
        .catch(() => {
            rememberedCache = [];
            renderSources();
        });
}

/**
 * Records the liveness an actual open attempt just proved, for the row the user
 * clicked. The background probe is a guess about a folder nobody touched; a
 * real enumerate that succeeded or threw is the authoritative answer, and
 * without this the row keeps whatever the last probe said - green next to a
 * "could not open" toast.
 */
export function setRememberedAvailability(folderId: string, availability: FolderAvailability): void {
    if (rememberedAvailability.get(folderId) === availability) return;
    rememberedAvailability.set(folderId, availability);
    renderSources();
}

/** Remembered folders no session source is bound to - the rows offering to
 *  load. Bound ones are already represented by their session row. */
function unloadedRemembered(): RememberedFolder[] {
    const boundIds = new Set<string>();
    for (const source of sourcesByKey.values()) {
        if (source.folderId) boundIds.add(source.folderId);
    }
    return rememberedCache.filter((folder) => !boundIds.has(folder.id));
}

/**
 * Human form of a folder/source root name. Chromium names a drive-root handle
 * after the bare path separator ("\" on a Windows flash card), which on screen
 * reads as a rendering glitch - substitute a real label. Every other name
 * passes through unchanged, including "" (the loose-files row owns that case).
 */
export function folderDisplayLabel(rootName: string): string {
    return /^[\\/]+$/.test(rootName) ? t("folderSources.driveRoot") : rootName;
}

/**
 * Display labels for remembered folders, duplicates suffixed " (2)", " (3)"...
 * in addedAt order (stable across re-renders, unlike the lastOpenedAt list
 * order). The handle exposes only the folder's leaf name - two SD cards named
 * "DCIM" are otherwise indistinguishable. Shared with the landing chips.
 * Buckets by the DISPLAY label, so two drive roots ("\" and "/") collide the
 * way the user sees them collide.
 */
export function disambiguatedLabels(folders: RememberedFolder[]): Map<string, string> {
    const byLabel = new Map<string, RememberedFolder[]>();
    for (const folder of folders) {
        const label = folderDisplayLabel(folder.label);
        const bucket = byLabel.get(label);
        if (bucket) bucket.push(folder);
        else byLabel.set(label, [folder]);
    }
    const out = new Map<string, string>();
    for (const [label, bucket] of byLabel) {
        if (bucket.length === 1) continue;
        bucket.sort((a, b) => a.addedAt - b.addedAt);
        bucket.forEach((folder, index) => {
            if (index > 0) out.set(folder.id, `${label} (${index + 1})`);
        });
    }
    return out;
}

/** Root folder name of a relative path, or "" when the file was dropped
 *  without a folder around it (a bare filename has no leading segment). */
function rootNameOf(relativePath: string): string {
    const segments = relativePath.split(/[/\\]/).filter((segment) => segment.length > 0);
    return segments.length > 1 ? segments[0]! : "";
}

function isRootFile(vendorFile: VendorFile, fileName: string): boolean {
    const segments = vendorFile.relativePath.split(/[/\\]/).filter((segment) => segment.length > 0);
    return segments.at(-1) === fileName && segments.length <= 2;
}

function fileFingerprint(file: File): string {
    // Some picker bridges round mtimes differently for FileList and directory
    // handles. Name + exact byte length stays stable across those two views;
    // the user has also explicitly selected the row's named folder.
    return `${file.name}\0${file.size}`;
}

/**
 * Records the folders an ingested batch came from and binds its files to the
 * remembered folder when the batch came from one. Called for every drop
 * (picker, classic input, drag-and-drop) after the junk filter, so the row
 * appears together with the trips it explains.
 */
export function registerIngestSource(
    files: VendorFile[],
    origin: IngestOrigin | null,
    duplicateMatches: readonly DuplicateSourceMatch[] = [],
): void {
    const sourceAliases = origin ? new Map<string, string>() : duplicateSourceAliases(duplicateMatches);
    const groups = new Map<string, { root: string; files: VendorFile[] }>();
    if (origin) {
        // A picker batch has exactly one root by construction - the picked
        // handle - so the whole batch lands on its row. Grouping by the paths'
        // first segment instead would shatter it when the handle's name is a
        // bare separator (a Windows drive root is named "\", which the path
        // split swallows, leaving the subfolders posing as roots). An empty
        // batch still names the folder: opening an already-loaded card dedups
        // every file away, and the row must still gain its handle (and with
        // it the offer to remember).
        let mapKey = origin.folderId ? `folder:${origin.folderId}` : sourceKeyByHandle.get(origin.handle);
        if (!mapKey) {
            mapKey = `handle:${nextHandleSourceId++}`;
        }
        sourceKeyByHandle.set(origin.handle, mapKey);
        groups.set(mapKey, { root: origin.handle.name, files });
    } else {
        // Handle-less paths (classic input, drag-and-drop): the leading path
        // segment is all there is to group by.
        for (const vendorFile of files) {
            const root = rootNameOf(vendorFile.relativePath);
            const proposedKey = `drop:${vendorFile.sourceKey ?? "unscoped"}:${root}`;
            const mapKey = sourceAliases.get(proposedKey) ?? proposedKey;
            const group = groups.get(mapKey);
            if (group) group.files.push(vendorFile);
            else groups.set(mapKey, { root, files: [vendorFile] });
        }
    }
    if (groups.size === 0) return;
    for (const [mapKey, group] of groups) {
        const source = sourcesByKey.get(mapKey) ?? {
            key: group.root,
            handle: null,
            folderId: "",
            availability: null,
            identityKeys: new Set<string>(),
            sourceKeys: new Set<string>(),
            fileFingerprints: new Set<string>(),
            readOnlyNotes: null,
        };
        for (const vendorFile of group.files) {
            source.identityKeys.add(fileIdentityKey(fileIdentityOf(vendorFile.file, vendorFile.relativePath)));
            source.sourceKeys.add(vendorFile.sourceKey ?? "");
            source.fileFingerprints.add(fileFingerprint(vendorFile.file));
        }
        if (source.folderId) bindKeys(source, source.folderId);
        if (origin) {
            source.handle = origin.handle;
            source.availability = "available";
            // Bind the source's WHOLE key set, not just this batch: files the
            // dedup dropped (or a drag-and-drop of the same folder earlier in
            // the session) belong to this folder too, and their annotations
            // must resolve to it.
            if (origin.folderId) {
                for (const [otherKey, other] of sourcesByKey) {
                    if (otherKey === mapKey || other.folderId !== origin.folderId) continue;
                    for (const identityKey of other.identityKeys) source.identityKeys.add(identityKey);
                    for (const sourceKey of other.sourceKeys) source.sourceKeys.add(sourceKey);
                    sourcesByKey.delete(otherKey);
                }
                bindKeys(source, origin.folderId);
            }
        }
        sourcesByKey.set(mapKey, source);
    }
    renderSources();
}

function duplicateSourceAliases(matches: readonly DuplicateSourceMatch[]): Map<string, string> {
    const aliases = new Map<string, string>();
    const incomingSourceKeys = new Map<string, string>();
    const ambiguous = new Set<string>();
    for (const { incoming, loaded } of matches) {
        const proposedKey = `drop:${incoming.sourceKey ?? "unscoped"}:${rootNameOf(incoming.relativePath)}`;
        if (ambiguous.has(proposedKey)) continue;
        const loadedIdentity = fileIdentityKey(fileIdentityOf(loaded.file, loaded.relativePath));
        const candidates = [...sourcesByKey.entries()].filter(
            ([, source]) => source.sourceKeys.has(loaded.sourceKey ?? "") && source.identityKeys.has(loadedIdentity),
        );
        if (candidates.length !== 1) continue;
        const [targetKey] = candidates[0]!;
        const prior = aliases.get(proposedKey);
        if (prior && prior !== targetKey) {
            aliases.delete(proposedKey);
            incomingSourceKeys.delete(proposedKey);
            ambiguous.add(proposedKey);
            continue;
        }
        aliases.set(proposedKey, targetKey);
        incomingSourceKeys.set(proposedKey, incoming.sourceKey ?? "");
    }
    for (const [proposedKey, targetKey] of aliases) {
        const target = sourcesByKey.get(targetKey);
        if (!target) continue;
        target.sourceKeys.add(incomingSourceKeys.get(proposedKey) ?? "");
        if (target.folderId) bindKeys(target, target.folderId);
    }
    return aliases;
}

/** Adds the result of the ingest-time notes-file read to the matching source
 * row. This is display state only: the batch does not attach a writable file
 * handle, even when the source itself has a live directory handle. */
export function registerIngestNotesFiles(statuses: readonly IngestNotesFileStatus[]): void {
    for (const status of statuses) {
        let source = sourcesByKey.get(`drop:${status.sourceKey}:${status.root}`);
        const scoped = source
            ? []
            : [...sourcesByKey.values()].filter((candidate) => candidate.sourceKeys.has(status.sourceKey));
        if (!source) {
            const sameRoot = scoped.filter((candidate) => candidate.key === status.root);
            if (sameRoot.length === 1) source = sameRoot[0];
            // Picker handles supply their own display name, which need not be
            // the first path segment (notably a Windows drive-root handle is
            // named "\\" while its root notes file has root ""). The ingest
            // scope is the stronger identity when it names exactly one row.
            else if (scoped.length === 1) source = scoped[0];
        }
        if (!source && scoped.length === 0) {
            // On a classic re-open every recording may deduplicate against the
            // loaded session while the notes file still needs merging. Reuse a
            // sole same-root row; with duplicate root labels there is no safe
            // source guess, so leave the status unattached.
            const matching = [...sourcesByKey.values()].filter(
                (candidate) => candidate.handle === null && candidate.key === status.root,
            );
            if (matching.length === 1) source = matching[0];
        }
        if (source) source.readOnlyNotes = status;
    }
    if (statuses.length > 0) renderSources();
}

/** Safely upgrades a read-only source after the user re-selects its folder.
 * At least one unchanged file must overlap, otherwise an unrelated folder can
 * never be remembered or receive this source's notes. */
export async function connectReadableFolderToSource(
    sourceId: string,
    handle: FileSystemDirectoryHandle,
    files: VendorFile[],
    notesHandle?: FileSystemFileHandle,
): Promise<RememberedFolder | null> {
    const source = sourcesByKey.get(sourceId);
    if (!source?.readOnlyNotes) return null;
    const notesFileName = source.readOnlyNotes.fileName;
    const hasNotesFile = files.some((vendorFile) => isRootFile(vendorFile, notesFileName));
    const matches =
        hasNotesFile &&
        files.some(
            (vendorFile) =>
                vendorFile.file.name !== notesFileName && source.fileFingerprints.has(fileFingerprint(vendorFile.file)),
        );
    if (!matches) {
        log.warn("selected notes folder does not match source", {
            sourceFiles: source.fileFingerprints.size,
            selectedFiles: files.length,
        });
        return null;
    }
    if (notesHandle) {
        try {
            const discovered = await handle.getFileHandle(notesFileName);
            if (!(await notesHandle.isSameEntry(discovered))) {
                log.warn("selected notes file does not belong to selected source folder");
                return null;
            }
        } catch (err) {
            log.warn("selected notes file identity check failed", {
                err: err instanceof Error ? err.message : String(err),
            });
            return null;
        }
    }
    try {
        const folder = await rememberFolder(handle);
        source.handle = handle;
        source.key = handle.name;
        source.availability = "available";
        sourceKeyByHandle.set(handle, sourceId);
        for (const vendorFile of files) {
            source.identityKeys.add(fileIdentityKey(fileIdentityOf(vendorFile.file, vendorFile.relativePath)));
            source.fileFingerprints.add(fileFingerprint(vendorFile.file));
        }
        bindSourceToFolder(handle, folder);
        await notifyFolderOpened(folder);
        if (notesHandle) {
            const connected = await notesConnector?.connectPicked(folder, notesHandle);
            if (connected !== "connected") return null;
        }
        refreshRememberedFolders();
        return folder;
    } catch (err) {
        log.warn("read-only notes folder connection failed", { err: err instanceof Error ? err.message : String(err) });
        return null;
    }
}

/**
 * Binds an already-remembered folder to the session source that came from it -
 * the picker path learns the folder is remembered only after the ingest, and a
 * "remember" click creates the record even later.
 */
export function bindSourceToFolder(handle: FileSystemDirectoryHandle, folder: RememberedFolder): void {
    const mappedKey = sourceKeyByHandle.get(handle);
    let source = mappedKey ? sourcesByKey.get(mappedKey) : undefined;
    let sourceEntryKey = source ? mappedKey : undefined;
    if (!source) {
        const candidates = [...sourcesByKey.entries()].filter(
            ([, candidate]) => candidate.handle === null && candidate.key === handle.name,
        );
        if (candidates.length === 1) {
            [sourceEntryKey, source] = candidates[0]!;
        }
    }
    if (!source) return;
    const existingEntry = [...sourcesByKey.entries()].find(
        ([key, candidate]) => candidate !== source && candidate.folderId === folder.id && key !== sourceEntryKey,
    );
    if (existingEntry) {
        const [existingKey, existing] = existingEntry;
        for (const identityKey of source.identityKeys) existing.identityKeys.add(identityKey);
        for (const sourceKey of source.sourceKeys) existing.sourceKeys.add(sourceKey);
        existing.handle = handle;
        existing.availability = "available";
        if (sourceEntryKey) sourcesByKey.delete(sourceEntryKey);
        sourceKeyByHandle.set(handle, existingKey);
        source = existing;
    }
    source.handle = handle;
    source.availability = "available";
    bindKeys(source, folder.id);
    renderSources();
}

/** Marks every file of a source as belonging to a remembered folder - the
 *  lookup annotations go through. */
function bindKeys(source: FolderSource, folderId: string): void {
    source.folderId = folderId;
    for (const identityKey of source.identityKeys) {
        for (const sourceKey of source.sourceKeys) {
            folderIdByFileKey.set(ownershipKey(identityKey, sourceKey), folderId);
        }
    }
}

let listElement: HTMLElement | null = null;

/** Wires the SOURCES list under the sidebar CTA. Call once from app.ts. */
export function initFolderSources(): void {
    listElement = document.getElementById("folder-sources");
    const help = document.querySelector<HTMLDetailsElement>(".folder-sources-help");
    document.addEventListener("click", (event) => {
        if (!help?.open || help.contains(event.target as Node | null)) return;
        help.open = false;
    });
    help?.addEventListener("keydown", (event) => {
        if (event.key !== "Escape" || !help.open) return;
        event.preventDefault();
        help.open = false;
        help.querySelector<HTMLElement>("summary")?.focus();
    });
    // A card pulled out mid-session is the case the status dot exists for, and
    // returning to the tab is when the user is about to act on it - re-probe
    // then rather than on a timer that would keep an unplugged card spinning.
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") {
            probeAll();
            refreshRememberedFolders();
        }
    });
    refreshRememberedFolders();
}

function probeAll(): void {
    for (const source of sourcesByKey.values()) {
        if (!source.handle) continue;
        const handle = source.handle;
        void probeFolderAvailability(handle).then((availability) => {
            // A slow probe can still land after its handle was replaced by a
            // fresher open of the same folder - ignore it then. An unchanged
            // answer renders nothing: a re-render closes an open row menu.
            if (source.handle !== handle || source.availability === availability) return;
            source.availability = availability;
            renderSources();
        });
    }
}

// Teardown of the open row menu's document listener. A re-render throws its
// rows away, and without this the listener would outlive them - dangling and
// piling up one per render.
let closeOpenMenu: (() => void) | null = null;

function renderSources(): void {
    if (!listElement) return;
    closeOpenMenu?.();
    listElement.replaceChildren();
    const unloaded = unloadedRemembered();
    listElement.hidden = sourcesByKey.size === 0 && unloaded.length === 0;
    const labels = rowDisplayLabels(unloaded);
    for (const [sourceId, source] of sourcesByKey) {
        listElement.appendChild(buildRow(sourceId, source, labels.sources.get(source)));
    }
    // Remembered-but-not-loaded folders come after the session sources: what
    // is on screen explains itself first, what can be added follows.
    for (const folder of unloaded) {
        listElement.appendChild(buildUnloadedRow(folder, labels.folders.get(folder.id)!));
    }
}

/** Repaints notes health after an asynchronous file write changes it. */
export function refreshFolderSources(): void {
    renderSources();
}

/** Unique, stable-enough labels across BOTH loaded and unloaded rows. Remembered
 * folders keep their addedAt ordinal; session-only duplicates follow them in
 * source insertion order. This keeps two simultaneously inserted DCIM cards
 * understandable before the user remembers either one. */
function rowDisplayLabels(unloaded: RememberedFolder[]): {
    sources: Map<FolderSource, string>;
    folders: Map<string, string>;
} {
    const sourceLabels = new Map<FolderSource, string>();
    const folderLabels = new Map<string, string>();
    const rows = [
        ...[...sourcesByKey.values()].map((source) => ({ source, folder: null })),
        ...unloaded.map((folder) => ({ source: null, folder })),
    ];
    const buckets = new Map<string, typeof rows>();
    for (const row of rows) {
        const raw = row.source?.key ?? row.folder?.label ?? "";
        const base = folderDisplayLabel(raw) || t("folderSources.looseFiles");
        const bucket = buckets.get(base);
        if (bucket) bucket.push(row);
        else buckets.set(base, [row]);
    }
    for (const [base, bucket] of buckets) {
        const remembered = rememberedCache
            .filter((folder) => (folderDisplayLabel(folder.label) || t("folderSources.looseFiles")) === base)
            .sort((a, b) => a.addedAt - b.addedAt);
        const ordinalByFolderId = new Map(remembered.map((folder, index) => [folder.id, index + 1]));
        let nextOrdinal = remembered.length + 1;
        for (const row of bucket) {
            const folderId = row.source?.folderId ?? row.folder?.id ?? "";
            const ordinal = ordinalByFolderId.get(folderId) ?? nextOrdinal++;
            const label = bucket.length === 1 || ordinal === 1 ? base : `${base} (${ordinal})`;
            if (row.source) sourceLabels.set(row.source, label);
            else if (row.folder) folderLabels.set(row.folder.id, label);
        }
    }
    return { sources: sourceLabels, folders: folderLabels };
}

function buildRow(sourceId: string, source: FolderSource, resolvedLabel?: string): HTMLElement {
    const row = document.createElement("li");
    row.className = "folder-source";

    if (source.handle) {
        const status = document.createElement("span");
        status.className = "folder-source__status";
        status.setAttribute("aria-hidden", "true");
        row.appendChild(status);
        applyAvailability(row, source.availability);
    }

    // A bare drop has no folder to name; say what it is instead of showing an
    // empty row - the trips still came from somewhere the user recognizes.
    const displayLabel = resolvedLabel ?? (folderDisplayLabel(source.key) || t("folderSources.looseFiles"));
    const label = document.createElement("span");
    label.className = "folder-source__label";
    label.id = `folder-source-label-${nextFolderDomId++}`;
    label.textContent = displayLabel;
    label.title = displayLabel;
    row.appendChild(label);

    // The plain picker supplies a readable snapshot, never a writable handle.
    // Make that limitation explicit when a notes file was actually loaded,
    // and offer the browser's permission flow where it exists.
    if (!source.handle) {
        if (source.readOnlyNotes) row.appendChild(buildReadOnlyNotesStatus(sourceId, source.readOnlyNotes, label.id));
        return row;
    }

    if (source.folderId) {
        const badge = document.createElement("span");
        badge.className = "folder-source__state";
        badge.textContent = t("folderSources.remembered");
        badge.title = t("folderSources.rememberedHint");
        row.appendChild(badge);
        row.appendChild(buildMenu(source, displayLabel));
        const notes = buildInlineNotesStatus();
        row.appendChild(notes);
        loadInlineNotesStatus(notes, source.folderId, label.id);
        return row;
    }

    const remember = document.createElement("button");
    remember.type = "button";
    remember.className = "folder-source__remember";
    remember.textContent = t("folderSources.remember");
    remember.title = t("folderSources.rememberHint");
    // Several rows carry the same verb; the folder is what tells them apart, so
    // it belongs in the accessible name and not only in the row above it. Its
    // own key, not a colon glued on here - word order and separator are the
    // dictionary's to choose.
    remember.setAttribute("aria-label", t("folderSources.rememberAria", { folder: displayLabel }));
    remember.addEventListener("click", () => void onRemember(source, remember));
    row.appendChild(remember);
    // Opening through the FSA picker gives this row a live directory handle,
    // but until the folder is remembered the notes file was still consumed as
    // an ingest-time File snapshot. Do not hide that successful read merely
    // because this source has a stronger folder handle than the classic path.
    if (source.readOnlyNotes) {
        row.appendChild(
            buildReadOnlyNotesStatus(sourceId, source.readOnlyNotes, label.id, () =>
                enableLiveNotesSync(source, remember),
            ),
        );
    }
    return row;
}

/** A remembered folder not loaded this session: muted name + a "load" action.
 *  The dot still shows liveness - the user decides whether to click by it. */
function buildUnloadedRow(folder: RememberedFolder, displayLabel: string): HTMLElement {
    const row = document.createElement("li");
    row.className = "folder-source folder-source--unloaded";

    const status = document.createElement("span");
    status.className = "folder-source__status";
    status.setAttribute("aria-hidden", "true");
    row.appendChild(status);
    applyAvailability(row, rememberedAvailability.get(folder.id) ?? null);

    const label = document.createElement("span");
    label.className = "folder-source__label";
    label.id = `folder-source-label-${nextFolderDomId++}`;
    label.textContent = displayLabel;
    label.title = displayLabel;
    row.appendChild(label);

    const load = document.createElement("button");
    load.type = "button";
    load.className = "folder-source__load";
    load.textContent = t("folderSources.load");
    load.title = t("folderSources.loadHint");
    // Same verb on every unloaded row - name the folder it belongs to.
    load.setAttribute("aria-label", t("folderSources.loadAria", { folder: displayLabel }));
    // Clickable in every liveness state on purpose: a re-plugged card revives
    // its stored handle, and the permission re-prompt needs this very gesture.
    load.addEventListener("click", () => rememberedFolderOpener?.(folder));
    row.appendChild(load);

    row.appendChild(
        buildMenuShell((menu, setOpen) => {
            menu.appendChild(
                menuAction(t("recentFolders.forgetLabel"), () => {
                    setOpen(false);
                    forgetFolder(folder.id)
                        .then(() => purgeFolderSessionState(folder.id))
                        .catch((err) => {
                            log.warn("forgetFolder failed", {
                                err: err instanceof Error ? err.message : String(err),
                            });
                        });
                }),
            );
        }, displayLabel),
    );
    const notes = buildInlineNotesStatus();
    row.appendChild(notes);
    loadInlineNotesStatus(notes, folder.id, label.id);
    return row;
}

function buildInlineNotesStatus(): HTMLElement {
    const notes = document.createElement("div");
    notes.className = "folder-source__notes";
    notes.hidden = true;
    return notes;
}

function loadInlineNotesStatus(notes: HTMLElement, folderId: string, folderLabelId: string): void {
    void fillInlineNotesStatus(notes, folderId, folderLabelId);
}

async function fillInlineNotesStatus(notes: HTMLElement, folderId: string, folderLabelId: string): Promise<void> {
    const folder = await getFolder(folderId).catch(() => null);
    if (!folder || !notes.isConnected) return;
    const label = document.createElement("span");
    label.className = "folder-source__notes-label";
    let action: HTMLButtonElement | null = null;
    const backupStatus = notesConnector ? await notesConnector.status(folder) : null;
    if (!notesConnector) {
        label.textContent = t("folderSources.notesBrowserOnly");
        action = notesAction(t("folderSources.notesSettings"), folderLabelId, openNotesSettings);
    } else if (backupStatus === "missing") {
        label.textContent = t(
            notesConnector.browserStorageReady() ? "folderSources.notesBrowserOnly" : "folderSources.notesSessionOnly",
        );
        action = notesAction(t("notesNudge.action"), folderLabelId, async () => {
            if (folder.sidecarHandle) await notesConnector?.useExisting(folder);
            else await notesConnector?.create(folder);
            renderSources();
        });
    } else if (folder.sidecarHandle && (backupStatus === "ready" || backupStatus === "connected")) {
        label.textContent = t(backupStatus === "ready" ? "folderSources.notesFile" : "folderSources.notesConnected", {
            file: folder.sidecarHandle.name,
        });
        label.title = folder.sidecarHandle.name;
    } else {
        notes.classList.add("is-problem");
        label.textContent = t("folderSources.notesProblem");
        action = notesAction(t("sidecar.reconnect"), folderLabelId, async () => {
            await notesConnector?.useExisting(folder);
            renderSources();
        });
    }
    notes.replaceChildren(label, ...(action ? [action] : []));
    notes.hidden = false;
}

function buildReadOnlyNotesStatus(
    sourceId: string,
    status: IngestNotesFileStatus,
    folderLabelId: string,
    liveSourceConnector?: () => void | Promise<void>,
): HTMLElement {
    const notes = buildInlineNotesStatus();
    const label = document.createElement("span");
    label.className = "folder-source__notes-label";
    const safelyLoaded = status.state === "loaded";
    if (!safelyLoaded) notes.classList.add("is-problem");
    label.textContent = t(safelyLoaded ? "folderSources.notesReadOnly" : "folderSources.notesReadOnlyProblem", {
        file: status.fileName,
    });
    label.title = status.fileName;
    const connect =
        safelyLoaded && liveSourceConnector
            ? liveSourceConnector
            : safelyLoaded && readOnlyNotesFolderConnector
              ? () => readOnlyNotesFolderConnector?.(sourceId)
              : null;
    const action = notesAction(
        t(connect ? "folderSources.notesEnableSync" : "folderSources.notesSettings"),
        folderLabelId,
        connect ?? openNotesSettings,
    );
    notes.replaceChildren(label, action);
    notes.hidden = false;
    return notes;
}

function notesAction(label: string, folderLabelId: string, activate: () => void | Promise<void>): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "folder-source__notes-action";
    button.textContent = label;
    button.setAttribute("aria-describedby", folderLabelId);
    button.addEventListener("click", () => {
        button.disabled = true;
        void Promise.resolve(activate()).finally(() => {
            if (button.isConnected) button.disabled = false;
        });
    });
    return button;
}

function openNotesSettings(): void {
    document.getElementById("settings-btn")?.click();
    queueMicrotask(() => {
        const target = document.getElementById("settings-notes-export-btn");
        target?.scrollIntoView({ block: "center" });
        target?.focus({ preventScroll: true });
    });
}

/** Colors a row by liveness: green = readable right now, red = gone
 *  (moved/unplugged), amber = permission lapsed. Mirrors the landing chips so
 *  one dot means one thing across the app. The two problem states also get a
 *  text equivalent on the dot - a colour alone says nothing to a screen reader
 *  (or to anyone who cannot tell the red from the green). */
function applyAvailability(row: HTMLElement, availability: FolderAvailability | null): void {
    row.classList.toggle("is-available", availability === "available");
    row.classList.toggle("is-unavailable", availability === "unavailable");
    row.classList.toggle("is-unknown", availability === "unknown");
    // Own hints, not the landing chips': those promise a retry on click, and
    // this row has nothing to click - it states the situation instead.
    const hint =
        availability === "unavailable"
            ? t("folderSources.unavailableHint")
            : availability === "unknown"
              ? t("folderSources.permissionHint")
              : null;
    if (hint) row.title = hint;
    else row.removeAttribute("title");
    const status = row.querySelector<HTMLElement>(".folder-source__status");
    if (!status) return;
    if (hint) {
        status.setAttribute("role", "img");
        status.setAttribute("aria-label", hint);
        status.removeAttribute("aria-hidden");
    } else {
        status.setAttribute("aria-hidden", "true");
        status.removeAttribute("role");
        status.removeAttribute("aria-label");
    }
}

async function onRemember(source: FolderSource, button: HTMLButtonElement): Promise<void> {
    if (!source.handle) return;
    button.disabled = true;
    try {
        const record = await rememberFolder(source.handle);
        bindSourceToFolder(source.handle, record);
        // Adopts annotations made before this click (they carry folderId "")
        // and merges the notes file if this folder already had one.
        await notifyFolderOpened(record);
        refreshRememberedFolders();
    } catch (err) {
        log.warn("rememberFolder failed", { err: err instanceof Error ? err.message : String(err) });
        button.disabled = false;
        notify({
            severity: "warn",
            messageKey: "folderSources.rememberFailed",
            messageParams: { name: folderDisplayLabel(source.key) },
        });
    }
}

/** Remembers the already-open folder, then asks for the one notes file that
 * should be writable. The directory handle itself remains read-only. */
async function enableLiveNotesSync(source: FolderSource, rememberButton: HTMLButtonElement): Promise<void> {
    if (!source.handle || !notesConnector || typeof window.showOpenFilePicker !== "function") return;
    let picked: Promise<FileSystemFileHandle[]>;
    try {
        // Open before remembering: IndexedDB work would otherwise consume the
        // click activation required by the file picker.
        picked = window.showOpenFilePicker({
            id: "annotations-sidecar",
            startIn: source.handle,
            multiple: false,
            excludeAcceptAllOption: true,
            types: [
                {
                    description: t("sidecar.fileDescription"),
                    accept: { "application/json": [".dashcamigo"] },
                },
            ],
        });
    } catch (err) {
        log.warn("notes file picker failed", { err: err instanceof Error ? err.message : String(err) });
        return;
    }
    let handle: FileSystemFileHandle | undefined;
    try {
        [handle] = await picked;
    } catch (err) {
        if (!(err instanceof DOMException && err.name === "AbortError")) {
            log.warn("notes file picker failed", { err: err instanceof Error ? err.message : String(err) });
        }
        return;
    }
    if (!handle) return;
    await onRemember(source, rememberButton);
    if (!source.folderId) return;
    const folder = await getFolder(source.folderId).catch(() => null);
    if (folder) await notesConnector.connectPicked(folder, handle);
}

/** The per-row overflow menu: the notes file and forgetting. Only remembered
 *  folders have one - an unremembered source has nothing to configure. */
function buildMenu(source: FolderSource, folderLabel: string): HTMLElement {
    return buildMenuShell((menu, setOpen) => fillMenu(menu, source, setOpen), folderLabel);
}

/** The shared ⋯ popup shell: open/close state, outside-click and Escape
 *  teardown. `fill` populates the (already emptied) menu right before it
 *  opens - the contents come from the store and can change between opens. */
function buildMenuShell(
    fill: (menu: HTMLElement, setOpen: (open: boolean) => void) => void | Promise<void>,
    folderLabel: string,
): HTMLElement {
    const wrap = document.createElement("span");
    wrap.className = "folder-source__menu-wrap";

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "folder-source__menu";
    // Every row has one of these; without the folder in the name a screen
    // reader reads the same "Folder actions" over and over.
    toggle.setAttribute("aria-label", t("folderSources.menuAria", { folder: folderLabel }));
    toggle.setAttribute("aria-expanded", "false");
    toggle.title = t("folderSources.menu");
    toggle.appendChild(buildLucideIcon(["M5 12h.01", "M12 12h.01", "M19 12h.01"], 14));

    const menu = document.createElement("ul");
    menu.className = "overflow-menu folder-source__popup";
    menu.setAttribute("role", "menu");
    menu.hidden = true;

    let isOpen = false;
    let outsideClickAttached = false;
    const onDocumentClick = (event: MouseEvent): void => {
        const target = event.target as Node | null;
        if (menu.contains(target) || toggle.contains(target)) return;
        setOpen(false);
    };
    const setOpen = (open: boolean): void => {
        isOpen = open;
        menu.hidden = !open;
        toggle.setAttribute("aria-expanded", String(open));
        if (open && !outsideClickAttached) {
            // queueMicrotask so the click that opened the menu is not the one
            // that closes it.
            queueMicrotask(() => {
                document.addEventListener("click", onDocumentClick);
                outsideClickAttached = true;
            });
            closeOpenMenu = () => setOpen(false);
        } else if (!open) {
            if (outsideClickAttached) {
                document.removeEventListener("click", onDocumentClick);
                outsideClickAttached = false;
            }
            if (closeOpenMenu) closeOpenMenu = null;
        }
    };

    toggle.addEventListener("click", () => {
        if (isOpen) {
            setOpen(false);
            return;
        }
        // Fill first, open after: the notes state comes from the store, and an
        // empty menu flashing before it lands reads as a broken control.
        menu.replaceChildren();
        void Promise.resolve(fill(menu, setOpen)).then(() => setOpen(true));
    });
    // On the wrap, not the menu: after the toggle click the focus is on the
    // toggle, so a listener bound to the menu would never see the key.
    wrap.addEventListener("keydown", (event) => {
        if (event.key !== "Escape" || !isOpen) return;
        setOpen(false);
        toggle.focus();
    });

    wrap.appendChild(toggle);
    wrap.appendChild(menu);
    return wrap;
}

/** Rebuilds the menu contents right before it opens - the notes state lives in
 *  the store and can change from another surface (or another tab). */
async function fillMenu(menu: HTMLElement, source: FolderSource, setOpen: (open: boolean) => void): Promise<void> {
    const folder = await getFolder(source.folderId).catch(() => null);
    const connector = notesConnector;
    if (folder && connector) {
        const status = await connector.status(folder);
        if (folder.sidecarHandle) {
            menu.appendChild(
                menuState(
                    status === "ready"
                        ? t("folderSources.notesConnected", { file: folder.sidecarHandle.name })
                        : t("folderSources.notesNeedsAttention", { file: folder.sidecarHandle.name }),
                    status === "ready",
                ),
            );
            // A persisted handle can become unreadable, point at a replaced
            // file, or lose its grant. Keep a non-destructive recovery path
            // available instead of presenting "Connected" as a dead end.
            menu.appendChild(
                menuAction(t("folderSources.useExistingNotes"), () => {
                    setOpen(false);
                    void connector.useExisting(folder).finally(refreshFolderSources);
                }),
            );
        } else if (status === "missing") {
            // Create first: the common case is a folder that has no notes file
            // yet. Adopting one is for a card that already carries notes from
            // another machine.
            menu.appendChild(
                menuAction(t("folderSources.createNotes"), () => {
                    setOpen(false);
                    void connector.create(folder).finally(refreshFolderSources);
                }),
            );
            menu.appendChild(
                menuAction(t("folderSources.useExistingNotes"), () => {
                    setOpen(false);
                    void connector.useExisting(folder).finally(refreshFolderSources);
                }),
            );
        } else {
            menu.appendChild(menuState(t("folderSources.notesProblem"), false));
            menu.appendChild(
                menuAction(t("folderSources.useExistingNotes"), () => {
                    setOpen(false);
                    void connector.useExisting(folder).finally(refreshFolderSources);
                }),
            );
        }
    }
    menu.appendChild(
        menuAction(t("recentFolders.forgetLabel"), () => {
            setOpen(false);
            void onForget(source);
        }),
    );
}

function menuAction(label: string, onActivate: () => void): HTMLElement {
    const item = document.createElement("li");
    item.className = "overflow-menu-item";
    item.setAttribute("role", "menuitem");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "overflow-menu-btn";
    const text = document.createElement("span");
    text.className = "overflow-menu-label";
    text.textContent = label;
    button.appendChild(text);
    button.addEventListener("click", (event) => {
        event.stopPropagation();
        onActivate();
    });
    item.appendChild(button);
    return item;
}

function menuState(label: string, isReady: boolean): HTMLElement {
    const item = document.createElement("li");
    item.className = "overflow-menu-item folder-source__menu-state";
    // A state line, not a command: presentation role keeps it out of the menu's
    // item count for a screen reader.
    item.setAttribute("role", "presentation");
    const text = document.createElement("span");
    text.className = "overflow-menu-label";
    text.textContent = label;
    item.appendChild(text);
    if (isReady) {
        const check = document.createElement("span");
        check.className = "overflow-menu-check";
        check.textContent = "✓";
        check.setAttribute("aria-hidden", "true");
        item.appendChild(check);
    }
    return item;
}

/**
 * Forgetting an OPEN folder only drops the stored record: the session keeps
 * its file -> folder binding, so annotations made afterwards still resolve
 * (and re-attach if the user remembers the folder again). Cutting the binding
 * here - the way the landing does when nothing of that folder is open - would
 * strand every note taken for the rest of the session.
 */
async function onForget(source: FolderSource): Promise<void> {
    const folderId = source.folderId;
    if (!folderId) return;
    try {
        await forgetFolder(folderId);
    } catch (err) {
        log.warn("forgetFolder failed", { err: err instanceof Error ? err.message : String(err) });
        return;
    }
    source.folderId = "";
    refreshRememberedFolders();
}
