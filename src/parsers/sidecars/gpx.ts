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
import { utcMillisecondsFromParts } from "../internal/calendar.js";
import { isCoordinateInRange } from "../internal/ddmm.js";
import { matchByBasename } from "./_basename.js";
import { readSidecarText } from "./_read.js";

const RX_GPX = /\.gpx$/i;
const RX_GPX_TIME = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/i;

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

    // Namespace prefixes are legal in GPX, so match local names rather than
    // only unprefixed qualified names. Route points share the same point shape.
    for (const pointName of ["trkpt", "wpt", "rtept"]) {
        for (const point of elementsByLocalName(doc, pointName)) {
            const rec = trkptToRecord(point, mp4Filename);
            if (rec) records.push(rec);
        }
    }

    if (records.length === 0) {
        throw new Error("gpx contains no usable trkpt/wpt/rtept with time");
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
    const trimmed = raw.trim();
    if (trimmed === "") return null;
    // 70mai-style trailing Z after an offset.
    const fixed = trimmed.replace(/([+-]\d{2}:?\d{2})Z$/i, "$1");
    const m = RX_GPX_TIME.exec(fixed);
    if (!m) return null;

    const [, y, mo, d, h, mi, s, fraction = "", zone] = m;
    const baseMs = utcMillisecondsFromParts(Number(y), Number(mo), Number(d), Number(h), Number(mi), Number(s), true);
    if (baseMs === null) return null;

    const fractionMs = fraction === "" ? 0 : Number(fraction) * 1000;
    if (!Number.isFinite(fractionMs)) return null;
    let ms = baseMs + fractionMs;

    // GPX requires a zone, but some exports omit it. Treat that wall-clock as
    // UTC deterministically; interpreting it in the browser's host zone makes
    // the same file move when opened on another computer.
    if (zone && zone.toUpperCase() !== "Z") {
        const digits = zone.slice(1).replace(":", "");
        const offsetHours = Number(digits.slice(0, 2));
        const offsetMinutes = Number(digits.slice(2));
        if (offsetHours > 23 || offsetMinutes > 59) return null;
        const direction = zone.startsWith("-") ? -1 : 1;
        ms -= direction * (offsetHours * 60 + offsetMinutes) * 60_000;
    }
    return Number.isFinite(ms) ? ms : null;
}

function elementsByLocalName(root: Document | Element, name: string): Element[] {
    const namespaced = root.getElementsByTagNameNS("*", name);
    if (namespaced.length > 0) return Array.from(namespaced);
    return Array.from(root.getElementsByTagName(name));
}

/**
 * Converts a <trkpt> or <wpt> element to a GpsRecord. Returns null if
 * lat/lon or time are missing or invalid - silently skipped so one bad
 * element does not abort the whole file.
 */
function trkptToRecord(el: Element, mp4Filename: string): GpsRecord | null {
    const latRaw = el.getAttribute("lat");
    const lonRaw = el.getAttribute("lon");
    if (latRaw === null || lonRaw === null || latRaw.trim() === "" || lonRaw.trim() === "") return null;
    const lat = Number(latRaw);
    const lon = Number(lonRaw);
    if (!isCoordinateInRange(lat, "lat") || !isCoordinateInRange(lon, "lon")) return null;

    const timeEl = elementsByLocalName(el, "time")[0];
    if (!timeEl) return null;
    const ms = parseGpxTime((timeEl.textContent ?? "").trim());
    if (ms === null) return null;

    // speed/course are common extensions. A bad optional field must not discard
    // an otherwise valid point; normalize it to the contract's neutral value.
    const speedEl = elementsByLocalName(el, "speed")[0];
    const courseEl = elementsByLocalName(el, "course")[0];
    const speedValue = speedEl ? Number(speedEl.textContent) : 0;
    const courseValue = courseEl ? Number(courseEl.textContent) : 0;
    const speedMs = Number.isFinite(speedValue) && speedValue >= 0 ? speedValue : 0;
    const bearingDeg = Number.isFinite(courseValue) ? ((courseValue % 360) + 360) % 360 : 0;

    return {
        unixSeconds: ms / 1000,
        active: true, // GPX normally contains only valid points
        lat,
        lon,
        bearingDeg,
        speedMs,
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
