// Unit tests for the Navitel gps0 extractor (low-level layer): parseIditDate,
// decodeGps0Record, parseNavitelTail on hand-crafted bytes.
// End-to-end tests against a real MP4 live in navitel.test.ts.

import { describe, it, expect } from "vitest";
import { ddmmToDegrees } from "./ddmm.js";
import {
    decodeGps0Record,
    gps0HasSelfDescribedDates,
    parseGsenAtom,
    parseIditDate,
    parseNavitelTail,
} from "./navitel-gps0.js";

describe("parseIditDate", () => {
    it("parses 'YYYY-MM-DD HH:MM:SS' ASCII string", () => {
        const payload = new TextEncoder().encode("2020-11-04 16:30:14\0");
        expect(parseIditDate(payload)).toEqual({ year: 2020, month: 11, day: 4, hour: 16, minute: 30, second: 14 });
    });

    it("rejects bogus format", () => {
        expect(parseIditDate(new TextEncoder().encode("not a date string"))).toBeNull();
    });

    it("rejects year outside 2000-2099 range", () => {
        expect(parseIditDate(new TextEncoder().encode("1999-12-31 23:59:59"))).toBeNull();
        expect(parseIditDate(new TextEncoder().encode("2100-01-01 00:00:00"))).toBeNull();
    });

    it("rejects too-short payload", () => {
        expect(parseIditDate(new Uint8Array(5))).toBeNull();
    });
});

describe("ddmmToDegrees", () => {
    it("converts NMEA DDmm.mmmm to decimal degrees", () => {
        // Synthetic: 50°12.3456' N = 50.20576° lat
        expect(ddmmToDegrees(5012.3456)).toBeCloseTo(50.20576, 6);
        // 30°09.8765' E = 30.164608° lon
        expect(ddmmToDegrees(3009.8765)).toBeCloseTo(30.164608333, 6);
    });

    it("preserves sign for southern/western hemispheres", () => {
        expect(ddmmToDegrees(-5012.3456)).toBeCloseTo(-50.20576, 6);
    });

    it("handles zero", () => {
        expect(ddmmToDegrees(0)).toBe(0);
    });
});

describe("decodeGps0Record", () => {
    function makeRecord(opts: {
        lat?: number;
        lon?: number;
        altitude?: number;
        speed?: number;
        year?: number; // raw byte, year - 2000; 0 = "firmware left it blank"
        month?: number; // raw byte; 0 = blank
        day?: number;
        hour?: number;
        min?: number;
        sec?: number;
        course?: number; // raw byte, degrees / 2
    }): DataView {
        const buf = Buffer.alloc(32);
        buf.writeDoubleLE(opts.lat ?? 5012.3456, 0);
        buf.writeDoubleLE(opts.lon ?? 3009.8765, 8);
        buf.writeInt32LE(opts.altitude ?? 140, 16);
        buf.writeUInt16LE(opts.speed ?? 0, 20);
        buf.writeUInt8(opts.year ?? 20, 22);
        buf.writeUInt8(opts.month ?? 11, 23);
        buf.writeUInt8(opts.day ?? 4, 24);
        buf.writeUInt8(opts.hour ?? 13, 25);
        buf.writeUInt8(opts.min ?? 30, 26);
        buf.writeUInt8(opts.sec ?? 15, 27);
        buf.writeUInt8(opts.course ?? 0, 28);
        buf.writeUInt8(0x01, 29);
        buf.writeUInt8(0x01, 30);
        buf.writeUInt8(0x00, 31);
        return new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    }

    it("decodes a typical record from sample data", () => {
        const view = makeRecord({});
        const rec = decodeGps0Record(view, 0, 2020, 11, "test.MOV");
        expect(rec).not.toBeNull();
        expect(rec!.lat).toBeCloseTo(50.20576, 6);
        expect(rec!.lon).toBeCloseTo(30.164608333, 6);
        // 2020-11-04 13:30:15 UTC
        expect(rec!.unixSeconds).toBeCloseTo(Date.UTC(2020, 10, 4, 13, 30, 15) / 1000, 5);
        expect(rec!.active).toBe(true);
        expect(rec!.mp4Filename).toBe("test.MOV");
    });

    it("returns null for zero-fix (lat=0 && lon=0)", () => {
        const view = makeRecord({ lat: 0, lon: 0 });
        expect(decodeGps0Record(view, 0, 2020, 11, "x")).toBeNull();
    });

    it("returns null for out-of-range coordinates", () => {
        const view = makeRecord({ lat: 9999.99 }); // DDmm = 99°99.99' > 100°
        expect(decodeGps0Record(view, 0, 2020, 11, "x")).toBeNull();
    });

    it("decodes speed from bytes 20-21 as plain km/h (not the altitude at 16)", () => {
        // altitude 140 m next to speed 68 km/h - the pre-fix parser read the
        // altitude bytes and reported a constant ~14 km/h on the real sample.
        const view = makeRecord({ altitude: 140, speed: 68 });
        const rec = decodeGps0Record(view, 0, 2020, 11, "x");
        expect(rec!.speedMs).toBeCloseTo(68 / 3.6, 4);
    });

    it("returns null for invalid date components", () => {
        expect(decodeGps0Record(makeRecord({ day: 0 }), 0, 2020, 11, "x")).toBeNull();
        expect(decodeGps0Record(makeRecord({ hour: 24 }), 0, 2020, 11, "x")).toBeNull();
        expect(decodeGps0Record(makeRecord({ min: 60 }), 0, 2020, 11, "x")).toBeNull();
        expect(decodeGps0Record(makeRecord({ sec: 60 }), 0, 2020, 11, "x")).toBeNull();
    });

    it("prefers in-record year/month over the IDIT baseline", () => {
        // Record says 2023-04; deliberately wrong baseline 2020-11 must lose.
        const view = makeRecord({ year: 23, month: 4, day: 22 });
        const rec = decodeGps0Record(view, 0, 2020, 11, "x");
        expect(rec!.unixSeconds).toBeCloseTo(Date.UTC(2023, 3, 22, 13, 30, 15) / 1000, 5);
    });

    it("falls back to the IDIT baseline when the month byte is blank", () => {
        const view = makeRecord({ year: 0, month: 0 });
        const rec = decodeGps0Record(view, 0, 2020, 11, "x");
        expect(rec!.unixSeconds).toBeCloseTo(Date.UTC(2020, 10, 4, 13, 30, 15) / 1000, 5);
    });

    it("decodes course as byte * 2 and drops implausible values", () => {
        const rec = decodeGps0Record(makeRecord({ course: 46 }), 0, 2020, 11, "x");
        expect(rec!.bearingDeg).toBe(92);
        // >= 180 raw would be >= 360 deg - treated as "no course".
        const bad = decodeGps0Record(makeRecord({ course: 200 }), 0, 2020, 11, "x");
        expect(bad!.bearingDeg).toBe(0);
    });
});

describe("parseNavitelTail", () => {
    function makeIditBytes(dateStr: string): Uint8Array {
        const header = Buffer.alloc(8);
        const dateBuf = Buffer.alloc(20);
        Buffer.from(dateStr, "ascii").copy(dateBuf, 0);
        header.writeUInt32BE(8 + 20, 0);
        Buffer.from("IDIT", "ascii").copy(header, 4);
        return new Uint8Array(Buffer.concat([header, dateBuf]));
    }

    // Records are written with BLANK year/month bytes (22-23) unless given -
    // the month-calibration/rollover tests below exercise exactly the
    // IDIT-baseline fallback path for firmware that zero-fills those bytes.
    function makeGps0Bytes(
        records: Array<{
            lat: number;
            lon: number;
            speed: number;
            year?: number;
            month?: number;
            day: number;
            hour: number;
            min: number;
            sec: number;
        }>,
    ): Uint8Array {
        const payload = Buffer.alloc(records.length * 32);
        for (let i = 0; i < records.length; i++) {
            const r = records[i]!;
            const off = i * 32;
            payload.writeDoubleLE(r.lat, off);
            payload.writeDoubleLE(r.lon, off + 8);
            payload.writeUInt16LE(r.speed, off + 20);
            payload.writeUInt8(r.year ?? 0, off + 22);
            payload.writeUInt8(r.month ?? 0, off + 23);
            payload.writeUInt8(r.day, off + 24);
            payload.writeUInt8(r.hour, off + 25);
            payload.writeUInt8(r.min, off + 26);
            payload.writeUInt8(r.sec, off + 27);
            payload.writeUInt8(0x01, off + 29);
            payload.writeUInt8(0x01, off + 30);
        }
        const header = Buffer.alloc(8);
        header.writeUInt32BE(8 + payload.length, 0);
        Buffer.from("gps0", "ascii").copy(header, 4);
        return new Uint8Array(Buffer.concat([header, payload]));
    }

    it("uses in-record year/month when present (real-firmware path)", () => {
        // IDIT month deliberately wrong (December) - in-record 2020-11 wins.
        const idit = makeIditBytes("2020-12-31 23:59:59");
        const gps0 = makeGps0Bytes([
            { lat: 5012.3456, lon: 3009.8765, speed: 68, year: 20, month: 11, day: 4, hour: 13, min: 30, sec: 15 },
        ]);
        const parsed = parseNavitelTail(idit, gps0, "x.MOV");
        expect(parsed!.records[0]!.unixSeconds).toBeCloseTo(Date.UTC(2020, 10, 4, 13, 30, 15) / 1000, 0);
        expect(parsed!.records[0]!.speedMs).toBeCloseTo(68 / 3.6, 3);
    });

    it("returns null when IDIT date is bogus", () => {
        const idit = makeIditBytes("not a real date");
        const gps0 = makeGps0Bytes([
            { lat: 5012.3456, lon: 3009.8765, speed: 100, day: 4, hour: 13, min: 30, sec: 15 },
        ]);
        expect(parseNavitelTail(idit, gps0, "x.MOV")).toBeNull();
    });

    it("parses 3 records with monotonic timestamps", () => {
        const idit = makeIditBytes("2020-11-04 16:30:14");
        const gps0 = makeGps0Bytes([
            { lat: 5012.3456, lon: 3009.8765, speed: 140, day: 4, hour: 13, min: 30, sec: 15 },
            { lat: 5012.345, lon: 3009.877, speed: 140, day: 4, hour: 13, min: 30, sec: 16 },
            { lat: 5012.3444, lon: 3009.8775, speed: 140, day: 4, hour: 13, min: 30, sec: 17 },
        ]);
        const parsed = parseNavitelTail(idit, gps0, "x.MOV");
        expect(parsed).not.toBeNull();
        expect(parsed!.records).toHaveLength(3);
        expect(parsed!.records[0]!.unixSeconds).toBeLessThan(parsed!.records[1]!.unixSeconds);
        expect(parsed!.records[1]!.unixSeconds).toBeLessThan(parsed!.records[2]!.unixSeconds);
    });

    it("filters out zero-fix records silently (no skipped entries)", () => {
        const idit = makeIditBytes("2020-11-04 16:30:14");
        const gps0 = makeGps0Bytes([
            { lat: 0, lon: 0, speed: 0, day: 4, hour: 13, min: 30, sec: 15 },
            { lat: 5012.3456, lon: 3009.8765, speed: 140, day: 4, hour: 13, min: 30, sec: 16 },
        ]);
        const parsed = parseNavitelTail(idit, gps0, "x.MOV");
        expect(parsed!.records).toHaveLength(1);
        expect(parsed!.skipped).toHaveLength(0);
    });

    it("returns null when gps0 has no records at all", () => {
        const idit = makeIditBytes("2020-11-04 16:30:14");
        // gps0 with empty payload (header only).
        const header = Buffer.alloc(8);
        header.writeUInt32BE(8, 0);
        Buffer.from("gps0", "ascii").copy(header, 4);
        const gps0 = new Uint8Array(header);
        expect(parseNavitelTail(idit, gps0, "x.MOV")).toBeNull();
    });

    it("rolls month forward when day drops from 31 -> 1 mid-recording (cross-midnight UTC)", () => {
        // Recording starts Jan 31 23:55 UTC, crosses into Feb 1 00:05 UTC.
        const idit = makeIditBytes("2025-02-01 02:55:00"); // local MSK = UTC+3
        const gps0 = makeGps0Bytes([
            { lat: 5012.3456, lon: 3009.8765, speed: 100, day: 31, hour: 23, min: 55, sec: 0 },
            { lat: 5012.3456, lon: 3009.8765, speed: 100, day: 31, hour: 23, min: 59, sec: 59 },
            { lat: 5012.3456, lon: 3009.8765, speed: 100, day: 1, hour: 0, min: 0, sec: 1 },
            { lat: 5012.3456, lon: 3009.8765, speed: 100, day: 1, hour: 0, min: 5, sec: 0 },
        ]);
        const parsed = parseNavitelTail(idit, gps0, "x.MOV");
        expect(parsed).not.toBeNull();
        expect(parsed!.records).toHaveLength(4);
        const r = parsed!.records;
        // First two records: January 31.
        expect(r[0]!.unixSeconds).toBeCloseTo(Date.UTC(2025, 0, 31, 23, 55, 0) / 1000, 0);
        expect(r[1]!.unixSeconds).toBeCloseTo(Date.UTC(2025, 0, 31, 23, 59, 59) / 1000, 0);
        // Last two records: February 1 (NOT January 1).
        expect(r[2]!.unixSeconds).toBeCloseTo(Date.UTC(2025, 1, 1, 0, 0, 1) / 1000, 0);
        expect(r[3]!.unixSeconds).toBeCloseTo(Date.UTC(2025, 1, 1, 0, 5, 0) / 1000, 0);
        // Records stay monotonic.
        for (let i = 1; i < r.length; i++) {
            expect(r[i]!.unixSeconds).toBeGreaterThan(r[i - 1]!.unixSeconds);
        }
    });

    it("rolls month+year forward when day drops from 31 -> 1 across Dec/Jan boundary", () => {
        const idit = makeIditBytes("2024-12-31 22:00:00");
        const gps0 = makeGps0Bytes([
            { lat: 5012.3456, lon: 3009.8765, speed: 100, day: 31, hour: 23, min: 59, sec: 0 },
            { lat: 5012.3456, lon: 3009.8765, speed: 100, day: 1, hour: 0, min: 0, sec: 30 },
        ]);
        const parsed = parseNavitelTail(idit, gps0, "x.MOV");
        const r = parsed!.records;
        expect(r[0]!.unixSeconds).toBeCloseTo(Date.UTC(2024, 11, 31, 23, 59, 0) / 1000, 0);
        expect(r[1]!.unixSeconds).toBeCloseTo(Date.UTC(2025, 0, 1, 0, 0, 30) / 1000, 0);
    });

    it("calibrates first record into previous month when IDIT local-tomorrow > gps0 UTC-today (TZ ahead)", () => {
        // IDIT in UTC+3 says 2025-02-01 01:30 local, UTC = 2025-01-31 22:30.
        // gps0 first record day=31 -> must be January, not February.
        const idit = makeIditBytes("2025-02-01 01:30:00");
        const gps0 = makeGps0Bytes([
            { lat: 5012.3456, lon: 3009.8765, speed: 100, day: 31, hour: 22, min: 30, sec: 0 },
        ]);
        const parsed = parseNavitelTail(idit, gps0, "x.MOV");
        expect(parsed!.records[0]!.unixSeconds).toBeCloseTo(Date.UTC(2025, 0, 31, 22, 30, 0) / 1000, 0);
    });

    it("calibrates first record into next month when IDIT local-yesterday < gps0 UTC-today (TZ behind)", () => {
        // IDIT in UTC-3 says 2025-01-31 22:00 local, UTC = 2025-02-01 01:00.
        // gps0 first record day=1 -> must be February.
        const idit = makeIditBytes("2025-01-31 22:00:00");
        const gps0 = makeGps0Bytes([{ lat: 5012.3456, lon: 3009.8765, speed: 100, day: 1, hour: 1, min: 0, sec: 0 }]);
        const parsed = parseNavitelTail(idit, gps0, "x.MOV");
        expect(parsed!.records[0]!.unixSeconds).toBeCloseTo(Date.UTC(2025, 1, 1, 1, 0, 0) / 1000, 0);
    });

    // Stale-row glitch patterns observed on the real iBOX iCON sample: the
    // firmware interleaves the valid 1 Hz track with ring-buffer leftovers.
    describe("stale firmware row filter", () => {
        const base = { lat: 5000.0, lon: 3000.0, speed: 70, day: 4, hour: 13, min: 30 };

        it("drops a full-stale row (timestamp a minute in the past)", () => {
            const idit = makeIditBytes("2020-11-04 16:30:14");
            const gps0 = makeGps0Bytes([
                { ...base, sec: 15 },
                { ...base, lat: 5000.01, sec: 16 },
                // stale: one minute back, position 0.5' (~925 m) behind
                { ...base, lat: 4999.5, min: 29, sec: 17 },
                { ...base, lat: 5000.02, sec: 17 },
            ]);
            const parsed = parseNavitelTail(idit, gps0, "x.MOV");
            expect(parsed!.records).toHaveLength(3);
            expect(parsed!.skipped.some((s) => s.reason.includes("backward time step"))).toBe(true);
        });

        it("drops a half-stale row (fresh timestamp, stale position)", () => {
            const idit = makeIditBytes("2020-11-04 16:30:14");
            const gps0 = makeGps0Bytes([
                { ...base, sec: 15 },
                { ...base, lat: 5000.01, sec: 16 },
                // fresh second, position teleports ~925 m back: implied ~925 m/s
                { ...base, lat: 4999.5, sec: 17 },
                { ...base, lat: 5000.02, sec: 18 },
            ]);
            const parsed = parseNavitelTail(idit, gps0, "x.MOV");
            expect(parsed!.records).toHaveLength(3);
            expect(parsed!.records.map((r) => r.lat).every((lat) => lat > 49.99)).toBe(true);
            expect(parsed!.skipped.some((s) => s.reason.includes("implausible displacement"))).toBe(true);
        });

        it("keeps a genuine relocation confirmed by the following row", () => {
            const idit = makeIditBytes("2020-11-04 16:30:14");
            const gps0 = makeGps0Bytes([
                { ...base, sec: 15 },
                // both rows agree on the new far-away position - new anchor,
                // not a glitch (e.g. recording resumed after a long gap)
                { ...base, lat: 5050.0, sec: 16 },
                { ...base, lat: 5050.01, sec: 17 },
            ]);
            const parsed = parseNavitelTail(idit, gps0, "x.MOV");
            expect(parsed!.records).toHaveLength(3);
        });
    });

    // A real 56-byte Miltona record (FILE211202-151504-000406F.MOV rec 11,
    // published in trip-viewer's test suite): scrambled f64 coords, km/h
    // speed byte @20, UTC datetime @22, framing magic 3c99a73a @44.
    const MILTONA_REC_HEX =
        "1e166a4d437bce40a50a46259940eac09f0000006700150c02140f0f2d010100f8d4870327498600830085003c99a73a6e00000000000000";

    function makeMiltonaGps0Bytes(): Uint8Array {
        const rec = Buffer.from(MILTONA_REC_HEX, "hex");
        expect(rec.length).toBe(56);
        const header = Buffer.alloc(8);
        header.writeUInt32BE(8 + rec.length * 2, 0);
        Buffer.from("gps0", "ascii").copy(header, 4);
        return new Uint8Array(Buffer.concat([header, rec, rec]));
    }

    it("bails out on the Miltona 56-byte gps0 dialect instead of misparsing it", () => {
        const idit = makeIditBytes("2021-12-02 15:15:04");
        expect(parseNavitelTail(idit, makeMiltonaGps0Bytes(), "FILE211202-151504-000406F.MOV")).toBeNull();
    });

    it("bails out on the Miltona dialect on the IDIT-less path too", () => {
        // Miltona records carry valid-looking date bytes at offsets 22-23
        // (0x15 0x0c = 2021-12 in the committed record), so they pass the
        // IDIT-less marker probe - the parse-level bail-out must run BEFORE
        // and independent of the IDIT branch.
        expect(gps0HasSelfDescribedDates(makeMiltonaGps0Bytes())).toBe(true); // probe is fooled by design
        expect(parseNavitelTail(null, makeMiltonaGps0Bytes(), "FILE211202-151504-000406F.MOV")).toBeNull();
    });

    // Lamax S9 encrypted gps0 dialect: 311-byte text records, signature
    // f2 e1 f0 ee 54 54 98 at payload offsets 2..8 (ExifTool
    // QuickTimeStream.pl:2722-2735, v13.59). Synthetic fixture reconstructed
    // from the upstream regex - no real sample exists in the repo.
    function makeLamaxGps0Bytes(): Uint8Array {
        const payload = Buffer.alloc(311);
        Buffer.from([0xf2, 0xe1, 0xf0, 0xee, 0x54, 0x54, 0x98]).copy(payload, 2);
        const header = Buffer.alloc(8);
        header.writeUInt32BE(8 + payload.length, 0);
        Buffer.from("gps0", "ascii").copy(header, 4);
        return new Uint8Array(Buffer.concat([header, payload]));
    }

    it("bails out on the Lamax S9 encrypted gps0 dialect (with IDIT)", () => {
        const idit = makeIditBytes("2022-05-01 10:00:00");
        expect(parseNavitelTail(idit, makeLamaxGps0Bytes(), "x.MOV")).toBeNull();
    });

    it("bails out on the Lamax S9 encrypted gps0 dialect (IDIT-less)", () => {
        expect(parseNavitelTail(null, makeLamaxGps0Bytes(), "x.MOV")).toBeNull();
    });

    // IDIT-less mode: records self-describe year/month at bytes 22-23.
    // Implemented from foreign source (ExifTool Process_gps0 has no IDIT
    // requirement) - all fixtures here are synthetic, n=0 real IDIT-less
    // samples exist.
    describe("IDIT-less mode", () => {
        it("parses records that self-describe year/month", () => {
            const gps0 = makeGps0Bytes([
                { lat: 5012.3456, lon: 3009.8765, speed: 68, year: 23, month: 4, day: 22, hour: 13, min: 30, sec: 15 },
                { lat: 5012.345, lon: 3009.877, speed: 68, year: 23, month: 4, day: 22, hour: 13, min: 30, sec: 16 },
            ]);
            const parsed = parseNavitelTail(null, gps0, "x.MOV");
            expect(parsed).not.toBeNull();
            expect(parsed!.records).toHaveLength(2);
            expect(parsed!.records[0]!.unixSeconds).toBeCloseTo(Date.UTC(2023, 3, 22, 13, 30, 15) / 1000, 0);
            expect(parsed!.records[1]!.unixSeconds).toBeCloseTo(Date.UTC(2023, 3, 22, 13, 30, 16) / 1000, 0);
        });

        it("returns null when all records have zero-filled date bytes (needs the IDIT baseline)", () => {
            // Same bytes WITH an IDIT parse fine (the baseline tests above);
            // without IDIT there is no time base - reject, never misparse.
            const gps0 = makeGps0Bytes([
                { lat: 5012.3456, lon: 3009.8765, speed: 100, day: 4, hour: 13, min: 30, sec: 15 },
                { lat: 5012.345, lon: 3009.877, speed: 100, day: 4, hour: 13, min: 30, sec: 16 },
            ]);
            expect(parseNavitelTail(null, gps0, "x.MOV")).toBeNull();
        });

        it("skips leading blank-date records and keeps the dated tail (cold start)", () => {
            const gps0 = makeGps0Bytes([
                { lat: 5012.3456, lon: 3009.8765, speed: 0, day: 22, hour: 13, min: 30, sec: 14 },
                { lat: 5012.3456, lon: 3009.8765, speed: 68, year: 23, month: 4, day: 22, hour: 13, min: 30, sec: 15 },
                { lat: 5012.345, lon: 3009.877, speed: 68, year: 23, month: 4, day: 22, hour: 13, min: 30, sec: 16 },
            ]);
            const parsed = parseNavitelTail(null, gps0, "x.MOV");
            expect(parsed).not.toBeNull();
            expect(parsed!.records).toHaveLength(2);
            expect(parsed!.records[0]!.unixSeconds).toBeCloseTo(Date.UTC(2023, 3, 22, 13, 30, 15) / 1000, 0);
            // Blank-date skip is silent (cold-start noise, same policy as empty fixes).
            expect(parsed!.skipped).toHaveLength(0);
        });

        it("treats a year byte of 0 as blank even with a valid month (year 2000 = unreal for a dashcam)", () => {
            const gps0 = makeGps0Bytes([
                { lat: 5012.3456, lon: 3009.8765, speed: 68, year: 0, month: 4, day: 22, hour: 13, min: 30, sec: 15 },
            ]);
            expect(parseNavitelTail(null, gps0, "x.MOV")).toBeNull();
        });
    });
});

describe("gps0HasSelfDescribedDates", () => {
    function makeDateOnlyGps0(records: Array<{ year: number; month: number }>): Uint8Array {
        const bytes = new Uint8Array(8 + records.length * 32);
        const dv = new DataView(bytes.buffer);
        dv.setUint32(0, bytes.byteLength, false);
        bytes.set([0x67, 0x70, 0x73, 0x30], 4); // 'gps0'
        for (let i = 0; i < records.length; i++) {
            bytes[8 + i * 32 + 22] = records[i]!.year;
            bytes[8 + i * 32 + 23] = records[i]!.month;
        }
        return bytes;
    }

    it("true when the first record carries a plausible date", () => {
        expect(gps0HasSelfDescribedDates(makeDateOnlyGps0([{ year: 23, month: 4 }]))).toBe(true);
    });

    it("true when only a later record within the probe window is dated", () => {
        const records = [
            { year: 0, month: 0 },
            { year: 0, month: 0 },
            { year: 0, month: 0 },
            { year: 0, month: 0 },
            { year: 20, month: 11 },
        ];
        expect(gps0HasSelfDescribedDates(makeDateOnlyGps0(records))).toBe(true);
    });

    it("false when all probed records are zero-filled", () => {
        const records = Array.from({ length: 10 }, () => ({ year: 0, month: 0 }));
        expect(gps0HasSelfDescribedDates(makeDateOnlyGps0(records))).toBe(false);
    });

    it("false on implausible date bytes (month > 12, year > 99)", () => {
        expect(gps0HasSelfDescribedDates(makeDateOnlyGps0([{ year: 150, month: 13 }]))).toBe(false);
    });

    it("false on a payload shorter than one record", () => {
        expect(gps0HasSelfDescribedDates(new Uint8Array(8 + 16))).toBe(false);
    });
});

describe("parseGsenAtom", () => {
    /** `gsen` atom bytes: 8-byte box header then 3-byte signed-triple records. */
    function buildGsen(records: Array<[number, number, number]>): Uint8Array {
        const bytes = new Uint8Array(8 + records.length * 3);
        const dv = new DataView(bytes.buffer);
        dv.setUint32(0, bytes.length, false);
        bytes.set(new TextEncoder().encode("gsen"), 4);
        records.forEach(([x, y, z], i) => {
            dv.setInt8(8 + i * 3, x);
            dv.setInt8(8 + i * 3 + 1, y);
            dv.setInt8(8 + i * 3 + 2, z);
        });
        return bytes;
    }

    it("decodes signed axes at /16 and paces them at the assumed 5 Hz", () => {
        const samples = parseGsenAtom(
            buildGsen([
                [16, 0, -16],
                [8, -8, 32],
            ]),
        );
        expect(samples).toHaveLength(2);
        expect(samples[0]).toEqual({ msSinceStart: 0, accelXg: 1, accelYg: 0, accelZg: -1 });
        expect(samples[1]).toEqual({ msSinceStart: 200, accelXg: 0.5, accelYg: -0.5, accelZg: 2 });
    });

    it("returns nothing for a header-only atom - the known real sample's shape", () => {
        expect(parseGsenAtom(buildGsen([]))).toEqual([]);
    });

    it("ignores a trailing partial record", () => {
        const withTail = new Uint8Array([...buildGsen([[16, 16, 16]]), 0x01, 0x02]);
        expect(parseGsenAtom(withTail)).toHaveLength(1);
    });
});
