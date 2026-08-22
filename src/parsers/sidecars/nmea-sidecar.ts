// Sidecar handlers for NMEA-shaped files alongside MP4. All share
// `parseNmeaText` from `parsers/_internal/nmea.ts`; this file only does
// extension/basename routing and selects the right prefix-regex.
//
//   1. **`.NMEA` / `.nmea`** - raw $GPRMC/$GPGGA/etc, no line prefix. Written by
//      many mid-range recorders: Mio MiVue (5xx-9xx, C/A/J/M/MP/R series), Navman
//      MiVue (Mio OEM - 530/800/850/Pro/Pro 4K), Vicovation Marcus 3+, Transcend
//      DrivePro 100-230, DOD older models. Exact sample signatures only confirmed
//      for Mio (dashcamtalk forum); the parser is shared, vendor-id is not exposed
//      (a separate UI label would be the right fix - not a priority now).
//
//   2. **`.gps`** - BlackVue legacy series (DR450/500/550/650, early DR770X). Each
//      line has a `[unix_ms]` prefix before the NMEA sentence - the camera's own
//      clock, in the TZ configured on the unit, so the sentence's satellite UTC
//      is what times the records (see the TIME RULE in internal/nmea.ts). Very
//      old DR400G-HD (2010) writes `.gps` WITHOUT the prefix - that variant is
//      not covered yet (see audit).
//
//   3. **`.gpx` in DDPai folders** - despite the `.gpx` extension the content is
//      plain NMEA with optional DDPai `$GPSCAMTIME`/`$GPSENDTIME` headers (no
//      `*` checksum). Path must be `103gps/` (M-series) or `203gps/` (N-series);
//      basename matches the MP4 after stripping optional `_D` from the .gpx and
//      `_A` from the MP4 (one .gpx covers both channels on 2-channel models).
//      Must be registered BEFORE `gpxSidecar` in SIDECARS so it intercepts these
//      files before the XML-only parser tries to read them.
//
// What this handler does NOT do:
//   - Does not parse `.3gf` (BlackVue G-sensor binary). That is a separate path;
//     brake events on BlackVue fixtures are not computed yet (gMagnitude=0).
//   - Does not cover BlackVue DR750S+/DR900X+/DR970X+ without a `.gps` sidecar -
//     GPS on those is embedded in the MP4 and needs a separate in-MP4 scanner.

import type { GpsRecord, SidecarHandler, VendorFile } from "../types.js";
import { WrongFormatError } from "../types.js";
import { parseNmeaText, dedupByUnixSeconds } from "../internal/nmea.js";
import { basenameLower, matchBlackvueSidecarBasename, matchByBasename } from "./_basename.js";
import { readSidecarText } from "./_read.js";

// BlackVue prefix: exactly 13-digit unix-ms in square brackets. 13 digits covers
// timestamps from 2001 to 5138; the tighter match reduces false hits on foreign files.
const BLACKVUE_PREFIX_RX = /^\[(\d{13})\]/;

const RX_GPS = /\.gps$/i;
const RX_NMEA = /\.nmea$/i;
const RX_GPX = /\.gpx$/i;
// DDPai SD layouts: `DCIM/100video/` + `DCIM/103gps/` (M-series); `DCIM/200video/`
// + `DCIM/203gps/` (N-series). Lowercased because firmware writes uppercase but
// the user may have renamed.
const RX_DDPAI_GPS_DIR = /(?:^|\/)(?:103|203)gps\//i;

/**
 * BlackVue legacy `.gps` sidecar. The `[unix_ms]` prefix is expected on every
 * line but treated as optional: the legacy DR400G-HD (2010) writes `.gps`
 * without the prefix as plain NMEA. Either way the timestamps come from the
 * GPRMC fields; the prefix is a fallback for a corrupt sentence time.
 */
export const blackvueGpsSidecar: SidecarHandler = {
    id: "blackvue-gps",
    matches(file: VendorFile, knownVideos: Set<string>): string | null {
        return matchBlackvueSidecarBasename(file, knownVideos, RX_GPS);
    },
    async parse(file: VendorFile, mp4Filename: string, signal?: AbortSignal): Promise<GpsRecord[]> {
        const text = await readSidecarText(file, signal);
        const result = parseNmeaText(text, mp4Filename, {
            linePrefixRegex: BLACKVUE_PREFIX_RX,
            linePrefixOptional: true,
        });
        // BlackVue often writes multiple sentence types (RMC + VTG + GGA) with the
        // same unix_ms. parseNmeaText returns only RMC, but dedup is still needed
        // for $GPRMC + $GNRMC on the same timestamp.
        return dedupByUnixSeconds(result.records);
    },
};

/**
 * Generic NMEA sidecar: `.NMEA` / `.nmea`, no line prefix. Covers Mio MiVue,
 * Navman, Vicovation, Transcend DrivePro, DOD. If the file contains only
 * $GSENSOR lines (Vicovation Marcus 3 without a GPS fix), returns an empty
 * array - no GPS data, no brake events, but the trip is still indexed via
 * mtime / mvhd.
 */
export const nmeaSidecar: SidecarHandler = {
    id: "nmea-sidecar",
    matches(file: VendorFile, knownVideos: Set<string>): string | null {
        return matchByBasename(file, knownVideos, RX_NMEA);
    },
    async parse(file: VendorFile, mp4Filename: string, signal?: AbortSignal): Promise<GpsRecord[]> {
        const text = await readSidecarText(file, signal);
        const result = parseNmeaText(text, mp4Filename);
        return dedupByUnixSeconds(result.records);
    },
};

/**
 * DDPai `.gpx` sidecar. Matches only inside `103gps/` / `203gps/` directories
 * so non-DDPai .gpx files reach the real XML gpxSidecar.
 *
 * Basename pairing: optional `_D` on the sidecar, optional `_A` on the MP4 -
 * one .gpx may cover both channels of a 2-channel model.
 *
 * Despite the extension, content is plain NMEA (with optional
 * `$GPSCAMTIME ...` / `$GPSENDTIME ...` lines which `parseNmeaText` silently
 * ignores as unknown sentences). Real XML payloads are rejected with
 * WrongFormatError so the dispatcher can fall through to `gpxSidecar`.
 */
export const ddpaiGpxSidecar: SidecarHandler = {
    id: "ddpai-gpx",
    matches(file: VendorFile, knownVideos: Set<string>): string | null {
        if (!RX_GPX.test(file.file.name)) return null;
        if (!RX_DDPAI_GPS_DIR.test(file.relativePath)) return null;
        // Sidecar basename without ".gpx", strip optional `_d` suffix.
        let base = basenameLower(file.file.name);
        if (base.endsWith("_d")) base = base.slice(0, -2);
        // Deterministic pick when the sidecar covers both channels: the exact
        // basename (front, no `_a`) wins over the `_a`-suffixed rear - not the
        // Set's insertion order, which follows the ingest file order. Mirrors
        // matchBlackvueSidecarBasename's front-first rule.
        let rear: string | null = null;
        for (const videoName of knownVideos) {
            // MP4 basename, strip optional `_a` suffix (rear channel marker).
            const videoBase = basenameLower(videoName);
            if (videoBase === base) return videoName;
            if (videoBase.endsWith("_a") && videoBase.slice(0, -2) === base) rear = videoName;
        }
        return rear;
    },
    async parse(file: VendorFile, mp4Filename: string, signal?: AbortSignal): Promise<GpsRecord[]> {
        const text = await readSidecarText(file, signal);
        // First non-blank char `<` means real XML GPX; bail so gpxSidecar can try.
        const trimmed = text.trimStart();
        if (trimmed.startsWith("<")) {
            throw new WrongFormatError("ddpai-gpx: content is XML, not NMEA");
        }
        const result = parseNmeaText(text, mp4Filename);
        return dedupByUnixSeconds(result.records);
    },
};
