# Self-hosting / running locally

dashcamigo is a static, no-backend web app: the build output (`dist/`) is plain
files, recordings never leave the browser, and any static file server can host
it. Prebuilt zips are attached to
[GitHub Releases](https://github.com/amkulikov/dashcamigo/releases); building
it yourself needs no accounts, no keys and no configuration.

**Maybe you don't need self-hosting at all.** If the goal is an app that works
offline, [dashcamigo.app](https://dashcamigo.app) installs as an app straight
from the browser (the Install button in Chrome/Edge, Add to Dock/Home Screen
in Safari) - it keeps working offline after that, with no terminal, no
downloads and no setup. The paths below are for running your own copy.

Pick the path that matches what you already have:

- **A web server you already run (nginx, Caddy, NAS, ...)** ->
  [Prebuilt zip](#prebuilt-zip) into its web root, per the
  [serving rules](#serving-rules-any-server)
- **Node.js or Python installed** -> [Prebuilt zip](#prebuilt-zip), served
  with a one-liner
- **Docker, nothing else** -> [Run with Docker](#run-with-docker)
- **Hacking on the source** -> [Run from source](#run-from-source)

## Prebuilt zip

With Node.js installed, one line downloads the latest build into a
`dashcamigo` folder in the current directory and serves it.

macOS / Linux:

```sh
curl -fsSL https://github.com/amkulikov/dashcamigo/releases/latest/download/dashcamigo.tar.gz | tar -xz && npx serve dashcamigo
```

Windows (PowerShell - `curl.exe` and `tar` ship with Windows 10+; `curl.exe`
with the extension, the bare name is a PowerShell alias for something else):

```powershell
curl.exe -fsSL https://github.com/amkulikov/dashcamigo/releases/latest/download/dashcamigo.tar.gz -o dashcamigo.tar.gz; tar -xzf dashcamigo.tar.gz; npx serve dashcamigo
```

Re-running the line extracts the new release over the same folder - delete
the folder first for a guaranteed-clean update. Prefer clicking? Download
`dashcamigo-<version>.zip` from the
[latest release](https://github.com/amkulikov/dashcamigo/releases/latest),
unzip it, and serve the `dashcamigo` folder it contains the same way:
`npx serve dashcamigo`.

Both archives are built from the same commit the official site deploys, with
no environment variables set - so crash reporting is compiled out and the app
contacts nothing except the map tiles. Open the
printed `http://localhost:...` URL. Or copy the folder's contents into your
web server's root - see the [serving rules](#serving-rules-any-server).
`python3 -m http.server` also works, with one caveat: the extension-less
pages linked from the footer 404 there.

Releases are published immutable, and every asset (`SHA256SUMS` included)
carries a signed build provenance. To verify a download (needs the
[GitHub CLI](https://cli.github.com), logged in; same commands work for the
zip):

```sh
gh release verify-asset <tag> dashcamigo.tar.gz -R amkulikov/dashcamigo
gh attestation verify dashcamigo.tar.gz -R amkulikov/dashcamigo \
  --signer-workflow amkulikov/dashcamigo/.github/workflows/release.yml
```

The first proves the file is byte-identical to the immutable release asset;
the second proves it was built by this repository's release workflow from a
specific commit.

## Run with Docker

No Node.js required, same command on Windows, macOS and Linux. The prebuilt
image (amd64 / arm64) serves exactly the files the release archives carry -
the release workflow packages the same build it attests:

```sh
docker run -d --name dashcamigo -p 8080:80 ghcr.io/amkulikov/dashcamigo
```

Then open http://localhost:8080. Or with compose:

```yaml
# docker-compose.yml
services:
  dashcamigo:
    image: ghcr.io/amkulikov/dashcamigo
    ports:
      - "8080:80"
    restart: unless-stopped
```

The image is stateless: no volumes, no environment variables, nothing to back
up. `latest` tracks the newest release; `v*` image tags match
[Releases](https://github.com/amkulikov/dashcamigo/releases). Prefer building
your own? The committed `Dockerfile` builds the app inside the image, from a
clone: `docker build -t dashcamigo . && docker run -d -p 8080:80 dashcamigo`.

Exposing it beyond localhost (NAS, home server): read
[HTTPS, localhost, and what degrades](#https-localhost-and-what-degrades-without-them)
first.

## Run from source

Requirements: [Node.js](https://nodejs.org) at the version `engines` in
`package.json` requires, and git.

```sh
git clone https://github.com/amkulikov/dashcamigo.git
cd dashcamigo
npm ci
npm run build
npx serve dist
```

Then open the printed `http://localhost:...` URL. `npx serve` is the
recommended one-liner because it resolves the extension-less URLs the app
links to (see "Serving rules") out of the box.

Alternatives, both with the same small caveat - the app itself works, but the
extension-less pages linked from the footer 404:

- `npm run preview` - Vite's preview server on the production build.
- `python3 -m http.server -d dist`

`npm run dev` is for hacking on the source, not for serving.

## What the build needs

- **No secrets.** Every environment variable is optional and defaults to off;
  `.env.example` documents each one. A build with none set contains no crash
  reporting.
- **No network beyond the npm registry.** Fonts and map styles are committed;
  nothing is fetched at build time (what each style loads at runtime lives in
  `public/styles/*.json`).
- **Git history is optional.** Building from a tarball only omits
  version/`lastmod` metadata; it does not fail.

## Serving rules (any server)

- Serve `dist/` at the **site root**. Subpath deployments
  (`http://host/dashcamigo/`) are not supported - absolute `/...` URLs are
  baked into the build.
- The app lives at `/<lang>/` (`/en/`, `/ru/`, ...); `/` is a small redirect
  page. Directory index (`/en/` -> `/en/index.html`) is required; every common
  server does this.
- Clean URLs: internal links use extension-less paths (`/privacy` ->
  `privacy.html`). nginx: `try_files $uri $uri.html $uri/ =404`. `npx serve`
  does this by default.
- Do not long-cache `/sw.js` (send `Cache-Control: max-age=0,
  must-revalidate`), or returning browsers will be slow to pick up a new
  deployment. Hashed `/assets/*` files are immutable and safe to cache
  forever. `public/_headers` is the reference for everything Cloudflare Pages
  sends in production, including a Content-Security-Policy worth adapting if
  your server can send one.

## HTTPS, localhost, and what degrades without them

The editor features (export re-encode, preview thumbnails) use browser APIs
that only exist in a secure context:

- `http://localhost` **is** a secure context - a local run is fully
  functional over plain http.
- Plain `http://` on a LAN IP (the "runs on the NAS, opened from the phone"
  setup) is **not**: viewing, the map, the chart and stream-copy export keep
  working, but editing/export/thumbnails are off and the offline cache is
  skipped. The app tells the user so (i18n `caps.notice.insecureContext`).
  Put it behind HTTPS - any reverse proxy - to get everything back.

## External services at runtime

The only external dependency of a default build is the map base layer: tiles,
sprites and glyphs come from OpenFreeMap (URLs live in `public/styles/*.json`).
Without internet the basemap is blank but the route, markers, chart and video
all keep working. Nothing else is contacted.

## Branding

Re-encoded exports carry the dashcamigo.app watermark
(`src/transcode/watermark.ts`); stream-copy ("original") exports are untouched.
Per the trademark note in `README.md`, a public fork must rename the mark along
with the rest of the brand.

## Reference config

The committed `Dockerfile` and `docker/nginx.conf` implement everything above
(rewrites, cache headers, 404 page). Running your own server? Translate
`docker/nginx.conf` - it is annotated for exactly that.
