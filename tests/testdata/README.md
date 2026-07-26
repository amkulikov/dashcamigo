# Public test data

Public samples of dashcam formats for parser tests. Unlike
`private/` (the user's personal recordings, gitignored), this folder
**is committed to the repo**.

## Where these come from

Samples come from public sources: GitHub repos of open-source parsers,
forum attachments (dashcamtalk.com, reddit r/Dashcam), issue trackers,
manufacturer documentation sample sets.

## What's inside

```
tests/testdata/<vendor>/
  <sample>.mp4              - processed sample (via scripts/anonymize-mp4.mjs)
  <sample>.txt / .gpx / ... - text formats (via scripts/anonymize-<vendor>-log.mjs)
  <sample>.source.md        - source metadata (URL, date, license)
```

## Rules

- **Every file goes through anonymization**, even if the original was
  publicly posted by a user. MP4s are trimmed to 2 seconds via testsrc2,
  coordinates in text logs are rounded to whole degrees. The goal is
  fixture compactness (size matters in a repo) plus a safeguard in case
  the original public post contained more than the user intended to show.
- **Every file is accompanied by `<filename>.source.md`** with:
  - the source URL (forum post / GitHub blob / etc),
  - the date it was obtained,
  - the license / explicit permissions if any,
  - the model / firmware if stated in the source.
