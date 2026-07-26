# Novatek GPS in MPEG-TS private PES ("novatek-ts")

Source: reverse-engineered from two real 180 s clips of a VIOFO A119 V3 in its
MPEG-TS recording mode (model known from the recording's source, not inferred
from the container; filename family `YYYYMMDDHHMMSS_NNNNNN.TS`, 4K HEVC at
~25 Mbps). No vendor string anywhere in
the container; the GPS record struct is byte-identical to the record geometry
of a Novatek freeGPS block - the same chipset muxing into MPEG-TS instead of
MP4.

Parser: `src/parsers/primitives/novatek-ts.ts` +
`src/parsers/internal/novatek-ts-extract.ts`.

## Container layout

- MPEG-TS, 188-byte packets. PMT advertises only two streams: HEVC
  (stream_type 0x24) and AAC (0x0f).
- **The GPS PES is NOT in the PMT.** It rides an unadvertised PID (0x300 on
  both samples; `ffprobe` shows it as a codec-less "unknown" stream). PSI
  parsing therefore cannot find it - both the marker and the extractor detect
  the stream by content and auto-lock the PID, so a firmware with a different
  PMT/PID layout parses without code changes.
- GPS PES: stream_id `0xbf` (private_stream_2 - fixed 6-byte PES header, **no
  PTS**), `PES_packet_length` = 1008. The 1014 PES bytes span 6 TS packets:
  1 PUSI + 5 continuations, the last one padded with adaptation-field
  stuffing.
- Cadence: exactly one PES per second, one record per PES (180 PES on each
  180 s sample; one 2 s gap in one sample - a skipped second, not a reorder).
- Bytes `[44..1008)` of the PES body are zero padding (verified all-zero on
  all 360 real PES). The whole record fits in the PUSI packet on this dialect.

## The B4K prefix dialect (foreign source, no sample)

Blueskysea B4K (Novatek NT96670) writes the SAME record behind a **fixed
164-byte prefix** - ExifTool matches the PES body with
`^(.{164})?(.{24})A[NS][EW]` (M2TS.pm:353-375, v13.55), where the optional
group is that prefix and the A119 V3 above is the case where it is absent. Two
consequences worth knowing before touching this code:

- 164 + 44 overruns what a PES-start packet has left, so this dialect - and
  only this one - forces the extractor to reassemble the PES across TS
  packets. A single-packet probe is *permanently* blind to it.
- The prefix is fixed-size, so there is nothing to hunt for. Do not "scan for
  the `A[NS][EW]` anchor and rebase" (the nvtk_mp42gpx recipe): a fixed offset
  cannot land on a false anchor inside video bytes. Reassembly is gated on a
  cheap pre-filter over the record's hour/minute/second u32 triple, which sits
  far enough ahead of the anchor to often be readable in the PES-start packet -
  but only by 2 bytes on a bare PES header, so an adaptation field or an
  extended header pushes it out of reach. The pre-filter is an optimization,
  never a gate: an unreadable triple must fall through to reassembly, or the
  whole dialect goes silently undetectable on any mux that stuffs the packet.

`RX_NOVATEK_VIOFO` stays `.mp4`-only. Viofo in TS mode writes the 14-digit
`<timestamp>_<counter>.TS` shape (both real samples), which already has its own
filename techniques - extending the Viofo regex to `.ts` would claim names no
observed camera writes.

## Record struct

PES body offset 0, all fields little-endian. Identical to the freeGPS Type-3
record geometry (`src/parsers/internal/freegps.ts`) rebased to 0:

| Offset | Type | Field | Notes |
|---|---|---|---|
| 0 | u32 | hour | camera-LOCAL clock, see below |
| 4 | u32 | minute | |
| 8 | u32 | second | |
| 12 | u32 | year | 2-digit (21 = 2021), expands as 2000+yy |
| 16 | u32 | month | 1..12 |
| 20 | u32 | day | 1..31 |
| 24 | char | fix | `'A'` valid / `'V'` void (skipped) |
| 25 | char | lat hemisphere | `'N'`/`'S'` |
| 26 | char | lon hemisphere | `'E'`/`'W'` |
| 27 | u8 | pad | always 0 |
| 28 | f32 | latitude | `DDmm.mmmm` (NMEA degrees*100+minutes) |
| 32 | f32 | longitude | `DDDmm.mmmm` |
| 36 | f32 | speed | **knots** (verified: haversine-distance/speed median ratio 0.52-0.54 on both samples = the knots factor; km/h would give 0.28) |
| 40 | f32 | course | degrees |

The datetime field order (H M S Y Mo D) and the `'A' N/S E/W \0 lat lon speed
course` tail are exactly freeGPS `LAYOUT_DEFAULT`/`LEGACY`/`ALT` geometry -
only the `freeGPS ` magic and the vendor preamble are absent. Decoding reuses
the shared helpers (`utcSecondsFromYmdhms`, `ddmmToDegrees`, `KNOTS_TO_MS`),
so calendar gates and unit conversions cannot drift from the MP4 freeGPS path.

## Clock is camera-local, not UTC

On both samples the struct time equals the filename's local time while the
coordinates resolve to a UTC+1 region (real UTC is one hour earlier). The
struct clock is therefore the camera's local wall clock. The extractor flags
every record `timeUnsynced` and supplies `relStartSeconds` (offset from the
first record), mirroring the Kenwood local-clock quarantine in `freegps.ts`:
the time layer re-anchors the records onto the video window instead of
poisoning per-fingerprint TZ estimation with local-as-UTC stamps. Because
private_stream_2 has no PTS, the offset baseline is the first record, not
frame 0 - the ~1 s GPS warm-up before the first PES is not recoverable and is
far below GPS-lock ambiguity.

## Marker

Gate order, the probe input and the fallback's cheap "starts like MPEG-TS"
test live in `novatekTsPrimitive.marker` (`src/parsers/primitives/novatek-ts.ts`);
the record signature itself is `isNovatekTsRecordAt` in
`novatek-ts-extract.ts`. What the code does not say: the GPS PES is claimed by
content, not by PSI, so renamed files still parse - and the first GPS PES sits
~1 s of video into the stream (3-4 MB at the observed bitrate), so a
higher-bitrate firmware can push it past the probe window. That single case is
the only reason the filename fallback exists; `parse()` self-rejects with
`WrongFormatError` when it fires on a foreign TS.

Disjoint from the other TS formats by construction: juscar-ts requires the
`LIGOGPSINFO` literal (absent here), and this marker requires the binary
record signature (absent in Juscar's ASCII payload and in the GPS-less generic
HEVC sticks). Negative tests pin both directions.

## Fixture provenance

- `src/parsers/__fixtures__/novatek-ts/synthetic-*.TS` - built by
  `build-synthetic.mjs` in the same folder (packet-level TS writer mirroring
  the real 6-packet PES split; PMT deliberately omits the GPS PID, like the
  real camera).
- `real-anonymized.TS` - `scripts/anonymize-novatek-ts.mjs` over a real
  sample: GPS PES packet groups kept byte-exact (PES header, continuation
  split and AF stuffing are the container quirks the fixture exists to
  preserve) with coordinates patched to a moving sentinel, interleaved into a
  freshly generated HEVC+AAC base. Record count, sentinel coordinates and the
  base-clip recipe are the script's own parameters. Timestamps and
  speed/course are original; no original video/audio bytes reach the fixture.
