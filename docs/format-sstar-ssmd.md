# SStar ssmd GPS format (Neoline Spectrum)

GPS embedded as a dedicated `ssmd` meta track of constant 40-byte samples at
~1 Hz, written by the SigmaStar ("SStar") firmware family. Confirmed
cameras: Neoline Spectrum mirror cam and a Spectrum-family 4K front cam
(ffprobe handler names `SStar Video` / `SStar Audio` / `SStarMeta`;
filename pattern `INF<YYYYMMDD>-<hhmmss>-<seq>-<F|R>.mp4`, `RX_NEOLINE` in
`src/parsers/filename/_patterns.ts`). The two differ only in the flags-word
base (see the layout table).

Reverse-engineered and validated against 3 real mirror-cam clips (528 GPS
samples: an all-fix highway drive, a cold-start clip with sparse fixes, a
night drive with sparse fixes) plus one 4K-cam day-drive clip (301 samples:
a 64-row no-fix acquisition lead-in, then 237 fixes at exactly 1 Hz).
Every interpretation below is tagged with its verification. Extractor:
`src/parsers/internal/sstar-ssmd-extract.ts` (constants live there, not
here).

## Container shape

Each MP4 carries THREE `ssmd` meta tracks (all handler `meta`, sample
format `ssmd`):

1. **JPEG thumbnail** - a single sample, starts `ff d8 ff e0 ... JFIF`.
2. **GPS** - constant 40-byte samples, ~1 Hz (media timescale 90000, stts
   deltas jitter around 90000). This is the parsed track.
3. **Telemetry** - constant 12-byte samples at ~15 Hz: three little-endian
   u32-sized fields, ranges consistent with an accelerometer/G-sensor but
   the axis convention, scale and zero offset could not be verified against
   ground truth. **Unparsed** - do not decode without a calibration capture
   (a clip with known maneuvers).

The `ssmd` sample-description name is multi-vendor (LigoGPS 64..1024-byte
chunks, Chigee JPEG previews, Rove 32-byte GPS + 12-byte accel). The
constant-40 stsz gate plus a first-sample content probe keep this extractor
disjoint from all of them - see the marker in
`src/parsers/primitives/sstar-ssmd.ts`.

## GPS sample layout (40 bytes, little-endian)

| Offset | Type | Meaning | Verification |
|---|---|---|---|
| 0 | f64 | latitude, decimal degrees (NOT NMEA DDmm) | high: matches the known recording region; consecutive-fix haversine agrees with the speed field |
| 8 | f64 | longitude, same convention | high (same checks) |
| 16 | i32 | altitude-like: smooth small values on good-signal rows, drifts wildly (even negative) on poor-signal rows; -1 on no-fix | low: meters is the best fit; ruled out course and speed. Not extracted (GpsRecord has no altitude) |
| 20 | u16 | speed, km/h integer; 0xFFFF on no-fix | high: mean error 4.4 km/h vs haversine over 179 adjacent-fix pairs on the good-signal clip (raw/10 and knots candidates were off by 80+ km/h) |
| 22 | u16 | flags: a constant per-camera base + the 0x0100 fix bit. Observed bases: 0x047E (mirror cam), 0x067E (4K front cam); the 0x0200 delta is undeciphered and never varied within a clip | high: agreement between the fix bit and the coordinate sentinel was exact across all samples of both cameras |
| 24 | u8 x4 | day-of-month, hour, minute, second - **no year/month anywhere in the record** | high: 1 s steps between adjacent fixes; hour matches the filename clock (see the UTC-vs-RTC quirk) |
| 28 | u8 | course over ground / 2 (2-degree units, 0..179); 0 also appears on clearly-moving rows = "not updated" (the extractor forward-fills it from the previous record) | high: mean circular error 1.8 deg vs movement bearing over 142 clean moving pairs |
| 29 | u8 x3 | constant `01 01 00` on fix rows; on no-fix rows bytes 28..31 are `ff 00 ff ff` | observed constant, not decoded |
| 32 | u32 | 0 before the first fix after boot, 1 from the first-fix sample onward | verified exactly (flip index == first-fix index); not decoded |
| 36 | u32 | always 0 | observed constant |

No-fix rows write the LE double 4294967295.0 (`00 00 e0 ff ff ff ef 41`)
into BOTH coordinate slots - the same sentinel value the Rove 32-byte ssmd
dialect uses for latitude only. No-fix rows are skipped silently by the
extractor (routine satellite acquisition).

Hemisphere: no N/S/E/W field in the 40 bytes; signed doubles assumed (all
real samples are N/E) - same caveat as rove-ssmd/navitel-gps0.

## The UTC-vs-RTC clock quirk

The day/hour/minute/second quartet changes meaning with the fix bit:

- **Fix rows**: the GPS clock in **UTC** (verified on all mirror-cam clips:
  fix-row hours run exactly the camera's TZ offset behind the filename clock).
- **No-fix rows**: the camera RTC in **local time** (verified on the
  mirror-cam clips and the 4K-cam clip: no-fix-row hours match the filename
  clock exactly, confirming the fix/no-fix split holds across both cameras).

The extractor therefore only ever reads time from fix rows.

## Year/month derivation

Records carry no year/month, so the extractor anchors the record's
day-of-month + time-of-day to the calendar date found in the filename
(`INF<YYYYMMDD>-...`, camera-local; the strict Neoline name shape is
preferred over a generic YYYYMMDD scan so a renamed file with a foreign date
run cannot poison the anchor). A clip is minutes long and |TZ| <= 14 h,
so the true UTC date is within one day of the anchor - that invariant is what
makes the day-of-month match unambiguous. The matching itself (and its
rollover handling) lives in `utcMsFromAnchoredDayTime`,
`src/parsers/internal/sstar-ssmd-extract.ts`. An anchor that no fix row matches is
treated as untrusted (foreign date run) rather than dropping the records.
Fallback chain and the no-anchor path (timeUnsynced + media-time pacing):
`extractFromSstarSsmdTrack` in `src/parsers/internal/sstar-ssmd-extract.ts`.
The real firmware writes mvhd creation_time = 0, so the mvhd fallback is
untested in the wild.

## Cold-start caveat

The firmware can flag rows as "fix" while the GPS clock is not yet synced:
on the cold-start clip the first fixes ran ~90-105 s ahead, then jumped
backward once the clock locked, and the pre-sync positions were off by tens
of km. Another real clip carried fixes ~104 s BEHIND real time with correct
positions/speeds and no resync inside the clip at all. No in-record field
distinguishes such rows (the +32 flag flips at the first fix, i.e. before
the clock locks). Two defenses, both in `extractFromSstarSsmdTrack`
(`src/parsers/internal/sstar-ssmd-extract.ts`):

- A synced GPS clock advances WITH media time, so any clock step deviating
  from the elapsed media time beyond jitter is the sync moment (backward =
  clock ran ahead, forward excess = clock ran behind); fixes before the last
  such step are dropped into the skipped diagnostics.
- A whole-file stale clock (never resyncs) is invisible to the scan above, so
  the clip-start UTC implied by the last fix is cross-checked against the
  filename time: the difference must sit on the 15-min TZ grid within an RTC
  drift tolerance. Off-grid demotes every fix to timeUnsynced (positions and
  media offsets kept, absolute times and videoStartUtcHint dropped) - the
  time layer re-anchors the file via the filename/run-offset machinery.

## Phantom-track caveat

Under weak signal (urban canyon, night parking between high-rises) the
receiver emits fully-flagged fixes carrying a self-consistent FICTIONAL
trajectory: a parked car (verified frame-by-frame against the video) gets a
smooth 113-137 km/h track with a slowly rotating course, positions gliding
~35 m/s in agreement with the speed field, and a CORRECT GPS clock. The
firmware knows - its OSD hides the speed readout on such stretches while
still printing the (equally fictional) coordinates - but the ssmd rows are
bit-for-bit indistinguishable from good fixes, and the fabricated track is
internally consistent, so no per-row filter can catch it.

Defense is a whole-file quality gate in `extractFromSstarSsmdTrack`
(`PHANTOM_*` constants and the threshold rationale live there): a high
no-fix share plus a high share of adjacent-fix pairs whose haversine-implied
speed contradicts the recorded speed field condemns every fix in the file.
Positions and speeds are dropped; the frame-0 clock hint survives (the clock
is the one honest field - the stale-clock gate owns clock trust). The
registry treats "zero records + hint" as a positive claim, so the file does
not fall through to other extractors and the skip diagnostics survive.
Known cost: a weak-signal clip whose sparse fixes are genuine is condemned
with the same verdict. Known limitation: a phantom under a clean sky (no
no-fix rows) would pass.

## Fixtures

- Synthetic: `src/parsers/__fixtures__/sstar-ssmd/` (builder:
  `build-synthetic.mjs` next to them).
- Real-anonymized: `tests/testdata/sstar-ssmd-real-anonymized/` (builder:
  `scripts/anonymize-sstar-ssmd-mp4.mjs`).
