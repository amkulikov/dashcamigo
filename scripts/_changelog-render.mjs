// Shared rendering bits for the two changelog generators
// (generate-changelog-md.mjs, generate-release-notes.mjs). Both emit English
// markdown bullets from src/changelog/entries.ts - English is the source of
// truth for meaning (.claude/rules/voice.md).

// Node's type stripping (default since 22.18) erases the type annotations and
// type-only imports in these modules, so importing them from an .mjs script
// needs no build step.
export { changelogIdDate } from "../src/changelog/id.ts";

export async function loadChangelogEntries() {
    const { CHANGELOG_ENTRIES } = await import("../src/changelog/entries.ts");
    return CHANGELOG_ENTRIES;
}

const CATEGORY_LABELS = {
    support: "New camera support",
    feature: "New",
    improvement: "Improved",
    fix: "Fixed",
};

/** One markdown bullet for an entry: bold category label + the English text. */
export function renderEntryBullet(entry) {
    const label = CATEGORY_LABELS[entry.category];
    // Fail loud: a raw category slug must never reach published output.
    if (!label) throw new Error(`unknown changelog category "${entry.category}" (entry ${entry.id})`);
    return `- **${label}:** ${entry.text.en}`;
}
