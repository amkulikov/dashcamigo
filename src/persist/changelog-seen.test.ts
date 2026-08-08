import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LATEST_CHANGELOG_ID } from "../changelog/latest.js";
import { initChangelogSeen, markChangelogSeen } from "./changelog-seen.js";

const STORAGE_KEY = "dashcamigo:changelog:lastSeenId";

// Minimal localStorage stand-in: the node test environment has none, and the
// pref must be exercised through the same get/set surface the browser offers.
function stubStorage(): Map<string, string> {
    const backing = new Map<string, string>();
    vi.stubGlobal("localStorage", {
        getItem: (key: string) => backing.get(key) ?? null,
        setItem: (key: string, value: string) => backing.set(key, value),
    });
    return backing;
}

describe("changelog seen pref", () => {
    let backing: Map<string, string>;

    beforeEach(() => {
        backing = stubStorage();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("stamps the latest id and stays quiet on first visit", () => {
        expect(initChangelogSeen()).toBe(false);
        expect(backing.get(STORAGE_KEY)).toBe(LATEST_CHANGELOG_ID);
    });

    it("reports unseen entries when the stored id is older than the latest", () => {
        backing.set(STORAGE_KEY, "2020-01-01.1");
        expect(initChangelogSeen()).toBe(true);
    });

    it("reports nothing unseen when the stored id equals the latest", () => {
        backing.set(STORAGE_KEY, LATEST_CHANGELOG_ID);
        expect(initChangelogSeen()).toBe(false);
    });

    it("treats a corrupt stored id as older, so the badge lights up", () => {
        backing.set(STORAGE_KEY, "not-an-id");
        expect(initChangelogSeen()).toBe(true);
    });

    it("acknowledges up to the latest on markChangelogSeen", () => {
        backing.set(STORAGE_KEY, "2020-01-01.1");
        markChangelogSeen();
        expect(backing.get(STORAGE_KEY)).toBe(LATEST_CHANGELOG_ID);
        expect(initChangelogSeen()).toBe(false);
    });

    it("stays quiet when localStorage is unavailable", () => {
        vi.stubGlobal("localStorage", {
            getItem: () => {
                throw new Error("denied");
            },
            setItem: () => {
                throw new Error("denied");
            },
        });
        expect(initChangelogSeen()).toBe(false);
        markChangelogSeen();
    });
});
