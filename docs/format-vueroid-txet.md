# Vueroid TXET track GPS format

Source: reverse-engineered from real Vueroid S1 4K Infinite recordings in
N/W and N/E regions. The telemetry layout has no published specification.

Parser: `src/parsers/primitives/vueroid-txet.ts` +
`src/parsers/internal/vueroid-txet-extract.ts`. Anonymizer:
`scripts/anonymize-vueroid-mp4.mjs`.

## Where it lives

A dedicated track inside the MP4:

- `hdlr` handler type `tvxt` (ffprobe shows the handler *name* `TXET`),
  `stsd` sample format `mp4s` with a stock `esds` descriptor.
- Constant 72-byte samples at ~20 Hz, one sample per chunk, media timescale
  1000 with alternating 50/51 ms `stts` deltas.
- The file head also carries small top-level `free` boxes whose payload
  starts with `RECO` - device/track config blobs sub-tagged `1cva` (video:
  dimensions, timescale, SPS/PPS) and `TXET` (this track), plus a `free`
  box with a firmware build date string. The marker gate does not use them
  (header bytes are not always probed); the structural track gate is
  sufficient. A giant trailing `free` box (~50 MB of garbage bytes) is
  preallocated space, not data.

## Sample layout (72 bytes, little-endian)

| Offset | Type | Meaning | Confidence |
|--------|------|---------|------------|
| 0x00..0x27 | - | reserved, all zeros in the corpus | observed in both regional corpora |
| 0x28 | f32 | accel axis A, "g"-like unit, gravity-included | medium - see accel note |
| 0x2c | f32 | accel axis B | medium |
| 0x30 | f32 | accel axis C | medium |
| 0x34 | u16 | packed hemisphere code: `0x0001` = N/W, `0x0005` = N/E | validated against recordings from both regions; other codes unverified |
| 0x36 | u16 | altitude, meters | high (matches terrain, drifts by 1 m) |
| 0x38 | f32 | speed, km/h (degradation policy for a garbage float: `decodeVueroidTxetRow`) | high (haversine-of-track ratio 0.98 vs 1.58 for mph) |
| 0x3c | f32 | latitude, NMEA `DDmm.mmmm`, unsigned | high |
| 0x40 | f32 | longitude, NMEA `DDDmm.mmmm`, unsigned | high |
| 0x44 | u32 | camera-local wall clock stored as fake unix-UTC, 1 Hz granularity | high - see clock note |

Coordinates and the clock field advance at 1 Hz (coordinate steps are not
aligned to the clock-field tick); accel and speed carry real ~20 Hz dynamics.
The **last sample of every observed clip is a fully zeroed terminator row** -
the extractor skips zero-coordinate rows silently (also covers cold-start
no-fix, not present in the corpus).

## Clock is camera-local, not UTC

The u32 at 0x44 follows the camera-local filename clock, stored as fake UTC.
A fix can trail the filename start by one second. Treating the field as UTC
would put the N/W daytime recordings in the middle of the night.
Same treatment as other local-clock formats: every record is flagged
`timeUnsynced` with `relStartSeconds` = media-time offset, so the time layer
re-anchors onto the video window instead of poisoning per-fingerprint TZ
estimation. Per-record pacing within the clip comes from `stts`, not from
the 1 Hz clock field. Both the dead-RTC whole-file fallback and the
isolated-bad-clock per-row skip are specified on `extractFromVueroidTxetTrack`
in `src/parsers/internal/vueroid-txet-extract.ts`.

## Hemisphere validation

The N/W corpus carries `0x0001` at 0x34; the N/E corpus carries `0x0005`.
The longitude sign changes with bit 2 of byte 0x34, not byte 0x35.
Both corpora use unsigned DDmm coordinates and zeroed terminator rows.
Southern-hemisphere codes remain unverified: require a real sample before
extending the accepted code set in `decodeVueroidTxetRow`.

## Accel caveats

The three floats are quantized to 1/256, update at 20 Hz, and their dynamic
part correlates with the speed derivative - an accelerometer. But the static
(gravity) vector magnitude is ~0.6-0.67, not 1.0, so the absolute g scale is
unconfirmed, and the axis-to-vehicle mapping is unknown. The extractor keeps
the values and removes the static component with the shared per-file mean
subtraction (`internal/accel-baseline.ts`); downstream consumes the
magnitude, so unknown axis order is harmless. If a sample with a known
g-event appears, recheck the scale.

## Filename / channel

Filename techniques and the GPS source hint key off `RX_VUEROID` in
`src/parsers/filename/_patterns.ts`. Mode folders come from the
[manufacturer's manual, “Location of Saved File”](https://vueroid.com/wp-content/uploads/2025/02/VUEROID_S1-4K-Infinite_MANUAL_v.1.0.pdf).
`Pevent` is an impact event while parked, not a background parking recording.
`Bookmark` holds screenshots, not recording clips. The `PARK` folder alone
does not distinguish motion recording from time-lapse.

Folder meanings are documented; E/P filename suffixes and the rear channel
remain mnemonic assumptions pending real samples. The `INF` filename token
alone does not establish the recording mode.
