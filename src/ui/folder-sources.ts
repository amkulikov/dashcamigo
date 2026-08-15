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
// A source is keyed by its root folder name, which is all any picker path
// exposes (the FSA handle has no path). Two cards named DCIM in one session
// therefore collapse into one row - the same aliasing the file-identity keys
// already have, so the row does not lie any more than the cache does.

import { t } from "../i18n/index.js";
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
}

// Insertion-ordered: the first folder the user opened stays first, so the row
// under the CTA does not reshuffle as more cards are added.
const sourcesByKey = new Map<string, FolderSource>();

// File identity key -> RememberedFolder.id, for every file that came out of a
// remembered folder this session. Annotations resolve their folderId through
// this. Far tighter than keying on the root folder NAME (which collides the
// moment two SD cards share one on-disk name), though not absolute: a
// byte-for-byte backup of a folder under the same leaf name yields identical
// keys (size and mtime survive copying), and the handle exposes no path to
// tell the two apart - last opened wins there.
const folderIdByFileKey = new Map<string, string>();

/** RememberedFolder.id that produced the file with this identity key, or ""
 *  when the file did not come out of a remembered folder (ad-hoc drop /
 *  never remembered). */
export function folderIdForFileKey(identityKey: string): string {
    return folderIdByFileKey.get(identityKey) ?? "";
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
    rememberedCache = [];
    rememberedAvailability.clear();
}

// The sidecar layer merges its file after a folder opens or is remembered. A
// registered hook, not an import - the sidecar module reads annotations, which
// resolve their folder id through this module.
let folderOpenedHook: ((folder: RememberedFolder) => void) | null = null;

/** Registers the after-open hook for remembered folders. */
export function registerFolderOpenedHook(callback: (folder: RememberedFolder) => void): void {
    folderOpenedHook = callback;
}

/** Notifies the sidecar layer that a folder is now open/remembered. */
export function notifyFolderOpened(folder: RememberedFolder): void {
    folderOpenedHook?.(folder);
}

/** The two ways to attach a notes file. They are separate because the pickers
 *  behave differently on an existing file - see annotations-sidecar. */
export interface NotesConnector {
    create(folder: RememberedFolder): void;
    useExisting(folder: RememberedFolder): void;
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
    return live.find((source) => source.identityKeys.has(identityKey)) ?? null;
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
        notifyFolderOpened(record);
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

/**
 * Records the folders an ingested batch came from and binds its files to the
 * remembered folder when the batch came from one. Called for every drop
 * (picker, classic input, drag-and-drop) after the junk filter, so the row
 * appears together with the trips it explains.
 */
export function registerIngestSource(files: VendorFile[], origin: IngestOrigin | null): void {
    const keysByRoot = new Map<string, string[]>();
    if (origin) {
        // A picker batch has exactly one root by construction - the picked
        // handle - so the whole batch lands on its row. Grouping by the paths'
        // first segment instead would shatter it when the handle's name is a
        // bare separator (a Windows drive root is named "\", which the path
        // split swallows, leaving the subfolders posing as roots). An empty
        // batch still names the folder: opening an already-loaded card dedups
        // every file away, and the row must still gain its handle (and with
        // it the offer to remember).
        keysByRoot.set(
            origin.handle.name,
            files.map((vendorFile) => fileIdentityKey(fileIdentityOf(vendorFile.file, vendorFile.relativePath))),
        );
    } else {
        // Handle-less paths (classic input, drag-and-drop): the leading path
        // segment is all there is to group by.
        for (const vendorFile of files) {
            const root = rootNameOf(vendorFile.relativePath);
            const identityKey = fileIdentityKey(fileIdentityOf(vendorFile.file, vendorFile.relativePath));
            const bucket = keysByRoot.get(root);
            if (bucket) bucket.push(identityKey);
            else keysByRoot.set(root, [identityKey]);
        }
    }
    if (keysByRoot.size === 0) return;
    for (const [root, identityKeys] of keysByRoot) {
        const source = sourcesByKey.get(root) ?? {
            key: root,
            handle: null,
            folderId: "",
            availability: null,
            identityKeys: new Set<string>(),
        };
        for (const identityKey of identityKeys) source.identityKeys.add(identityKey);
        if (origin) {
            source.handle = origin.handle;
            source.availability = "available";
            // Bind the source's WHOLE key set, not just this batch: files the
            // dedup dropped (or a drag-and-drop of the same folder earlier in
            // the session) belong to this folder too, and their annotations
            // must resolve to it.
            if (origin.folderId) bindKeys(source, origin.folderId);
        }
        sourcesByKey.set(root, source);
    }
    renderSources();
}

/**
 * Binds an already-remembered folder to the session source that came from it -
 * the picker path learns the folder is remembered only after the ingest, and a
 * "remember" click creates the record even later.
 */
export function bindSourceToFolder(handle: FileSystemDirectoryHandle, folder: RememberedFolder): void {
    const source = sourcesByKey.get(handle.name);
    if (!source) return;
    source.handle = handle;
    source.availability = "available";
    bindKeys(source, folder.id);
    renderSources();
}

/** Marks every file of a source as belonging to a remembered folder - the
 *  lookup annotations go through. */
function bindKeys(source: FolderSource, folderId: string): void {
    source.folderId = folderId;
    for (const identityKey of source.identityKeys) folderIdByFileKey.set(identityKey, folderId);
}

let listElement: HTMLElement | null = null;

/** Wires the SOURCES list under the sidebar CTA. Call once from app.ts. */
export function initFolderSources(): void {
    listElement = document.getElementById("folder-sources");
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
            // The source map is keyed by root name and never re-created, but a
            // slow probe can still land after its handle was replaced by a
            // fresher open of the same name - ignore it then. An unchanged
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
    for (const source of sourcesByKey.values()) listElement.appendChild(buildRow(source));
    // Remembered-but-not-loaded folders come after the session sources: what
    // is on screen explains itself first, what can be added follows.
    const labels = disambiguatedLabels(rememberedCache);
    for (const folder of unloaded) {
        listElement.appendChild(buildUnloadedRow(folder, labels.get(folder.id) ?? folderDisplayLabel(folder.label)));
    }
}

function buildRow(source: FolderSource): HTMLElement {
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
    const displayLabel = folderDisplayLabel(source.key) || t("folderSources.looseFiles");
    const label = document.createElement("span");
    label.className = "folder-source__label";
    label.textContent = displayLabel;
    label.title = displayLabel;
    row.appendChild(label);

    // Nothing to offer without a handle: the classic input and drag-and-drop
    // hand over files, not a folder that can be reopened. The row stays as the
    // answer to "where is this from".
    if (!source.handle) return row;

    if (source.folderId) {
        const badge = document.createElement("span");
        badge.className = "folder-source__state";
        badge.textContent = t("folderSources.remembered");
        badge.title = t("folderSources.rememberedHint");
        row.appendChild(badge);
        row.appendChild(buildMenu(source, displayLabel));
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
    return row;
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
        notifyFolderOpened(record);
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
        if (folder.sidecarHandle) {
            menu.appendChild(menuState(t("folderSources.notesConnected")));
        } else {
            // Create first: the common case is a folder that has no notes file
            // yet. Adopting one is for a card that already carries notes from
            // another machine.
            menu.appendChild(
                menuAction(t("folderSources.createNotes"), () => {
                    setOpen(false);
                    connector.create(folder);
                }),
            );
            menu.appendChild(
                menuAction(t("folderSources.useExistingNotes"), () => {
                    setOpen(false);
                    connector.useExisting(folder);
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

function menuState(label: string): HTMLElement {
    const item = document.createElement("li");
    item.className = "overflow-menu-item folder-source__menu-state";
    // A state line, not a command: presentation role keeps it out of the menu's
    // item count for a screen reader.
    item.setAttribute("role", "presentation");
    const text = document.createElement("span");
    text.className = "overflow-menu-label";
    text.textContent = label;
    const check = document.createElement("span");
    check.className = "overflow-menu-check";
    check.textContent = "✓";
    check.setAttribute("aria-hidden", "true");
    item.appendChild(text);
    item.appendChild(check);
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
