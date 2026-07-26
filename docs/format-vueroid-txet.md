# Vueroid TXET track GPS format

Source: reverse-engineered from two real 60-second clips of a Vueroid S1 4K
"Infinite" (2384 samples total). No public spec exists - exiftool, dashcamtalk
and GitHub carry nothing on this track layout, and Vueroid documents only its
own PC viewer. Expect correction as new samples appear.

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
| 0x00..0x27 | - | reserved, all zeros in the corpus | assumption (0 nonzero bytes across 2384 samples) |
| 0x28 | f32 | accel axis A, "g"-like unit, gravity-included | medium - see accel note |
| 0x2c | f32 | accel axis B | medium |
| 0x30 | f32 | accel axis C | medium |
| 0x34 | u8 | lat hemisphere: 1 = N, 0 = S | **assumption** - see hemisphere note |
| 0x35 | u8 | lon hemisphere: 1 = E, 0 = W | **assumption** - see hemisphere note |
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

The u32 at 0x44 equals the local filename time (`YYYYMMDD_HHMMSS_...` -> the
first row decodes to exactly that HH:MM:SS as "UTC") and the mvhd
creation_time, while the implied UTC would put this daytime recording in the
middle of the night for the region the coordinates fall in.
Same treatment as other local-clock formats: every record is flagged
`timeUnsynced` with `relStartSeconds` = media-time offset, so the time layer
re-anchors onto the video window instead of poisoning per-fingerprint TZ
estimation. Per-record pacing within the clip comes from `stts`, not from
the 1 Hz clock field. Both the dead-RTC whole-file fallback and the
isolated-bad-clock per-row skip are specified on `extractFromVueroidTxetTrack`
in `src/parsers/internal/vueroid-txet-extract.ts`.

## Hemisphere: single-hemisphere corpus assumption

Both flags are constant across the corpus: (1, 0) on every fix row of an
N/W-hemisphere recording, (0, 0) on the zeroed terminator rows. That is
consistent with "0x34 = north, 0x35 = east", but equally with a u16
fix-status field. Nothing else in the container carries a hemisphere.
**Revalidate on the first
S- or E-hemisphere sample** (Vueroid is a Korean brand - a domestic clip is
N/E): if such a clip decodes to negative longitude, 0x35 is not "east".

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

`YYYYMMDD_HHMMSS_INF_F_N.mp4` - local datetime, fixed model tag `INF`,
channel `F`/`R`, mode `N`/`E`/`P`. Filename techniques and the GPS source
hint key off `RX_VUEROID` in `src/parsers/filename/_patterns.ts`.
