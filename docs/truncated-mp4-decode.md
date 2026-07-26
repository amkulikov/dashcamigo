# Truncated / overshooting MP4: the Firefox "native video decode failed" class

A diagnosed playback failure: a dashcam MP4 whose sample table references
bytes past the end of the file. Firefox's native demuxer aborts hard; our
player currently mislabels it as a codec problem. Status: **n=1; the
playback-side failure is unfixed, the export-side manifestation of the same
defect is fixed (last section).**

## The signal

One Sentry event:

- `native video decode failed`, Firefox on Windows, codec `avc`.
- `MediaError.code = 3` (`MEDIA_ERR_DECODE`), `currentTime = 0.513s` when it fired.
- Raw `err.message`:
  `Result<already_AddRefed<MediaRawData>, MediaResult> __cdecl mozilla::SampleIterator::GetNext(void): Sample data byte range beyond end of resource`
- File: ~15.5 MB, ~20 s, single channel `front`, fingerprint `novatek-viofo|...`.
- All capabilities green (`h264Decode`, `webCodecsDecode`, `mediaSource`). One file, one trip.
- Our ingest repairs ran but matched nothing: `repairedHvccCount 0`,
  `repairedPhantomCount 0` (both detected together in
  `src/repair/moov-repair.ts`, inside the `indexMp4` stage).

The error is captured in the native `<video>` `error` handler in
`src/ui/player.ts`; the `MediaError` branch routes through
`handleRuntimeDecodeFailure` (retry, then `markCandidateUnplayable`) and fires
`captureSentryMessage("native video decode failed", ...)`.

## Root cause (verified against Firefox source)

The message comes from `dom/media/mp4/SampleIterator.cpp`,
`SampleIterator::GetNext()`. After building per-sample byte ranges from the moov
sample table at init, it validates each sample on demand, in decode order:

```cpp
mIndex->mSource->Length(&length);     // actual resource (File/blob) size
if (s->mByteRange.mEnd > length) {    // this sample's data runs past EOF
    return Err(NS_ERROR_DOM_MEDIA_RANGE_ERR, "Sample data byte range beyond end of resource");
}
```

It is a **purely structural check** - it never touches the H.264 bitstream. The
moov says a sample lives at `[offset, offset+size)`, but that range exceeds the
file. `NS_ERROR_DOM_MEDIA_RANGE_ERR` is a decode-family error, so Firefox
surfaces it to the HTML `MediaError` API as `code 3`. `loadedmetadata` had
already fired (playback started, `currentTime` advanced), so the moov parsed
cleanly - this is the post-init per-sample path, not a "failed to parse
metadata" failure.

The verbose `__FUNCSIG__` prefix (`Result<...> __cdecl mozilla::SampleIterator::GetNext(void)`)
is the MSVC expansion of the `RESULT_DETAIL` macro on the Windows build, and it
matches byte-for-byte - so the breadcrumb pins this exact line with no ambiguity.

**Meaning:** the file is a broken / truncated / unclean-finalized recording
(classic Novatek/Viofo power-loss), or a single chunk offset / sample size in
the table is garbage. Either way the sample table overshoots the file.

## Why our existing repairs miss it

`src/repair/phantom-track.ts` only neutralizes **non-video** tracks whose chunk
offsets are **all zero** or whose total sample size is zero (a dead audio track
pointing at no data). This defect is different on two axes: the offsets are
**non-zero but past EOF**, and the bad sample may be on the **video** track.
`repairedPhantomCount 0` is therefore correct, not a bug. `repair/hvcc.ts` is for
mislabeled HEVC config and is unrelated. This is a genuinely new failure class.

## The timing argues against a clean tail truncation

The obvious story - "the recording was cut off, so the last bytes are missing" -
does not fit the telemetry. The error fired at `currentTime = 0.513s`, not near
the ~20 s end.

Firefox's `MediaFormatReader` demuxes only modestly ahead of the playhead (a
small decode queue + buffered window, pull-based, not a whole-file pre-scan). So
at 0.5 s it is validating samples near the **start** of decode order. In a
normally written, progressively interleaved MP4, those early-presentation
samples also sit near the **start** of the file in byte terms. A clean tail
truncation removes bytes at the **end**, backing the **last** samples (~19-20 s) -
Firefox would only reach those near `currentTime ~19s`.

So an early 0.5 s failure points to one of:

1. **A garbage / early-in-decode-order offset** on an otherwise complete file
   (a wrong chunk offset, co64-vs-stco misread, or stsc mis-assignment that
   sends an early sample past EOF), or
2. **Gross truncation** - the moov sits at the tail and was written, but most of
   the mdat is gone, so even early-time byte offsets already exceed the surviving
   length.

Both are "the index overshoots near the front", not "the tail was cut".
Consequence: **a naive "drop the tail down to the last valid sample" repair would
not help this file** - the bad reference is early, so trimming the tail leaves it
intact. (Confidence: medium. Without the file we can't exclude a non-monotonic /
oddly interleaved Viofo layout where early presentation time maps to late byte
offsets, which would let a tail truncation fail early.)

## What mediabunny would do (relevant to the MSE-fallback option)

We have a tolerant demuxer in the codebase: the per-file MSE backend
(`PerFileMseBackend`) already routes HEVC-remux and MPEG-TS files through
mediabunny. Would re-routing a native `code 3` AVC failure to it recover
playback? Traced through the mediabunny source shipped in
`node_modules/mediabunny/src/` (version pinned in `package.json`):

- `reader.ts:38` - `requestSlice(start, len)` returns **`null`** when
  `start + len > fileSize`. It does not throw and does not clamp. (Only
  `requestSliceRange`, used for box headers, clamps.)
- `isobmff/isobmff-demuxer.ts`, `fetchPacketForSampleIndex()` - reading a
  sample's data: `if (!slice) return null; // Data is outside`.
- `isobmff/isobmff-demuxer.ts`, `getNextPacket(prev)` - advances strictly to
  `fetchPacketForSampleIndex(idx + 1)`, so it returns that same `null`.
- `feedVideo` in `src/workers/per-file-mse-worker.ts` - the loop is
  `while (pkt) { ...; pkt = await sink.getNextPacket(pkt); }`. On `null` it exits
  cleanly, `output.finalize()` runs at the end of the feed cycle, `FEED_DONE`
  fires. **No `fail()`, no throw.**

So mediabunny **degrades gracefully**: it plays the valid prefix up to the first
overshooting sample, then ends as clean EOS. But it does **not skip** the bad
sample to continue - `getNextPacket` treats `null` as end-of-stream. Therefore:

| Defect shape | MSE-fallback outcome |
|---|---|
| Clean tail truncation (fails ~19-20 s) | Plays ~99 % of the file, stops at the tail. **This is where the fallback is genuinely valuable.** |
| This file (early break ~0.5 s) | Plays only a short prefix, then clean end. |
| Break at the very first keyframe | `getFirstPacket`/`getKeyPacket` return null -> worker does `fail("no-video-keyframe")` -> `markCandidateUnplayable`. Still no crash. |

The native Firefox path **tears down the whole pipeline** on overshoot (code 3,
overlay, nothing plays). mediabunny ends gracefully and the prefix stays
playable - so an MSE-fallback outcome is always `>=` the current one. The earlier
worry "mediabunny might also throw on an overshooting table" is **disproven by
source**: it returns `null`. That makes the fallback **safe** for the whole
"broken/truncated container" class; its **value** is file-dependent (great for
tail truncation, marginal for early breaks like this one).

## What the user sees today (and why it's wrong)

On `code 3`/`code 4`, `markCandidateUnplayable` -> `showCodecUnsupportedOverlay`
(`src/ui/empty-state.ts`) shows the `codecUnsupported.title` copy
(`src/i18n/en.ts`) plus a hint to try Safari/Edge or
export the clip. For a truncated/corrupt file this is **inaccurate**: Firefox
plays AVC fine; the file is broken, not the codec. The "try another browser"
hint is accidentally semi-useful (Chrome's FFmpeg demuxer may play the prefix)
but framed as a codec gap that does not exist.

## Fix options

1. **Message + diagnostics (recommended first step, small).**
   Split `code 3` (DECODE -> "this recording is damaged or incomplete") from
   `code 4` (SRC_NOT_SUPPORTED -> the current codec message) in the native
   `<video>` `error` handler in `player.ts` (the `handleRuntimeDecodeFailure`
   call site) and add a `*.error.*`-style key (ru + en). Separately, at
   ingest - where we already build the `Mp4Index` and read sample tables - detect
   "sample table overshoots EOF" (`max(offset + size)` vs `file.size`), and put
   the first-overshooting sample index, the overshoot amount, and the track type
   (`vide`/`soun`) into the Sentry tags. Cheap, correct regardless of the exact
   defect, and it classifies the next occurrence so we stop guessing.

2. **MSE-fallback on `code 3` (medium).**
   Re-attach a native-decode-failed AVC candidate through `PerFileMseBackend`.
   Proven safe above. Guards needed: mark the candidate "native failed" so a
   stale error can't re-trigger the fallback in a loop; only on `code 3`/`4`
   (not `1`/`2`); converge on `markCandidateUnplayable` if MSE also gives up;
   distinct Sentry fingerprint so a `native` and an `mse` failure don't collapse
   into one signal. Worth it as a general defense for the broken-container class,
   not specifically for this file (early break -> short prefix only).

3. **Truncation-repair module in `src/repair/` (medium-large, not advised under n=1).**
   Detect the overshoot and rewrite the moov to drop the bad samples. Unlike
   phantom-track's constant-size `entry_count` zeroing, dropping samples shortens
   `stsz`/`stco`/`stsc`/`stts` and forces a box-size recompute up the whole tree
   (`stbl -> minf -> mdia -> trak -> moov`), ~700 lines with a re-parse
   validation pass. And per the timing analysis it likely would not help this
   file (the overshoot is early, not a droppable tail). Revisit only if we obtain
   a real sample and confirm a clean-tail case.

## Recommendation

Do (1) now - it fixes an actively wrong message and turns the next n=1 into
classified data, with no guessing. Defer (2) and (3) until the diagnostics
confirm the defect distribution, or until a user sends a real file to
`feedback@dashcamigo.app` that we can reproduce. (2) is the better structural bet
of the two if we decide to recover playback, because it covers the whole class
safely; (3) is narrow and expensive.

## Export-side manifestation (same family, fixed)

The same "power-cut recording, incomplete last GOP" defect also breaks **export**,
on a different axis than the Firefox playback signal above:

- Reproduced (n=1, real Juscar multichannel TS): the last file of the recording
  (`...152434F/R.ts`, ~137 s) decodes cleanly to ~135 s then its WebCodecs
  `VideoDecoder` fires `EncodingError: Decoding error` on the truncated tail.
  Both channels fail (~134.7 s rear, ~135.3 s front). The preceding full-length
  files decode end to end. Verified in isolation - a single `VideoSampleSink`
  over one file throws at the same frame, so it is the bitstream, not the
  concurrent decode/encode load (2x 1440p decode + encode runs clean on the
  good file). The mediabunny stack pointing at `_createDecoder` is misleading: it
  captures the decoder-creation stack and reattaches it to the decoder's async
  `error` callback (the capture sits in mediabunny's `media-sink`
  `_createDecoder`).
- Why the player survives but export did not: the player remuxes TS -> fMP4 and
  decodes through the browser's MSE pipeline (error concealment, just stops near
  the end); export decodes through a raw WebCodecs `VideoDecoder` (fail-on-error),
  so one bad frame aborted the whole multi-minute re-encode.
- **Fix:** the re-encode pipelines (`pipeline.ts`, `pipeline-split.ts`)
  pull samples through `nextTolerant` (`pipeline-common.ts`): a non-`AbortError`
  decode failure resolves to a graceful end-of-stream instead of throwing. The
  clip finalizes with the frames decoded so far; in split, a master-slot failure
  ends the loop and a non-master slot freezes on its last frame. `TranscodeResult.
  decodeTruncated` surfaces a soft `export.notify.damagedEnd` notice so the early
  cut is not silent. Stream-copy is unaffected - it copies encoded packets without
  decoding (the truncated tail's packets are structurally present and copy fine).
- Not addressed here: trimming the undecodable tail at ingest so the player/chart/
  export agree on the usable duration. That is the bigger data-contract change
  (option parallel to the playback fixes above); the pipeline tolerance is the
  localized fix and matches the "broken/truncated recording" reality.
