# Asymmetric camera cuts

Synthetic footage for [the playback regression](../../e2e/asymmetric-channels.spec.ts).
The cameras cut files at different moments while recording the same continuous session.
All pixels are generated; there is no source video, audio or GPS.

Regenerate with `node scripts/make-asymmetric-channels-fixture.mjs` from the repository root.
