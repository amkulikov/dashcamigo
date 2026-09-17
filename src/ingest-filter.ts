// Pre-ingest path filter: drops hidden/system files and known low-resolution
// previews before they reach classify/index/dedup. Runs at the single
// ingest chokepoint (ui/ingest.ts), so junk never costs an SD seek. The FSA
// and drag-and-drop walkers additionally prune the same names during
// enumeration (via isIgnoredSegment) - OS metadata directories like
// .Spotlight-V100 are unreadable and would otherwise surface as read-error
// warnings for a perfectly healthy card.
//
// Hidden directories cover 70mai `.s_Front` / `.s_Back` previews. DDPai Z60
// writes its low-resolution previews to a visible `small/` directory instead.

const RX_SMALL_PREVIEW_PATH = /(?:^|\/)small\/\d{14}_\d{2,7}_S\.mp4$/i;

// Exact-match (case-insensitive) directory names that are OS/filesystem junk
// but not dot-prefixed, so the hidden-segment rule below would miss them.
const JUNK_DIR_NAMES = new Set<string>([
    "system volume information", // Windows
    "$recycle.bin", // Windows recycle bin
    "recycler", // Windows (pre-Vista) recycle bin
    "lost.dir", // Android FAT recovery
]);

// Windows chkdsk recovery folders: FOUND.000, FOUND.001, ...
const FOUND_DIR_RE = /^found\.\d{3}$/;

/**
 * Whether a single path segment is a hidden or junk directory/file name.
 * Hidden = starts with ".", which on every dashcam SD we have seen means
 * proxy/thumbnail/system content, never a primary recording.
 */
export function isIgnoredSegment(segment: string): boolean {
    if (segment.startsWith(".")) return true;
    const lower = segment.toLowerCase();
    if (JUNK_DIR_NAMES.has(lower)) return true;
    if (FOUND_DIR_RE.test(lower)) return true;
    return false;
}

/**
 * Whether a file at `relativePath` should be skipped at ingest. Hidden/junk
 * segments and known preview paths are ignored.
 *
 * Accepts both "/" (DnD fullPath) and "\\" (some Windows webkitRelativePath)
 * separators. An empty path is never ignored (treated as a bare filename).
 */
export function isIgnoredPath(relativePath: string): boolean {
    if (!relativePath) return false;
    const normalizedPath = relativePath.replaceAll("\\", "/");
    if (RX_SMALL_PREVIEW_PATH.test(normalizedPath)) return true;
    const segments = normalizedPath.split("/");
    for (const segment of segments) {
        if (segment.length === 0) continue; // leading slash, double slash
        if (isIgnoredSegment(segment)) return true;
    }
    return false;
}

/**
 * Distinct top-level (root) segments across `relativePaths` that the filter
 * classifies as junk. Diagnostic-only: used when the filter emptied the whole
 * selection, to name the folder the user actually picked (a ".backup" copy, a
 * chkdsk "FOUND.000") in a bug-report log line instead of a generic "nothing
 * loaded". A clean root with junk deeper in the tree contributes nothing - the
 * root is what the user chose, so it is the useful signal here.
 */
export function ignoredRootSegments(relativePaths: string[]): string[] {
    const roots = new Set<string>();
    for (const relativePath of relativePaths) {
        if (!relativePath) continue;
        const root = relativePath.split(/[/\\]/).find((segment) => segment.length > 0);
        if (root && isIgnoredSegment(root)) roots.add(root);
    }
    return [...roots];
}
