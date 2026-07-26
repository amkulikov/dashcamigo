// End-to-end test on an anonymized Navman MiVue 150 Safety `.NMEA` sidecar.
//
// Source: private/incoming/Navman MiVue 150 Safety/FILE260625-144859.NMEA -
// anonymized via scripts/anonymize-nmea-log.mjs (lat/lon rounded to whole
// degrees in $GPRMC/$GPGGA; $GPGSA/$GPGSV satellite fields blanked - az/el
// geometry at the kept timestamps would undo the whole-degree rounding;
// timestamps and the $GSENSORD accel stay).
//
// What this pins:
//  - the generic nmeaSidecar handler parses the Mio/Navman GPRMC stream;
//  - the $GSENSORD accel extension (decimal g) is attached to its record - the
//    bug this whole change fixes (previously dropped, so no G-load / impacts);
//  - filename time + mode techniques recognise FILE<YYMMDD>-<HHMMSS> under a
//    Normal/ folder.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { classifyFilenameMode, classifyFilenameTime } from "../../filename/index.js";
import { classifyGpsSource, shouldTryEmbeddedGps } from "../../gps-source-hints.js";
import { nmeaSidecar } from "../../sidecars/nmea-sidecar.js";
import { makeVendorFile } from "../helpers.js";

const FIXTURE = resolve(dirname(fileURLToPath(import.meta.url)), "real-anonymized.NMEA");
const MP4 = "FILE260625-144859.MP4";

describe("navman mivue real-anonymized sidecar", () => {
    it("parses the GPRMC stream with $GSENSORD accel attached", async () => {
        const text = readFileSync(FIXTURE, "utf8");
        const file = makeVendorFile("FILE260625-144859.NMEA", text);
        const records = await nmeaSidecar.parse(file, MP4);

        // 7 RMC fixes (the very first second's GSENSORD has no RMC to attach to
        // because the log starts mid-cycle).
        expect(records).toHaveLength(7);

        // Coordinates are anonymized to whole degrees (Queensland -> 23S/150E).
        for (const r of records) {
            expect(r.lat).toBe(-23);
            expect(r.lon).toBe(150);
            expect(r.active).toBe(true);
            expect(r.mp4Filename).toBe(MP4);
        }

        // Timestamps are monotonic, 1 Hz, and decode to UTC (filename 14:48 local
        // is UTC+10 AEST -> 04:48 UTC, consistent with YYMMDD-HHMMSS).
        expect(records[0]!.unixSeconds).toBe(Date.UTC(2026, 5, 25, 4, 48, 58) / 1000);
        for (let i = 1; i < records.length; i++) {
            expect(records[i]!.unixSeconds).toBe(records[i - 1]!.unixSeconds + 1);
        }

        // $GSENSORD parsed AND its constant DC offset removed (gravity-removed
        // contract - see parseNmeaText.removeAccelDcBias). With an odd record
        // count the per-axis median is subtracted exactly, so each axis median is
        // 0 afterwards; the dynamics around that baseline survive.
        const medianOfAxis = (vals: number[]) => [...vals].sort((a, b) => a - b)[(vals.length - 1) >> 1]!;
        expect(medianOfAxis(records.map((r) => r.accelXg))).toBeCloseTo(0, 6);
        expect(medianOfAxis(records.map((r) => r.accelYg))).toBeCloseTo(0, 6);
        expect(medianOfAxis(records.map((r) => r.accelZg))).toBeCloseTo(0, 6);
        // The ~0.3g baseline is genuinely gone: the quietest record now sits near
        // zero |a| (raw it floated at ~0.3g), while real dynamics remain on others.
        const mag = records.map((r) => Math.hypot(r.accelXg, r.accelYg, r.accelZg));
        expect(Math.min(...mag)).toBeLessThan(0.1);
        expect(Math.max(...mag)).toBeGreaterThan(0);
    });

    it("filename techniques and source hint recognise the format", () => {
        const video = makeVendorFile(`Normal/${MP4}`, "");

        const time = classifyFilenameTime(video);
        expect(time?.getUTCFullYear()).toBe(2026);
        expect(time?.getUTCMonth()).toBe(5); // June
        expect(time?.getUTCDate()).toBe(25);
        expect(time?.getUTCHours()).toBe(14); // camera-local

        expect(classifyFilenameMode(video)).toBe("normal");

        // GPS is in the `.NMEA` sidecar, so the source is basename-sidecar.
        expect(classifyGpsSource(video)).toBe("basename-sidecar");
        // But `FILE<yymmdd>-<hhmmss>` is a generic Ambarella shape, so the hint
        // is probe-when-empty: without sidecar records yet the embedded probe is
        // still allowed (a lookalike must not be silently left unread); once the
        // sidecar has produced records the skip is trusted.
        expect(shouldTryEmbeddedGps(video, false)).toBe(true);
        expect(shouldTryEmbeddedGps(video, true)).toBe(false);
    });
});
