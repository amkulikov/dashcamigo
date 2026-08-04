// Pre-ingest path filter: drops files that live in hidden or OS/filesystem
// junk directories before they reach classify/index/dedup. Runs at the single
// ingest chokepoint (ui/ingest.ts), so junk never costs an SD seek. The FSA
// and drag-and-drop walkers additionally prune the same names during
// enumeration (via isIgnoredSegment) - OS metadata directories like
// .Spotlight-V100 are unreadable and would otherwise surface as read-error
// warnings for a perfectly healthy card.
//
// Vendor-neutral by design - there is no per-camera branch here. The two rules
// below cover every known case we have seen, including 70mai `.s_Front` /
// `.s_Back` (low-res display/app-search proxies that share a basename with the
// full-res clip in `Normal/Front` - ingesting both collides on basename and
// pollutes the trip list with duplicate low-quality channels).

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
 * Whether a file at `relativePath` should be skipped at ingest. True if ANY
 * path segment is hidden or junk - a file nested under `.s_Front/clip.mp4` or
 * `System Volume Information/...` is dropped regardless of the leaf name.
 *
 * Accepts both "/" (DnD fullPath) and "\\" (some Windows webkitRelativePath)
 * separators. An empty path is never ignored (treated as a bare filename).
 */
export function isIgnoredPath(relativePath: string): boolean {
    if (!relativePath) return false;
    const segments = relativePath.split(/[/\\]/);
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
