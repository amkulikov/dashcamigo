// Tests for the Nextbase binary-subtitle extractor: helper units plus
// end-to-end runs against in-memory synthetic MP4s.
//
// Fixture provenance: samples are reconstructed byte-for-byte from the
// nb-dashcam-tools decoder (github.com/skyhisi/nb-dashcam-tools @ b51f244,
// src/gpssampleparser.cpp:93-282) and doc/camera-file-format.md:33-45 - there
// is no real Nextbase recording available, so the fixtures test the
// transcription of that (upstream-validated) decoder, not the format itself.
// RMC/GGA strings are synthetic with coarse 50N/30E coords and deliberately
// WRONG checksums (the cameras never write valid ones, camera-file-format.md:31).

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildMp4Index } from "./mp4-index.js";
import {
    _internal,
    detectNextbaseVariant,
    extractFromNextbaseSubtitleTrack,
    findNextbaseSubtitleTrack,
} from "./nextbase-subtitle-extract.js";
import { nextbaseSubtitlePrimitive } from "../primitives/nextbase-subtitle.js";
import { nmeaSubtitlePrimitive } from "../primitives/nmea-subtitle.js";
import { pndmPrimitive } from "../primitives/pndm.js";
import { KNOTS_TO_MS, WrongFormatError, type VendorFile } from "../types.js";

const { decodeAccel, readRmcField, removeAccelBaseline, FMT1, FMT2 } = _internal;

const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), "../__fixtures__");

// ---------------------------------------------------------------------------
// Byte builders

// NMEA DDmm.mmmm encoding for synthetic sentences.
function ddmm(deg: number, lonWidth: boolean): string {
    const a = Math.abs(deg);
    const d = Math.floor(a);
    const m = (a - d) * 60;
    const degStr = String(d).padStart(lonWidth ? 3 : 2, "0");
    return `${degStr}${m.toFixed(5).padStart(8, "0")}`;
}

function rmcSentence(opts: {
    time: string;
    lat?: number;
    lon?: number;
    knots?: number;
    course?: number;
    date?: string;
    status?: "A" | "V";
}): string {
    const { time, lat = 50, lon = 30, knots = 25, course = 45, date = "150126", status = "A" } = opts;
    const ns = lat >= 0 ? "N" : "S";
    const ew = lon >= 0 ? "E" : "W";
    // 13 comma-separated fields, the exact shape upstream requires
    // (gpssampleparser.cpp:295). Checksum *7F is deliberately wrong.
    if (status === "V") return `$GPRMC,${time},V,,,,,,,${date},,,N*7F`;
    return `$GPRMC,${time},A,${ddmm(lat, false)},${ns},${ddmm(lon, true)},${ew},${knots.toFixed(3)},${course.toFixed(2)},${date},,,A*7F`;
}

const GGA_FILLER = "$GPGGA,120000.000,5000.00000,N,03000.00000,E,1,08,1.0,100.0,M,46.0,M,,*7F";

interface SampleOpts {
    /** Full RMC sentence; "" leaves the field all-NUL (pre-fix sample). */
    rmc?: string;
    /** Raw accel counts in FILE order: y, x, z. */
    accelRaw?: [number, number, number];
    /** Override the 4 "always zero" bytes (negative tests). */
    leadBytes?: [number, number, number, number];
    /** Override the uint16-BE length prefix (negative tests). */
    lengthPrefix?: number;
}

// fmt1 sample: 2-byte prefix + 288-byte payload = 290 bytes total. Layout per
// gpssampleparser.cpp:195-216 (4 zeros, 16B datetime, int32-LE y/x/z, 128B
// RMC, 128B GGA).
function fmt1Sample(opts: SampleOpts = {}): Uint8Array {
    const payload = Buffer.alloc(FMT1.payloadLen); // zero-filled = NUL padding
    const lead = opts.leadBytes ?? [0, 0, 0, 0];
    Buffer.from(lead).copy(payload, 0);
    Buffer.from("20260115120000", "ascii").copy(payload, 4); // 14 chars + 2 NUL pad
    const [y, x, z] = opts.accelRaw ?? [0, 0, 0];
    payload.writeInt32LE(y, 20);
    payload.writeInt32LE(x, 24);
    payload.writeInt32LE(z, 28);
    if (opts.rmc) Buffer.from(opts.rmc, "ascii").copy(payload, 32);
    Buffer.from(GGA_FILLER, "ascii").copy(payload, 160);
    const sample = Buffer.alloc(2 + payload.length);
    sample.writeUInt16BE(opts.lengthPrefix ?? FMT1.payloadLen, 0);
    payload.copy(sample, 2);
    return new Uint8Array(sample);
}

// fmt2 sample: 2-byte prefix + 1046-byte payload = 1048 bytes total. Layout
// per gpssampleparser.cpp:240-261 (4 zeros, 24B skip, int16-LE y/x/z, 756B
// unknown, 128B RMC, 128B GGA). Upstream marks this branch untested.
function fmt2Sample(opts: SampleOpts = {}): Uint8Array {
    const payload = Buffer.alloc(FMT2.payloadLen);
    const lead = opts.leadBytes ?? [0, 0, 0, 0];
    Buffer.from(lead).copy(payload, 0);
    const [y, x, z] = opts.accelRaw ?? [0, 0, 0];
    payload.writeInt16LE(y, 28);
    payload.writeInt16LE(x, 30);
    payload.writeInt16LE(z, 32);
    if (opts.rmc) Buffer.from(opts.rmc, "ascii").copy(payload, 790);
    Buffer.from(GGA_FILLER, "ascii").copy(payload, 918);
    const sample = Buffer.alloc(2 + payload.length);
    sample.writeUInt16BE(opts.lengthPrefix ?? FMT2.payloadLen, 0);
    payload.copy(sample, 2);
    return new Uint8Array(sample);
}

// Minimal ISOBMFF wrapper (ftyp + moov with one sbtl track + mdat). Ported
// from src/parsers/__fixtures__/thinkware/build-synthetic.mjs buildSbtlMp4,
// except samples are raw binary (the Nextbase struct already carries the
// uint16-BE prefix that tx3g framing would add).
function buildSbtlMp4(sampleBytes: Uint8Array[]): Buffer {
    const fourCC = (s: string) => Buffer.from(s, "ascii");
    const box = (type: string, payload: Buffer) => {
        const head = Buffer.alloc(8);
        head.writeUInt32BE(8 + payload.length, 0);
        fourCC(type).copy(head, 4);
        return Buffer.concat([head, payload]);
    };
    const u32be = (n: number) => {
        const b = Buffer.alloc(4);
        b.writeUInt32BE(n >>> 0, 0);
        return b;
    };

    const samples = sampleBytes.map((s) => Buffer.from(s));
    const creationTime = 3851323200; // 2026-01-15 12:00:00 in the MP4 epoch

    const mvhd = (() => {
        const p = Buffer.alloc(108);
        p.writeUInt32BE(creationTime, 4);
        p.writeUInt32BE(creationTime, 8);
        p.writeUInt32BE(1000, 12);
        p.writeUInt32BE(samples.length * 1000, 16);
        return box("mvhd", p);
    })();
    const hdlr = (() => {
        const p = Buffer.alloc(33);
        fourCC("sbtl").copy(p, 8);
        return box("hdlr", p);
    })();
    const mdhd = (() => {
        const p = Buffer.alloc(24);
        p.writeUInt32BE(creationTime, 4);
        p.writeUInt32BE(creationTime, 8);
        p.writeUInt32BE(1000, 12);
        p.writeUInt32BE(samples.length * 1000, 16);
        return box("mdhd", p);
    })();
    const stsd = (() => {
        const entry = Buffer.alloc(16);
        entry.writeUInt32BE(16, 0);
        fourCC("tx3g").copy(entry, 4);
        return box("stsd", Buffer.concat([Buffer.alloc(4), u32be(1), entry]));
    })();
    const stts = box("stts", Buffer.concat([Buffer.alloc(4), u32be(1), u32be(samples.length), u32be(1000)]));
    const stsc = box("stsc", Buffer.concat([Buffer.alloc(4), u32be(1), u32be(1), u32be(samples.length), u32be(1)]));
    const stsz = box(
        "stsz",
        Buffer.concat([Buffer.alloc(4), u32be(0), u32be(samples.length), ...samples.map((s) => u32be(s.length))]),
    );
    const stcoPlaceholder = box("stco", Buffer.concat([Buffer.alloc(4), u32be(1), u32be(0)]));
    const stbl = box("stbl", Buffer.concat([stsd, stts, stsc, stsz, stcoPlaceholder]));
    const dref = box(
        "dref",
        Buffer.concat([Buffer.alloc(4), u32be(1), u32be(12), fourCC("url "), Buffer.from([0, 0, 0, 1])]),
    );
    const dinf = box("dinf", dref);
    const minf = box("minf", Buffer.concat([dinf, stbl]));
    const mdia = box("mdia", Buffer.concat([mdhd, hdlr, minf]));
    const tkhd = (() => {
        const p = Buffer.alloc(84);
        p.writeUInt32BE(7, 0);
        p.writeUInt32BE(creationTime, 4);
        p.writeUInt32BE(creationTime, 8);
        p.writeUInt32BE(1, 12);
        p.writeUInt32BE(samples.length * 1000, 20);
        return box("tkhd", p);
    })();
    const trak = box("trak", Buffer.concat([tkhd, mdia]));
    const moov = box("moov", Buffer.concat([mvhd, trak]));
    const ftyp = box(
        "ftyp",
        Buffer.concat([fourCC("isom"), u32be(512), fourCC("isom"), fourCC("avc1"), fourCC("mp41")]),
    );
    const mdat = box("mdat", Buffer.concat(samples));
    const mdatStartOffset = ftyp.length + moov.length + 8;
    const chunkOffsetPos = moov.indexOf(stcoPlaceholder) + 8 + 4 + 4;
    const moovPatched = Buffer.from(moov);
    moovPatched.writeUInt32BE(mdatStartOffset, chunkOffsetPos);
    return Buffer.concat([ftyp, moovPatched, mdat]);
}

function makeVf(samples: Uint8Array[], name = "200110_120000_001_FH.MP4"): VendorFile {
    const file = new File([new Uint8Array(buildSbtlMp4(samples))], name);
    return { file, relativePath: name };
}

function loadFixtureVf(relPath: string, name: string): VendorFile {
    const buf = readFileSync(resolve(FIXTURES, relPath));
    const file = new File([buf], name);
    return { file, relativePath: name };
}

// ---------------------------------------------------------------------------
// Helper units

describe("detectNextbaseVariant", () => {
    it("accepts a well-formed fmt1 sample (290 bytes, $GPRMC at +32)", () => {
        const s = fmt1Sample({ rmc: rmcSentence({ time: "120000.000" }) });
        expect(s.byteLength).toBe(290);
        expect(detectNextbaseVariant(s)?.id).toBe("nextbase-fmt1");
    });

    it("accepts a well-formed fmt2 sample (1048 bytes, $GPRMC at +790)", () => {
        const s = fmt2Sample({ rmc: rmcSentence({ time: "120000.000" }) });
        expect(s.byteLength).toBe(1048);
        expect(detectNextbaseVariant(s)?.id).toBe("nextbase-fmt2");
    });

    it("accepts a void fix - the $GPRMC literal is still present", () => {
        const s = fmt1Sample({ rmc: rmcSentence({ time: "120000.000", status: "V" }) });
        expect(detectNextbaseVariant(s)?.id).toBe("nextbase-fmt1");
    });

    it("rejects an all-NUL RMC field (documented miss mode for pre-fix first samples)", () => {
        expect(detectNextbaseVariant(fmt1Sample({ rmc: "" }))).toBeNull();
    });

    it("rejects an unknown length prefix", () => {
        const s = fmt1Sample({ rmc: rmcSentence({ time: "120000.000" }), lengthPrefix: 0x0121 });
        expect(detectNextbaseVariant(s)).toBeNull();
    });

    it("rejects non-zero bytes where the 4 always-zero bytes belong", () => {
        const s = fmt1Sample({ rmc: rmcSentence({ time: "120000.000" }), leadBytes: [0, 0, 0, 1] });
        expect(detectNextbaseVariant(s)).toBeNull();
    });

    it("rejects a truncated sample (prefix larger than the actual bytes)", () => {
        const s = fmt1Sample({ rmc: rmcSentence({ time: "120000.000" }) }).subarray(0, 100);
        expect(detectNextbaseVariant(s)).toBeNull();
    });

    it("rejects a Thinkware-style text cue (variable-length, no fixed struct)", () => {
        // Same shape the F200 PRO writes: tx3g prefix + ASCII telemetry. The
        // prefix value never equals 0x0120/0x0416 for these short cues.
        const text =
            "gsensori,4,512,5,-3,8;GPRMC,120000.00,A,5000.00000,N,03000.00000,E,25.000,45.00,150126,,,A*28;CAR,0";
        const bytes = Buffer.alloc(2 + text.length);
        bytes.writeUInt16BE(text.length, 0);
        Buffer.from(text, "latin1").copy(bytes, 2);
        expect(detectNextbaseVariant(new Uint8Array(bytes))).toBeNull();
    });
});

describe("decodeAccel", () => {
    it("fmt1: int32 LE, /1280, file order y/x/z, Y negated (gpssampleparser.cpp:198-200)", () => {
        const s = fmt1Sample({ accelRaw: [128, 1280, 2560] });
        expect(decodeAccel(s, FMT1)).toEqual({ y: -0.1, x: 1, z: 2 });
    });

    it("fmt2: int16 LE, /2048, Y negated (gpssampleparser.cpp:243-245)", () => {
        const s = fmt2Sample({ accelRaw: [1024, -2048, 4096] });
        expect(decodeAccel(s, FMT2)).toEqual({ y: -0.5, x: -1, z: 2 });
    });
});

describe("readRmcField", () => {
    it("cuts at the first NUL of the 128-byte field", () => {
        const sentence = rmcSentence({ time: "120000.000" });
        expect(readRmcField(fmt1Sample({ rmc: sentence }), FMT1)).toBe(sentence);
    });

    it("returns empty string for an all-NUL field", () => {
        expect(readRmcField(fmt1Sample({ rmc: "" }), FMT1)).toBe("");
    });
});

describe("removeAccelBaseline", () => {
    it("subtracts the per-file mean in place with >=2 samples", () => {
        const recs = [
            { accelXg: 1, accelYg: 0, accelZg: 2 },
            { accelXg: 3, accelYg: 0, accelZg: 2 },
        ] as any[];
        removeAccelBaseline(recs, [
            { x: 1, y: 0, z: 2 },
            { x: 3, y: 0, z: 2 },
        ]);
        expect(recs[0].accelXg).toBe(-1);
        expect(recs[1].accelXg).toBe(1);
        expect(recs[0].accelZg).toBe(0);
    });

    it("ZEROES accel with fewer than 2 samples (unverified gravity semantics, never pass raw)", () => {
        const recs = [{ accelXg: 0.9, accelYg: -0.2, accelZg: 1.1 }] as any[];
        removeAccelBaseline(recs, [{ x: 0.9, y: -0.2, z: 1.1 }]);
        expect(recs[0]).toEqual({ accelXg: 0, accelYg: 0, accelZg: 0 });
    });
});

// ---------------------------------------------------------------------------
// End-to-end: fmt1

describe("synthetic fmt1 (322GW-family) fixture", () => {
    // 5 samples: 2 active fixes, a void fix, an all-NUL pre-fix sample, and an
    // active S/W-hemisphere fix. Every sample carries accel.
    const cues = [
        fmt1Sample({ rmc: rmcSentence({ time: "120000.000" }), accelRaw: [128, 1280, 2560] }),
        fmt1Sample({
            rmc: rmcSentence({ time: "120001.000", lat: 50.0001, lon: 30.0001, course: 46 }),
            accelRaw: [256, 1280, 2560],
        }),
        fmt1Sample({ rmc: rmcSentence({ time: "120002.000", status: "V" }), accelRaw: [0, 0, 0] }),
        fmt1Sample({ rmc: "", accelRaw: [128, 1280, 2560] }),
        fmt1Sample({ rmc: rmcSentence({ time: "120004.000", lat: -10.5, lon: -70.25 }), accelRaw: [128, 1280, 2560] }),
    ];

    it("marker matches and parse yields the active fixes", async () => {
        const vf = makeVf(cues);
        const index = await buildMp4Index(vf.file);
        expect(await nextbaseSubtitlePrimitive.marker(vf, index)).toBe(true);

        const result = await nextbaseSubtitlePrimitive.parse(vf, index);
        // void + all-NUL samples are tolerated silently
        expect(result.records).toHaveLength(3);
        expect(result.skipped).toHaveLength(0);

        const first = result.records[0]!;
        expect(first.lat).toBeCloseTo(50, 6);
        expect(first.lon).toBeCloseTo(30, 6);
        expect(first.bearingDeg).toBe(45);
        expect(first.speedMs).toBeCloseTo(25 * KNOTS_TO_MS, 4);
        expect(first.active).toBe(true);
        expect(first.mp4Filename).toBe(vf.file.name);
        // RMC time+date are absolute UTC - 2026-01-15 12:00:00
        expect(first.unixSeconds).toBe(Date.UTC(2026, 0, 15, 12, 0, 0) / 1000);
        expect(result.records[1]!.unixSeconds).toBe(first.unixSeconds + 1);
    });

    it("decodes S/W hemisphere with negative signs", async () => {
        const vf = makeVf(cues);
        const index = await buildMp4Index(vf.file);
        const result = await nextbaseSubtitlePrimitive.parse(vf, index);
        const south = result.records[2]!;
        expect(south.lat).toBeCloseTo(-10.5, 6);
        expect(south.lon).toBeCloseTo(-70.25, 6);
    });

    it("accel is baseline-removed: per-file mean sits at ~0, raw floor never leaks", async () => {
        const vf = makeVf(cues);
        const index = await buildMp4Index(vf.file);
        const result = await nextbaseSubtitlePrimitive.parse(vf, index);

        // Raw g values per sample (y negated, /1280):
        //   s1 {y:-0.1, x:1, z:2}  s2 {y:-0.2, x:1, z:2}  s3 {0,0,0}
        //   s4 {y:-0.1, x:1, z:2}  s5 {y:-0.1, x:1, z:2}
        // Mean over ALL 5 accel samples: y=-0.1, x=0.8, z=1.6.
        const recs = result.records;
        expect(recs[0]!.accelYg).toBeCloseTo(0, 6); // -0.1 - (-0.1)
        expect(recs[0]!.accelXg).toBeCloseTo(0.2, 6); // 1 - 0.8
        expect(recs[0]!.accelZg).toBeCloseTo(0.4, 6); // 2 - 1.6
        expect(recs[1]!.accelYg).toBeCloseTo(-0.1, 6); // -0.2 - (-0.1)
        // The static x=1g / z=2g floor (could be gravity) must NOT survive.
        expect(Math.max(...recs.map((r) => Math.abs(r.accelXg)))).toBeLessThan(0.5);
        expect(Math.max(...recs.map((r) => Math.abs(r.accelZg)))).toBeLessThan(0.5);
    });

    it("a single-fix clip zeroes accel instead of passing the raw value", async () => {
        // One structurally-valid sample only -> no mean to subtract.
        const vf = makeVf([fmt1Sample({ rmc: rmcSentence({ time: "120000.000" }), accelRaw: [1280, 1280, 1280] })]);
        const index = await buildMp4Index(vf.file);
        const result = await nextbaseSubtitlePrimitive.parse(vf, index);
        expect(result.records).toHaveLength(1);
        expect(result.records[0]!.accelXg).toBe(0);
        expect(result.records[0]!.accelYg).toBe(0);
        expect(result.records[0]!.accelZg).toBe(0);
    });

    it("marker matches a first-sample void fix (the $GPRMC literal is present pre-fix)", async () => {
        const vf = makeVf([
            fmt1Sample({ rmc: rmcSentence({ time: "115959.000", status: "V" }) }),
            fmt1Sample({ rmc: rmcSentence({ time: "120000.000" }), accelRaw: [128, 1280, 2560] }),
        ]);
        const index = await buildMp4Index(vf.file);
        expect(await nextbaseSubtitlePrimitive.marker(vf, index)).toBe(true);
        const result = await nextbaseSubtitlePrimitive.parse(vf, index);
        expect(result.records).toHaveLength(1);
    });

    it("documented miss mode: an all-NUL RMC field in the FIRST sample is not claimed", async () => {
        // Whether real pre-fix firmware writes NULs or a void RMC is unknown
        // without a sample; this test pins the current (conservative) behavior.
        const vf = makeVf([fmt1Sample({ rmc: "" }), fmt1Sample({ rmc: rmcSentence({ time: "120000.000" }) })]);
        const index = await buildMp4Index(vf.file);
        expect(await nextbaseSubtitlePrimitive.marker(vf, index)).toBe(false);
        await expect(nextbaseSubtitlePrimitive.parse(vf, index)).rejects.toBeInstanceOf(WrongFormatError);
    });

    it("a track with only void/pre-fix samples yields WrongFormatError, not empty success", async () => {
        const vf = makeVf([
            fmt1Sample({ rmc: rmcSentence({ time: "120000.000", status: "V" }) }),
            fmt1Sample({ rmc: rmcSentence({ time: "120001.000", status: "V" }) }),
        ]);
        const index = await buildMp4Index(vf.file);
        expect(await nextbaseSubtitlePrimitive.marker(vf, index)).toBe(true);
        const track = await findNextbaseSubtitleTrack(vf, index);
        expect(track).not.toBeNull();
        expect(await extractFromNextbaseSubtitleTrack(vf, index, track!)).toBeNull();
        await expect(nextbaseSubtitlePrimitive.parse(vf, index)).rejects.toBeInstanceOf(WrongFormatError);
    });
});

// ---------------------------------------------------------------------------
// End-to-end: fmt2 (622GW - upstream-untested branch)

describe("synthetic fmt2 (622GW) fixture", () => {
    it("marker matches and parse decodes coords/time/accel via the int16 path", async () => {
        const vf = makeVf([
            fmt2Sample({ rmc: rmcSentence({ time: "120000.000" }), accelRaw: [205, 2048, 4096] }),
            fmt2Sample({
                rmc: rmcSentence({ time: "120001.000", lat: 50.0001, lon: 30.0001 }),
                accelRaw: [410, 2048, 4096],
            }),
        ]);
        const index = await buildMp4Index(vf.file);
        expect(await nextbaseSubtitlePrimitive.marker(vf, index)).toBe(true);

        const result = await nextbaseSubtitlePrimitive.parse(vf, index);
        expect(result.records).toHaveLength(2);
        expect(result.records[0]!.lat).toBeCloseTo(50, 6);
        expect(result.records[0]!.lon).toBeCloseTo(30, 6);
        expect(result.records[0]!.unixSeconds).toBe(Date.UTC(2026, 0, 15, 12, 0, 0) / 1000);
        // raw y: -205/2048=-0.1001, -410/2048=-0.2002 -> mean -0.1501;
        // x/z static floor is fully absorbed by the mean.
        expect(result.records[0]!.accelYg).toBeCloseTo(0.05, 3);
        expect(result.records[1]!.accelYg).toBeCloseTo(-0.05, 3);
        expect(result.records[0]!.accelXg).toBeCloseTo(0, 6);
        expect(result.records[0]!.accelZg).toBeCloseTo(0, 6);
    });
});

// ---------------------------------------------------------------------------
// Cross-claim negatives (registration-order safety)

describe("cross-claim: nextbase marker vs other subtitle formats", () => {
    it("does NOT claim the Thinkware real-anonymized fixture", async () => {
        const vf = loadFixtureVf("thinkware/real-anonymized.mp4", "REC_2026_06_01_21_16_47_F.MP4");
        const index = await buildMp4Index(vf.file);
        expect(await nextbaseSubtitlePrimitive.marker(vf, index)).toBe(false);
    });

    it("does NOT claim the Thinkware synthetic fixture", async () => {
        const vf = loadFixtureVf("thinkware/synthetic-fseries.mp4", "REC_2026_01_15_12_00_00_F.MP4");
        const index = await buildMp4Index(vf.file);
        expect(await nextbaseSubtitlePrimitive.marker(vf, index)).toBe(false);
    });

    it("does NOT claim the Garmin PNDM synthetic fixture", async () => {
        const vf = loadFixtureVf("garmin/synthetic-pndm.mp4", "GRMN0001.MP4");
        const index = await buildMp4Index(vf.file);
        expect(await nextbaseSubtitlePrimitive.marker(vf, index)).toBe(false);
    });

    it("Garmin PNDM marker does not claim a Nextbase file (safe both directions)", async () => {
        const vf = makeVf([fmt1Sample({ rmc: rmcSentence({ time: "120000.000" }) })]);
        const index = await buildMp4Index(vf.file);
        expect(await pndmPrimitive.marker(vf, index)).toBe(false);
    });

    it("Thinkware nmea-subtitle marker DOES claim a Nextbase file - the reason this primitive must register first", async () => {
        // This is the documented collision, asserted on purpose: the Thinkware
        // marker strips the same uint16-BE prefix (288 <= 290-2 is
        // self-consistent) and NMEA_RMC_SIG allows '$' as a boundary, so the
        // embedded "$GPRMC" fires it. Registration order (nextbase-subtitle
        // BEFORE nmea-subtitle in VIDEO_EMBEDDED_PRIMITIVES) is what protects
        // this direction - there is no marker-level fix that would not weaken
        // Thinkware's own detection. If this assertion ever flips to false,
        // the ordering constraint can be relaxed.
        const vf = makeVf([fmt1Sample({ rmc: rmcSentence({ time: "120000.000" }) })]);
        const index = await buildMp4Index(vf.file);
        expect(await nmeaSubtitlePrimitive.marker(vf, index)).toBe(true);
        // ...and it would half-claim: coords parse, but the binary accel
        // triple is invisible to the text parser (no gsensori/$GSENSOR tag).
        const halfClaim = await nmeaSubtitlePrimitive.parse(vf, index);
        expect(halfClaim.records.length).toBeGreaterThan(0);
        expect(halfClaim.records.every((r) => r.accelXg === 0 && r.accelYg === 0 && r.accelZg === 0)).toBe(true);
    });
});
