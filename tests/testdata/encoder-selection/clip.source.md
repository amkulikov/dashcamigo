# Encoder selection input

Synthetic video generated locally with FFmpeg's `testsrc2` filter. It contains
no captured media or location data and is distributed under the repository's
license.

The frame rate matches the worker probe scenarios in
`tests/e2e/encoder-selection.spec.ts`, so the full export test exercises the
same native rate-control conditions when checking the software notification.

Regenerate from the repository root:

```sh
ffmpeg -y -f lavfi -i testsrc2=size=640x360:rate=25:duration=2 \
  -c:v libx264 -profile:v high -pix_fmt yuv420p -g 25 -movflags +faststart \
  tests/testdata/encoder-selection/clip.mp4
```
