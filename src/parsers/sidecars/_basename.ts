// Shared basename helpers for sidecar handlers. Every "by-basename" sidecar
// (GPX, NMEA `.gps`, NMEA `.nmea`, BlackVue `.3gf`) used to carry its own
// copy of these tiny utilities; centralised here so a future extension (e.g.
// `.MP4.GZ` support) lives in one place.

import { blackvueChannelGroupKey } from "../filename/_patterns.js";
import type { VendorFile } from "../types.js";

/**
 * Lowercase basename without extension. Used to pair MP4 <-> sidecar by the
 * "same name" convention:
 *   "NO20260429-182640F.MP4" -> "no20260429-182640f"
 *   "trip.gpx"                -> "trip"
 *   "name"                    -> "name" (no extension)
 */
export function basenameLower(filename: string): string {
    const dot = filename.lastIndexOf(".");
    return (dot < 0 ? filename : filename.slice(0, dot)).toLowerCase();
}

/**
 * Returns the MP4 name from `knownVideos` whose basename matches `file`'s
 * basename, or null. Extension is filtered first by `extRegex` so unrelated
 * files exit early without scanning the video set.
 */
export function matchByBasename(file: VendorFile, knownVideos: Set<string>, extRegex: RegExp): string | null {
    if (!extRegex.test(file.file.name)) return null;
    const base = basenameLower(file.file.name);
    for (const videoName of knownVideos) {
        if (basenameLower(videoName) === base) return videoName;
    }
    return null;
}

/**
 * Pairs a BlackVue sidecar (`.gps` NMEA / `.3gf` accel) with its MP4.
 *
 * Legacy DR-series writes ONE sidecar per (date, time, mode) triple, shared
 * across channels: `20260718_070333_N.gps` covers BOTH `..._NF.mp4` (front) and
 * `..._NR.mp4` (rear). The MP4 name carries an extra channel letter (F/R/I) the
 * sidecar does not, so a plain equal-basename compare (matchByBasename) never
 * pairs them and the GPS is silently dropped.
 *
 * Rule: match the sidecar basename against the BlackVue channel-group key
 * (`date_time_mode`, channel dropped), falling back to an exact-basename match
 * (a per-channel sidecar, should any firmware write one). Only MP4s whose name
 * fits RX_BLACKVUE have a group key, so a `_N`-suffixed sidecar cannot
 * accidentally pair with a foreign video.
 *
 * This only decides which single clip the sidecar is *classified* against.
 * cloneRecordsAcrossChannels then copies the parsed GPS onto every sibling
 * channel so all of them anchor identically - so the choice here is cosmetic.
 * We still prefer front (then rear over interior, deterministically) so the
 * winning-extractor bookkeeping and the pre-clone startUtc name a stable clip.
 */
export function matchBlackvueSidecarBasename(
    file: VendorFile,
    knownVideos: Set<string>,
    extRegex: RegExp,
): string | null {
    if (!extRegex.test(file.file.name)) return null;
    const base = basenameLower(file.file.name);
    let front: string | null = null;
    let rear: string | null = null;
    let interior: string | null = null;
    for (const videoName of knownVideos) {
        // Exact per-channel pairing (sidecar carries the channel letter too).
        if (basenameLower(videoName) === base) return videoName;
        // Shared sidecar: compare against the channel-group key (channel dropped).
        if (blackvueChannelGroupKey(videoName) !== base) continue;
        // basenameLower already lowercased; the channel letter is the last char.
        const channel = basenameLower(videoName).slice(-1);
        if (channel === "f") front = videoName;
        else if (channel === "r") rear = videoName;
        else if (channel === "i") interior = videoName;
    }
    return front ?? rear ?? interior;
}
