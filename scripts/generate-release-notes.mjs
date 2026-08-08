// Emits the GitHub release notes for a tag: the changelog entries added since
// the previous v* tag, rendered as English markdown. Wired into
// .github/workflows/release.yml (gh release create --notes-file); runnable
// locally for a preview:
//
//   node scripts/generate-release-notes.mjs --tag v2026.08.08 [--out FILE]
//
// "Added since" is a diff of entry ids between this revision's entries.ts and
// the previous tag's - not a date comparison, so same-day tags and late-dated
// entries attribute unambiguously. Requires tags in the clone (CI checks out
// with fetch-depth: 0).

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

import { loadChangelogEntries, renderEntryBullet } from "./_changelog-render.mjs";

const ENTRIES_PATH = "src/changelog/entries.ts";

function arg(name) {
    const i = process.argv.indexOf(name);
    return i >= 0 ? process.argv[i + 1] : undefined;
}

const tag = arg("--tag") ?? process.env.GITHUB_REF_NAME;
if (!tag?.startsWith("v")) {
    console.error("usage: generate-release-notes.mjs --tag v<yyyy>.<mm>.<dd>[.<n>] [--out FILE]");
    process.exit(1);
}
// Repo slug for the compare link; empty means "skip the link" (local preview
// outside CI without --repo).
const repo = arg("--repo") ?? process.env.GITHUB_REPOSITORY ?? "";

// Git's own stderr is suppressed: the one expected failure (entries.ts absent
// at the previous tag) is handled by the caller, and a leaked "fatal:" line
// reads like a broken run in the CI log.
function git(...args) {
    return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
}

// Previous release = the highest v* tag that sorts below the current one.
// The zero-padded v<yyyy>.<mm>.<dd>[.<n>] convention makes plain string order
// chronological, and "below current" (not "second newest") keeps the diff
// correct even when newer tags exist in the clone.
const previousTag = git("tag", "--list", "v*")
    .split("\n")
    .filter((t) => t && t < tag)
    .sort()
    .at(-1);

// Entry ids present at the previous tag. Regex over the old file text instead
// of importing it: the revision is not on disk, and the id line format is a
// stated contract (src/changelog/id.ts). Absent file (release predates the
// changelog) = no ids, every current entry counts as new.
let previousIds = new Set();
if (previousTag) {
    try {
        const oldSource = git("show", `${previousTag}:${ENTRIES_PATH}`);
        previousIds = new Set(oldSource.match(/(?<=^\s*id: ")\d{4}-\d{2}-\d{2}\.\d+(?=",$)/gm) ?? []);
    } catch {
        console.error(`note: ${ENTRIES_PATH} absent at ${previousTag} - treating all entries as new`);
    }
}

const entries = await loadChangelogEntries();
const fresh = entries.filter((entry) => !previousIds.has(entry.id));

const lines = [];
if (fresh.length > 0) {
    lines.push("## What's new", "", ...fresh.map(renderEntryBullet));
} else {
    lines.push("Maintenance release — no user-facing changes.");
}
lines.push("");
if (previousTag && repo) {
    lines.push(
        `**Full changelog:** [${previousTag}...${tag}](https://github.com/${repo}/compare/${previousTag}...${tag})`,
    );
} else {
    lines.push(
        `**Full changelog:** [CHANGELOG.md](https://github.com/${repo || "amkulikov/dashcamigo"}/blob/${tag}/CHANGELOG.md)`,
    );
}

const notes = `${lines.join("\n").trimEnd()}\n`;
const out = arg("--out");
if (out) {
    writeFileSync(out, notes);
    console.error(`wrote ${out} (${fresh.length} new entries since ${previousTag ?? "the beginning"})`);
} else {
    process.stdout.write(notes);
}
