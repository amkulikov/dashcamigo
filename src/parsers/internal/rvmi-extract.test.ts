// Tests for the RVMI extractor. Source fixtures:
//   1. Synthetic - built in this file with full control over structure and sample
//      data; used to verify timing/coord/accel decoding.
//   2. sample.mp4 - real-anonymized from `Fragment of AMBA2373-2388 ...mp4`.
//      Builder: scripts/anonymize-rvmi-mp4.mjs. gReV coordinates replaced with
//      sentinel micro-degrees; everything else (cadence, accel, timestamps,
//      sample-table) kept as-is.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildMp4Index } from "./mp4-index.js";
import { tryExtractRvmi, findRvmiTrack } from "./rvmi-extract.js";
import { expectPlausibleGpsTrack } from "../__fixtures__/helpers.js";

const FIXTURES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../__fixtures__/rvmi");

// Helpers for building MP4 bytes in tests.
function fourCC(s: string): Buffer {
    return Buffer.from(s, "ascii");
}
function makeBox(type: string, payload: Buffer): Buffer {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(8 + payload.length, 0);
    fourCC(type).copy(head, 4);
    return Buffer.concat([head, payload]);
}
function u32be(n: number): Buffer {
    const b = Buffer.alloc(4);
    b.writeUInt32BE(n, 0);
    return b;
}

// Builds a synthetic RVMI track MP4 from sample specs. Each sample is an object
// { magic: 'tReV'/'gReV'/'sReV', payload: Buffer, delta: number }. Returns a
// complete Buffer (ftyp+moov+mdat).
function buildSyntheticRvmiMp4(
    timescale: number,
    samples: Array<{ magic: string; payload: Buffer; delta: number }>,
): Buffer {
    const sampleBuffers = samples.map((s) => {
        const buf = Buffer.alloc(4 + s.payload.length + 1);
        fourCC(s.magic).copy(buf, 0);
        s.payload.copy(buf, 4);
        buf.writeUInt8(0x0c, 4 + s.payload.length);
        return buf;
    });
    let totalDuration = 0;
    for (const s of samples) totalDuration += s.delta;

    const mdhd = makeBox(
        "mdhd",
        Buffer.concat([
            Buffer.alloc(4), // version+flags
            u32be(0),
            u32be(0), // creation+modification
            u32be(timescale),
            u32be(totalDuration),
            Buffer.from([0x55, 0xc4, 0, 0]), // language 'und' + quality
        ]),
    );
    const hdlrPayload = Buffer.alloc(33);
    fourCC("data").copy(hdlrPayload, 8);
    const hdlr = makeBox("hdlr", hdlrPayload);

    const stsdEntry = Buffer.alloc(16);
    stsdEntry.writeUInt32BE(16, 0);
    fourCC("RVMI").copy(stsdEntry, 4);
    const stsd = makeBox("stsd", Buffer.concat([Buffer.alloc(4), u32be(1), stsdEntry]));

    // stts: deltas differ, so one entry per sample.
    const sttsEntries: Buffer[] = [];
    for (const s of samples) sttsEntries.push(u32be(1), u32be(s.delta));
    const stts = makeBox("stts", Buffer.concat([Buffer.alloc(4), u32be(samples.length), ...sttsEntries]));

    const stsc = makeBox("stsc", Buffer.concat([Buffer.alloc(4), u32be(1), u32be(1), u32be(samples.length), u32be(1)]));

    const stsz = makeBox(
        "stsz",
        Buffer.concat([Buffer.alloc(4), u32be(0), u32be(samples.length), ...sampleBuffers.map((b) => u32be(b.length))]),
    );

    const stcoPh = makeBox("stco", Buffer.concat([Buffer.alloc(4), u32be(1), u32be(0)]));

    const dinf = makeBox(
        "dinf",
        makeBox(
            "dref",
            Buffer.concat([Buffer.alloc(4), u32be(1), u32be(12), fourCC("url "), Buffer.from([0, 0, 0, 1])]),
        ),
    );
    const stbl = makeBox("stbl", Buffer.concat([stsd, stts, stsc, stsz, stcoPh]));
    const minf = makeBox("minf", Buffer.concat([dinf, stbl]));
    const mdia = makeBox("mdia", Buffer.concat([mdhd, hdlr, minf]));

    const tkhd = Buffer.alloc(84);
    tkhd.writeUInt32BE(0x000007, 0);
    tkhd.writeUInt32BE(1, 12);
    tkhd.writeUInt32BE(totalDuration, 20);
    const trak = makeBox("trak", Buffer.concat([makeBox("tkhd", tkhd), mdia]));

    const mvhd = makeBox("mvhd", Buffer.alloc(108));
    const moov = makeBox("moov", Buffer.concat([mvhd, trak]));
    const ftyp = makeBox(
        "ftyp",
        Buffer.concat([fourCC("isom"), u32be(512), fourCC("isom"), fourCC("avc1"), fourCC("mp41")]),
    );
    const mdat = makeBox("mdat", Buffer.concat(sampleBuffers));

    // Patch stco placeholder with the correct mdat-data offset.
    const mdatDataOff = ftyp.length + moov.length + 8;
    const stcoOffsetInMoov = moov.indexOf(stcoPh);
    const chunkOffsetPos = stcoOffsetInMoov + 8 + 4 + 4;
    moov.writeUInt32BE(mdatDataOff, chunkOffsetPos);

    return Buffer.concat([ftyp, moov, mdat]);
}

// Builds an OLE-date double LE buffer for tReV. Calendar fields are converted
// the same way the extractor does: `(oleDays - 25569) * 86400` = Date.UTC(...).
function oleDouble(year: number, month: number, day: number, hour: number, min: number, sec: number): Buffer {
    const utcMs = Date.UTC(year, month, day, hour, min, sec);
    const oleDays = utcMs / (86400 * 1000) + 25569;
    const buf = Buffer.alloc(8);
    buf.writeDoubleLE(oleDays, 0);
    return buf;
}

/** Expected unix seconds for the same calendar fields treated as UTC. */
function expectedUtcUnixSec(year: number, month: number, day: number, hour: number, min: number, sec: number): number {
    return Date.UTC(year, month, day, hour, min, sec) / 1000;
}

// gReV payload (16 bytes): lon (i32 LE µdeg) + lat (i32 LE µdeg) + alt (i32 LE) +
//                          speed (i16 LE, kmh*10) + bearingHalfDeg (u16 LE, 0.5° per LSB).
function gReVPayload(lon: number, lat: number, alt: number, speedKmhX10: number, bearingHalfDeg: number): Buffer {
    const b = Buffer.alloc(16);
    b.writeInt32LE(Math.round(lon * 1_000_000), 0);
    b.writeInt32LE(Math.round(lat * 1_000_000), 4);
    b.writeInt32LE(alt, 8);
    b.writeInt16LE(speedKmhX10, 12); // GPSSpeed is int16s per ExifTool RVMI_gReV
    b.writeUInt16LE(bearingHalfDeg, 14);
    return b;
}

// sReV payload (6 bytes): i16 X / Y / Z (units: 1g = 1024 LSB).
function sReVPayload(xG: number, yG: number, zG: number): Buffer {
    const b = Buffer.alloc(6);
    b.writeInt16LE(Math.round(xG * 1024), 0);
    b.writeInt16LE(Math.round(yG * 1024), 2);
    b.writeInt16LE(Math.round(zG * 1024), 4);
    return b;
}

describe("rvmi-extract / synthetic", () => {
    it("returns null when no RVMI track exists", async () => {
        // Minimal MP4 with no RVMI track at all.
        const buf = makeBox("ftyp", Buffer.concat([fourCC("isom"), u32be(0), fourCC("isom")]));
        const moov = makeBox("moov", makeBox("mvhd", Buffer.alloc(108)));
        const file = new File([Buffer.concat([buf, moov])], "no-rvmi.mp4");
        const index = await buildMp4Index(file);
        expect(findRvmiTrack(index)).toBeNull();
        const result = await tryExtractRvmi({ file, relativePath: "no-rvmi.mp4" }, index);
        expect(result).toBeNull();
    });

    it("parses 3 gReV records with correct lat/lon/speed/bearing", async () => {
        // tReV baseline: 2024-01-15 12:00:00. Parser treats OLE directly as UTC;
        // tests use the same conversion.
        const Y = 2024,
            MO = 0,
            D = 15,
            H = 12,
            MI = 0,
            S = 0;
        const baselineUtc = expectedUtcUnixSec(Y, MO, D, H, MI, S);
        // timescale=50, delta=50 per sample => 1 sec between samples.
        // bearing payload is in half-degrees (raw 45 = 90°, raw 60 = 120°, ...).
        const mp4 = buildSyntheticRvmiMp4(50, [
            { magic: "tReV", payload: oleDouble(Y, MO, D, H, MI, S), delta: 50 },
            { magic: "gReV", payload: gReVPayload(30.0, 50.0, 0, 100, 45), delta: 50 },
            { magic: "gReV", payload: gReVPayload(30.0001, 50.0001, 0, 200, 60), delta: 50 },
            { magic: "gReV", payload: gReVPayload(30.0002, 50.0002, 0, 300, 75), delta: 50 },
        ]);
        const file = new File([new Uint8Array(mp4)], "synth.mp4");
        const index = await buildMp4Index(file);
        const result = await tryExtractRvmi({ file, relativePath: "synth.mp4" }, index);
        expect(result).not.toBeNull();
        expect(result!.records).toHaveLength(3);

        // First gReV sample stts decode-time = 50 ticks (ticks accumulate AFTER
        // the previous sample; tReV occupies the first 50 ticks). With timescale=50
        // this is +1.0 sec from the baseline.
        const r0 = result!.records[0]!;
        expect(r0.unixSeconds).toBeCloseTo(baselineUtc + 1.0, 5);
        expect(r0.lat).toBeCloseTo(50.0, 6);
        expect(r0.lon).toBeCloseTo(30.0, 6);
        expect(r0.speedMs).toBeCloseTo(10.0 / 3.6, 5); // 100 kmh*10 = 10 km/h = 2.78 m/s
        expect(r0.bearingDeg).toBe(90); // raw 45 half-degrees = 90°
        expect(r0.active).toBe(true);

        const r2 = result!.records[2]!;
        expect(r2.unixSeconds).toBeCloseTo(baselineUtc + 3.0, 5);
        expect(r2.lat).toBeCloseTo(50.0002, 6);
        expect(r2.speedMs).toBeCloseTo(30.0 / 3.6, 5); // 300 kmh*10 = 30 km/h
    });

    it("decodes a negative raw speed as a small magnitude (int16s), not a ~6553 km/h spike", async () => {
        // A glitched/negative gReV speed must read as int16s. Read as uint16 it
        // would decode near 6553.5 km/h (~1820 m/s) - a spurious chart spike.
        const baselineUtc = expectedUtcUnixSec(2024, 0, 15, 12, 0, 0);
        const mp4 = buildSyntheticRvmiMp4(50, [
            { magic: "tReV", payload: oleDouble(2024, 0, 15, 12, 0, 0), delta: 50 },
            { magic: "gReV", payload: gReVPayload(30.0, 50.0, 0, -50, 45), delta: 50 }, // raw -50 = -5 km/h
        ]);
        const file = new File([new Uint8Array(mp4)], "synth-neg-speed.mp4");
        const index = await buildMp4Index(file);
        const result = await tryExtractRvmi({ file, relativePath: "synth-neg-speed.mp4" }, index);
        expect(result).not.toBeNull();
        expect(result!.records).toHaveLength(1);
        const r0 = result!.records[0]!;
        expect(r0.unixSeconds).toBeCloseTo(baselineUtc + 1.0, 5);
        expect(r0.speedMs).toBeCloseTo(-5.0 / 3.6, 5); // -50 kmh*10 = -5 km/h, NOT ~1820 m/s
    });

    it("skips zero-fix gReV samples without recording them as errors", async () => {
        const mp4 = buildSyntheticRvmiMp4(50, [
            { magic: "tReV", payload: oleDouble(2024, 0, 15, 12, 0, 0), delta: 50 },
            // First gReV = zero (cold-start, no fix yet) - skip without error.
            { magic: "gReV", payload: gReVPayload(0, 0, 0, 0, 0), delta: 50 },
            { magic: "gReV", payload: gReVPayload(30.0, 50.0, 0, 100, 90), delta: 50 },
        ]);
        const file = new File([new Uint8Array(mp4)], "synth.mp4");
        const index = await buildMp4Index(file);
        const result = await tryExtractRvmi({ file, relativePath: "synth.mp4" }, index);
        expect(result).not.toBeNull();
        expect(result!.records).toHaveLength(1);
        // skipped is empty - cold-start is not an error.
        expect(result!.skipped).toHaveLength(0);
    });

    it("merges sReV accel into nearest gReV record", async () => {
        const mp4 = buildSyntheticRvmiMp4(50, [
            { magic: "tReV", payload: oleDouble(2024, 0, 15, 12, 0, 0), delta: 50 },
            { magic: "gReV", payload: gReVPayload(30.0, 50.0, 0, 100, 90), delta: 5 },
            { magic: "sReV", payload: sReVPayload(0.1, 0.2, -0.3), delta: 45 },
            { magic: "gReV", payload: gReVPayload(30.0001, 50.0001, 0, 200, 91), delta: 50 },
        ]);
        const file = new File([new Uint8Array(mp4)], "synth.mp4");
        const index = await buildMp4Index(file);
        const result = await tryExtractRvmi({ file, relativePath: "synth.mp4" }, index);
        expect(result).not.toBeNull();
        expect(result!.records).toHaveLength(2);
        // gReV[0] at t=1.0 sec, sReV at t=1.1 sec (gap 0.1 s) - merged.
        const r0 = result!.records[0]!;
        expect(r0.accelXg).toBeCloseTo(0.1, 2);
        expect(r0.accelYg).toBeCloseTo(0.2, 2);
        expect(r0.accelZg).toBeCloseTo(-0.3, 2);
    });
});

describe("rvmi-extract / real-anonymized fixture", () => {
    it("parses sample.mp4 (RegistratorViewer-exported AMBA2373 fragment)", async () => {
        const buf = readFileSync(resolve(FIXTURES_DIR, "sample.mp4"));
        const file = new File([buf], "sample.mp4");
        const index = await buildMp4Index(file);
        // RVMI track sample-table is real (real cadence). gReV coordinates are
        // sentinel values: 50.0/30.0 + i*0.0001.
        const result = await tryExtractRvmi({ file, relativePath: "sample.mp4" }, index);
        expectPlausibleGpsTrack(result!.records, { minCount: 2 });
        expect(result).toMatchSnapshot();
    });
});
