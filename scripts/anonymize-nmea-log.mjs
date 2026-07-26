#!/usr/bin/env node
// Anonymizes an NMEA sidecar file (`.nmea`/`.NMEA`/`.gps`) for use as a test
// fixture. Counterpart of scripts/anonymize-70mai-log.mjs, but for the
// NMEA-0183 format.
//
// What it does:
//  1. Reads the source lines.
//  2. For every `$XYRMC`, `$XYGGA` AND `$XYGLL` line, rounds lat/lon to whole
//     degrees (keeps the hemisphere via N/S/E/W, ~110 km precision). All three
//     carry real coordinates - without masking the fixture would leak them.
//  3. For every `$XYGSA`/`$XYGSV` line, blanks the satellite PRNs and zeroes
//     elevation/azimuth/SNR. Satellite geometry at the (kept) timestamps is a
//     position oracle: az/el of a dozen satellites plus the almanac for that
//     date re-locates the observer far tighter than the whole-degree rounding,
//     and QZSS/SBAS PRNs alone narrow the hemisphere. DOPs and message framing
//     stay.
//  4. Other custom extensions ($GSENSOR/$GSENSORD/$GPVTG/$GPZDA) carry over
//     1-to-1 - they're not sensitive (g-sensor, course/speed, date/time).
//  5. The optional `[unix_ms]` prefix (BlackVue format) is preserved.
//  6. Truncates to MAX_LINES records (GPRMC + custom counted together, order
//     preserved).
//
// Run:
//   node scripts/anonymize-nmea-log.mjs <input.nmea> <output.nmea>
//
// The script is idempotent w.r.t. its input.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { argv, exit } from "node:process";

const MAX_LINES = 60;

function usage() {
    console.error("usage: node scripts/anonymize-nmea-log.mjs <input> <output>");
    exit(1);
}

// Regex captures the line prefix (if any, e.g. BlackVue `[123]`) so we don't
// touch it, only the content after.
const RX_PREFIX = /^(\[\d+\])?(.*)$/;

// $XYRMC fields: $XYRMC,time,A,lat_DDmm.mmmm,N|S,lon_DDDmm.mmmm,E|W,...
// We only want to replace lat and lon (fields 3, 5) with values rounded to
// whole degrees in the same DDmm.mmmm notation.
function maskRmcLine(rmc) {
    const parts = rmc.split(",");
    if (parts.length < 7) return rmc; // malformed RMC, leave as-is
    if (parts[2] !== "A" && parts[2] !== "V") return rmc;

    parts[3] = roundCoordToDegree(parts[3]); // lat
    parts[5] = roundCoordToDegree(parts[5]); // lon

    const masked = parts.join(",");
    // Not recomputing the checksum after `*` - our parser doesn't validate it.
    return masked;
}

// $XYGGA fields: $XYGGA,time,lat_DDmm.mmmm,N|S,lon_DDDmm.mmmm,E|W,fix,...
// Coordinates in fields 2 and 4 use the same DDmm.mmmm notation as RMC.
function maskGgaLine(gga) {
    const parts = gga.split(",");
    if (parts.length < 6) return gga; // malformed GGA, leave as-is
    parts[2] = roundCoordToDegree(parts[2]); // lat
    parts[4] = roundCoordToDegree(parts[4]); // lon
    return parts.join(",");
}

// $XYGLL fields: $XYGLL,lat_DDmm.mmmm,N|S,lon_DDDmm.mmmm,E|W,time,status,...
// BlackVue emits GLL alongside RMC/GGA; without masking it leaks the same
// coordinates the other two hide (fields 1 and 3 here).
function maskGllLine(gll) {
    const parts = gll.split(",");
    if (parts.length < 5) return gll; // malformed GLL, leave as-is
    parts[1] = roundCoordToDegree(parts[1]); // lat
    parts[3] = roundCoordToDegree(parts[3]); // lon
    return parts.join(",");
}

// $XYGSA fields: $XYGSA,mode,fix,PRN x12,PDOP,HDOP,VDOP - blanks every PRN
// slot between the fix type and the trailing three DOPs. Vendors are sloppy
// about the slot count, so index from both ends instead of assuming 12.
function maskGsaLine(gsa) {
    const parts = gsa.split(",");
    if (parts.length < 7) return gsa; // malformed GSA, leave as-is
    for (let i = 3; i < parts.length - 3; i++) parts[i] = "";
    return parts.join(",");
}

// $XYGSV fields: $XYGSV,total,msg,numSV,(PRN,elev,az,SNR) x up-to-4. Zeroes
// all four per satellite group, preserving field widths and the empty slots
// vendors emit (e.g. SNR of an untracked satellite). The `*XX` checksum tail
// on the last field is kept as-is - see maskRmcLine.
function maskGsvLine(gsv) {
    const parts = gsv.split(",");
    if (parts.length < 8) return gsv; // malformed GSV, leave as-is
    const ZEROS = ["00", "00", "000", "00"]; // PRN, elevation, azimuth, SNR
    for (let i = 4; i < parts.length; i++) {
        const star = parts[i].indexOf("*");
        const value = star === -1 ? parts[i] : parts[i].slice(0, star);
        const suffix = star === -1 ? "" : parts[i].slice(star);
        parts[i] = (value === "" ? "" : ZEROS[(i - 4) % 4]) + suffix;
    }
    return parts.join(",");
}

// "1234.5678" -> "1200.0000". DDmm.mmmm: the integer part before the dot is
// DD*100 + MM; divide by 100, round to a whole degree, multiply back by 100, format.
function roundCoordToDegree(value) {
    if (value === "") return value;
    const num = Number(value);
    if (!Number.isFinite(num)) return value;
    const deg = Math.round(num / 100);
    return (deg * 100).toFixed(4);
}

function main() {
    const args = argv.slice(2);
    if (args.length < 2) usage();

    const input = resolve(args[0]);
    const output = resolve(args[1]);

    const text = readFileSync(input, "utf8");
    const lines = text.split(/\r?\n/);
    const out = [];

    let kept = 0;
    for (const line of lines) {
        if (line === "") continue;
        if (kept >= MAX_LINES) break;

        const m = line.match(RX_PREFIX);
        const prefix = m?.[1] ?? "";
        const body = m?.[2] ?? line;

        // RMC / GGA / GLL carry coordinates, GSA / GSV carry satellite
        // geometry (a position oracle at a known epoch) - all masked. The
        // rest (GSENSOR(D)/VTG/ZDA) carries over 1-to-1.
        const sentence = body.length >= 7 && body.startsWith("$") ? body.slice(3, 6) : "";
        if (sentence === "RMC") {
            out.push(prefix + maskRmcLine(body));
        } else if (sentence === "GGA") {
            out.push(prefix + maskGgaLine(body));
        } else if (sentence === "GLL") {
            out.push(prefix + maskGllLine(body));
        } else if (sentence === "GSA") {
            out.push(prefix + maskGsaLine(body));
        } else if (sentence === "GSV") {
            out.push(prefix + maskGsvLine(body));
        } else {
            out.push(line);
        }
        kept++;
    }

    out.push("");
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, out.join("\n"));
    console.log(`wrote ${kept} lines to ${output}`);
}

main();
