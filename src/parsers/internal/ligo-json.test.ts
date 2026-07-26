// Tests for the LigoGPS JSON extractor. The fixture header is rebuilt from
// the ExifTool hexdump (LigoGPS.pm:327-333, v13.59: 'LIGOGPSINFO {"Hour":
// "23", "Minute": "10", "Second": "22", "Year": "2023", "Month": "12",
// "Day": "28", "status":...') and completed synthetically with the
// documented key set - no real sample exists (see the foreign-source banner
// in ligo-json.ts).

import { describe, expect, it } from "vitest";
import { KNOTS_TO_MS } from "../types.js";
import {
    GKU_MARKER,
    gkuJsonStart,
    hasGkuMarker,
    hasLigoJsonMarker,
    LIGO_JSON_MARKER,
    parseLigoJsonText,
} from "./ligo-json.js";

/** One JSON record with the upstream key set, in the documented order. */
function jsonRecord(overrides: Record<string, string> = {}): string {
    const fields: Record<string, string> = {
        Hour: "23",
        Minute: "10",
        Second: "22",
        Year: "2023",
        Month: "12",
        Day: "28",
        status: "A",
        NS: "N",
        EW: "E",
        Latitude: "37.123456",
        Longitude: "122.654321",
        Speed: "10.5",
        GsensorX: "000",
        GsensorY: "000",
        GsensorZ: "000",
        MHour: "15",
        MMinute: "10",
        MSecond: "22",
        MYear: "2023",
        MMonth: "12",
        MDay: "28",
        OLatitude: "37.123456",
        OLongitude: "122.654321",
        ...overrides,
    };
    const body = Object.entries(fields)
        .map(([k, v]) => `"${k}": "${v}"`)
        .join(", ");
    return `{${body}}`;
}

/** Chains records as 512-byte 'LIGOGPSINFO {json}' blobs (NUL-padded),
 *  mirroring the upstream "chained 512-byte records" comment. */
function chained(records: string[]): string {
    return records.map((r) => `LIGOGPSINFO ${r}`.padEnd(512, "\0")).join("");
}

const ascii = (text: string): Uint8Array => Uint8Array.from(text, (ch) => ch.charCodeAt(0) & 0xff);

describe("marker checks", () => {
    it("hasLigoJsonMarker requires the payload to OPEN with the literal", () => {
        expect(hasLigoJsonMarker(ascii(`${LIGO_JSON_MARKER}"Hour": ...`))).toBe(true);
        expect(hasLigoJsonMarker(ascii(` ${LIGO_JSON_MARKER}`))).toBe(false);
        expect(hasLigoJsonMarker(ascii("LIGOGPSINFO\0"))).toBe(false); // the encrypted-chunk form, not ours
        expect(hasLigoJsonMarker(new Uint8Array(0))).toBe(false);
    });

    it("hasGkuMarker requires the literal at payload offset 8", () => {
        const head = new Uint8Array(32);
        head.set(ascii(GKU_MARKER), 8);
        expect(hasGkuMarker(head)).toBe(true);
        expect(hasGkuMarker(ascii(GKU_MARKER))).toBe(false); // at 0, not 8
        expect(hasGkuMarker(new Uint8Array(32))).toBe(false);
    });

    it("gkuJsonStart returns the u32 LE indirection offset for GKU heads only", () => {
        const head = new Uint8Array(32);
        new DataView(head.buffer).setUint32(0, 0x1234, true);
        head.set(ascii(GKU_MARKER), 8);
        expect(gkuJsonStart(head)).toBe(0x1234);
        expect(gkuJsonStart(new Uint8Array(32))).toBeNull();
    });
});

describe("parseLigoJsonText", () => {
    it("decodes a chained record stream (UTC time, decimal degrees, knots)", () => {
        const second = jsonRecord({ Second: "23", Latitude: "37.123500" });
        const { records, skipped } = parseLigoJsonText(chained([jsonRecord(), second]), "y.mp4");
        expect(skipped).toEqual([]);
        expect(records).toHaveLength(2);
        const r = records[0]!;
        expect(r.unixSeconds).toBe(Date.UTC(2023, 11, 28, 23, 10, 22) / 1000);
        expect(r.timeUnsynced).toBeUndefined(); // honest GPS UTC - no re-anchor
        expect(r.lat).toBeCloseTo(37.123456, 6);
        expect(r.lon).toBeCloseTo(122.654321, 6);
        expect(r.speedMs).toBeCloseTo(10.5 * KNOTS_TO_MS, 6);
        // Gsensor scale/orientation undocumented upstream - zeroed by policy.
        expect(r.accelXg).toBe(0);
        expect(r.accelYg).toBe(0);
        expect(r.accelZg).toBe(0);
        expect(records[1]!.unixSeconds).toBe(Date.UTC(2023, 11, 28, 23, 10, 23) / 1000);
    });

    it("applies S/W hemisphere signs", () => {
        const { records } = parseLigoJsonText(chained([jsonRecord({ NS: "S", EW: "W" })]), "y.mp4");
        expect(records[0]!.lat).toBeCloseTo(-37.123456, 6);
        expect(records[0]!.lon).toBeCloseTo(-122.654321, 6);
    });

    it("skips status='V' records (no fix) without aborting the stream", () => {
        const { records, skipped } = parseLigoJsonText(chained([jsonRecord({ status: "V" }), jsonRecord()]), "y.mp4");
        expect(records).toHaveLength(1);
        expect(skipped).toHaveLength(1);
        expect(skipped[0]!.reason).toBe("no gps fix (status != A)");
    });

    it("malformed JSON lands in skipped, never throws", () => {
        const broken = 'LIGOGPSINFO {"Hour": "23", "Minute": }';
        const { records, skipped } = parseLigoJsonText(broken + chained([jsonRecord()]), "y.mp4");
        expect(records).toHaveLength(1);
        expect(skipped).toHaveLength(1);
        expect(skipped[0]!.reason).toBe("invalid json");
    });

    it("skips records with missing or implausible fields", () => {
        const noCoords = jsonRecord();
        const stripped = noCoords.replace(', "Latitude": "37.123456"', "").replace(', "OLatitude": "37.123456"', "");
        const badDate = jsonRecord({ Month: "13" });
        const outOfRange = jsonRecord({ Latitude: "97.000000" });
        const { records, skipped } = parseLigoJsonText(chained([stripped, badDate, outOfRange]), "y.mp4");
        expect(records).toEqual([]);
        expect(skipped.map((s) => s.reason)).toEqual([
            "missing coordinates",
            "implausible datetime",
            "coordinates out of range",
        ]);
    });

    it("a record without Speed defaults to 0 m/s", () => {
        const noSpeed = jsonRecord().replace(', "Speed": "10.5"', "");
        const { records } = parseLigoJsonText(chained([noSpeed]), "y.mp4");
        expect(records).toHaveLength(1);
        expect(records[0]!.speedMs).toBe(0);
    });

    it("returns nothing for text without the record literal", () => {
        const { records, skipped } = parseLigoJsonText("no ligo markers anywhere", "y.mp4");
        expect(records).toEqual([]);
        expect(skipped).toEqual([]);
    });

    it("an adversarial window of repeated unterminated literals completes fast with zero records", () => {
        // The unbounded ExifTool regex is quadratic on this shape (~minutes
        // at the 4 MB cap); the bounded body class must stay O(window).
        const window = "LIGOGPSINFO {".repeat(64 * 1024); // ~832 KB, no '}' anywhere
        const startedAt = performance.now();
        const { records } = parseLigoJsonText(window, "y.mp4");
        expect(records).toEqual([]);
        expect(performance.now() - startedAt).toBeLessThan(2000);
    });

    it("a record body longer than the 1024-char bound does not match; normal records still parse", () => {
        const oversized = `LIGOGPSINFO {"pad": "${"x".repeat(1100)}"}`;
        const { records, skipped } = parseLigoJsonText(oversized + chained([jsonRecord()]), "y.mp4");
        // The oversized body is not even claimed as a record (no skipped
        // entry) - upstream records are 512-byte blobs, so 1024 is generous.
        expect(records).toHaveLength(1);
        expect(skipped).toEqual([]);
        expect(records[0]!.lat).toBeCloseTo(37.123456, 6);
    });
});
