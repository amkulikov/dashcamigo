# Deploying to Cloudflare Pages

This is a static, no-backend site, so any static host works. The reference
deployment (dashcamigo.app) runs on Cloudflare Pages; this guide describes that
setup with placeholders you can swap for your own repo and domain.

## Build settings

| Setting | Value |
|---------|-------|
| Framework preset | None |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Root directory | (empty) |
| Node.js version | `22` (pinned via `.nvmrc` in the repo) |

## First-time setup via the dashboard

1. https://dash.cloudflare.com -> Workers & Pages -> Create application -> Pages
   -> Connect to Git.
2. Select your GitHub repository (`<your-user>/dashcamigo`), branch `main`.
3. Build settings: use the values from the table above.
4. Environment variables (Production + Preview): all are optional. Set
   `VITE_SENTRY_DSN` to enable crash reporting (opt-out in Settings); leave it
   unset and the Sentry SDK tree-shakes out entirely. (Cloudflare Web Analytics
   is enabled in the Pages dashboard under Settings -> Web Analytics, not via an
   env var.) For readable crash stacks in
   Sentry, set the three build secrets `SENTRY_AUTH_TOKEN` / `SENTRY_ORG` /
   `SENTRY_PROJECT` (Production only, unless you also want maps for a preview
   branch) - the build then uploads hidden source maps to Sentry and removes them
   from `dist`. Without them the build still works, stacks just stay minified. See
   `.env.example` for the full contract and the other optional variables.
   `INDEXNOW_KEY` (Production only, type **Secret**) makes the build emit the
   IndexNow proof-of-ownership file; unset, IndexNow is simply off - the right
   state for a fork. Why it is a secret and how to rotate it: `docs/seo.md`,
   "IndexNow".
5. Save and Deploy.

### Moving to another repository

A Pages project cannot be repointed at a different repository - Cloudflare
offers no repo swap, and a re-created repository (even under the same name) is
a different repository to the GitHub App. Two ways out:

- Re-create the Pages project against the new repo and move the custom domains
  over: remove each from the old project first, then add to the new one -
  there is no atomic move, so this is a downtime window. `beta` must also be
  re-added as a custom domain before its CNAME can point at the new project's
  branch alias (a bare CNAME to `*.pages.dev` without the dashboard
  association 522s).
- Keep the project and retire git integration: Cloudflare supports manual
  deployments into a git-integrated project, and wrangler deploys by project
  name over the API - no git binding involved. The reference deployment does
  this (see "Deployment pipeline"); the dead git link in the dashboard is
  cosmetic. Already-published deployments keep serving either way.

After the first deploy the project is reachable at `https://<project>.pages.dev`.
Every push to the production branch triggers a new build. For a plain fork,
production branch = `main` and that is the whole pipeline; the reference
deployment layers a staging tier on top, described next.

## Deployment pipeline (who does what)

The reference deployment is two-tier, one working branch:

- **`main`** is the only branch anyone commits to. Every push deploys
  staging: `deploy.yml` builds with the staging env and uploads `dist/` as a
  `main` branch deployment, reachable via the branch alias
  `main.<project>.pages.dev` - the staging domain (beta.dashcamigo.app) is a
  CNAME to that alias (see "Staging domain" below).
- **`release`** is machine-managed: only the `promote` job of `release.yml`
  moves it, fast-forwarding to the commit a `v*` tag points at, so the repo
  records what production runs (it also creates the branch on the first
  promotion). Never commit to or force-push it by hand. The name doubles as
  the Pages project's production branch: the production deploy uploads with
  `--branch=release`, and matching the project's production-branch setting is
  what marks a deployment *production* rather than *preview*.

GitHub Actions owns the whole chain; the Pages project only serves what is
uploaded:

- `ci.yml` - typecheck / lint / unit / e2e on pushes to `main` and PRs.
- `deploy.yml` - staging build + `wrangler pages deploy` on every `main` push.
- `release.yml` (on `v*` tags) - the production build + deploy, the `release`
  promote, the self-host artifacts, and the chained IndexNow ping.
- `indexnow.yml` - the manual re-ping button.

The Pages project's git integration is unused - Pages cannot re-link a
project to another repository (see "Moving to another repository"); every
deployment is a direct upload. Wrangler deploys by project name with
`CLOUDFLARE_API_TOKEN` (custom token, permission "Cloudflare Pages: Edit") +
`CLOUDFLARE_ACCOUNT_ID` - both GH Actions secrets; without them the deploy
jobs self-skip, so forks stay green. Build env vars live in the workflow
files, not the CF dashboard - the `env:` blocks of `deploy.yml` and the
`deploy` job of `release.yml` are the current set.

Two properties of this shape to keep in mind:

- **The deploy does not wait for CI.** A tag deploys even if `ci.yml` goes
  red - the gate is advisory, check CI on `main` before tagging. A failed
  production deploy shows as the red `deploy` job of the tag's release.yml
  run.
- **The IndexNow ping must run post-deploy**, never as a build step: engines
  fetch the submitted URLs and the key file when they process a ping, so the
  script reads the live sitemap, not `dist/`. It runs as the `ping` job
  chained after `deploy` in release.yml - its failure cannot fail the deploy
  it follows. Secrets: where `INDEXNOW_KEY` lives, why it is in no file, and
  how the ping pre-flights it - `docs/seo.md`, "IndexNow".

## Custom domain

Pages -> Custom domains -> Set up a custom domain -> enter `<your-domain>`. If the
domain is already in the same Cloudflare account, Pages writes the CNAME-flattened
apex record and issues Universal SSL within seconds.

### Staging domain

Custom domains attached via the Pages UI always serve the *production*
deployment. A staging domain instead rides a branch alias: create a CNAME
record `beta.<your-domain>` -> `main.<project>.pages.dev` (Proxied) in the
zone's DNS. Requirements: the branch must be a non-production branch with
preview deployments enabled, and the zone must live in the same CF account
(otherwise the alias TLS certificate does not cover the vanity name).

### www -> apex redirect

The canonical method per Cloudflare's own docs for Pages sites:
https://developers.cloudflare.com/pages/how-to/www-redirect/. **Not** via
`_redirects` (it cannot match on host), **not** via Page Rules (legacy), **not**
via a Single Redirect Rule - use a Bulk Redirect, because it intercepts the
request at the edge before Pages.

1. **DNS.** Zone `<your-domain>` -> DNS -> Records. Remove the `www` CNAME to
   `<project>.pages.dev`. Create a `www` **A** record pointing at `192.0.2.1`
   (RFC 5737 TEST-NET-1, a non-routable range), Proxy status: **Proxied** (orange
   cloud). The idea: the edge needs a Proxied DNS record to intercept the request;
   no real origin is needed because the Bulk Redirect returns a 301 before proxying.
2. **Pages Custom Domains.** Pages -> project -> Custom domains -> remove
   `www.<your-domain>`. After step 1 the www SSL cert cannot renew (DNS validation
   fails), so it is cleaner to detach it explicitly. Keep `<your-domain>`.
3. **Bulk Redirect.** Zone `<your-domain>` -> Rules -> Bulk Redirects -> Create a
   list (type URL Redirect, e.g. name `www-to-apex`) -> Add URL redirect:
    - Source URL: `www.<your-domain>`
    - Target URL: `https://<your-domain>`
    - Status: `301`
    - Parameters (all four): **Preserve query string, Subpath matching, Preserve
      path suffix, Include subdomains**

   Save list -> Create rule (if CF did not offer it automatically) -> attach the
   list -> Deploy.
4. **Check.**
    ```sh
    curl -sI "https://www.<your-domain>/en/cameras/70mai/?ref=test"
    # expect: HTTP/2 301
    #         location: https://<your-domain>/en/cameras/70mai/?ref=test
    ```

Bulk Redirects are available on all Cloudflare plans (including Free), with ample
quota for a single rule.

## Handling `<project>.pages.dev`

Cloudflare hands every project a `pages.dev` subdomain and it cannot be removed.
Options:

### Option A - ignore (default)

Just do not advertise it. The HTML already carries
`<link rel="canonical" href="https://<your-domain>/">`, so search engines follow
the canonical and do not surface `pages.dev` duplicates.

- **Pro:** nothing to do.
- **Con:** anyone who learns the `<project>.pages.dev` URL can open the app there.
  Same content.

### Option B - 301 redirect via a Pages Function

Create `functions/_middleware.js` at the repo root (Cloudflare Pages picks up the
`functions/` folder as middleware/routes automatically):

```js
// functions/_middleware.js
export const onRequest = async ({ request, next }) => {
    const url = new URL(request.url);
    // The production pages.dev URL has exactly one subdomain segment before
    // pages.dev. Preview deploys (for PR/branch) carry a commit-hash prefix -
    // do not redirect those, so they stay reviewable.
    if (url.hostname === "<project>.pages.dev") {
        url.hostname = "<your-domain>";
        return Response.redirect(url.toString(), 301);
    }
    return next();
};
```

- **Pro:** pages.dev visitors land on the custom domain; search engines lose all
  interest in pages.dev.
- **Con:** you must hardcode the exact project name; update the hostname if you
  rename the project.

### Option C - Cloudflare Access password gate

Pages -> Project settings -> Access -> Configure access policy -> apply to all
preview deployments or to the whole site. You can allow an email list or OTP. Free
for up to 50 users.

- **Pro:** the pages.dev URL becomes private (visible only to invited users).
- **Con:** overkill if you only want it out of public sight; you log in on every
  visit.

## Releases (production deploy + prebuilt self-host artifacts)

A `v*` tag is the single promotion ritual: `.github/workflows/release.yml`
builds and uploads the production site (the `deploy` job - see "Deployment
pipeline"), fast-forwards the `release` branch to the tagged commit, and
publishes one build of `dist/` in
three forms: a versioned zip + a fixed-name `dashcamigo.tar.gz`
(plus `SHA256SUMS`) on a GitHub Release, and a container image at
`ghcr.io/amkulikov/dashcamigo` (`latest` + the tag; packaged from the same
already-built `dist/` via `docker/Dockerfile.prebuilt`, not an in-Docker
rebuild). The fixed asset name is load-bearing: the install one-liners in
README / `docs/self-hosting.md` rely on `releases/latest/download/`. The
artifact build gets no env vars, so crash reporting is compiled out (the
production site build in the `deploy` job carries the production env). To cut
a release, tag the `main` commit staging has validated:

```sh
git fetch origin
git tag v2026.07.25 origin/main   # convention: v<yyyy>.<mm>.<dd>[.<n>], zero-padded
git push origin v2026.07.25
```

A manual run of the workflow (workflow_dispatch) builds the same archives as
a run artifact without publishing a release or pushing an image - use it to
dry-run the pipeline.

The ghcr.io package is created by the first tag run and keeps the visibility it
had then - it is never re-synced with the repo, so check package Settings after
any visibility change or a private repo leaves users with a failing `docker
pull`. The package is account-scoped and outlives the repository: deleting the
repo leaves it orphaned, and a re-created repo's `GITHUB_TOKEN` cannot push into
that namespace until the package is deleted or granted Actions access to the new
repo. The image push runs *before* the release is published, so this failure
mode costs the whole release, and a `workflow_dispatch` dry-run does not catch
it (it builds without pushing).

### Release integrity

One-time setup, before the first tag: repo Settings -> General -> Releases ->
enable **release immutability**. Published releases then get platform-locked
assets and tags (nothing - including this account - can swap a published zip
or move its tag), plus an auto-generated signed release attestation.
Consequences the workflow is built around:

- Assets lock at publish time, so the workflow attaches them to a draft and
  publishes once. A published release can never be updated: to re-release,
  cut a new tag (`v2026.07.25` -> `v2026.07.25.1`); a re-run on a released tag
  fails on purpose.
- The workflow also attests build provenance
  (`actions/attest-build-provenance`, the assets listed in that step's
  `subject-path` bound to this repo/workflow/commit via Sigstore). User-facing verification
  commands live in `docs/self-hosting.md`. Attestations are free on public
  repos but require Enterprise Cloud on a private one, so the step is gated on
  repo visibility - a private repo publishes a release without provenance
  rather than failing the job.
- Optional defense-in-depth: a tag ruleset on `v*` (Settings -> Rules:
  Restrict deletions + Block force pushes) protects not-yet-released tags;
  note a repo admin can delete the ruleset, so it guards against accidents,
  not a compromised owner - the immutability above is the real lock.

## GitHub Pages mirror (gh.dashcamigo.app)

The primary site rides the Cloudflare edge, which parts of the audience
cannot always reach (notably RU networks). The mirror serves the same bytes
from GitHub's infrastructure: `mirror.yml` unpacks the published release
artifact (`dashcamigo.tar.gz` - the self-host build: crash reporting
compiled out, CSP delivered as a `<meta>` tag since Pages cannot send
headers) and deploys it to GitHub Pages on every release publish; a
`workflow_dispatch` re-deploys from the latest release.

One-time setup:

1. Repo Settings -> Pages: Source = **GitHub Actions**; Custom domain =
   `gh.dashcamigo.app`; enable Enforce HTTPS once the certificate is issued.
2. DNS (zone dashcamigo.app): CNAME `gh` -> `amkulikov.github.io`,
   **DNS-only** (grey cloud) - proxying it through Cloudflare would put the
   mirror behind the same edge it exists to bypass.
3. Settings -> Environments -> `github-pages` -> Deployment branches and
   tags: add a **tag rule `v*`**. Enabling Pages auto-creates this
   environment restricted to the default branch, and the release-published
   trigger runs with the tag as its ref - without the rule every
   post-release mirror deploy fails on environment protection while the
   manual (main-ref) run passes.
4. GitHub account Settings -> Pages -> **Add verified domain** for
   `gh.dashcamigo.app` (one TXT record). Without it, a dangling CNAME after
   any future Pages teardown lets another GitHub user claim the subdomain
   onto their own Pages site.

The custom domain gives the mirror the site root, so the root-only build
constraint (see "Serving rules" in docs/self-hosting.md) holds without a
subpath flavor. What the mirror lacks: response headers (no header CSP -
the meta CSP covers it; no cache tuning - GitHub's default is acceptable
and sw.js updates use `updateViaCache: "none"`), and the legacy
`_redirects` 301s, which only ever mattered for old dashcamigo.app URLs.
Canonicals point at dashcamigo.app, so the mirror does not compete with
the primary in search. Scope of the hedge: it survives a Cloudflare-edge
outage, not a block of the dashcamigo.app domain itself - the subdomain
dies with the zone.

## What the repo ships for deployment

- `vite.config.ts` - the production build (minifiers, vendor splitting, the
  SEO/SW/CSP plugin chain, the `SENTRY_*`-gated source-map handling). Each
  choice is commented at its site in the file.
- `public/_headers` - cache-control + security headers + CSP in enforce mode
  (the current allowlist and its rationale live in the file itself).
- `public/sw.js` - service worker for the offline PWA precache (app shell). Minified
  by a post-build hook (Oxc).
- `public/manifest.webmanifest` - PWA-installable.
- `public/fonts/` - self-hosted woff2 fonts (generated by `node scripts/fetch-fonts.mjs`).
- `.nvmrc` - the Node version CF Pages builds with (see the build-settings table).

## What is not needed

- A hand-written `_redirects` - the build already emits `dist/_redirects`
  (legacy `/cameras/` 301s, see `vite-plugins/redirects.ts`), and the app is a
  single page with no client-side routing, so no SPA-fallback entry is needed
  on top. (`_redirects` in CF Pages cannot filter by host - for a
  `pages.dev -> custom domain` redirect use Option B above.)
- Cloudflare Workers outside Pages - it is static assets plus optional middleware,
  there is no backend.
- API keys for core functionality - viewing and export run locally.
  `VITE_SENTRY_DSN` is public, not secret (it is visible in the bundle
  anyway), kept in env only for multi-environment convenience.
