// Regenerates CHANGELOG.md from src/changelog/entries.ts (the single source
// of truth - the in-app "What's new" modal reads the same data). Run via
// `npm run generate:changelog`; the changelog skill runs it after every
// entries.ts change. English only: per-locale texts live in entries.ts and
// ship in the app, the repo file serves GitHub readers.
//
// `--check` verifies the file matches instead of writing it - wired into
// ci.yml so a hand edit or a skipped regeneration fails there, not in a
// release asset.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { changelogIdDate, loadChangelogEntries, renderEntryBullet } from "./_changelog-render.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const entries = await loadChangelogEntries();

const lines = [
    "# Changelog",
    "",
    "<!-- Generated from src/changelog/entries.ts by scripts/generate-changelog-md.mjs.",
    "     Do not edit by hand - edit the entries and regenerate: npm run generate:changelog -->",
    "",
    "User-facing changes, newest first. Dates are when the change landed on",
    "[beta](https://beta.dashcamigo.app); production picks it up with the next",
    'release tag. Localized texts ship inside the app (the "What\'s new" panel).',
    "",
];

let currentDate = null;
for (const entry of entries) {
    const date = changelogIdDate(entry.id);
    if (date !== currentDate) {
        // Blank line closes the previous date's bullet list before the heading.
        if (currentDate !== null) lines.push("");
        currentDate = date;
        lines.push(`## ${date}`, "");
    }
    lines.push(renderEntryBullet(entry));
}

const out = join(repoRoot, "CHANGELOG.md");
const text = `${lines.join("\n").trimEnd()}\n`;
if (process.argv.includes("--check")) {
    let current = "";
    try {
        current = readFileSync(out, "utf8");
    } catch {
        // Missing file is just another mismatch.
    }
    if (current !== text) {
        console.error("CHANGELOG.md is stale - regenerate: npm run generate:changelog");
        process.exit(1);
    }
    console.log("CHANGELOG.md matches entries.ts");
} else {
    writeFileSync(out, text);
    console.log(`wrote ${out} (${entries.length} entries)`);
}
