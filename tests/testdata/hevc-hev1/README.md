# hevc-hev1

Synthetic HEVC clip for the e2e suite, **not** a real recording.

- `sample-hev1.mp4` - 2s, 640x360, `testsrc2` pattern, no audio, no GPS.
  Encoded `libx265` with the **`hev1`** sample-entry tag (`-tag:v hev1`).

The `hev1` tag is what matters: native `<video>.src` renders it black, so the
viewer routes it through `needsHevcRemux` -> the per-file MSE backend (mediabunny
remux). This is the BlackVue ELITE / Vantrue playback path that was otherwise
manual-only. The e2e test (`tests/e2e/hevc.spec.ts`) skips itself on platforms
whose browser cannot decode HEVC (e.g. many Linux CI runners).

Regenerate:

```sh
ffmpeg -y -f lavfi -i testsrc2=size=640x360:rate=30:duration=2 \
  -c:v libx265 -tag:v hev1 -pix_fmt yuv420p -an -movflags +faststart \
  tests/testdata/hevc-hev1/sample-hev1.mp4
```
