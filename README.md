# dashcamigo — your dashcam player, right in the browser

<p>
  <a href="https://dashcamigo.app"><kbd>&nbsp;&nbsp;dashcamigo.app&nbsp;&nbsp;</kbd></a>&ensp;
  <a href="https://gh.dashcamigo.app"><kbd>&nbsp;gh.dashcamigo.app · mirror&nbsp;</kbd></a>&ensp;
  <a href="https://beta.dashcamigo.app"><kbd>&nbsp;beta.dashcamigo.app&nbsp;</kbd></a>
</p>

<p align="center">
  <a href="https://dashcamigo.app">
    <img src="docs/screenshots/readme-hero.webp" alt="dashcamigo on desktop (dark theme) and on a phone (light theme): a two-camera trip with front and rear video side by side, a speed and G-force chart, and the speed-colored route on a map">
  </a>
</p>

dashcamigo turns the recordings on your dashcam's SD card into complete,
easy-to-browse trips. Choose the card's folder and it joins the clips, keeps
every camera in sync and plays straight through file boundaries. Your route,
speed and G-force appear alongside the video, making it easy to find the
moment you need.

Trim any part of a trip and save it as an MP4. Keep the original video quality,
or combine cameras and burn the speed, map and G-force overlays into the frame.
It is the viewer your dashcam should have come with — only it works across many
popular cameras.

Everything happens in your browser. There is no backend and no upload: your
recordings never leave your device. Beyond loading the app itself, the hosted
version contacts the map service, collects anonymous aggregate usage data and,
if the app crashes, sends an anonymized report unless you opt out in Settings
([privacy](https://dashcamigo.app/privacy)). The prebuilt self-hosted release
contains neither analytics nor crash reporting.

[Supported cameras](#supported-cameras) | [Self-hosting](#self-hosting) | [Contributing](CONTRIBUTING.md) | [License](#license)

## Getting started

- [**dashcamigo.app**](https://dashcamigo.app) — the latest stable release.
- [**gh.dashcamigo.app**](https://gh.dashcamigo.app) — the same release on
  GitHub Pages, ready when the main site is unavailable.
- [**beta.dashcamigo.app**](https://beta.dashcamigo.app) — a preview of what is
  coming next, updated with every push to `main`.
- **Install it** — open any version and install it from your browser. After the
  first visit, it can open without a network connection.
- [**Run a private copy**](#self-hosting) — use Node, Docker or an internal web
  server.

## Features

- **Continuous playback:** clips flow into one trip, with every camera kept in
  sync.
- **Map and charts:** the route is colored by speed and a marker follows the
  video. Hover over the route or chart to jump straight to that moment.
- **Events:** harsh braking is detected from the G-force data and marked on the
  chart.
- **Export:** trim the trip, arrange cameras side by side, add a watermark, and
  keep the GPS data in the MP4 or save it as GPX.
- **Blur:** mark license plates and faces yourself or let beta detection find
  them; dashcamigo tracks them as they move and blurs them in the exported
  video. This all runs on your device.
- **Desktop and mobile:** use dashcamigo in your language and keep it available
  offline after the first visit.
- **Broad browser support:** viewing works in any current browser. Some export
  options and the map need newer browser features; see the exact boundaries in
  [docs/browser-support.md](docs/browser-support.md).

## Supported cameras

Support for every GPS format comes from a real recording or a verified
open-source reference — never guesswork. See the current list in
[docs/gps-format-coverage.md](docs/gps-format-coverage.md).

Don't see your camera yet? You can help us add it:

- In the app, turn the card's file list into a report you can send us — see
  [dashcamigo.app/add-my-camera](https://dashcamigo.app/add-my-camera).
- On GitHub, open a camera-support issue.

## Self-hosting

Self-hosting here means a personal or internal installation: on your computer,
home network or an organization's private server. The
[self-hosting guide](docs/self-hosting.md) covers Node.js, Docker, HTTPS,
updates and release verification. It is not a white-label distribution guide
or permission to publish a separate service under the dashcamigo identity.

## Built with

- [Mediabunny](https://github.com/Vanilagy/mediabunny) — video playback and MP4
  export.
- [MapLibre GL JS](https://github.com/maplibre/maplibre-gl-js) — the route map.
- [Chart.js](https://github.com/chartjs/Chart.js) — speed and G-force charts.
- [ONNX Runtime](https://github.com/microsoft/onnxruntime) — on-device plate and
  face detection.
- [OpenFreeMap](https://openfreemap.org) — keyless vector map tiles.

## License

[AGPL-3.0-only](LICENSE). In plain English:

- The license permits using, modifying and self-hosting the code under its
  terms.
- If you run a modified version for others to use over a network, you must
  make its complete source available under the same license.
- Like any free software, dashcamigo comes without a warranty or liability for
  damages.

This is a summary, not legal advice — [LICENSE](LICENSE) is the binding text.

The **dashcamigo** name, logo and brand mark are separate from the code license.
They may not be used to brand a fork, mirror, rehosted copy or separate hosted
service.
