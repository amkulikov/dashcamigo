---
name: release
description: Cut a production release end to end with optional changelog entries. Triggers when the user says "cut a release", "зарелизь", "выкати прод", "сделай релиз", "промоутни на прод". Prepares any requested changes on main, computes the next v-tag by convention, and STOPS for explicit confirmation before every push - a tag push deploys production. Never triggers on "deploy staging" (that is just a push to main) or on tag mechanics questions.
---

# Release

Promotion mechanics, the tag convention and the pipeline live in `docs/deploy.md`
("Releases"). New changelog entries are optional; release state and successful
CI remain required.

## Preconditions - verify, do not assume

- `git status` clean, `git branch --show-current` = main, `git fetch origin` then
  local main == `origin/main`. Diverged or dirty - stop and surface it.
- The commit to tag is the one staging (https://beta.everydashcam.app) has
  validated. The user's ask to release IS the confirmation staging looks good -
  do not re-ask; but if main moved since the last staging deploy you were part
  of, say so.

## Workflow

### 1. Changelog

If the user asks to skip the changelog, leave its data unchanged. Otherwise,
run `.claude/skills/changelog/SKILL.md` and review any drafted entries.
Commit release preparation changes on main. Get permission before pushing
main, then wait for successful CI on that exact commit before pushing a tag.
A release without new entries needs no special tag annotation.

### 2. Tag

- Next tag: `v<yyyy>.<mm>.<dd>` zero-padded, `.<n>` suffix if today already has
  one (`git tag --list 'v*'`). Date = today.
- Create a plain (lightweight) tag on the pushed main commit.
- The notes generator diffs entry ids against the previous tag; when that tag
  predates `entries.ts` entirely, EVERY current entry lands in the notes - if
  some of them already shipped in earlier releases, say so to the user before
  the tag push.
- Show the user the tag name and the tagged commit, and get an explicit go for
  `git push origin <tag>` - this is THE production deploy. The prior push of
  main was staging; permission for one push is never permission for the next.

### 3. Hand off

After the tag push everything is `release.yml`'s job. Point the user at the
Actions run. If a release fails, inspect the failure before retrying;
never overwrite a published release.
