# Vantrue N2X - real-anonymized fixture

Real freeGPS blocks from a Vantrue N2X (NMEA-embedded variant: ASCII
$GNRMC sentence at offset ~100 in the payload). Coordinates in the NMEA
replaced with sentinel values (50.0 N / 30.0 E + 0.0001° per record), the
binary preamble (lat double + lon double + datetime metadata, bytes 16-99
of each block) zero-filled.

Used for the regression test of the novatek plugin's variantVantrueNmea
(`__fixtures__/vantrue/real-anonymized.test.ts`).

## Files

- `vantrue-n2x.mp4` (944 bytes) - 3 freeGPS blocks from a real Vantrue
  N2X file `20241223_195136_00305_N_A.MP4`. Sentinel datetime starts at
  2025-06-07 18:06:17, sentinel coords 50.0/30.0.

## How to rebuild

```sh
node scripts/anonymize-vantrue-mp4.mjs <real-input.mp4> <output.mp4> [numBlocks=3]
```
