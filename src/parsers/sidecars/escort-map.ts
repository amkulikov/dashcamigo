// Sidecar handler for Escort M2 Smart Dash Cam `.map` logs. Confirmed only
// on M2 (radar-mounted, single-channel front). Other Escort models
// (M1/M3/MaxCam Drive) not verified; if a different layout surfaces, split
// into a separate handler or add a version branch here.
//
// SD layout (M2):
//   <root>/
//     Normal/       cyclic recording
//     Event/        G-sensor / button trigger
//     Favorites/    user-pinned (not overwritten)
//     Photo/        stills (out of scope)
//
// Video name: `YYYYMMDD_HHMM_CAM.MP4` (camera-local time; name carries only
// hours:minutes).
// Sidecar:    `YYYYMMDD_HHMM_CAM.map` next to the MP4, basename-paired.
//
// `.map` is a proprietary CSV (not NMEA). Coordinates use the same encoding
// (DDMM.MMMM + N/S/E/W), the rest is custom. Line layout:
//
//   A,DDMMYY,HHMMSS,LAT(DDMM.MMMM),N|S,LON(DDDMM.MMMM),E|W,SPEED_KMH,AX,AY,AZ;
//   1  2     3      4               5   6                7   8         9  10 11
//
//   1) fix validity (NMEA RMC-style: A = active, V = void);
//   2) date DDMMYY (no century; <70 -> 2000+, >=70 -> 1900+ per NMEA convention);
//   3) UTC time HHMMSS;
//   4-5) latitude;
//   6-7) longitude;
//   8) speed km/h (GPS Doppler - confirmed against position-diff on a real
//      sample, within error);
//   9-11) accelerometer X/Y/Z - raw, gravity + calibration bias included.
//      Real sample has Z mean ~1.5g (not 1.0), so per-axis mean subtraction
//      is applied to satisfy the `GpsRecord.accel*g` contract (~0 at rest).
//      Over a typical >1 min log the actual dynamics average to zero, the
//      remainder is gravity + static bias. Same trick as in `mergeAccelSamples`
//      for blackvue-3gf.
//
// Bearing is NOT in the file - computed from consecutive coordinates
// (forward-azimuth). Endpoint records get the bearing of their only neighbour.

import type { GpsRecord, SidecarHandler, SkippedLine, VendorFile } from "../types.js";
import { parseNmeaCoord } from "../internal/nmea.js";
import { matchByBasename } from "./_basename.js";
import { readSidecarText } from "./_read.js";

// `<basename>.map` -> matched case-insensitively against the same basename in
// knownVideos (firmware versions differ in extension/name casing).
const RX_MAP_SIDECAR = /\.map$/i;

// Strict line signature. Anything that does not match goes to skipped.
// Strict anchors avoid swallowing junk trailers.
const RX_MAP_LINE =
    /^([AV]),(\d{6}),(\d{6}),(\d{1,4}\.\d+),([NS]),(\d{1,5}\.\d+),([EW]),(-?\d+\.\d+),(-?\d+\.\d+),(-?\d+\.\d+),(-?\d+\.\d+);?$/;

function parseDateDDMMYY(s: string): { year: number; month: number; day: number } | null {
    if (s.length !== 6) return null;
    const dd = Number(s.slice(0, 2));
    const mo = Number(s.slice(2, 4));
    const yy = Number(s.slice(4, 6));
    if (!Number.isFinite(dd) || !Number.isFinite(mo) || !Number.isFinite(yy)) return null;
    if (mo < 1 || mo > 12 || dd < 1 || dd > 31) return null;
    // Two-digit year, NMEA convention: <70 -> 2000+, >=70 -> 1900+. Covers
    // every post-2000 dashcam; no dashcams existed before 1970.
    const year = yy < 70 ? 2000 + yy : 1900 + yy;
    return { year, month: mo, day: dd };
}

function parseTimeHHMMSS(s: string): { hour: number; minute: number; second: number } | null {
    if (s.length !== 6) return null;
    const hh = Number(s.slice(0, 2));
    const mm = Number(s.slice(2, 4));
    const ss = Number(s.slice(4, 6));
    if (!Number.isFinite(hh) || !Number.isFinite(mm) || !Number.isFinite(ss)) return null;
    if (hh > 23 || mm > 59 || ss > 59) return null;
    return { hour: hh, minute: mm, second: ss };
}

/**
 * Forward-azimuth in degrees [0..360) between two points on a sphere.
 * Used because `.map` has no course field - bearing is computed from
 * consecutive positions.
 */
function computeBearingDeg(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const toRad = (d: number) => (d * Math.PI) / 180;
    const phi1 = toRad(lat1);
    const phi2 = toRad(lat2);
    const dLambda = toRad(lon2 - lon1);
    const y = Math.sin(dLambda) * Math.cos(phi2);
    const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda);
    const deg = (Math.atan2(y, x) * 180) / Math.PI;
    return (deg + 360) % 360;
}

/**
 * Parses `.map` text. `mp4Filename` is set by the dispatcher from the
 * basename match. Bearing is back-filled from neighbours; endpoint records
 * (first / last) inherit the bearing of the only adjacent pair.
 *
 * Exported for unit tests that need access to `skipped` (SidecarHandler.parse
 * returns only records).
 */
export function parseMapText(text: string, mp4Filename: string): { records: GpsRecord[]; skipped: SkippedLine[] } {
    const lines = text.split(/\r?\n/);
    const records: GpsRecord[] = [];
    const skipped: SkippedLine[] = [];

    for (let i = 0; i < lines.length; i++) {
        const raw = lines[i]!;
        if (raw === "") continue;
        const m = raw.match(RX_MAP_LINE);
        if (!m) {
            skipped.push({ line: i + 1, raw, reason: "line did not match escort .map signature" });
            continue;
        }
        const [, statusFlag, dateStr, timeStr, latStr, latDir, lonStr, lonDir, speedKmh, ax, ay, az] = m;

        const date = parseDateDDMMYY(dateStr!);
        const time = parseTimeHHMMSS(timeStr!);
        if (!date || !time) {
            skipped.push({ line: i + 1, raw, reason: "invalid date or time" });
            continue;
        }
        const unixSeconds = Date.UTC(date.year, date.month - 1, date.day, time.hour, time.minute, time.second) / 1000;
        if (!Number.isFinite(unixSeconds)) {
            skipped.push({ line: i + 1, raw, reason: "timestamp out of range" });
            continue;
        }

        const lat = parseNmeaCoord(latStr!, latDir!);
        const lon = parseNmeaCoord(lonStr!, lonDir!);
        if (lat === null || lon === null) {
            skipped.push({ line: i + 1, raw, reason: "invalid coordinates" });
            continue;
        }

        const speedNum = Number(speedKmh);
        if (!Number.isFinite(speedNum) || speedNum < 0) {
            skipped.push({ line: i + 1, raw, reason: "invalid speed" });
            continue;
        }
        // Field 8 is km/h -> GpsRecord.speedMs in m/s.
        const speedMs = speedNum / 3.6;

        const accelXg = Number(ax);
        const accelYg = Number(ay);
        const accelZg = Number(az);
        if (![accelXg, accelYg, accelZg].every(Number.isFinite)) {
            skipped.push({ line: i + 1, raw, reason: "invalid accelerometer values" });
            continue;
        }

        records.push({
            unixSeconds,
            active: statusFlag === "A",
            lat,
            lon,
            bearingDeg: 0, // placeholder, filled by the neighbour pass below.
            speedMs,
            accelXg, // raw, gravity subtracted below.
            accelYg,
            accelZg,
            mp4Filename,
        });
    }

    // Gravity removal: per-axis mean. The sensor emits gravity + calibration
    // bias (Z mean ~1.5g on real samples). Over a typical log (>1 min) real
    // dynamics average to zero, so mean ~= gravity. On very short bursts
    // (<10s active manoeuvre) this underestimates motion in the mean
    // direction - acceptable trade-off versus not emitting accel at all.
    if (records.length > 0) {
        let sx = 0;
        let sy = 0;
        let sz = 0;
        for (const r of records) {
            sx += r.accelXg;
            sy += r.accelYg;
            sz += r.accelZg;
        }
        const n = records.length;
        const mx = sx / n;
        const my = sy / n;
        const mz = sz / n;
        for (const r of records) {
            r.accelXg -= mx;
            r.accelYg -= my;
            r.accelZg -= mz;
        }
    }

    // Bearing back-fill from consecutive pairs. First record gets
    // bearing(0->1); last gets bearing(n-2->n-1). Single-record file stays at 0.
    for (let i = 0; i < records.length; i++) {
        const cur = records[i]!;
        const next = i + 1 < records.length ? records[i + 1] : undefined;
        const prev = i > 0 ? records[i - 1] : undefined;
        if (next) {
            cur.bearingDeg = computeBearingDeg(cur.lat, cur.lon, next.lat, next.lon);
        } else if (prev) {
            cur.bearingDeg = computeBearingDeg(prev.lat, prev.lon, cur.lat, cur.lon);
        }
    }

    return { records, skipped };
}

/**
 * Escort `.map` sidecar. Bound to its MP4 via case-insensitive basename match
 * (`20260511_0016_CAM.map` <-> `20260511_0016_CAM.MP4`) through the shared
 * matchByBasename helper - the hand-rolled exact-case variant silently failed
 * to pair when name casing differed between the sidecar and the video.
 */
export const escortMapSidecar: SidecarHandler = {
    id: "escort-map",
    matches(file: VendorFile, knownVideos: Set<string>): string | null {
        return matchByBasename(file, knownVideos, RX_MAP_SIDECAR);
    },
    async parse(file: VendorFile, mp4Filename: string, signal?: AbortSignal): Promise<GpsRecord[]> {
        const text = await readSidecarText(file, signal);
        const parsed = parseMapText(text, mp4Filename);
        return parsed.records;
    },
};
