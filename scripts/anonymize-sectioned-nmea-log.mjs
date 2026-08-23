#!/usr/bin/env node
// Anonymizes a recording-scoped NMEA log into a committed parser fixture.
// Timestamps and section headers stay intact so clip association remains
// testable; coordinates are rounded to whole degrees and each section is
// trimmed to a short, readable run.
//
// Run:
//   node scripts/anonymize-sectioned-nmea-log.mjs [input.LOG] [output.LOG]

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_INPUT = "private/incoming/26082300.LOG";
const DEFAULT_OUTPUT = "src/parsers/__fixtures__/sectioned-nmea-log/real-anonymized.LOG";
const MAX_FIXES_PER_SECTION = 12;
const RX_RECORDING_HEADER = /^@Sonygps\/ver\d+(?:\.\d+)?\/wgs-84\/\d{14}\.\d{1,3}\/$/i;
const RX_OPTION_HEADER = /^@Sonygpsoption\/\d+\/\d{14}\.\d{1,3}\/\d{14}\.\d{1,3}\/$/i;

function checksum(body) {
    let value = 0;
    for (let i = 0; i < body.length; i++) value ^= body.charCodeAt(i);
    return value.toString(16).toUpperCase().padStart(2, "0");
}

function parseCoordinate(value, direction, axis) {
    const raw = Number(value);
    if (!Number.isFinite(raw)) return null;
    if (axis === "lat" && direction !== "N" && direction !== "S") return null;
    if (axis === "lon" && direction !== "E" && direction !== "W") return null;
    const degrees = Math.floor(raw / 100);
    const minutes = raw - degrees * 100;
    if (minutes < 0 || minutes >= 60) return null;
    const sign = direction === "S" || direction === "W" ? -1 : 1;
    return sign * (degrees + minutes / 60);
}

function wholeDegreeCoordinate(value, direction, axis) {
    const decimal = parseCoordinate(value, direction, axis);
    if (decimal === null) throw new Error("bad NMEA coordinate");
    const rounded = Math.round(decimal);
    const absolute = Math.abs(rounded);
    const width = axis === "lat" ? 2 : 3;
    const positiveDirection = axis === "lat" ? "N" : "E";
    const negativeDirection = axis === "lat" ? "S" : "W";
    const outputDirection = rounded === 0 ? direction : rounded < 0 ? negativeDirection : positiveDirection;
    return {
        value: `${String(absolute).padStart(width, "0")}00.0000`,
        direction: outputDirection,
        decimal: rounded,
    };
}

function anonymizeSentence(line) {
    const star = line.indexOf("*");
    const body = star >= 0 ? line.slice(1, star) : line.slice(1);
    const fields = body.split(",");
    const type = fields[0]?.slice(-3);
    let latIndex;
    let lonIndex;
    if (type === "RMC") {
        latIndex = 3;
        lonIndex = 5;
    } else if (type === "GGA") {
        latIndex = 2;
        lonIndex = 4;
    } else {
        return { line, coordinate: null, type };
    }

    const lat = wholeDegreeCoordinate(fields[latIndex], fields[latIndex + 1], "lat");
    const lon = wholeDegreeCoordinate(fields[lonIndex], fields[lonIndex + 1], "lon");
    fields[latIndex] = lat.value;
    fields[latIndex + 1] = lat.direction;
    fields[lonIndex] = lon.value;
    fields[lonIndex + 1] = lon.direction;
    const anonymizedBody = fields.join(",");
    return {
        line: `$${anonymizedBody}*${checksum(anonymizedBody)}`,
        coordinate: { lat: lat.decimal, lon: lon.decimal },
        type,
    };
}

function parseRmcTimestamp(time, date) {
    const timeMatch = /^(\d{2})(\d{2})(\d{2})(?:\.(\d+))?$/.exec(time);
    const dateMatch = /^(\d{2})(\d{2})(\d{2})$/.exec(date);
    if (!timeMatch || !dateMatch) return null;
    const [, hourText, minuteText, secondText, fractionText = ""] = timeMatch;
    const [, dayText, monthText, yearText] = dateMatch;
    const yearValue = Number(yearText);
    const year = yearValue < 70 ? 2000 + yearValue : 1900 + yearValue;
    const month = Number(monthText);
    const day = Number(dayText);
    const hour = Number(hourText);
    const minute = Number(minuteText);
    const second = Number(secondText);
    if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) return null;
    const wholeMs = Date.UTC(year, month - 1, day, hour, minute, second);
    const check = new Date(wholeMs);
    if (
        check.getUTCFullYear() !== year ||
        check.getUTCMonth() !== month - 1 ||
        check.getUTCDate() !== day ||
        check.getUTCHours() !== hour ||
        check.getUTCMinutes() !== minute ||
        check.getUTCSeconds() !== second
    ) {
        return null;
    }
    const fraction = fractionText === "" ? 0 : Number(`0.${fractionText}`);
    return Number.isFinite(fraction) ? wholeMs / 1000 + fraction : null;
}

function anonymize(text) {
    const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
    const out = [];
    const originalCoordinates = [];
    const anonymizedCoordinates = [];
    const rmcTimes = [];
    let sections = 0;
    let keptInSection = 0;

    for (const raw of lines) {
        const line = raw.trimEnd();
        if (RX_RECORDING_HEADER.test(line)) {
            sections++;
            keptInSection = 0;
            out.push(line);
            continue;
        }
        if (!line.startsWith("$")) {
            if (RX_OPTION_HEADER.test(line)) out.push(line);
            continue;
        }

        const type = line.slice(3, 6);
        if ((type === "RMC" || type === "GGA") && keptInSection >= MAX_FIXES_PER_SECTION) continue;
        const parsed = anonymizeSentence(line);
        if (parsed.coordinate === null) continue;

        const fields = line.slice(1, line.indexOf("*") >= 0 ? line.indexOf("*") : undefined).split(",");
        const latIndex = type === "RMC" ? 3 : 2;
        const lonIndex = type === "RMC" ? 5 : 4;
        originalCoordinates.push({
            lat: parseCoordinate(fields[latIndex], fields[latIndex + 1], "lat"),
            lon: parseCoordinate(fields[lonIndex], fields[lonIndex + 1], "lon"),
        });
        anonymizedCoordinates.push(parsed.coordinate);
        out.push(parsed.line);
        if (type === "RMC") {
            keptInSection++;
            const timestamp = parseRmcTimestamp(fields[1], fields[9]);
            if (timestamp === null) throw new Error("bad retained RMC timestamp");
            rmcTimes.push(timestamp);
        }
    }
    out.push("");

    if (sections === 0 || rmcTimes.length === 0) throw new Error("fixture contains no recording sections or RMC fixes");
    if (originalCoordinates.length !== anonymizedCoordinates.length) throw new Error("coordinate validation mismatch");
    for (let i = 0; i < anonymizedCoordinates.length; i++) {
        const original = originalCoordinates[i];
        const rounded = anonymizedCoordinates[i];
        if (!Number.isInteger(rounded.lat) || !Number.isInteger(rounded.lon)) {
            throw new Error("anonymized coordinate is not a whole degree");
        }
        if (original?.lat === rounded.lat && original?.lon === rounded.lon) {
            throw new Error("anonymized coordinate did not change");
        }
    }
    for (let i = 1; i < rmcTimes.length; i++) {
        if (rmcTimes[i] < rmcTimes[i - 1]) throw new Error("RMC timestamps are not monotonic");
    }
    return { text: out.join("\n"), sections, fixes: rmcTimes.length };
}

function main() {
    const input = resolve(REPO_ROOT, process.argv[2] ?? DEFAULT_INPUT);
    const output = resolve(REPO_ROOT, process.argv[3] ?? DEFAULT_OUTPUT);
    const result = anonymize(readFileSync(input, "utf8"));
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, result.text, "utf8");
    console.log(`wrote ${result.fixes} fixes across ${result.sections} sections`);
}

main();
