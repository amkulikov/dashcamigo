// Changelog guard for the release pipeline: fails when a tag ships
// user-facing commits (feat/fix touching src/ or index.html since the
// previous v* tag) without new changelog entries. Wired as the gate job in
// .github/workflows/release.yml - nothing deploys or publishes until it
// passes. Runnable locally for a preview:
//
//   node scripts/check-release-changelog.mjs --tag v2026.08.08
//
// An intentional entry-less release passes by annotating the tag with a
// message containing "maintenance" (git tag -a v... -m "maintenance: ...").
// No TypeScript imports here - see _release-tags.mjs.

import { ENTRIES_PATH, entryIdsAt, git, previousReleaseTag } from "./_release-tags.mjs";

// index.html carries user-visible markup; everything else user-facing lives
// under src/. Docs, scripts, workflows and tests never trip the guard.
const USER_FACING_PATHS = ["src", "index.html"];

function arg(name) {
    const i = process.argv.indexOf(name);
    return i >= 0 ? process.argv[i + 1] : undefined;
}

const tag = arg("--tag") ?? process.env.GITHUB_REF_NAME;
if (!tag?.startsWith("v")) {
    console.error("usage: check-release-changelog.mjs --tag v<yyyy>.<mm>.<dd>[.<n>]");
    process.exit(1);
}

const previousTag = previousReleaseTag(tag);
if (!previousTag) {
    console.log(`no release before ${tag} - nothing to guard`);
    process.exit(0);
}

// Only a real tag OBJECT can carry the bypass. For a lightweight tag,
// %(contents) falls through to the pointed-to commit's message - any commit
// body that merely mentions "maintenance" would then defeat the guard.
const isAnnotated = git("tag", "--list", "--format=%(objecttype)", tag).trim() === "tag";
const tagMessage = isAnnotated ? git("tag", "--list", "--format=%(contents)", tag) : "";
if (/maintenance/i.test(tagMessage)) {
    console.log(`tag ${tag} is annotated as maintenance - changelog guard bypassed`);
    process.exit(0);
}

// Same definition of "new" as generate-release-notes.mjs: entry ids absent at
// the previous tag. A mere edit of an existing entry does not count -
// otherwise the guard would pass a release whose generated notes come out as
// the maintenance fallback.
const previousIds = new Set(entryIdsAt(previousTag) ?? []);
const freshIds = (entryIdsAt(tag) ?? []).filter((id) => !previousIds.has(id));
if (freshIds.length > 0) {
    console.log(`${freshIds.length} new changelog entr${freshIds.length === 1 ? "y" : "ies"} since ${previousTag} - ok`);
    process.exit(0);
}

const userFacingSubjects = git("log", `${previousTag}..${tag}`, "--format=%s", "--", ...USER_FACING_PATHS)
    .split("\n")
    .filter((subject) => /^(feat|fix)[(!:]/.test(subject));

if (userFacingSubjects.length === 0) {
    console.log(`no user-facing feat/fix commits since ${previousTag} - ok without new entries`);
    process.exit(0);
}

console.error(`release ${tag} ships user-facing commits but ${ENTRIES_PATH} has no new entries since ${previousTag}:`);
for (const subject of userFacingSubjects) console.error(`  - ${subject}`);
console.error(`
Either of:
  1. Run the changelog skill (.claude/skills/changelog/SKILL.md), land its
     commit on main and cut a NEW tag (a failed guard published nothing -
     this tag is dead, do not reuse it).
  2. If none of the commits above changes what a user sees, re-tag with an
     annotated "maintenance" message: git tag -a <new-tag> -m "maintenance: <why>"`);
process.exit(1);
