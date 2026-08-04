// File sources: <input webkitdirectory> in the header + full-page DnD
// (with recursive folder traversal via FileSystemEntry API). Both paths
// converge into ingestFiles(VendorFile[]).

import { isIgnoredSegment } from "../ingest-filter.js";
import { createLogger } from "../log.js";
import type { VendorFile } from "../parsers/types.js";

import { dom } from "./dom.js";
import { beginPreIngestReading, endPreIngestReading } from "./ingest-overlay.js";
import { ingestFiles } from "./ingest.js";
import { toVendorFiles } from "./ingest-core.js";
import { notify } from "./notifications.js";
import { canUseDirectoryPicker, openViaDirectoryPicker } from "./persistent-folders.js";
import { shouldShowUploadWarning, showUploadWarning } from "./upload-warning-modal.js";

const log = createLogger("file-sources");

/** Result of collecting dragged files: what we could read, plus how many
 *  entries failed (rejected file()/readEntries()) so the caller can warn. */
interface CollectResult {
    files: VendorFile[];
    readErrors: number;
}

/**
 * Whether a DataTransfer contains files (not text/url/anything else). Used to
 * avoid showing the overlay when dragging text or internal page elements
 * (e.g. the sidebar resize handle).
 */
function dragHasFiles(dt: DataTransfer | null): boolean {
    // Per DOM Living Standard, DataTransfer.types is ReadonlyArray<string>
    // with native .includes. All targeted browsers (current major versions)
    // comply with this contract.
    return !!dt && dt.types?.includes("Files");
}

// Pending show-side rAF. hideDropOverlay cancels it: dragenter->dragleave
// within one frame otherwise runs hide BEFORE the rAF adds .visible, the
// 160ms check then sees the class and skips hidden=true - leaving a
// pointer-events:auto full-screen overlay stuck over the app.
let dropOverlayShowRaf = 0;

function showDropOverlay(): void {
    if (!dom.dropOverlay) return;
    dom.dropOverlay.hidden = false;
    // requestAnimationFrame so the browser applies hidden=false before adding
    // the class - otherwise the transition does not trigger (transitions from
    // display:none are not triggered in the browser layout pipeline).
    if (dropOverlayShowRaf) cancelAnimationFrame(dropOverlayShowRaf);
    dropOverlayShowRaf = requestAnimationFrame(() => {
        dropOverlayShowRaf = 0;
        dom.dropOverlay.classList.add("visible");
    });
}

function hideDropOverlay(): void {
    if (!dom.dropOverlay) return;
    if (dropOverlayShowRaf) {
        cancelAnimationFrame(dropOverlayShowRaf);
        dropOverlayShowRaf = 0;
    }
    dom.dropOverlay.classList.remove("visible");
    // Hide after the opacity transition ends to avoid an abrupt cut.
    // 160ms is slightly longer than the 120ms CSS transition.
    setTimeout(() => {
        if (!dom.dropOverlay.classList.contains("visible")) {
            dom.dropOverlay.hidden = true;
        }
    }, 160);
}

/**
 * Extracts all files from a DataTransfer, recursively traversing dragged
 * folders via the File and Directory Entries API. Also collects relativePath
 * from FileSystemEntry.fullPath so plugins can inspect the directory structure
 * (important for multi-channel cameras and vendors that place logs in
 * subdirectories).
 *
 * When the user dragged individual files (not a folder), dt.items yields a flat
 * list with fullPath = "/<filename>". Strip the leading slash so relativePath
 * is "<filename>", matching the webkitRelativePath format from <input>.
 */
async function collectFilesFromDataTransfer(dt: DataTransfer | null): Promise<CollectResult> {
    if (!dt) return { files: [], readErrors: 0 };
    const entries: FileSystemEntry[] = [];
    if (dt.items && dt.items.length > 0 && typeof dt.items[0]!.webkitGetAsEntry === "function") {
        for (let i = 0; i < dt.items.length; i++) {
            const e = dt.items[i]!.webkitGetAsEntry?.();
            if (e) entries.push(e);
        }
    }
    if (entries.length === 0) {
        return { files: toVendorFiles(Array.from(dt.files || [])), readErrors: 0 };
    }
    const out: VendorFile[] = [];
    const errors = { count: 0 };
    for (const entry of entries) {
        await walkEntry(entry, out, errors);
    }
    return { files: out, readErrors: errors.count };
}

// Recursively collects files into `out`. Per-entry failures (a file removed
// from the SD card mid-read, a revoked permission, an IO error on a slow card)
// are caught, counted in `errors`, and skipped rather than rejecting the whole
// traversal - one unreadable file must not silently abort the entire drop (the
// overlay is already gone, so the user would see nothing happen at all).
async function walkEntry(entry: FileSystemEntry, out: VendorFile[], errors: { count: number }): Promise<void> {
    if (entry.isFile) {
        const fileEntry = entry as FileSystemFileEntry;
        let f: File;
        try {
            f = await new Promise<File>((res, rej) => fileEntry.file(res, rej));
        } catch (err) {
            errors.count++;
            log.warn("dnd: failed to read file entry", { name: entry.name, err: String(err) });
            return;
        }
        // FileSystemEntry.fullPath starts with "/" - strip it to get a path
        // relative to the dnd session root. Outside dnd we use
        // webkitRelativePath, which has no leading slash.
        const path = entry.fullPath.startsWith("/") ? entry.fullPath.slice(1) : entry.fullPath;
        out.push({ file: f, relativePath: path || f.name });
        return;
    }
    if (entry.isDirectory) {
        const dirEntry = entry as FileSystemDirectoryEntry;
        const reader = dirEntry.createReader();
        while (true) {
            let batch: FileSystemEntry[];
            try {
                batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
            } catch (err) {
                errors.count++;
                log.warn("dnd: failed to read directory entries", { name: entry.name, err: String(err) });
                break;
            }
            if (batch.length === 0) break;
            for (const child of batch) {
                // Same pruning as the FSA walker (persist/folders.ts): OS
                // metadata directories deny reads and would count as read
                // errors. Only children are pruned - an explicitly dropped
                // junk folder still walks, so the chokepoint's junk-root
                // diagnostic can name it.
                if (isIgnoredSegment(child.name)) continue;
                await walkEntry(child, out, errors);
            }
        }
    }
}

export function initFileSources(): void {
    dom.folderInput.addEventListener("change", () => {
        const files = Array.from(dom.folderInput.files || []);
        if (files.length > 0) {
            // ingestFiles takes over the pre-ingest overlay (showIngestOverlay).
        } else {
            // Empty selection (an empty folder, or some browsers' "open" with
            // nothing chosen). ingestFiles([]) only warns and returns, so it
            // will not hide the pre-ingest overlay we raised on click - retract
            // it here.
            endPreIngestReading();
        }
        ingestFiles(toVendorFiles(files));
        dom.folderInput.value = "";
    });

    // The OS file picker was dismissed without choosing anything - retract the
    // pre-ingest overlay raised in openFolderPicker(). This is the seamless
    // auto-retract on browsers that fire the input "cancel" event (Chrome 113+,
    // Firefox 109+, Safari 16.4+). Chrome/Edge 94-112 are within our support
    // floor (Chrome 94, docs/browser-support.md) and do NOT fire it; there the
    // overlay's own Cancel button (kept enabled during the pre-ingest phase) is
    // the manual escape, so a missed cancel is never a reload-only dead end.
    dom.folderInput.addEventListener("cancel", () => endPreIngestReading());

    // Drag-and-drop works across the whole window. CTA wrappers (landing-drop
    // and sidebar-cta) are label[for="folder-input"] elements. The landing
    // drop card contains an inner <button id="landing-cta"> as the primary
    // visual CTA - <button> is a labelable element, so HTML spec skips the
    // label's "synthesize click on the labeled control" default action when
    // the click target is the button. That means clicking the orange button
    // would do nothing if we relied on native label semantics. We bypass that
    // by always preventDefault + always calling folderInput.click() ourselves.
    //
    // Before the picker opens, the upload-warning modal (once per 30 days, see
    // upload-warning-modal.ts) shows so the user is not greeted by the scary
    // "Upload N files to this site?" prompt without context. uploadWarningInFlight
    // guards a double-click while the async modal renders.
    // Raises the pre-ingest overlay, THEN opens the OS folder picker. The
    // overlay goes up before .click() on purpose: once the picker is open the
    // page yields control, and after the user picks a folder the browser
    // enumerates the whole tree before firing change - a window that runs no JS
    // and can take seconds on a slow card. Showing the overlay first means the
    // page is never blank across that window. Retracted by the change handler
    // (a selection) or the cancel event (a dismissal).
    const openFolderPicker = (): void => {
        // On Chromium the FSA directory picker yields a persistable handle
        // (remember + zero-click restore, see persistent-folders.ts); the
        // classic input stays everywhere else AND as the in-flight fallback.
        if (canUseDirectoryPicker()) {
            void openViaDirectoryPicker();
            return;
        }
        beginPreIngestReading();
        dom.folderInput.click();
    };

    let uploadWarningInFlight = false;
    for (const cta of [dom.landingDrop, dom.landingDock, dom.sidebarCta]) {
        if (!cta) continue;
        cta.addEventListener("click", async (e) => {
            // Stop both native label-for-activation (when target is a passive
            // descendant) and any default button activation. We open the picker
            // explicitly below.
            e.preventDefault();
            if (!shouldShowUploadWarning()) {
                openFolderPicker();
                return;
            }
            if (uploadWarningInFlight) return;
            uploadWarningInFlight = true;
            try {
                const continued = await showUploadWarning();
                if (continued) openFolderPicker();
            } finally {
                uploadWarningInFlight = false;
            }
        });
    }

    // The static HTML ships #landing-cta as .is-pending (a loading spinner) so a
    // slow-network reveal of the landing - before this bundle hydrates - reads as
    // "loading" rather than a dead button (the click handler bound above is what
    // makes the CTA work). Now that it is bound, drop the loading state.
    dom.landingCta?.classList.remove("is-pending");
    dom.landingCta?.removeAttribute("aria-busy");

    // Counter of active dragenter events without a matching dragleave. Without
    // it the overlay flickers as the cursor moves over child elements - dragleave
    // fires on every nested element boundary. Only the outermost enter/leave at
    // the window boundary behaves correctly.
    let dragDepth = 0;

    window.addEventListener("dragenter", (e) => {
        if (!dragHasFiles(e.dataTransfer)) return;
        e.preventDefault();
        dragDepth++;
        if (dragDepth === 1) showDropOverlay();
    });

    window.addEventListener("dragover", (e) => {
        if (!dragHasFiles(e.dataTransfer)) return;
        // preventDefault is required - without it drop does not fire (the browser
        // navigates to the file by default, as if opening it).
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    });

    window.addEventListener("dragleave", (e) => {
        if (!dragHasFiles(e.dataTransfer)) return;
        dragDepth = Math.max(0, dragDepth - 1);
        if (dragDepth === 0) hideDropOverlay();
    });

    window.addEventListener("drop", async (e) => {
        if (!dragHasFiles(e.dataTransfer)) return;
        e.preventDefault();
        dragDepth = 0;
        hideDropOverlay();

        // Raise the overlay BEFORE walking the dropped tree:
        // collectFilesFromDataTransfer recurses the directory (readEntries +
        // file() per entry) and can take seconds on a large card, during which
        // the drop overlay is already gone and the real ingest has not started.
        // No-op when an ingest is already running (the second drop queues and
        // that overlay stays - see beginPreIngestReading).
        beginPreIngestReading();

        let files: VendorFile[];
        let readErrors: number;
        try {
            ({ files, readErrors } = await collectFilesFromDataTransfer(e.dataTransfer));
        } catch (err) {
            // Defensive net: walkEntry swallows per-entry errors, so this only
            // fires on an unexpected failure of the whole traversal. Without it
            // a rejected promise would silently drop the gesture.
            endPreIngestReading();
            log.error("dnd: file collection failed", err);
            notify({ severity: "error", messageKey: "status.dropReadFailed" });
            return;
        }

        if (files.length === 0) {
            // Nothing to ingest: retract the overlay (ingestFiles([]) only warns
            // and returns, so it would not hide it for us).
            endPreIngestReading();
            // Read errors with nothing salvaged: tell the user the read failed.
            // Otherwise fall through to ingestFiles([]), which shows the normal
            // "no files selected" toast.
            if (readErrors > 0) {
                notify({ severity: "error", messageKey: "status.dropReadFailed" });
                return;
            }
            ingestFiles(files);
            return;
        }

        // Partial success: ingest what we read, but flag the skipped files.
        if (readErrors > 0) notify({ severity: "warn", messageKey: "status.dropReadFailed" });
        ingestFiles(files);
    });

    // Keyboard activation for label-based CTAs. sidebarCta is a focusable
    // label[for=folder-input]; without explicit handling, Space/Enter on the
    // focused label do nothing - the native form-control activation runs only
    // on click. We delegate to cta.click() so the click handler with the
    // upload-warning gate fires once. landingDrop has no tabindex - its inner
    // <button id="landing-cta"> handles Enter/Space natively (browser fires a
    // click on the button, which bubbles to the label's click listener).
    if (dom.sidebarCta) {
        const cta = dom.sidebarCta;
        cta.addEventListener("keydown", (e) => {
            if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                cta.click();
            }
        });
    }
}
