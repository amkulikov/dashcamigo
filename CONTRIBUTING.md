# Contributing to dashcamigo

The most valuable things you can send:

- **Bug reports and suggestions** - open a GitHub issue.
- **Support for a new camera** - the contribution that helps most. It takes a
  real sample. Start at
  [dashcamigo.app/add-my-camera](https://dashcamigo.app/add-my-camera) - the
  app packages a file-name-only report you can send - or open a camera-support
  issue.
- **Security reports** - see [SECURITY.md](SECURITY.md).
- **Translation fixes** - the UI ships in 10 languages; wording corrections
  are welcome as issues with the exact current string and the suggested
  replacement.

## Development

```sh
npm install
npm run dev
```

Node version: `.nvmrc`. A fresh clone builds and runs with no keys and no
configuration.

## Pull requests

Pull requests are welcome. Two rules keep review workable on a
solo-maintained project:

- **A fix or a small correction** - open a PR directly.
- **Anything larger** (a feature, a refactor, a new dependency) - open an
  issue first and get a yes before writing code. A big PR that skips this
  step risks being closed for architectural reasons.

Every PR: `npm run typecheck` and `npm run check` pass, behavior changes come
with tests, and UI copy goes through i18n, never as a literal in code.
English is required; the other dictionaries carry either the English value
under `// TODO i18n:` or your own translation - both are normalized on review.

Review can take a while - one maintainer, best effort.

### Parser PRs

No sample -> no parser: support cannot be validated from a format
description alone. The one exception, porting from a verified open-source
implementation, has strict conditions - the foreign-source waiver in
[docs/gps-format-coverage.md](docs/gps-format-coverage.md).

The path:

1. Open a camera-support issue and share a sample. Review starts when it
   arrives.
2. The PR contains the extractor, tests, and anonymized fixtures
   (coordinates rounded to whole degrees, no real footage). The committed
   `scripts/anonymize-*.mjs` scripts show the pattern - a new format brings
   its own. Unsure? Say so in the PR - fixtures can be derived from the
   shared sample on review.
