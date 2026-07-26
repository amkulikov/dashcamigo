// Tests for the Kenwood udta/trailer extractor. Fixtures are rebuilt
// verbatim from the ExifTool hexdumps (QuickTimeStream.pl:2858-2866 udta,
// 2997-3006 trailer, v13.59) and completed synthetically where the dumps
// truncate - no real sample exists (see the foreign-source banner in
// kenwood.ts).

import { describe, expect, it } from "vitest";
import {
    hasKenwoodTrailerMarker,
    hasKenwoodUdtaMarker,
    KENWOOD_TRAILER_PROBE_BYTES,
    KENWOOD_UDTA_MARKER,
    parseKenwoodTrailer,
    parseKenwoodUdta,
} from "./kenwood.js";

const LATIN1_ENCODE = (text: string): Uint8Array => Uint8Array.from(text, (ch) => ch.charCodeAt(0) & 0xff);

// One udta record body (without the \xfe\xfe delimiter), from the upstream
// dump: date1 '.' date2 '\x03' coords, then altitude+speed and accel triples.
// 4737.7053 DDmm -> 47.628422; 12209.9014 -> 122.165023 W (Seattle).
function udtaRecord(opts: { date1?: string; date2?: string; tail?: string } = {}): string {
    const { date1 = "20230107111914", date2 = "20230107111915", tail = "+0058000+006+009+004+002+009+005" } = opts;
    return `${date1}.${date2}\x03N47377053W122099014${tail}`;
}

function udtaPayload(records: string[]): Uint8Array {
    return LATIN1_ENCODE(KENWOOD_UDTA_MARKER + records.map((r) => `\xfe\xfe${r}`).join(""));
}

describe("hasKenwoodUdtaMarker", () => {
    it("accepts the VIDEO+22xU literal and rejects everything else", () => {
        expect(hasKenwoodUdtaMarker(LATIN1_ENCODE(KENWOOD_UDTA_MARKER))).toBe(true);
        expect(hasKenwoodUdtaMarker(LATIN1_ENCODE(`${KENWOOD_UDTA_MARKER}garbage`))).toBe(true);
        expect(hasKenwoodUdtaMarker(LATIN1_ENCODE("VIDEOUUUU"))).toBe(false); // truncated run
        expect(hasKenwoodUdtaMarker(LATIN1_ENCODE("©too©swr ordinary udta"))).toBe(false);
        expect(hasKenwoodUdtaMarker(new Uint8Array(0))).toBe(false);
    });
});

describe("parseKenwoodUdta", () => {
    it("decodes the ExifTool hexdump record (Seattle, DDmm*1e4 coords)", () => {
        const { records, skipped } = parseKenwoodUdta(udtaPayload([udtaRecord()]), "a.mp4");
        expect(skipped).toEqual([]);
        expect(records).toHaveLength(1);
        const r = records[0]!;
        expect(r.lat).toBeCloseTo(47 + 37.7053 / 60, 6);
        expect(r.lon).toBeCloseTo(-(122 + 9.9014 / 60), 6);
        // FIRST date is the fix time (ExifTool discards the second).
        expect(r.unixSeconds).toBe(Date.UTC(2023, 0, 7, 11, 19, 14) / 1000);
        // Camera-local clock, no TZ marker -> excluded from TZ inference.
        expect(r.timeUnsynced).toBe(true);
        expect(r.relStartSeconds).toBe(0);
        expect(r.speedMs).toBeCloseTo(0, 6); // '000' km/h
        // First accel triple only, /1000 scale.
        expect(r.accelXg).toBeCloseTo(0.006, 6);
        expect(r.accelYg).toBeCloseTo(0.009, 6);
        expect(r.accelZg).toBeCloseTo(0.004, 6);
        expect(r.active).toBe(true);
        expect(r.mp4Filename).toBe("a.mp4");
    });

    it("relStartSeconds tracks the camera clock delta from the first record", () => {
        const { records } = parseKenwoodUdta(
            udtaPayload([
                udtaRecord(),
                udtaRecord({ date1: "20230107111916", date2: "20230107111917" }),
                udtaRecord({ date1: "20230107111919", date2: "20230107111920" }), // 3 s gap survives
            ]),
            "a.mp4",
        );
        expect(records.map((r) => r.relStartSeconds)).toEqual([0, 2, 5]);
    });

    it("parses a record with a nonzero speed", () => {
        const { records } = parseKenwoodUdta(udtaPayload([udtaRecord({ tail: "+0058054+006+009+004" })]), "a.mp4");
        expect(records).toHaveLength(1);
        expect(records[0]!.speedMs).toBeCloseTo(54 / 3.6, 6);
    });

    it("a record without the speed/accel tail still yields the fix", () => {
        const { records } = parseKenwoodUdta(udtaPayload([udtaRecord({ tail: "" })]), "a.mp4");
        expect(records).toHaveLength(1);
        expect(records[0]!.speedMs).toBe(0);
        expect(records[0]!.accelXg).toBe(0);
    });

    it("skips records without the coordinate group or with an implausible date", () => {
        const noCoords = "20230107111914.20230107111915\x03no gps here";
        const badDate = udtaRecord({ date1: "20231399251461" });
        const { records, skipped } = parseKenwoodUdta(udtaPayload([noCoords, badDate, udtaRecord()]), "a.mp4");
        expect(records).toHaveLength(1);
        expect(skipped).toHaveLength(2);
        expect(skipped[0]!.reason).toBe("no datetime/coordinate pattern");
        expect(skipped[1]!.reason).toBe("implausible datetime");
        // The first VALID record anchors relStartSeconds, not the first slot.
        expect(records[0]!.relStartSeconds).toBe(0);
    });

    it("returns nothing for a payload without records (marker only)", () => {
        const { records, skipped } = parseKenwoodUdta(LATIN1_ENCODE(KENWOOD_UDTA_MARKER), "a.mp4");
        expect(records).toEqual([]);
        expect(skipped).toEqual([]);
    });
});

// One 121-byte trailer record from the upstream dump (Giessen, DECIMAL
// degrees - ProcessKenwoodTrailer applies no DDmm conversion).
function trailerRecord(opts: { date?: string; lat?: string; lon?: string } = {}): string {
    const { date = "20240711120412", lat = "N50.6123860677", lon = "E8.70271809895" } = opts;
    const rec = `GPSDATA--${date}${lat}${lon}33.000000000000.0000000000000.019999999553-0.09000000357-0.14000000059`;
    if (rec.length !== 121) throw new Error(`bad fixture: ${rec.length}`);
    return rec;
}

describe("hasKenwoodTrailerMarker", () => {
    it("accepts 14 C's (the upstream dump form) and 22 C's (the ProcessKenwoodTrailer reading)", () => {
        expect(hasKenwoodTrailerMarker(LATIN1_ENCODE(`${"C".repeat(14)}GPSDATA--`))).toBe(true);
        expect(hasKenwoodTrailerMarker(LATIN1_ENCODE(`${"C".repeat(22)}GPSDATA--`))).toBe(true);
    });

    it("rejects short runs, over-long runs, and non-CCCC trailing garbage", () => {
        expect(hasKenwoodTrailerMarker(LATIN1_ENCODE(`${"C".repeat(13)}GPSDATA--`))).toBe(false);
        expect(hasKenwoodTrailerMarker(LATIN1_ENCODE(`${"C".repeat(40)}GPSDATA--`))).toBe(false);
        expect(hasKenwoodTrailerMarker(LATIN1_ENCODE(`${"C".repeat(14)}NOTGPSDAT`))).toBe(false);
        expect(hasKenwoodTrailerMarker(LATIN1_ENCODE("gpsa\0\0\0\0riff trailer junk"))).toBe(false);
        expect(hasKenwoodTrailerMarker(new Uint8Array(KENWOOD_TRAILER_PROBE_BYTES))).toBe(false);
    });
});

describe("parseKenwoodTrailer", () => {
    it("decodes the ExifTool hexdump record (decimal degrees, raw accel)", () => {
        const bytes = LATIN1_ENCODE("C".repeat(14) + trailerRecord());
        const { records, skipped } = parseKenwoodTrailer(bytes, "t.mp4");
        expect(skipped).toEqual([]);
        expect(records).toHaveLength(1);
        const r = records[0]!;
        expect(r.lat).toBeCloseTo(50.6123860677, 9);
        expect(r.lon).toBeCloseTo(8.70271809895, 9);
        expect(r.unixSeconds).toBe(Date.UTC(2024, 6, 11, 12, 4, 12) / 1000);
        expect(r.timeUnsynced).toBe(true);
        expect(r.relStartSeconds).toBe(0);
        // Speed units unconfirmed upstream - km/h assumed.
        expect(r.speedMs).toBeCloseTo(33 / 3.6, 6);
        expect(r.accelXg).toBeCloseTo(0.019999999553, 9);
        expect(r.accelYg).toBeCloseTo(-0.09000000357, 9);
        expect(r.accelZg).toBeCloseTo(-0.14000000059, 9);
    });

    it("applies S/W hemisphere signs", () => {
        const bytes = LATIN1_ENCODE("C".repeat(14) + trailerRecord({ lat: "S50.6123860677", lon: "W8.70271809895" }));
        const { records } = parseKenwoodTrailer(bytes, "t.mp4");
        expect(records[0]!.lat).toBeCloseTo(-50.6123860677, 9);
        expect(records[0]!.lon).toBeCloseTo(-8.70271809895, 9);
    });

    it("chains 121-byte records and stops at the first non-record slot", () => {
        // The junk slot is a full 121 bytes so the loop stops via the
        // GPSDATA-- prefix mismatch, not via running out of bytes.
        const bytes = LATIN1_ENCODE(
            "C".repeat(14) + trailerRecord() + trailerRecord({ date: "20240711120413" }) + "X".repeat(121),
        );
        const { records } = parseKenwoodTrailer(bytes, "t.mp4");
        expect(records).toHaveLength(2);
        expect(records[1]!.relStartSeconds).toBe(1);
    });

    it("tolerates the 22-C prefix (records still aligned after the run)", () => {
        const bytes = LATIN1_ENCODE("C".repeat(22) + trailerRecord());
        const { records } = parseKenwoodTrailer(bytes, "t.mp4");
        expect(records).toHaveLength(1);
    });

    it("returns nothing when the marker is absent or the record area is truncated", () => {
        expect(parseKenwoodTrailer(LATIN1_ENCODE("random tail bytes"), "t.mp4").records).toEqual([]);
        const truncated = LATIN1_ENCODE(`${"C".repeat(14)}GPSDATA--2024`);
        expect(parseKenwoodTrailer(truncated, "t.mp4").records).toEqual([]);
    });

    it("skips a record with an implausible date but keeps reading the chain", () => {
        const bytes = LATIN1_ENCODE(
            "C".repeat(14) + trailerRecord({ date: "20241399999999" }) + trailerRecord({ date: "20240711120413" }),
        );
        const { records, skipped } = parseKenwoodTrailer(bytes, "t.mp4");
        expect(skipped).toHaveLength(1);
        expect(skipped[0]!.reason).toBe("implausible datetime");
        expect(records).toHaveLength(1);
    });
});
