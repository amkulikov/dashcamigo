# SStar firmware - real-anonymized fixtures

Real `ssmd` GPS meta-track bytes from Neoline Spectrum-family and iZEEKER
iD300 clips, repacked into minimal single-track MP4s. Fix-row coordinates
are rounded to whole degrees (~110 km precision); timestamps, speed, course,
the altitude-like word and the real stts cadence are untouched. The iZEEKER
identifier field is replaced with zeroes. Sibling tracks are dropped.

Used for the regression test of the sstar-ssmd extractor
(`src/parsers/__fixtures__/sstar-ssmd/real-anonymized.test.ts`).

## Files

- `neoline-spectrum-front.mp4` (9717 bytes) - all 192 GPS samples (72
  fixes interleaved with 120 no-fix rows) of the real clip
  `INF20260520-214526-1-F.mp4`. The fix rows carry the GPS clock in UTC
  (18:45), the no-fix rows the camera-local RTC (21:45) - the interleaving
  and the UTC-vs-RTC split are the real firmware behavior the extractor
  is tested against. This clip is also the PHANTOM-TRACK sample (parked
  car, fabricated 113-137 km/h fixes): the parse must gate every fix.
- `neoline-spectrum-front-good-signal.mp4` (9189 bytes) - all 181 GPS
  samples (179 fixes, 2 no-fix rows) of the real day-drive clip
  `INF20260520-143412-26-F.mp4`. Good-signal, genuine motion: covers the
  decode path (coordinates, speed, course, 1 Hz clock) on real firmware
  bytes AND pins the phantom-track gate's false-positive boundary - this
  file must parse in full.
- `neoline-spectrum-4k-front.mp4` (14957 bytes) - all 301 GPS samples
  (64 no-fix rows, then 237 fixes at exactly 1 Hz) of the real day-drive
  clip `INF20260725-120324-105-F.mp4` from a Spectrum-family 4K front
  cam. Same layout as the mirror cam but flags base 0x067E instead of
  0x047E - pins the second observed flags dialect on real bytes.
- `izeeker-id300-front.mp4` (12021 bytes) - all 180 GPS samples from an
  iZEEKER iD300. Pins the 56-byte KTRX dialect, its reversible coordinate
  transform and the stale-clock fallback on real bytes. The stable 16-hex
  identifier appended to every source row is `0000000000000000` here.

## How to rebuild

```sh
node scripts/anonymize-sstar-ssmd-mp4.mjs <real-input.mp4> <output.mp4>
```
