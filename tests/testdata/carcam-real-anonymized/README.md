# CARCAM 4CH 360-WiFi - real-anonymized fixture

Real MP4 bytes from a CARCAM 4-channel recorder (SigmaStar SoC,
`ssmd` meta track + LIGOGPSINFO encrypted chunks). Coordinates in the
decoded ASCII replaced with sentinel values (50.0 N / 30.0 E + 0.0001°
per record), re-encrypted via the same DecryptLigoGPS reverse algorithm.
The pre-SKIP binary preamble (lat double + lon double + datetime
metadata) zero-filled.

Used for the regression test of the ligogps decoder + carcam plugin
(`__fixtures__/carcam/real-anonymized.test.ts`).

## Files

- `carcam-4ch-front.mp4` (1045 bytes) - 3 LigoGPS samples from a real
  CARCAM 4CH file `REC20250607-180617-527-A.mp4`. Sentinel datetime starts
  at 2025-06-07 18:06:00, sentinel coords 50.0/30.0.

## How to rebuild

```sh
node scripts/anonymize-carcam-mp4.mjs <real-input.mp4> <output.mp4> [numSamples=3]
```
