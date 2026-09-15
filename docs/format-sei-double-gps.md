# GPS in an HEVC SEI track

Some UBIA-produced MP4 clips put GPS in a second `hvc1`/`vide` track rather than a metadata track. Its samples are 40-byte HEVC prefix-SEI NAL units with no decodable picture. A player that chooses the first video track plays normally; a GPS parser that only checks `meta` and subtitle tracks misses the coordinates.

The packet starts with a length-prefixed `4e 01` NAL and a small elapsed-second counter. A no-fix packet has a zeroed payload. A fix packet contains east/west and north/south flags (`EN` in the observed clip) and two little-endian doubles: longitude, then latitude. The observed fix clip yields a continuous road trajectory, while the other has only zeroed packets. The MP4 sample table gives the second packet a 66 ms timestamp even though its internal counter and position imply a two-second step, so the counter is the reliable relative clock. South and west signs are inferred from the flags; those hemispheres have only synthetic coverage until a real sample is available.

The packets contain no satellite UTC timestamp, speed, bearing, or accelerometer values. The extractor gives the trip layer relative offsets for clock anchoring and estimates movement speed and bearing from adjacent positions. The fixture generator copies only this track and `mvhd`, replacing every payload with fictional whole-degree coordinates or a no-fix sentinel; source video, audio, and the `ubia` trailer are omitted.

The tested clips have a true-UTC MP4 creation clock and a filename with only local `HHMMSS`, so the filename cannot supply a date independently. Other suffix letters in the full-card diagnostic are not assigned recording modes without a verified meaning.
