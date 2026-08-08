---
name: release
description: Cut a production release end to end - changelog first, then the tag. Triggers when the user says "cut a release", "зарелизь", "выкати прод", "сделай релиз", "промоутни на прод". Runs the changelog skill, lands its commit on main, computes the next v-tag by convention, and STOPS for explicit confirmation before every push - a tag push deploys production. Never triggers on "deploy staging" (that is just a push to main) or on tag mechanics questions.
---

# Release

Promotion mechanics, the tag convention and the pipeline live in `docs/deploy.md`
("Releases"); this skill orchestrates the ritual so the changelog can never be
forgotten - the pipeline's changelog guard fails a tag that ships user-facing
commits without new entries, so skipping step 2 does not save time, it wastes a
tag.

## Preconditions - verify, do not assume

- `git status` clean, `git branch --show-current` = main, `git fetch origin` then
  local main == `origin/main`. Diverged or dirty - stop and surface it.
- The commit to tag is the one staging (https://beta.dashcamigo.app) has
  validated. The user's ask to release IS the confirmation staging looks good -
  do not re-ask; but if main moved since the last staging deploy you were part
  of, say so.

## Workflow

### 1. Changelog

Run the changelog skill (`.claude/skills/changelog/SKILL.md`) - it drafts
entries from the commits since the last entry and gates on the user's review.

Two outcomes:

- **Entries drafted** → commit them (entries.ts + latest.ts + CHANGELOG.md, one
  commit) and ask permission to push main - the release ships that commit, and
  a push deploys staging. No permission - no release; do not tag around it.
- **Nothing user-facing** → maintenance release. If the window still contains
  feat/fix commits touching `src/` or `index.html` (judged not user-visible),
  the tag in step 2 must be annotated with a message containing "maintenance"
  or the guard fails the pipeline; with no such commits a plain tag passes on
  its own.

### 2. Tag

- Next tag: `v<yyyy>.<mm>.<dd>` zero-padded, `.<n>` suffix if today already has
  one (`git tag --list 'v*'`). Date = today.
- Normal release: a plain (lightweight) tag on the pushed main commit.
  Maintenance release: `git tag -a <tag> -m "maintenance: <why>"`.
- The notes generator diffs entry ids against the previous tag; when that tag
  predates `entries.ts` entirely, EVERY current entry lands in the notes - if
  some of them already shipped in earlier releases, say so to the user before
  the tag push.
- Show the user the tag name and the tagged commit, and get an explicit go for
  `git push origin <tag>` - this is THE production deploy. The prior push of
  main was staging; permission for one push is never permission for the next.

### 3. Hand off

After the tag push everything is `release.yml`'s job. Point the user at the
Actions run; do not watch it with sleep loops. If the changelog guard fails
there despite step 1 - something landed between the changelog commit and the
tag; the failed tag is dead, fix and cut a NEW one (releases are immutable).
