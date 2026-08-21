// Regression test on real-anonymized BlackVue DR550DW sidecars.
//
// Source files: one recording's `_N.gps` (NMEA with BlackVue `[unix_ms]`
// prefix) + `_N.3gf` (binary G-sensor), shared across the front `_NF.mp4` and
// rear `_NR.mp4` clips. Coordinates in the `.gps` were rounded to whole degrees
// (52.0 N / 0.0 W) and $GPGSA/$GPGSV satellite fields blanked by
// scripts/anonymize-nmea-log.mjs; the `.3gf` carries no location and was only
// trimmed by scripts/anonymize-blackvue-3gf.mjs.
//
// This is the first real BlackVue sidecar sample in the repo: it both fixes the
// pairing (a mode-only sidecar must bind to the channel-suffixed MP4) and
// confirms the `.3gf` layout (BE, /128) the handler was carrying on faith.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { blackvueGpsSidecar } from "../../sidecars/nmea-sidecar.js";
import { blackvue3gfSidecar } from "../../sidecars/blackvue-3gf.js";
import { freeGpsBoxPrimitive } from "../../primitives/free-gps-box.js";
import { buildMp4Index } from "../../internal/mp4-index.js";
import { cloneRecordsAcrossChannels, rebuildLog } from "../../../parser.js";
import { makeVendorFile } from "../helpers.js";

const HERE = dirname(fileURLToPath(import.meta.url));

const FRONT = "20260718_070333_NF.mp4";
const REAR = "20260718_070333_NR.mp4";
const GPS_NAME = "20260718_070333_N.gps";
const GF_NAME = "20260718_070333_N.3gf";

describe("real-anonymized BlackVue DR550DW .gps sidecar", () => {
    it("pairs the mode-only .gps with the front clip", () => {
        const file = makeVendorFile(GPS_NAME, "");
        const known = new Set([REAR, FRONT]);
        expect(blackvueGpsSidecar.matches(file, known)).toBe(FRONT);
    });

    it("parses masked coordinates, monotonic time and plausible speed", async () => {
        const text = readFileSync(resolve(HERE, "real-anonymized.gps"), "utf8");
        const file = makeVendorFile(GPS_NAME, text);
        const records = await blackvueGpsSidecar.parse(file, FRONT);

        expect(records.length).toBeGreaterThanOrEqual(5);
        for (const r of records) {
            expect(r.mp4Filename).toBe(FRONT);
            expect(r.active).toBe(true);
            // Anonymized to whole degrees: 52 N, 0 W (lon rounds to 0).
            expect(r.lat).toBeCloseTo(52, 3);
            expect(r.lon).toBeCloseTo(0, 3);
            // ~48 knots (~24.7 m/s) on the source clip; bound it clear of noise.
            expect(r.speedMs).toBeGreaterThan(10);
            expect(r.speedMs).toBeLessThan(40);
        }
        for (let i = 1; i < records.length; i++) {
            expect(records[i]!.unixSeconds).toBeGreaterThanOrEqual(records[i - 1]!.unixSeconds);
        }
    });

    it("times the track by satellite UTC, not the camera-clock prefix", async () => {
        // This unit runs on UTC+1: every `[unix_ms]` prefix sits ~3602 s ahead of
        // the sentence it labels (one hour of TZ plus the firmware's write lag),
        // and the filename `070333` is local too. Reading the prefix as unix time
        // shifted every trip an hour forward for anyone whose camera is not on UTC.
        const text = readFileSync(resolve(HERE, "real-anonymized.gps"), "utf8");
        const records = await blackvueGpsSidecar.parse(makeVendorFile(GPS_NAME, text), FRONT);

        // $GPRMC,060329.000,...,180726 - the first fix in the file.
        expect(records[0]!.unixSeconds).toBe(Date.UTC(2026, 6, 18, 6, 3, 29) / 1000);
        // mvhd of the paired clips is 2026-07-18T06:04:34Z (finalize semantics on
        // a 61 s clip), so the whole GPS window must sit inside the minute before it.
        const last = records[records.length - 1]!.unixSeconds;
        expect(last).toBeLessThanOrEqual(Date.UTC(2026, 6, 18, 6, 4, 34) / 1000);
    });

    it("shared sidecar reaches BOTH channels so front and rear anchor together", async () => {
        // The regression: the sidecar binds to ONE clip (front). If the rear
        // clip stays record-less it anchors on the filename while the front
        // anchors on GPS, so their startUtc diverges by the fix delay and the
        // 30 s frame snap tears them into separate frames. cloneRecordsAcrossChannels
        // copies the GPS onto the rear so both derive an identical startUtc.
        const text = readFileSync(resolve(HERE, "real-anonymized.gps"), "utf8");
        const file = makeVendorFile(GPS_NAME, text);
        const frontRecords = await blackvueGpsSidecar.parse(file, FRONT);
        const frontCount = frontRecords.length; // capture before the in-place clone grows log.records

        const log = rebuildLog([], frontRecords, []);
        expect(log.byFilename.get(FRONT)?.length ?? 0).toBe(frontCount);
        expect(log.byFilename.get(REAR)?.length ?? 0).toBe(0); // rear is empty pre-clone

        const cloned = cloneRecordsAcrossChannels(log, [makeVendorFile(FRONT, ""), makeVendorFile(REAR, "")]);
        expect(cloned).toBe(frontCount);

        const rebuilt = rebuildLog([], log.records, []);
        const front = rebuilt.byFilename.get(FRONT)!;
        const rear = rebuilt.byFilename.get(REAR)!;
        expect(rear).toHaveLength(front.length);
        // Same track on both channels (identical timestamps and coordinates).
        expect(rear.map((r) => [r.unixSeconds, r.lat, r.lon])).toEqual(
            front.map((r) => [r.unixSeconds, r.lat, r.lon]),
        );
    });
});

describe("embedded `3gf ` inside the top-level free box (X-series, no sidecar)", () => {
    // X-series models write the same two payloads as free-box children instead
    // of as paired files. No such recording is in the repo, so the container is
    // assembled here around the REAL sidecar bytes - the layout under test is
    // the box nesting, and the payload parsing is already covered above.
    const EMBEDDED = "20260718_070333_XF.mp4";

    function box(type: string, payload: Uint8Array): Uint8Array {
        const out = new Uint8Array(8 + payload.length);
        new DataView(out.buffer).setUint32(0, out.length, false);
        out.set(new TextEncoder().encode(type), 4);
        out.set(payload, 8);
        return out;
    }

    function buildEmbeddedMp4(opts: { with3gf: boolean }): File {
        const gpsBytes = new Uint8Array(readFileSync(resolve(HERE, "real-anonymized.gps")));
        const gfBytes = new Uint8Array(readFileSync(resolve(HERE, "real-anonymized.3gf")));
        const children = [box("gps ", gpsBytes)];
        if (opts.with3gf) children.push(box("3gf ", gfBytes));
        const freePayload = new Uint8Array(children.reduce((n, c) => n + c.length, 0));
        let at = 0;
        for (const child of children) {
            freePayload.set(child, at);
            at += child.length;
        }
        const parts = [
            box("ftyp", new TextEncoder().encode("isomisom")),
            box("free", freePayload),
            box("moov", new Uint8Array(0)),
        ];
        return new File(parts as BlobPart[], EMBEDDED);
    }

    it("returns the accel stream alongside the GPS records", async () => {
        const file = buildEmbeddedMp4({ with3gf: true });
        const index = await buildMp4Index(file);
        expect(index.free3gfBoxInsideFree).not.toBeNull();

        const result = await freeGpsBoxPrimitive.parse({ file, relativePath: EMBEDDED }, index);
        expect(result.records.length).toBeGreaterThanOrEqual(5);
        // Same 50 samples the paired-file path yields, same scale.
        expect(result.accelSamples).toHaveLength(50);
        const meanZ = result.accelSamples!.reduce((s, r) => s + r.accelZg, 0) / result.accelSamples!.length;
        expect(meanZ).toBeGreaterThan(0.8);
        expect(meanZ).toBeLessThan(1.2);
    });

    it("stays undefined when the free box carries only `gps `", async () => {
        const file = buildEmbeddedMp4({ with3gf: false });
        const index = await buildMp4Index(file);
        expect(index.free3gfBoxInsideFree).toBeNull();

        const result = await freeGpsBoxPrimitive.parse({ file, relativePath: EMBEDDED }, index);
        expect(result.records.length).toBeGreaterThanOrEqual(5);
        expect(result.accelSamples).toBeUndefined();
    });
});

describe("real-anonymized BlackVue DR550DW .3gf sidecar", () => {
    it("pairs the mode-only .3gf with the front clip", () => {
        const file = makeVendorFile(GF_NAME, "");
        const known = new Set([REAR, FRONT]);
        expect(blackvue3gfSidecar.matches(file, known)).toBe(FRONT);
    });

    it("decodes BE records with the vertical axis at ~1g (confirms /128 scale)", async () => {
        const buf = readFileSync(resolve(HERE, "real-anonymized.3gf"));
        const file = makeVendorFile(GF_NAME, new Uint8Array(buf));
        const samples = await blackvue3gfSidecar.parseAccel(file);

        expect(samples.length).toBe(50);
        // ms-since-start is monotonic non-decreasing and starts at 0.
        expect(samples[0]!.msSinceStart).toBe(0);
        for (let i = 1; i < samples.length; i++) {
            expect(samples[i]!.msSinceStart).toBeGreaterThanOrEqual(samples[i - 1]!.msSinceStart);
        }
        // Vertical axis (file Y -> accelZg) sits at ~1g; lateral/longitudinal
        // stay near 0 on this near-straight drive. A /10 scale would read ~10g.
        const meanZ = samples.reduce((s, r) => s + r.accelZg, 0) / samples.length;
        expect(meanZ).toBeGreaterThan(0.8);
        expect(meanZ).toBeLessThan(1.2);
        for (const r of samples) {
            expect(Math.abs(r.accelXg)).toBeLessThan(0.6);
            expect(Math.abs(r.accelYg)).toBeLessThan(0.6);
        }
    });
});
