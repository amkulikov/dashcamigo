import { describe, it, expect } from "vitest";
import type { GpsRecord } from "../types.js";
import { parseNmeaText, dedupByUnixSeconds, applyGsensor, _internal } from "./nmea.js";

describe("parseNmeaCoord", () => {
    const { parseNmeaCoord } = _internal;
    it.each<[string, string, "lat" | "lon", number | null]>([
        ["5228.16177", "N", "lat", 52 + 28.16177 / 60],
        ["5228.16177", "S", "lat", -(52 + 28.16177 / 60)],
        ["02110.10000", "E", "lon", 21 + 10.1 / 60],
        ["12345.67890", "W", "lon", -(123 + 45.6789 / 60)],
        ["", "N", "lat", null],
        ["foo", "N", "lat", null],
        ["1234.5", "X", "lat", null],
        ["1260.0000", "N", "lat", null],
        ["9999.9999", "N", "lat", null],
        ["5228.16177", "E", "lat", null],
        ["02110.10000", "N", "lon", null],
    ])("parseNmeaCoord(%s, %s, %s)", (value, dir, axis, expected) => {
        const result = parseNmeaCoord(value, dir, axis);
        if (expected === null) expect(result).toBeNull();
        else expect(result).toBeCloseTo(expected, 6);
    });
});

describe("parseNmeaTimestamp", () => {
    const { parseNmeaTimestamp } = _internal;
    it("hhmmss + ddmmyy -> unix seconds UTC", () => {
        // 16:24:58 UTC on 30 Jan 2019 = 1548865498
        const ts = parseNmeaTimestamp("162458", "300119");
        expect(ts).toBe(Date.UTC(2019, 0, 30, 16, 24, 58) / 1000);
    });
    it("hhmmss.ss with sub-second precision", () => {
        const ts = parseNmeaTimestamp("162458.50", "300119");
        expect(ts).toBeCloseTo(Date.UTC(2019, 0, 30, 16, 24, 58) / 1000 + 0.5, 6);
    });
    it("yy < 70 -> 20xx, yy >= 70 -> 19xx", () => {
        const a = parseNmeaTimestamp("000000", "010169"); // 2069
        const b = parseNmeaTimestamp("000000", "010170"); // 1970
        expect(new Date((a ?? 0) * 1000).getUTCFullYear()).toBe(2069);
        expect(new Date((b ?? 0) * 1000).getUTCFullYear()).toBe(1970);
    });
    it("returns null on invalid input", () => {
        expect(parseNmeaTimestamp("xx", "300119")).toBeNull();
        expect(parseNmeaTimestamp("162458", "")).toBeNull();
        expect(parseNmeaTimestamp("162458", "310226")).toBeNull();
    });
});

describe("parseNmeaText", () => {
    it("plain GPRMC stream parses to GpsRecord[]", () => {
        const text = [
            "$GPRMC,162458.00,A,5228.16177,N,02110.10000,E,5.5,123.4,300119,,,A*6C",
            "$GPRMC,162459.00,A,5228.16200,N,02110.10100,E,5.6,123.5,300119,,,A*6F",
            "$GPGGA,162458.00,5228.16177,N,02110.10000,E,1,12,0.5,123.4,M,46.0,M,,*4C",
            "$GPRMC,162500.00,V,,,,,,,300119,,,N*53",
            "",
        ].join("\n");
        const result = parseNmeaText(text, "test.mp4");
        expect(result.records).toHaveLength(2);
        expect(result.skipped).toHaveLength(0);
        expect(result.records[0]?.lat).toBeCloseTo(52 + 28.16177 / 60, 5);
        expect(result.records[0]?.unixSeconds).toBe(Date.UTC(2019, 0, 30, 16, 24, 58) / 1000);
        expect(result.records[0]?.speedMs).toBeCloseTo(5.5 * 0.514444, 5);
        expect(result.records[1]?.bearingDeg).toBe(123.5);
    });

    it("$GSENSOR wrap10 mode (no minus signs in any line - corpus-style)", () => {
        // All values unsigned, mode stays wrap10 for the whole file.
        // 976 in 10-bit two's complement = 976 - 1024 = -48 -> -0.047g
        const text = [
            "$GPRMC,162459.00,A,5228.16200,N,02110.10100,E,5.6,123.5,300119,,,A*6F",
            "$GSENSOR,0,0,976",
            "$GPRMC,162500.00,A,5228.16300,N,02110.10200,E,5.7,123.6,300119,,,A*70",
            "$GSENSOR,0,0,0",
            "",
        ].join("\n");
        const result = parseNmeaText(text, "test.mp4");
        expect(result.records).toHaveLength(2);
        expect(result.records[0]?.accelXg).toBe(0);
        expect(result.records[0]?.accelYg).toBe(0);
        expect(result.records[0]?.accelZg).toBeCloseTo(-48 / 1024, 6);
        // explicit 0,0,0 - magnitude 0
        expect(result.records[1]?.accelXg).toBe(0);
        expect(result.records[1]?.accelYg).toBe(0);
        expect(result.records[1]?.accelZg).toBe(0);
    });

    it("$GSENSOR signed-direct mode sticky after first minus line (Marcus 3)", () => {
        // First line has '-' -> mode switches to signed-direct for the whole
        // file. All subsequent $GSENSOR lines are treated as signed-direct,
        // even if they contain only positive numbers.
        const text = [
            "$GPRMC,162458.00,A,5228.16177,N,02110.10000,E,5.5,123.4,300119,,,A*6C",
            "$GSENSOR,-50,-384,500",
            "$GPRMC,162459.00,A,5228.16200,N,02110.10100,E,5.6,123.5,300119,,,A*6F",
            // 976 in signed-direct mode = +976 (no wrap) = +0.953g
            "$GSENSOR,0,0,976",
            "",
        ].join("\n");
        const result = parseNmeaText(text, "test.mp4");
        expect(result.records).toHaveLength(2);
        expect(result.records[0]?.accelXg).toBeCloseTo(-50 / 1024, 6);
        expect(result.records[0]?.accelYg).toBeCloseTo(-384 / 1024, 6);
        expect(result.records[0]?.accelZg).toBeCloseTo(500 / 1024, 6);
        // signed-direct: 976 without wrap = +976 / 1024 = +0.953g
        expect(result.records[1]?.accelZg).toBeCloseTo(976 / 1024, 6);
    });

    it("applyGsensor float-g mode (Mio/Navman): decimal g read directly, no LSB scaling", () => {
        // Navman MiVue dialect: values are decimal g already (NOT /1024). The
        // sentence id has a trailing D ($GSENSORD) and must not be confused with
        // the integer $GSENSOR form. This is the raw read, BEFORE the per-log DC
        // removal that parseNmeaText applies (see the next test).
        const rec = { accelXg: 0, accelYg: 0, accelZg: 0 } as unknown as GpsRecord;
        applyGsensor("$GSENSORD,0.310,0.060,-0.120", rec, "float-g");
        expect(rec.accelXg).toBeCloseTo(0.31, 6);
        expect(rec.accelYg).toBeCloseTo(0.06, 6);
        expect(rec.accelZg).toBeCloseTo(-0.12, 6);
    });

    it("$GSENSORD: per-axis median DC offset removed to honour the gravity-removed contract", () => {
        // The camera carries a constant ~0.3g vector (mount tilt / bias) that
        // never decays at rest. parseNmeaText subtracts the per-axis median over
        // the whole log so the baseline returns to ~0. Three X samples 0.30/0.40/
        // 0.50 -> median 0.40; Y constant 0.10, Z constant -0.10 -> both collapse.
        const text = [
            "$GPRMC,044858.000,A,2300.0000,S,15000.0000,E,0.00,0.00,250626,,,A*72",
            "$GSENSORD,0.300,0.100,-0.100",
            "$GPRMC,044859.000,A,2300.0000,S,15000.0000,E,0.00,0.00,250626,,,A*73",
            "$GSENSORD,0.400,0.100,-0.100",
            "$GPRMC,044900.000,A,2300.0000,S,15000.0000,E,0.00,0.00,250626,,,A*7E",
            "$GSENSORD,0.500,0.100,-0.100",
            "",
        ].join("\n");
        const result = parseNmeaText(text, "FILE260625-144859.MP4");
        expect(result.records).toHaveLength(3);
        expect(result.skipped).toHaveLength(0);
        // Median X=0.40 subtracted: only the dynamics around the baseline survive.
        expect(result.records[0]!.accelXg).toBeCloseTo(-0.1, 6);
        expect(result.records[1]!.accelXg).toBeCloseTo(0, 6);
        expect(result.records[2]!.accelXg).toBeCloseTo(0.1, 6);
        // Constant Y/Z -> their median equals every value -> collapse to 0.
        for (const r of result.records) {
            expect(r.accelYg).toBeCloseTo(0, 6);
            expect(r.accelZg).toBeCloseTo(0, 6);
        }
    });

    it("$GSENSOR before any RMC is silently dropped (nowhere to attach)", () => {
        const text = [
            "$GSENSOR,100,200,1000",
            "$GPRMC,162458.00,A,5228.16177,N,02110.10000,E,5.5,123.4,300119,,,A*6C",
            "",
        ].join("\n");
        const result = parseNmeaText(text, "test.mp4");
        expect(result.records).toHaveLength(1);
        expect(result.records[0]?.accelXg).toBe(0);
    });

    it("$GSENSOR with an empty/checksum-only Z is rejected, not read as 0", () => {
        const text = [
            "$GPRMC,162458.00,A,5228.16177,N,02110.10000,E,5.5,123.4,300119,,,A*6C",
            // Z field is just a checksum -> Number("") would be 0; must be rejected
            // so X/Y are not applied either (the record keeps its default zeros).
            "$GSENSOR,100,200,*FF",
            "",
        ].join("\n");
        const result = parseNmeaText(text, "test.mp4");
        expect(result.records).toHaveLength(1);
        expect(result.records[0]?.accelXg).toBe(0);
        expect(result.records[0]?.accelYg).toBe(0);
        expect(result.records[0]?.accelZg).toBe(0);
    });

    it("BlackVue-style [unix_ms] prefix never overrides satellite time", () => {
        // Prefix runs 1 h 0.5 s ahead of the sentence: a camera on UTC+1 stamping
        // local wall time. Taking it would shift the whole track by the TZ.
        const text = [
            "[1548869098500]$GPRMC,162458.00,A,5228.16177,N,02110.10000,E,5.5,123.4,300119,,,A*6C",
            "[1548869099500]$GPRMC,162459.00,A,5228.16200,N,02110.10100,E,5.6,123.5,300119,,,A*6F",
            // line without prefix is silently skipped
            "$GPRMC,162500.00,A,5228.16300,N,02110.10200,E,5.7,123.6,300119,,,A*70",
        ].join("\n");
        const result = parseNmeaText(text, "test.mp4", { linePrefixRegex: /^\[(\d+)\]/ });
        expect(result.records).toHaveLength(2);
        expect(result.records[0]?.unixSeconds).toBe(1548865498);
        expect(result.records[1]?.unixSeconds).toBe(1548865499);
    });

    it("falls back to the prefix clock when the sentence timestamp is corrupt", () => {
        // Empty time/date fields: without the prefix this row would be dropped,
        // and a point placed by the camera clock beats no point at all.
        const text = ["[1548865498500]$GPRMC,,A,5228.16177,N,02110.10000,E,5.5,123.4,,,,A*6C"].join("\n");
        const result = parseNmeaText(text, "test.mp4", { linePrefixRegex: /^\[(\d+)\]/ });
        expect(result.records).toHaveLength(1);
        expect(result.records[0]?.unixSeconds).toBe(1548865498.5);
    });

    it("malformed RMC goes to skipped, not records", () => {
        const text = [
            "$GPRMC,162458.00,A,5228.16177,N,02110.10000,E,5.5,123.4,300119,,,A*6C", // ok
            "$GPRMC,bad,A,bad,N,bad,E,bad,bad,bad,,,A*FF", // garbage
            "$GPRMC,162459.00,A,5228.16200,N,02110.10100,E,5.6,123.5,300119,,,A*6F", // ok
        ].join("\n");
        const result = parseNmeaText(text, "test.mp4");
        expect(result.records).toHaveLength(2);
        expect(result.skipped).toHaveLength(1);
    });
});

describe("dedupByUnixSeconds", () => {
    it("keeps first occurrence per timestamp", () => {
        const records = [
            {
                unixSeconds: 100,
                lat: 1,
                lon: 2,
                active: true,
                bearingDeg: 0,
                speedMs: 0,
                accelXg: 0,
                accelYg: 0,
                accelZg: 0,
                mp4Filename: "",
            },
            {
                unixSeconds: 100,
                lat: 9,
                lon: 9,
                active: true,
                bearingDeg: 0,
                speedMs: 0,
                accelXg: 0,
                accelYg: 0,
                accelZg: 0,
                mp4Filename: "",
            },
            {
                unixSeconds: 101,
                lat: 3,
                lon: 4,
                active: true,
                bearingDeg: 0,
                speedMs: 0,
                accelXg: 0,
                accelYg: 0,
                accelZg: 0,
                mp4Filename: "",
            },
        ];
        const result = dedupByUnixSeconds(records);
        expect(result).toHaveLength(2);
        expect(result[0]?.lat).toBe(1);
        expect(result[1]?.lat).toBe(3);
    });
});
