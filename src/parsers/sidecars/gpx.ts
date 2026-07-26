// GPX 1.1 (https://www.topografix.com/GPX/1/1) - vendor-neutral sidecar.
//
// GPX is the de-facto track sharing format for dashcam software (Dashcam
// Viewer, Registrator Viewer) and general GPS apps (Strava, Google Earth,
// OsmAnd). We write it when exporting a selected range (see src/export.ts)
// and read it as a sidecar file placed next to an MP4.
//
// Unlike vendor plugins, GPX is not tied to a specific dashcam, so it is
// implemented as a SidecarHandler (see types.ts). Association with a video
// is by filename: `trip.gpx` looks for `trip.mp4` among known videos.

import type { GpsRecord, SidecarHandler, VendorFile } from "../types.js";
import { escapeXml } from "../../escape.js";
import { forwardFillBearingsIfAllZero } from "../../parser.js";
import { matchByBasename } from "./_basename.js";
import { readSidecarText } from "./_read.js";

const RX_GPX = /\.gpx$/i;

export const gpxSidecar: SidecarHandler = {
    id: "gpx",

    matches(file: VendorFile, knownVideos: Set<string>): string | null {
        return matchByBasename(file, knownVideos, RX_GPX);
    },

    async parse(file: VendorFile, mp4Filename: string, signal?: AbortSignal): Promise<GpsRecord[]> {
        // Routed through the shared reader so a cancelled ingest stops here like everywhere else.
        const text = await readSidecarText(file, signal);
        return parseGpx(text, mp4Filename);
    },
};

/**
 * Parses GPX file content and returns records in the shared GpsRecord format.
 * Fields absent from GPX (accelerometer) are set to zero. The MP4 filename
 * is supplied by the caller - GPX has no knowledge of a specific MP4.
 *
 * Parsed fields:
 *  - lat/lon (trkpt attributes) - required.
 *  - time (ISO8601, UTC) - required; without it the record cannot be linked to video.
 *  - speed (m/s) - optional, defaults to 0.
 *  - course (deg) - optional. If no point carries a non-zero course (a track
 *    re-exported without the camera's bearing, or a track-only GPX), heading is
 *    synthesized from position deltas so the map arrow follows travel instead of
 *    locking north - see forwardFillBearingsIfAllZero below.
 *
 * Throws if the root tag is not gpx or no valid records are found.
 */
function parseGpx(text: string, mp4Filename: string): GpsRecord[] {
    const doc = new DOMParser().parseFromString(text, "application/xml");

    // DOMParser does not throw on invalid XML - it returns a <parsererror> element.
    // getElementsByTagName instead of querySelector for compatibility with
    // non-browser DOMParser polyfills (@xmldom/xmldom does not implement querySelector).
    const parserErrors = doc.getElementsByTagName("parsererror");
    if (parserErrors.length > 0) {
        throw new Error(`gpx parse error: ${(parserErrors[0]?.textContent ?? "").slice(0, 200)}`);
    }

    const root = doc.documentElement;
    if (root?.localName !== "gpx") {
        throw new Error(`expected <gpx> root, got <${root?.localName ?? "none"}>`);
    }

    const records: GpsRecord[] = [];

    // Points may be in trk/trkseg/trkpt or in top-level wpt elements.
    // Dashcam software usually writes trk/trkseg, but wpt is also seen -
    // collect both to handle non-standard exports.
    const points = doc.getElementsByTagName("trkpt");
    for (let i = 0; i < points.length; i++) {
        const rec = trkptToRecord(points[i]!, mp4Filename);
        if (rec) records.push(rec);
    }
    const waypoints = doc.getElementsByTagName("wpt");
    for (let i = 0; i < waypoints.length; i++) {
        const rec = trkptToRecord(waypoints[i]!, mp4Filename);
        if (rec) records.push(rec);
    }

    if (records.length === 0) {
        throw new Error("gpx contains no usable trkpt/wpt with time");
    }

    records.sort((a, b) => a.unixSeconds - b.unixSeconds);
    // Mirror the embedded-GPS path (registry.ts) and the escort .map sidecar:
    // when the source omits course, derive bearing from consecutive positions.
    // No-op the moment any <course> is non-zero, so a GPX that carries real
    // heading keeps it. Per-file by construction - every record here shares the
    // one mp4Filename, so this never bearings across a recording gap.
    forwardFillBearingsIfAllZero(records);
    return records;
}

/**
 * Parses an ISO time string from GPX. GPX 1.1 requires ISO 8601 (`...Z` or
 * `...±HH:MM`), but real dashcams write invalid variants: 70mai_RV produces
 * `2024-12-01T12:27:34+03:00Z` (mixed offset and Z), which Date.parse returns
 * NaN for. Strip the trailing Z after an offset to get a valid ISO offset
 * string (`+03:00`) that Date understands.
 *
 * Returns unix milliseconds, or null if the string is unparseable.
 */
function parseGpxTime(raw: string): number | null {
    let ms = Date.parse(raw);
    if (Number.isFinite(ms)) return ms;
    // 70mai-style trailing Z after an offset.
    const fixed = raw.replace(/([+-]\d{2}:?\d{2})Z$/, "$1");
    if (fixed !== raw) {
        ms = Date.parse(fixed);
        if (Number.isFinite(ms)) return ms;
    }
    return null;
}

/**
 * Converts a <trkpt> or <wpt> element to a GpsRecord. Returns null if
 * lat/lon or time are missing or invalid - silently skipped so one bad
 * element does not abort the whole file.
 */
function trkptToRecord(el: Element, mp4Filename: string): GpsRecord | null {
    const lat = Number(el.getAttribute("lat"));
    const lon = Number(el.getAttribute("lon"));
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

    const timeEl = el.getElementsByTagName("time")[0];
    if (!timeEl) return null;
    const ms = parseGpxTime((timeEl.textContent ?? "").trim());
    if (ms === null) return null;

    // speed/course are not in the GPX 1.1 schema but are commonly written
    // as child elements in the gpx namespace or without a namespace.
    // getElementsByTagName matches without namespace - sufficient for common
    // exports (Dashcam Viewer / OsmAnd / our own serializer).
    const speedEl = el.getElementsByTagName("speed")[0];
    const courseEl = el.getElementsByTagName("course")[0];
    const speedMs = speedEl ? Number(speedEl.textContent) : 0;
    const bearingDeg = courseEl ? Number(courseEl.textContent) : 0;

    return {
        unixSeconds: ms / 1000,
        active: true, // GPX normally contains only valid points
        lat,
        lon,
        bearingDeg: Number.isFinite(bearingDeg) ? bearingDeg : 0,
        speedMs: Number.isFinite(speedMs) ? speedMs : 0,
        // GPX has no accelerometer data - brake events will not be detected
        // on these tracks (gMagnitude = 0).
        accelXg: 0,
        accelYg: 0,
        accelZg: 0,
        mp4Filename,
    };
}

/** Arguments for serializeGpx. */
interface SerializeGpxArgs {
    records: GpsRecord[];
    /** Human-readable track name. */
    trackName: string;
    /** Value of the creator attribute. */
    creator?: string;
}

/**
 * Serializes an array of records to GPX 1.1. Track name and metadata time
 * are provided by the caller. Records must be sorted by unixSeconds.
 *
 * Produces one track with one segment. If segmentation on gaps is ever
 * needed, add a parameter then.
 */
export function serializeGpx({ records, trackName, creator = "dashcamigo" }: SerializeGpxArgs): string {
    const points = records
        .filter((r) => r.active)
        .map(serializeTrkpt)
        .join("");

    const metadataTime =
        records.length > 0 ? new Date(records[0]!.unixSeconds * 1000).toISOString() : new Date().toISOString();

    return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="${escapeXml(creator)}"
     xmlns="http://www.topografix.com/GPX/1/1"
     xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
     xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">
  <metadata>
    <name>${escapeXml(trackName)}</name>
    <time>${metadataTime}</time>
  </metadata>
  <trk>
    <name>${escapeXml(trackName)}</name>
    <trkseg>${points}
    </trkseg>
  </trk>
</gpx>
`;
}

/**
 * Serializes one <trkpt> element. 6 decimal places for coordinates (~11 cm
 * at the equator, well above GPS fix accuracy). 2 decimal places for speed
 * and course are enough.
 */
function serializeTrkpt(r: GpsRecord): string {
    const time = new Date(r.unixSeconds * 1000).toISOString();
    return `
      <trkpt lat="${r.lat.toFixed(6)}" lon="${r.lon.toFixed(6)}">
        <time>${time}</time>
        <speed>${r.speedMs.toFixed(2)}</speed>
        <course>${r.bearingDeg.toFixed(2)}</course>
      </trkpt>`;
}
