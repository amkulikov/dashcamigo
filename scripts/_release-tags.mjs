// Release-tag helpers shared by generate-release-notes.mjs and
// check-release-changelog.mjs. Kept free of TypeScript imports on purpose:
// the changelog guard runs on the CI runner's stock Node, which is not
// guaranteed to strip types.

import { execFileSync } from "node:child_process";
import { compareReleaseTags, isReleaseTag } from "../src/portable/release-tags.mjs";

export { compareReleaseTags } from "../src/portable/release-tags.mjs";

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

/**
 * The release preceding `tag`: the highest convention v* tag ordering below
 * it, or undefined for the first release. "Below current" (not "second
 * newest") keeps the answer correct even when newer tags exist in the clone.
 */
export function previousReleaseTag(tag) {
    return git("tag", "--list", "v*")
        .split("\n")
        .filter((t) => isReleaseTag(t) && compareReleaseTags(t, tag) < 0)
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
        throw new Error(
            `no entry ids matched in ${ENTRIES_PATH} at ${rev} - id extraction drifted from the file format`,
        );
    }
    return ids;
}
