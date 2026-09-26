# Viidure GPS in MPEG-TS

INNOVV N2 carries a null-padded ASCII GPS record in a private PES. The
record begins with `Viidure`; it is distinct from the binary INNOVV layout.
Use the content marker, not the filename or a fixed PID, to select it.

The supplied recordings advertise the data stream in the PMT and fit each
record in one adaptation-stuffed TS packet. The shared scanner also handles
PES reassembly and read boundaries. See `src/parsers/internal/ts-pes-gps.ts`
and `src/parsers/internal/viidure.ts` for the carrier and record grammar.

The timestamp is UTC; the filename uses the camera's local clock. Do not
apply the filename timezone to the GPS timestamp. The first GPS record can
lag the clip name, and paired cameras need not contain identical GPS records.
Do not clone the front track onto the rear camera.

Speed has an explicit km/h unit. Coordinates use decimal degrees with
separate hemisphere letters. The fields after speed are course, altitude,
and an unidentified integer. The trailing axis values in the samples are
constant placeholders, with no verified scale or mount convention; do not
expose them as measured acceleration.

The field interpretation agrees with the Viidure branch of
[ExifTool M2TS.pm](https://github.com/exiftool/exiftool/blob/master/lib/Image/ExifTool/M2TS.pm).
The public samples come from `scripts/anonymize-viidure-ts.mjs`: only rounded
GPS PES packets survive; video and audio are generated from scratch.
