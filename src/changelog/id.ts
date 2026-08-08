// Changelog entry ids. An id is "<yyyy-mm-dd>.<n>": the release-facing date
// plus a sequence number that orders entries within one day. The format is
// load-bearing beyond the app: scripts/_release-tags.mjs extracts ids from old
// revisions of entries.ts with this exact pattern (ENTRY_ID_LINE_RE);
// entries.test.ts pins that regex to the real file so drift fails in CI.
//
// Kept free of runtime imports: this module rides in the entry bundle (the
// topbar badge needs it at startup), while the entry texts stay behind a lazy
// chunk (see entries.ts).

export const CHANGELOG_ID_PATTERN = /^\d{4}-\d{2}-\d{2}\.\d+$/;

/**
 * Orders two entry ids chronologically: negative when `a` is older than `b`,
 * positive when newer, 0 when equal. The date parts compare lexicographically
 * (ISO dates sort as strings); the sequence parts compare numerically -
 * "…08.10" is newer than "…08.2", which a plain string compare gets wrong.
 * An id that does not match CHANGELOG_ID_PATTERN sorts as oldest, so a
 * corrupted stored value never suppresses the "new" badge forever.
 */
export function compareChangelogIds(a: string, b: string): number {
    const aOk = CHANGELOG_ID_PATTERN.test(a);
    const bOk = CHANGELOG_ID_PATTERN.test(b);
    if (!aOk || !bOk) return (aOk ? 1 : 0) - (bOk ? 1 : 0);
    // Pattern-validated ids always split into exactly date + sequence.
    const aParts = a.split(".");
    const bParts = b.split(".");
    if (aParts[0] !== bParts[0]) return aParts[0]! < bParts[0]! ? -1 : 1;
    return Number(aParts[1]!) - Number(bParts[1]!);
}

/** The "yyyy-mm-dd" date part of an entry id (assumes a pattern-valid id). */
export function changelogIdDate(id: string): string {
    // split() yields at least one element even for "", so [0] is in-bounds.
    return id.split(".", 1)[0]!;
}
