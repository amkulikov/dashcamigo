// Tracks the newest changelog entry the user has opened the "What's new"
// panel on. localStorage, not the persist DB - same rationale as
// cache-limit.ts: a tiny synchronous pref that must stay readable when
// IndexedDB is unavailable. The value is an entry id ("<yyyy-mm-dd>.<n>"),
// not a build/release version: builds carry a git SHA (src/version.ts), and
// entry ids order changes the same way on beta and production.

import { compareChangelogIds } from "../changelog/id.js";
import { LATEST_CHANGELOG_ID } from "../changelog/latest.js";

const STORAGE_KEY = "dashcamigo:changelog:lastSeenId";

/**
 * Whether entries newer than the last acknowledged one exist - drives the
 * topbar badge. First visit (nothing stored) stamps the current latest and
 * reports false: a new user has no "before" to catch up on, greeting them
 * with a lit badge would be noise. With localStorage unavailable (private
 * mode) reports false - never nag when we cannot remember the acknowledgment.
 */
export function initChangelogSeen(): boolean {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored === null) {
            localStorage.setItem(STORAGE_KEY, LATEST_CHANGELOG_ID);
            return false;
        }
        return compareChangelogIds(LATEST_CHANGELOG_ID, stored) > 0;
    } catch {
        return false;
    }
}

/** Acknowledges everything up to the current latest entry. Called when the
 *  user opens the "What's new" panel. */
export function markChangelogSeen(): void {
    try {
        localStorage.setItem(STORAGE_KEY, LATEST_CHANGELOG_ID);
    } catch {
        // Private mode - the badge stays off this session (initChangelogSeen
        // reports false without storage), nothing to do.
    }
}
