---
name: changelog
description: Maintain the user-facing changelog - the "What's new" panel, CHANGELOG.md and the GitHub release notes all read from one source (src/changelog/entries.ts). Triggers when the user says "update the changelog", "обнови changelog", or as the pre-tag step of release prep (docs/deploy.md). Reads git history since the newest entry, drafts coarse user-facing entries in every locale, appends them, bumps the badge id and regenerates CHANGELOG.md.
---

# Changelog

One source of truth: `src/changelog/entries.ts`. Everything else derives from it:

- The in-app "What's new" panel renders the per-locale texts (`src/ui/whats-new-modal.ts`).
- The topbar badge compares `src/changelog/latest.ts` against the user's acknowledgment.
- `CHANGELOG.md` is generated - never edit it by hand (`npm run generate:changelog`).
- GitHub release notes are generated at tag time by `.github/workflows/release.yml` from the entries added since the previous `v*` tag - which is why this skill must run BEFORE the tag is pushed, or the release ships without its notes.

The id format and ordering rules are stated in `src/changelog/id.ts`; `src/changelog/entries.test.ts` enforces them.

## When NOT to run

- Nothing user-visible changed since the newest entry (infra, refactors, docs, tests, CI). An empty release is fine - the notes generator emits a maintenance fallback.
- The user asks to change the panel UI or the generators - that is regular feature work, not changelog maintenance.

## Workflow

### 1. Collect the candidate window

The newest entry's coverage boundary is the last commit that touched `entries.ts`:

```sh
git log --oneline "$(git log -1 --format=%H -- src/changelog/entries.ts)"..HEAD
```

If `entries.ts` has never been touched in the window you were asked about, fall back to `git log --oneline <last-release-tag>..HEAD`.

### 2. Filter to what a driver notices

Keep only changes that alter what the user sees or can do: new camera/format support, new features and settings, visible UX changes, fixes of bugs a user could have hit. Drop refactors, internal renames, test/CI/docs work, and perf work with no visible effect.

Coarse strokes are the point: merge related commits into ONE entry ("Improved trip cards", not three bullets about corner buttons). A typical release yields 0-5 entries, one sentence each. When unsure whether something clears the bar, it does not.

### 3. Draft and categorize

- Categories: `support` (new cameras/formats), `feature` (new capability or setting), `improvement` (existing flow got better), `fix`.
- Write English and Russian first - `.claude/rules/voice.md` governs tone (outcome, not implementation; informal register; em-dash is brand voice). English is the source of truth for meaning.
- Translate to the remaining locales. Reuse each locale's established product vocabulary - check how `src/i18n/<lang>.ts` names trips, recordings, cameras before inventing a term.
- Naming a camera brand requires a real sample behind the support claim, same bar as the landing copy.

### 4. Land the data

- New ids: `<yyyy-mm-dd>.<n>` where the date is the day the change landed on main (the commit date, not today) and `<n>` orders entries within that day - higher = newer. Prepend entries newest-first.
- Update `LATEST_CHANGELOG_ID` in `src/changelog/latest.ts` to the new `entries[0].id`.
- Regenerate: `npm run generate:changelog`.
- Verify: `npx vitest run src/changelog` and `npm run typecheck`.

### 5. Review gate

Show the user the drafted entries (en + ru) BEFORE committing - the "coarse enough, user-relevant enough" judgment is theirs. Commit entries.ts + latest.ts + CHANGELOG.md together in one commit.
