# LigoGPS trailers on MPEG-TS

The GPS table follows the last complete TS packet. It is not packetized:
demuxers must stop before it, while telemetry extraction reads the original
file. Keep GPS-trailer detection shared between these consumers in
`src/ts-trailer.ts`. The AV clamp can also cut an unknown suffix when packet
sync establishes the last complete packet.

The trailer contains a big-endian total length, `SKIP` plus GPS magic,
five flag bytes, a little-endian header field, indexed NUL-padded ASCII
slots, then a terminator and another big-endian total length. Both length
copies include the entire trailer. Reject unknown combinations and prefixes
that do not end on the TS packet grid.

Firmware interprets the little-endian field differently. LCAI with hashes
can store either byte length or the exact written slot count; classic LIGO
with ampersands stores capacity, which can exceed the written count on partial
clips. Do not infer the field's meaning from the terminator alone.
The accepted combinations and bounds live in `src/ts-trailer.ts`.

Blackview X5S PRO recordings without GPS can end in an empty table. Parking
clips use a `SKIP` block with zero magic, flags and count. Time-lapse clips
retain the LCAI magic and a nominal slot capacity even though no slots were
written. Accept these shapes only with an empty slot region and the hash
terminator. They need the same AV clamp even though they supply no GPS.

Plaintext speed is km/h. Timestamps are camera-local; preserve gaps in the
record cadence. Course can appear as `A:` or, in the LCAI count dialect,
as a bare number after the x/y/z fields. Zero acceleration components do
not establish that the hardware supplies usable acceleration.

See `scripts/anonymize-ligogps-trailer-ts.mjs` for fixture preparation and
`src/parsers/__fixtures__/ligogps-trailer-ts/real-anonymized.test.ts` for
real-byte regression coverage.
