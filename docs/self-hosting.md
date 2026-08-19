# Run dashcamigo privately

This guide is for personal and internal installations: a local computer, a home
network or an organization's private server. dashcamigo is a static web app, so
you can run a prebuilt release, use the Docker image, copy the files to an
internal web server or build the project yourself. Recordings stay in the
browser whichever route you choose.

The project is not distributed as a white-label product. These instructions do
not grant permission to publish a separate service under the dashcamigo name,
logo or brand mark. The exact code-license and branding boundary is summarized
at the end of this guide.

If you only want dashcamigo to work offline, you may not need to host it.
[dashcamigo.app](https://dashcamigo.app) can be installed from the browser and
keeps working without a connection after the first visit. Continue below when
you need a private installation you control.

## Choose a setup

- **Node.js is already installed:** [download and run a release](#run-a-release-with-nodejs).
- **You prefer a container:** [run the Docker image](#run-with-docker).
- **You already have nginx, Caddy, a NAS or an internal web server:** download a
  release and follow the [server requirements](#serve-it-on-an-internal-web-server).
- **You want to change the code:** [build from source](#build-from-source).

## Run a release with Node.js

The following commands download the latest release into a `dashcamigo` folder
and start a local server.

macOS or Linux:

```sh
curl -fsSL https://github.com/amkulikov/dashcamigo/releases/latest/download/dashcamigo.tar.gz | tar -xz && npx serve dashcamigo
```

Windows PowerShell (`curl.exe` and `tar` are included with current Windows
versions):

```powershell
curl.exe -fsSL https://github.com/amkulikov/dashcamigo/releases/latest/download/dashcamigo.tar.gz -o dashcamigo.tar.gz; tar -xzf dashcamigo.tar.gz; npx serve dashcamigo
```

Open the local address printed by `npx serve`.

Prefer a regular download? Get `dashcamigo-<version>.zip` from the
[latest release](https://github.com/amkulikov/dashcamigo/releases/latest),
unzip it and run `npx serve dashcamigo`. Extract an update into a fresh folder
so files left over from an older release cannot remain in the installation.

The release archives are built from the same tagged commit as the official
release. They are a separate, environment-free build without the hosted site's
analytics or optional crash reporting. At runtime, they only contact the map
tile service.

### Verify a downloaded release

Every release includes `SHA256SUMS` and signed build provenance. With the
[GitHub CLI](https://cli.github.com) installed and signed in, replace `<tag>`
with the release tag and run:

```sh
gh release verify-asset <tag> dashcamigo.tar.gz -R amkulikov/dashcamigo
gh attestation verify dashcamigo.tar.gz -R amkulikov/dashcamigo \
  --signer-workflow amkulikov/dashcamigo/.github/workflows/release.yml
```

The first command checks that the archive matches the immutable GitHub release.
The second confirms that this repository's release workflow built it from the
recorded commit. The same commands work for the zip archive when you substitute
its filename.

## Run with Docker

The published image supports amd64 and arm64 and needs no volumes or environment
variables:

```sh
docker run -d --name dashcamigo -p 8080:80 ghcr.io/amkulikov/dashcamigo
```

Open [localhost:8080](http://localhost:8080).

With Docker Compose:

```yaml
# docker-compose.yml
services:
  dashcamigo:
    image: ghcr.io/amkulikov/dashcamigo
    ports:
      - "8080:80"
    restart: unless-stopped
```

The image is stateless, so there is nothing to back up. `latest` follows the
newest release; versioned `v*` tags match
[GitHub Releases](https://github.com/amkulikov/dashcamigo/releases).

To build the image from your checkout instead:

```sh
docker build -t dashcamigo .
docker run -d --name dashcamigo -p 8080:80 dashcamigo
```

If other devices will open the app through a NAS or home server, read
[HTTPS and local networks](#https-and-local-networks) before exposing it.

## Build from source

You need Git and the Node.js version required by `package.json`:

```sh
git clone https://github.com/amkulikov/dashcamigo.git
cd dashcamigo
npm ci
npm run build
npx serve dist
```

Open the address printed by `npx serve`. The build needs no accounts, API keys
or local configuration.

All environment variables are optional and documented in `.env.example`. With
none set, crash reporting is left out of the build. The build only needs network
access to install npm packages; fonts and map styles are already in the
repository. A source archive without Git history also builds successfully, but
omits version and page-modification metadata.

`npx serve` is recommended because it handles dashcamigo's extension-less URLs.
`npm run preview` and `python3 -m http.server -d dist` can serve the app itself,
but links such as `/privacy` return 404 without an additional rewrite rule.

## Serve it on an internal web server

Copy the contents of the release folder or `dist/` to the root of the site.
Subpath deployments such as `https://example.com/dashcamigo/` are not supported.

Your server needs these rules:

- Serve a directory index for locale paths such as `/en/` and `/ru/`. The root
  path redirects to the appropriate locale.
- Resolve extension-less pages to their HTML files. For nginx, use
  `try_files $uri $uri.html $uri/ =404`.
- Send `/sw.js` with `Cache-Control: max-age=0, must-revalidate` so returning
  browsers pick up updates promptly.
- Cache hashed files under `/assets/` indefinitely; their names change whenever
  their contents do.

The committed `docker/nginx.conf` is the complete reference for rewrites,
cache headers and the 404 page. `public/_headers` contains the production
security and caching headers, including the Content Security Policy.

## HTTPS and local networks

Some editing and export features require a secure browser context:

- `http://localhost` counts as secure, so a local installation works fully over
  plain HTTP.
- A plain HTTP address on your local network does not. Video, the route, charts
  and original-quality export keep working, but editing, previews, some export
  options and offline caching are unavailable.

Use HTTPS through your web server or reverse proxy when other devices connect
to dashcamigo over the network. The app also explains this limitation when it
detects an insecure address.

## Network access at runtime

In a default self-hosted build, the only external requests are for OpenFreeMap
tiles, sprites and map text. Their URLs live in `public/styles/*.json`.

Without an internet connection, the basemap is blank, but the route, markers,
chart and video continue to work. Nothing else is contacted unless you enable
an optional integration from `.env.example`.

## License and branding

Exports that include overlays carry the dashcamigo.app watermark. Original
quality exports are left untouched.

The source code is available under the AGPL-3.0-only license. If a modified
version is made available to other people over a network, the license requires
its complete source to be offered under the same terms. The **dashcamigo** name,
logo and brand mark are not included in that license and may not identify a
fork, mirror, rehosted copy or separate hosted service. See
[README.md](../README.md#license) and [LICENSE](../LICENSE) for the binding
terms.
