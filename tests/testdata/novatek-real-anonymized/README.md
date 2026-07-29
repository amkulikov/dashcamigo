# Novatek freeGPS - real-anonymized fixtures

Real MP4 bytes from real Novatek devices, coordinates replaced with
sentinel values (a fixed synthetic 50.0°N / 30.0°E, unrelated to the
original location). Datetime, speed, course, and structural padding are original -
this covers the **byte layout of real devices**, not an idealized
synthetic one. Used for a regression test (`real-anonymized.test.ts`).

## Files

- `2e-drive-730.mp4` (944 bytes) - 3 freeGPS blocks from a real
  2E Drive 730 Magnet (`2021_1013_183759_050.MP4`). LAYOUT_DEFAULT
  (datetime@44, active@68, lat@72). Dated 2021-10-13.
- `silverstone-a80.mp4` (944 bytes) - 3 blocks from a SilverStone F1 A80-GPS Sky
  (`2019_0216_150750_196.MOV`). Same LAYOUT_DEFAULT. Dated 2019-02-16.
- `viofo-a119-mini2-coldstart.mp4` (2264 bytes) - 4 pre-fix + 4 active blocks
  around the cold-start transition of a real VIOFO A119 Mini 2
  (`20260406142122_000022.MP4`). LAYOUT_ALT (datetime@12, active@36, lat@40).
  Covers the local-as-UTC clock-jump evidence: pre-fix RTC blocks in UTC,
  synced records with the camera zone baked in. Pre-fix blocks carry no
  coordinates by construction (the anonymizer verifies the fix region is
  all zero and aborts otherwise). Dated 2026-04-06.

## How to rebuild

```sh
node scripts/anonymize-novatek-mp4.mjs <real-input.mp4> <output.mp4> [numBlocks=3]
# cold-start fixture (keeps the pre-fix RTC blocks around the transition):
node scripts/anonymize-viofo-coldstart-mp4.mjs <real-input.mp4> <output.mp4> [preFix=4] [active=4]
```

The scripts are kept in `scripts/`. Reproducible given the original file
in `private/incoming/`.

## What is NOT published

- Original lat/lon (replaced with sentinel values).
- Hemisphere bytes (NS/EW rewritten to a fixed N/E).
- Video and audio (skipped; the fixture only contains the free boxes with
  GPS data + a minimal moov/mvhd stub).

Datetime (year/month/day/hour/minute) and speed **are preserved** - the
structural layout matters for the regression test, and these fields
themselves carry no PII.
