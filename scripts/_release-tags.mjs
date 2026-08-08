// Release-tag helpers shared by generate-release-notes.mjs and
// check-release-changelog.mjs. Kept free of TypeScript imports on purpose:
// the changelog guard runs on the CI runner's stock Node, which is not
// guaranteed to strip types.

import { execFileSync } from "node:child_process";

export const ENTRIES_PATH = "src/changelog/entries.ts";

// Matches the id line of a ChangelogEntry (`id: "<yyyy-mm-dd>.<n>",`). The id
// format contract lives in src/changelog/id.ts; entries.test.ts pins this
// regex to the real file so a formatting change fails in CI, not at release
// time.
export const ENTRY_ID_LINE_RE = /(?<=^\s*id: ")\d{4}-\d{2}-\d{2}\.\d+(?=",$)/gm;

// Git's own stderr is suppressed: expected failures (a path absent at an old
// tag) are handled by callers, and a leaked "fatal:" line reads like a broken
// run in the CI log.
export function git(...args) {
    return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
}

// Only tags following the release convention participate in "previous
// release" ordering - anything else a clone may carry is ignored.
const RELEASE_TAG_RE = /^v\d{4}\.\d{2}\.\d{2}(\.\d+)?$/;

/**
 * Chronological order for two convention tags: segment-wise numeric compare.
 * The date segments are zero-padded but the `.<n>` suffix is not, so plain
 * string order would misplace "….10" below "….2" - the same trap
 * compareChangelogIds in src/changelog/id.ts documents for entry ids. A tag
 * without the suffix sorts before ".1" of the same date.
 */
export function compareReleaseTags(a, b) {
    const aSegments = a.slice(1).split(".").map(Number);
    const bSegments = b.slice(1).split(".").map(Number);
    for (let i = 0; i < Math.max(aSegments.length, bSegments.length); i++) {
        const aValue = aSegments[i] ?? -1;
        const bValue = bSegments[i] ?? -1;
        if (aValue !== bValue) return aValue - bValue;
    }
    return 0;
}

/**
 * The release preceding `tag`: the highest convention v* tag ordering below
 * it, or undefined for the first release. "Below current" (not "second
 * newest") keeps the answer correct even when newer tags exist in the clone.
 */
export function previousReleaseTag(tag) {
    return git("tag", "--list", "v*")
        .split("\n")
        .filter((t) => RELEASE_TAG_RE.test(t) && compareReleaseTags(t, tag) < 0)
        .sort(compareReleaseTags)
        .at(-1);
}

/**
 * Entry ids in entries.ts at a git revision, or null when the file does not
 * exist there (the revision predates the changelog). A revision that has the
 * file but matches no ids throws: the extraction regex drifted from the file
 * format, and silently returning nothing would republish the whole history
 * as new.
 */
export function entryIdsAt(rev) {
    let source;
    try {
        source = git("show", `${rev}:${ENTRIES_PATH}`);
    } catch {
        return null;
    }
    const ids = source.match(ENTRY_ID_LINE_RE);
    if (!ids) {
        throw new Error(`no entry ids matched in ${ENTRIES_PATH} at ${rev} - id extraction drifted from the file format`);
    }
    return ids;
}
