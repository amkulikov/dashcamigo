# CLAUDE.md

Guidance for Claude Code working in this repo: the constraints, the working rules,
and a map of where to look - not a description of how the code currently works. When
guidance and code disagree, the code wins.

## What this is

A web-based, no-backend viewer for dashcam recordings. Multi-vendor through a
capability-first parser architecture: a new camera adds techniques to per-capability
libraries, it is not a "vendor" module.

Hard constraints - non-negotiable; changing one is an architectural decision. If a
task seems to require crossing one, stop and ask - never work around it silently:

- **No backend.** Video is never uploaded. The user picks local files, JS reads them
  in-browser via the File API.
- **Analytics is optional and separable.**
- **Graceful degradation.** If any external dependency (tile server, analytics) is
  down, the functional app keeps working - video, chart, markers and the track drawn
  on the map canvas are all local.

## Branches and deployment

- One working branch: `main` -> staging (https://beta.dashcamigo.app) on every
  push (`deploy.yml`). Production (https://dashcamigo.app) deploys on a `v*`
  tag push: `release.yml` builds and uploads via wrangler; the machine-managed
  `release` branch only records what production runs and only `release.yml`
  moves it - never touch `release` by hand. Never rebase `main`; on conflict,
  stop and surface it.
- Treat pushing as an outward action: commit locally freely, but do not push
  without an explicit request - a push to `origin/main` deploys staging.
- Promotion to production is the user's call and = pushing a tag
  `v<yyyy>.<mm>.<dd>[.<n>]` (zero-padded). The same tag publishes the GitHub
  Release with the prebuilt self-host artifacts (`.github/workflows/release.yml`,
  runbook in `docs/deploy.md`). Releases are immutable: a re-release is a new
  tag, never an overwrite of a published one.

## Working rules

### The private zone (`private/`)

- Everything under `private/` is local-only: never tracked by the main repo
  (`/private/` in the root `.gitignore`), never in the docker build context
  (`.dockerignore`). This is a single public repository - no mirror, no scrub
  stage between a commit and the world. `samples/` and `incoming/` are real
  user data. **Never commit it, never send it to an external service.** Share
  only anonymized fragments (coordinates rounded to whole degrees).
  Anonymization scripts are committed as `scripts/anonymize-*.mjs`.
- Text notes (`plans/`, `research/`, `*.md` only) are versioned by the nested
  git repo rooted at `private/` - its remote must be a private one. Commit note
  edits there in the same session that made them - nothing else keeps that
  history. Layout and rules: `private/README.md`.
- Unlike everything else in this file, a violation here is irreversible - a revert
  does not fix a leak.

### Code language

- Identifiers, in-code strings, filenames, commit and PR messages - simple English.
- Comments - simple English, compact. Explain WHY (the invariant, the reason, the
  non-obvious case); HOW only when naming does not carry it. Do not restate the code
  - a comment no shorter than the line it labels, carrying no WHY, is noise. No
  attribution or quotes: never name or cite a person/user/tester ("owner-confirmed",
  "X reported") - state the fact neutrally. "State the rule, not its history" (see
  Documentation) holds for comments too: no dates, "used to be", "was X in stage N",
  "previously".
- Error messages - English, lower-case, no trailing period (Go style).
- UI copy goes through i18n, never as a literal in code.

### TypeScript

- Errors, three tiers: an expected local failure (one record/line/block does not
  parse) returns null/empty; a whole file that matched a cheap marker but is not
  that format throws `WrongFormatError` (contract in `src/parsers/types.ts`) so
  dispatch falls through; an invariant violation throws a plain `Error`.
- In a `catch`: normalize (`err instanceof Error ? err.message : String(err)`)
  into a structured log field, or rethrow unchanged after cleanup; an
  `AbortError` (user cancel) always passes through.
- `any` is a last resort for a third-party lib's unusable types and carries a
  justifying comment. Unknown-shaped data (parsed JSON, worker messages,
  third-party events) is `unknown`, narrowed at the boundary. Casts belong at
  real boundaries (DOM reads, worker protocol) - the parser core stays
  cast-free. `arr[i]!` where the index is in-bounds by construction is the
  accepted idiom under `noUncheckedIndexedAccess`, not a bug to fix.
- Named exports only, no `enum` (string-literal unions), `interface` for object
  shapes, kebab-case filenames. A barrel `index.ts` is an explicit ordered
  registry - never a re-export convenience.
- `class` only for stateful lifecycle objects (a tracker session, a loaded
  model, a worker client); everything else is functions over interfaces.
- Relative imports end in `.js`. The bundler resolves without it; the codebase
  never omits it.
- Doc comments are prose stating the contract, not `@param`/`@returns` tag
  lists. UPPER_SNAKE_CASE only for literal constants; booleans read as
  `is`/`has`/`should`/`can`.

### Commits and git history

- Conventional `type(scope): subject` - lower-case, no trailing period. The
  subject states the outcome ("footer carries the source link"), not the
  command ("add source link"). Types are an open set (feat / fix / chore / docs
  / test / perf / refactor / ...); scope is the module or surface touched.
- The body is prose about WHY: rationale, tradeoffs, what a review pass
  changed. Bullets for independent points. No attribution trailers of any kind.
- One logical change per commit; a refactor does not ride with the feature that
  motivated it. Unpushed history is plastic - amend/fixup freely; once pushed,
  append new commits only (the push already deployed staging).
- Destructive operations - `reset --hard`, `checkout --`/`restore`, `clean`,
  `stash` - only on explicit request. Uncommitted changes this session did not
  make are not yours to discard or sweep into a commit; before any
  history-touching command, verify the actual state (`git status`, `git branch
  --show-current`) instead of trusting an earlier snapshot, and when in doubt,
  stop and ask.

### Dependencies

- **Check current docs** before building on any external dependency (npm package,
  Web API, file format). Guessing an API from a method name produces almost-working
  code. This is not routine work to skip.
- **Deduplicate.** If the same thing happens in two places, extract a shared helper;
  grep before writing a new utility.
- **A new npm dependency (or a swap) is an architectural choice** - discuss it
  separately, do not add it along the way. Bar: popular, actively maintained,
  MIT/Apache, sane bundle cost, no paid service pulled in.

### Logging (`src/log.ts`)

- One central logger. **No direct `console.*` in project code** - the in-memory ring
  buffer plus a DevTools download button is the primary local diagnostic for a
  no-backend app. Optional Sentry (errors-only, PII-scrubbed) when `VITE_SENTRY_DSN`
  is built in; no DSN tree-shakes the SDK out (`src/sentry.ts`, `src/sentry-scrub.ts`).
- Do not log: hot paths (rAF loops, the per-record parse loop, the per-packet export
  loop, `timeupdate`), meaningless "started"/"finished" pairs, or "entered function".
  Before every log call: "what will I do when this line fires?" No answer, delete it.

### Localization (`src/i18n/`)

- Baseline invariant: **Russian + English ship together**, never "localize later".
  Community locales (de/es/fr/ja/ko/pl/pt/zh) follow the same rule plus a
  build-time parity check.
- The `I18nKey` union is the key list; each dictionary is `satisfies
  Record<I18nKey, string>`, so drift fails to compile.
- Always pass an explicit locale to `Intl.*` (`ru-RU` / `en-US`), never `undefined` -
  otherwise the English UI shows Russian-formatted dates.
- Tone and wording are governed by **`.claude/rules/voice.md`** (auto-loads on copy
  files). English is the source of truth for meaning.

### Deferred work

- Defer -> leave a grep-able `TODO:` at the spot, not "I'll remember". Unfinished
  translations sit under `// TODO i18n:` next to the key (typecheck catches a missing
  key, not a value copied from `en.ts`).

### Tests

- **New parser = extractor + real sample + tests, in one PR.** No sample -> no parser
  (writing one from a format description is forbidden; see the onboard-format skill).
  One documented exception: the foreign-source waiver (verified upstream
  implementation cited by file+line+version, strict marker, negative tests,
  in-code flag) - conditions and the standing revalidation duty in
  `docs/gps-format-coverage.md`.
- Unit tests are vitest, colocated as `src/**/*.test.ts` (the `test.include`
  glob in `vite.config.ts` is the enforcement; `*.spec.ts` means Playwright).
  Explicit imports from `vitest`; `it()` not `test()`; titles are present-tense
  behavior statements ("clamps to first when before first"), never "should";
  no committed `.only`/`.skip`.
- Mock nothing under test: `vi.mock` exists only to sever DOM-touching imports
  so pure logic runs under `environment: "node"`; parser input is real bytes,
  never hand-faked structures. Shared semantic checks are plain helper
  functions (`src/parsers/__fixtures__/helpers.ts`), not `expect.extend`. A
  snapshot never stands alone - pair it with a plausibility check; a snapshot
  blesses whatever the parser first produced.
- Unit determinism is enforced, not assumed: the TZ pin lives in the `test` npm
  script; no randomness, no network; fake timers only when timing itself is
  under test. A module with module-level state exports `_resetForTests()` for
  `beforeEach`. Floats compare via `toBeCloseTo`; multi-step invariants get the
  two-arg `expect(value, "label")` form.
- The `tests/e2e/*.spec.ts` Playwright suite is the regression gate - hermetic,
  fail-loud, assertion-driven. Setup + invariants: `tests/e2e/_fixtures.ts`.
- Map-style JSON is validated by `scripts/validate-map-styles.mjs`, wired as a
  `pretest` gate.
- **Pixel artifacts - three buckets, decide by which before touching git:**
  - VRT baselines (`tests/e2e/*-snapshots/`) - **committed** source of truth for
    deterministic surfaces. Regenerate ONLY on an intended visual change, via
    `npm run test:vrt:update`; a diff here is a real signal to review.
  - e2e `shot()` PNGs (`tests/e2e/screenshots/`) - **gitignored, never commit.**
    Screenshots of live video/map, non-deterministic by frame timing, so a
    committed diff is noise. They are local/CI review aids (CI uploads them in
    the playwright-report on failure). A dirty `M` on these = expected, ignore.
  - README screenshots - `scripts/generate-readme-screenshots.mjs`, **committed**,
    regenerated deliberately on a UI layout change (see Definition of done;
    source frames under `docs/screenshots/frames/`).
- Coverage is a lens, not a gate: on-demand `npm run test:coverage` (v8, writes
  gitignored `tests/coverage/`). No CI threshold - it surfaces untested logic for
  a human, it does not block. Plain `npm test` never runs it.

### SEO

- Every canonical URL we expose (sitemap, `rel=canonical`, internal links, footers)
  is the **extension-less** form - CF Pages 308-redirects `*.html`.
- `lastmod` = **git mtime**, never the build date.

### Documentation (this file and `docs/`)

Apply this test whenever you write or touch a doc:

- **Cut on sight, never add, a fact that mirrors code or config and moves with it:** a
  number that lives in a `const` (buffer sizes, probe bytes, thresholds), an
  enumeration that grows with the codebase (primitive lists, locale lists, event
  names, supported-format tables), a table that restates a code definition, a precise
  call sequence a refactor will change. If a `grep` answers it, point at the file or
  symbol that owns it instead of copying the value.
- **Keep only what the code cannot tell you:** constraints and invariants, working
  rules, design rationale (WHY a thing is shaped this way), hard-won
  external/operational knowledge (browser bugs, protocol quirks, deploy traps), and a
  pointer index. A load-bearing gotcha belongs as a comment at its site in the code,
  not only here.
- **State the rule, not its history.** No war stories, discovery narratives, or dated
  "we did X, then learned Y, so now Z". Keep the causal fact ("CF Pages clones
  depth-1, so `git log` needs `--unshallow`"); drop when and how it was found. A date,
  a "since <month>", a "learned in production", a "caught when" is the tell - cut back
  to the fact.
- **On a stale fact, replace it with a pointer,** not the corrected value - the copy
  just drifts again.

## Definition of done

Before a change is presented (or committed) as finished:

- `npm run typecheck` and `npm run check` pass. `check` is Biome lint AND
  format (`--write`); plain `lint` does not catch format drift, so a
  lint-only run lets unformatted code land.
- UI or behavior changed -> `npm run test:e2e` passes. The script rebuilds `dist/`
  first; never point bare Playwright at a stale build.
- `public/styles/*.json` touched -> `npm run validate:styles` passes.
- UI copy touched -> `ru` and `en` land together in the same change.
- New `TODO:`s in the diff -> the commit/PR message lists them (what is deferred and
  why).
- UI layout/visual changes -> regenerate the README screenshots; see
  `scripts/generate-readme-screenshots.mjs` (source frames are committed under
  `docs/screenshots/frames/`).

## Platforms

Desktop (Windows/macOS/Linux) is first-class. Mobile (Android/iPad/iPhone) is
supported and first-class for what the platform allows - mobile-only bugs are real
bugs, not auto-wontfix. A functional shortcut is acceptable only where an API is
genuinely absent (the iOS Safari folder-picker gap), and it must be documented at its
spot, never silent. Browser bar: current or previous major of the popular engines
(2025+); missing APIs are graded at startup (blocking / degraded / info), not
all-or-nothing. Full matrix, verified versions, and UX decisions:
`docs/browser-support.md`.

## Where things live

### Architecture (the shape - read the files for current detail)

- **`src/parsers/`** - GPS parsers. Capability-first, no "vendor" entity. Four
  orthogonal concerns: byte parsers (`primitives/`), filename/path techniques
  (`filename/<field>.ts`), the pre-flight GPS-source filter (`gps-source-hints.ts`),
  and basename-paired handlers (`sidecars/`). Cross-channel camera identity is
  `camera-fingerprint.ts`. UI never reaches in here.
- **`src/repair/`** - container-level byte-patching of broken codec-config boxes
  before playback/export. No UI.
- **`src/ui/`** - `state.ts` and `dom.ts` are the singleton graph roots; feature
  modules (player, map, chart, sidebar, modals) build on them. Reverse dependencies
  are broken by init callbacks passed from `app.ts` - keep the graph tree-shaped, no
  cycles.
- **`src/transcode/`, `src/export/`** - the decode/encode pipeline and exported-MP4
  post-processing. **`src/workers/`** - heavy work off the main thread.
- **`src/i18n/`** - dictionaries + the `t()` helper. **`src/types/`** - ambient
  declarations for otherwise-untyped deps.
- **Root utilities in `src/`** (`parser.ts`, `indexer.ts`, `events.ts`, `trips.ts`,
  `log.ts`, ...) - pure logic, no UI deps. **`src/app.ts`** - thin orchestrator shell.

### Design system

In-repo sources of truth: design tokens in `src/styles/tokens.css` (`--dc-*` raw tokens plus
semantic aliases - component styles use the semantics, not raw colors), and the
copy/tone guide in `.claude/rules/voice.md`. Hard-coded canvas colors
go through a `themeColors()` cache invalidated on `prefers-color-scheme` change.

### Index

- Primitive list and order -> `src/parsers/primitives/index.ts`
- Filename techniques -> `src/parsers/filename/<field>.ts` (shared regexes in
  `_patterns.ts`)
- GPS source hints -> `src/parsers/gps-source-hints.ts`
- Sidecar / accel-sidecar list -> `src/parsers/registry.ts`
- Extractor contract -> `src/parsers/primitives/types.ts`; sidecar contract ->
  `src/parsers/types.ts`
- Camera fingerprint -> `src/parsers/camera-fingerprint.ts`
- Container repair -> `src/repair/`
- Ingest pipeline -> `src/ui/ingest.ts`, `src/parsers/registry.ts`; start-time
  derivation -> `deriveStartUtc` in `src/trips.ts`
- AppState shape -> `src/ui/state.ts`
- Capability detection + gate -> `src/capabilities.ts`, `src/ui/capability-gate.ts`
  (matrix + rationale in `docs/browser-support.md`)
- Export pipeline -> `src/ui/export-flow.ts`, `src/export/`, `src/transcode/`
- i18n key list -> `src/i18n/keys.ts`; locale / URL / hreflang config ->
  `src/i18n/seo-config.ts` (`SEO_LOCALES`; a URL with an explicit `/<lang>/` segment
  is share-safe - URL wins over stored preference)
- Hotkeys -> `src/ui/hotkeys-modal.ts`
- Dependencies and versions -> `package.json`
- SEO / IndexNow runbook -> `docs/seo.md`;
  GPS format coverage -> `docs/gps-format-coverage.md`
- Deep-dives: per-format breakdowns -> `docs/format-*.md`;
  truncated-MP4 playback -> `docs/truncated-mp4-decode.md`
- Onboarding a new format -> `.claude/skills/onboard-format/SKILL.md`
- README screenshots -> `scripts/generate-readme-screenshots.mjs`
- mediabunny docs (check before changing any usage) ->
  https://mediabunny.dev/llms-full.txt and https://mediabunny.dev/mediabunny.d.ts
  (the release is pinned in `package.json`)

## Running

Commands live in `package.json` scripts: `dev` / `build` / `preview` / `typecheck` /
`lint` / `format` / `check` / `knip`, `test` / `test:watch` / `test:e2e` / `test:vrt`
/ `test:perf` / `test:bench`, `validate:styles`, `indexnow`. Lint and format are
Biome (`biome.json`).
