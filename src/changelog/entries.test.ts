import { describe, expect, it } from "vitest";

import { LANGS } from "../i18n/index.js";
import { CHANGELOG_ENTRIES } from "./entries.js";
import { CHANGELOG_ID_PATTERN, changelogIdDate, compareChangelogIds } from "./id.js";
import { LATEST_CHANGELOG_ID } from "./latest.js";

describe("changelog entries", () => {
    it("keeps every id in the <yyyy-mm-dd>.<n> format with a real date", () => {
        for (const entry of CHANGELOG_ENTRIES) {
            expect(entry.id, `id ${entry.id}`).toMatch(CHANGELOG_ID_PATTERN);
            const date = changelogIdDate(entry.id);
            // A round-trip through Date catches "2026-13-40": the parsed value
            // would re-serialize to a different ISO date (or NaN).
            const parsed = new Date(`${date}T00:00:00Z`);
            expect(parsed.toISOString().slice(0, 10), `date of ${entry.id}`).toBe(date);
        }
    });

    it("orders entries newest first with unique ids", () => {
        const ids = CHANGELOG_ENTRIES.map((entry) => entry.id);
        expect(new Set(ids).size, "duplicate ids").toBe(ids.length);
        for (let i = 1; i < ids.length; i++) {
            expect(
                compareChangelogIds(ids[i]!, ids[i - 1]!),
                `${ids[i]} must be older than ${ids[i - 1]}`,
            ).toBeLessThan(0);
        }
    });

    it("keeps latest.ts in sync with the newest entry", () => {
        expect(LATEST_CHANGELOG_ID).toBe(CHANGELOG_ENTRIES[0]!.id);
    });

    it("carries a non-empty single-line text for every supported locale", () => {
        for (const entry of CHANGELOG_ENTRIES) {
            for (const { code } of LANGS) {
                const text = entry.text[code];
                expect(text, `${entry.id} [${code}]`).toBeTruthy();
                expect(text, `${entry.id} [${code}] must be single-line`).not.toContain("\n");
            }
        }
    });
});

describe("compareChangelogIds", () => {
    it("compares the sequence part numerically, not lexicographically", () => {
        expect(compareChangelogIds("2026-08-08.10", "2026-08-08.2")).toBeGreaterThan(0);
        expect(compareChangelogIds("2026-08-08.2", "2026-08-08.10")).toBeLessThan(0);
    });

    it("orders by date before sequence", () => {
        expect(compareChangelogIds("2026-08-09.1", "2026-08-08.99")).toBeGreaterThan(0);
    });

    it("treats equal ids as equal", () => {
        expect(compareChangelogIds("2026-08-08.1", "2026-08-08.1")).toBe(0);
    });

    it("sorts a malformed id as oldest so a corrupt stored value never hides the badge", () => {
        expect(compareChangelogIds("garbage", "2026-08-08.1")).toBeLessThan(0);
        expect(compareChangelogIds("2026-08-08.1", "garbage")).toBeGreaterThan(0);
        expect(compareChangelogIds("garbage", "junk")).toBe(0);
    });
});
