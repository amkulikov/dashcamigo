import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { blackvueGpsSidecar, ddpaiGpxSidecar, nmeaSidecar } from "./nmea-sidecar.js";
import { expectPlausibleGpsTrack, makeVendorFile } from "../__fixtures__/helpers.js";

const FIXTURES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../__fixtures__");

function loadFixture(relPath: string): string {
    return readFileSync(resolve(FIXTURES_DIR, relPath), "utf8");
}

describe("blackvueGpsSidecar.matches", () => {
    it("matches .gps file by basename with known MP4", () => {
        const file = makeVendorFile("20231114_120000_NF.gps", "");
        const known = new Set(["20231114_120000_NF.mp4"]);
        expect(blackvueGpsSidecar.matches(file, known)).toBe("20231114_120000_NF.mp4");
    });

    it("does not match if no MP4 with same basename", () => {
        const file = makeVendorFile("orphan.gps", "");
        const known = new Set(["something_else.mp4"]);
        expect(blackvueGpsSidecar.matches(file, known)).toBeNull();
    });

    it("rejects non-.gps extensions", () => {
        const file = makeVendorFile("20231114_120000_NF.NMEA", "");
        const known = new Set(["20231114_120000_NF.mp4"]);
        expect(blackvueGpsSidecar.matches(file, known)).toBeNull();
    });

    it("matches case-insensitively", () => {
        const file = makeVendorFile("ABC.GPS", "");
        const known = new Set(["abc.MP4"]);
        expect(blackvueGpsSidecar.matches(file, known)).toBe("abc.MP4");
    });

    it("pairs a mode-only .gps (DR550DW) with both channels, binding to front", () => {
        // Real DR-series writes one `_N.gps` shared by `_NF`/`_NR`; the front
        // clip is preferred (its startUtc/TZ benefits from the GPS clock).
        const file = makeVendorFile("20260718_070333_N.gps", "");
        const known = new Set(["20260718_070333_NR.mp4", "20260718_070333_NF.mp4"]);
        expect(blackvueGpsSidecar.matches(file, known)).toBe("20260718_070333_NF.mp4");
    });

    it("pairs a mode-only .gps with the rear clip when front is absent", () => {
        const file = makeVendorFile("20260718_070333_N.gps", "");
        const known = new Set(["20260718_070333_NR.mp4"]);
        expect(blackvueGpsSidecar.matches(file, known)).toBe("20260718_070333_NR.mp4");
    });

    it("does not strip the channel letter for a non-BlackVue video", () => {
        // Same date_time_mode prefix and an F/R-looking letter, but the channel
        // is out of BlackVue's [FRI] set, so RX_BLACKVUE rejects it - isolating
        // that the group-key gate (not the prefix compare) is what pairs.
        const file = makeVendorFile("20260718_070333_N.gps", "");
        const known = new Set(["20260718_070333_NX.mp4"]);
        expect(blackvueGpsSidecar.matches(file, known)).toBeNull();
    });
});

describe("blackvueGpsSidecar.parse", () => {
    it("parses BlackVue-style synthetic .gps with [unix_ms] prefix", async () => {
        const file = makeVendorFile("20231114_120000_NF.gps", loadFixture("blackvue/synthetic.gps"));
        const records = await blackvueGpsSidecar.parse(file, "20231114_120000_NF.mp4");
        expectPlausibleGpsTrack(records);
        // The fixture's prefixes model a unit set to UTC+2 (they lead each
        // sentence by 2 h 0.4 s), so a snapshot on satellite UTC is what pins
        // the camera clock out of the timestamps.
        expect(records[0]!.unixSeconds).toBe(Date.UTC(2023, 10, 14, 12, 0, 0) / 1000);
        expect(records).toMatchSnapshot();
    });

    it("falls back to plain NMEA without prefix (legacy DR400G-HD)", async () => {
        // DR400G-HD (2010) writes .gps as plain NMEA without [unix_ms] prefix.
        // In optional-prefix mode the parser uses time from RMC itself.
        const text = "$GPRMC,120000.00,A,5000.00000,N,03000.00000,E,5.0,90.0,141123,,,A*6F\n";
        const file = makeVendorFile("test.gps", text);
        const records = await blackvueGpsSidecar.parse(file, "test.mp4");
        expect(records).toHaveLength(1);
        expect(records[0]!.lat).toBe(50);
        expect(records[0]!.lon).toBe(30);
        expect(records[0]!.unixSeconds).toBe(Date.UTC(2023, 10, 14, 12, 0, 0) / 1000);
    });
});

describe("nmeaSidecar.matches", () => {
    it("matches .NMEA / .nmea by basename with known MP4", () => {
        const f1 = makeVendorFile("FILE001.NMEA", "");
        const f2 = makeVendorFile("FILE002.nmea", "");
        const known = new Set(["FILE001.MP4", "FILE002.mp4"]);
        expect(nmeaSidecar.matches(f1, known)).toBe("FILE001.MP4");
        expect(nmeaSidecar.matches(f2, known)).toBe("FILE002.mp4");
    });

    it("rejects .gps (it's BlackVue's territory)", () => {
        const file = makeVendorFile("test.gps", "");
        const known = new Set(["test.mp4"]);
        expect(nmeaSidecar.matches(file, known)).toBeNull();
    });
});

describe("nmeaSidecar.parse", () => {
    it("parses Mio-style synthetic .NMEA without prefix", async () => {
        const file = makeVendorFile("FILE001.NMEA", loadFixture("nmea/synthetic.NMEA"));
        const records = await nmeaSidecar.parse(file, "FILE001.MP4");
        expectPlausibleGpsTrack(records);
        expect(records).toMatchSnapshot();
    });

    it("parses real-anonymized DashcamViewer corpus sample (.nmea with $GSENSOR lines)", async () => {
        // Source: tests/testdata/dashcam-viewer-corpus/MOV_0581.nmea -
        // anonymized fragment of a real dashcam NMEA log from 2013 from the
        // public samplefiles.zip by Minimanu (see MOV_0581.source.md).
        // Covers Mio/DOD-style specifics: $GPRMC interleaved with custom
        // $GSENSOR extensions; the parser must skip unknown sentences silently
        // without adding them to skipped.
        const repoRoot = resolve(FIXTURES_DIR, "../../..");
        const text = readFileSync(resolve(repoRoot, "tests/testdata/dashcam-viewer-corpus/MOV_0581.nmea"), "utf8");
        const file = makeVendorFile("MOV_0581.nmea", text);
        const records = await nmeaSidecar.parse(file, "MOV_0581.mp4");
        expectPlausibleGpsTrack(records, { minCount: 2 });
        expect(records).toMatchSnapshot();
    });
});

// Synthetic DDPai NMEA-in-gpx: header + 2 $GPRMC + footer. parseNmeaText
// silently ignores the $GPSCAMTIME / $GPSENDTIME lines as unknown sentences.
const DDPAI_NMEA_GPX = [
    "$GPSCAMTIME 20190719161640",
    "$GPRMC,161640.00,A,5546.0000,N,03737.0000,E,12.34,10.5,190719,,*XX",
    "$GPRMC,161641.00,A,5546.0001,N,03737.0001,E,12.34,10.5,190719,,*XX",
    "$GPSENDTIME 20190719161641",
    "",
].join("\n");

describe("ddpaiGpxSidecar.matches", () => {
    it("pairs `.gpx` inside `103gps/` to the corresponding MP4 in `100video/`", () => {
        const file = makeVendorFile("DCIM/103gps/20190719161640_0060.gpx", "", "20190719161640_0060.gpx");
        const known = new Set(["20190719161640_0060.mp4"]);
        expect(ddpaiGpxSidecar.matches(file, known)).toBe("20190719161640_0060.mp4");
    });

    it("pairs `.gpx` inside `203gps/` to the corresponding MP4 in `200video/` (N-series)", () => {
        const file = makeVendorFile("DCIM/203gps/20240101120000_0030.gpx", "", "20240101120000_0030.gpx");
        const known = new Set(["20240101120000_0030.mp4"]);
        expect(ddpaiGpxSidecar.matches(file, known)).toBe("20240101120000_0030.mp4");
    });

    it("matches a selected `103gps/` folder even when it is the import root", () => {
        const file = makeVendorFile("103gps/20190719161640_0060.gpx", "", "20190719161640_0060.gpx");
        const known = new Set(["20190719161640_0060.mp4"]);
        expect(ddpaiGpxSidecar.matches(file, known)).toBe("20190719161640_0060.mp4");
    });

    it("strips the `_D` suffix on the sidecar and `_A` on the MP4 (2-channel pairing)", () => {
        const file = makeVendorFile("DCIM/103gps/20190719161640_0060_D.gpx", "", "20190719161640_0060_D.gpx");
        const known = new Set(["20190719161640_0060_A.mp4"]);
        expect(ddpaiGpxSidecar.matches(file, known)).toBe("20190719161640_0060_A.mp4");
    });

    it("prefers the exact-basename front over the `_A` rear regardless of set order", () => {
        const file = makeVendorFile("DCIM/103gps/20190719161640_0060.gpx", "", "20190719161640_0060.gpx");
        // Rear first in insertion order - the front must still win.
        const known = new Set(["20190719161640_0060_A.mp4", "20190719161640_0060.mp4"]);
        expect(ddpaiGpxSidecar.matches(file, known)).toBe("20190719161640_0060.mp4");
        const knownReversed = new Set(["20190719161640_0060.mp4", "20190719161640_0060_A.mp4"]);
        expect(ddpaiGpxSidecar.matches(file, knownReversed)).toBe("20190719161640_0060.mp4");
    });

    it("does not match `.gpx` files OUTSIDE DDPai folders (so real GPX still reaches gpxSidecar)", () => {
        const file = makeVendorFile("trip.gpx", "", "trip.gpx");
        const known = new Set(["trip.mp4"]);
        expect(ddpaiGpxSidecar.matches(file, known)).toBeNull();
    });

    it("returns null when no MP4 with a compatible basename is known", () => {
        const file = makeVendorFile("DCIM/103gps/20190719161640_0060.gpx", "", "20190719161640_0060.gpx");
        expect(ddpaiGpxSidecar.matches(file, new Set(["other.mp4"]))).toBeNull();
    });
});

describe("ddpaiGpxSidecar.parse", () => {
    it("parses DDPai-style NMEA-in-gpx content", async () => {
        const file = makeVendorFile("DCIM/103gps/20190719161640_0060.gpx", DDPAI_NMEA_GPX, "20190719161640_0060.gpx");
        const records = await ddpaiGpxSidecar.parse(file, "20190719161640_0060.mp4");
        expect(records).toHaveLength(2);
        expect(records[0]!.mp4Filename).toBe("20190719161640_0060.mp4");
        expect(records[0]!.active).toBe(true);
        expect(records[0]!.lat).toBeCloseTo(55 + 46 / 60, 4);
        expect(records[0]!.lon).toBeCloseTo(37 + 37 / 60, 4);
    });

    it("rejects real XML GPX with WrongFormatError so dispatch surfaces the mismatch", async () => {
        const xml = '<?xml version="1.0"?><gpx><trk></trk></gpx>';
        const file = makeVendorFile("DCIM/103gps/20190719161640_0060.gpx", xml, "20190719161640_0060.gpx");
        await expect(ddpaiGpxSidecar.parse(file, "20190719161640_0060.mp4")).rejects.toThrow(/XML/i);
    });
});
