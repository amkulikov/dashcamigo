// Tests for the subtitle-track GPS extractor: pure-helper units plus
// end-to-end runs against the committed Thinkware synthetic / real-anonymized
// fixtures and an in-memory Mini 0806 container (ExifTool-derived cues).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildMp4Index } from "./mp4-index.js";
import { _internal, extractFromNmeaSubtitleTrack, findNmeaSubtitleTrack } from "./sbtl-nmea-extract.js";
import { nmeaSubtitlePrimitive } from "../primitives/nmea-subtitle.js";
import { KNOTS_TO_MS, WrongFormatError, type VendorFile } from "../types.js";

const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), "../__fixtures__/thinkware");

function loadVf(fixture: string, name: string): { vf: VendorFile; file: File } {
    const buf = readFileSync(resolve(FIXTURES, fixture));
    const file = new File([buf], name);
    return { vf: { file, relativePath: name }, file };
}

function magnitude(r: { accelXg: number; accelYg: number; accelZg: number }): number {
    return Math.sqrt(r.accelXg ** 2 + r.accelYg ** 2 + r.accelZg ** 2);
}

describe("sbtl helpers", () => {
    const {
        stripSubtitleTextPrefix,
        splitCueSegments,
        parseGsensori,
        removeGsensoriBaseline,
        hasGpsTelemetrySignature,
    } = _internal;

    it("strips a self-consistent tx3g length prefix", () => {
        const text = "gsensori,4,512,1,2,3";
        const bytes = new Uint8Array([0x00, text.length, ...[...text].map((c) => c.charCodeAt(0))]);
        expect(new TextDecoder().decode(stripSubtitleTextPrefix(bytes))).toBe(text);
    });

    it("leaves raw text (no prefix) untouched - legacy dialect", () => {
        const bytes = new TextEncoder().encode("$GPRMC,120000.00,A,5000.0,N,03000.0,E,1,2,150126,,,A*00");
        // First two bytes "$G" decode to a length far larger than the buffer -> no strip.
        expect(stripSubtitleTextPrefix(bytes)).toBe(bytes);
    });

    it("splits cue on ; \\0 and CRLF, dropping empties and whitespace", () => {
        const segs = splitCueSegments("gsensori,4,512,1,2,3;GPRMC,x*aa\r\n; CAR,0");
        expect(segs).toEqual(["gsensori,4,512,1,2,3", "GPRMC,x*aa", "CAR,0"]);
    });

    it("parseGsensori divides by the inline <sens> field, not a hard-coded scale", () => {
        expect(parseGsensori("gsensori,4,512,512,-256,128")).toEqual({ x: 1, y: -0.5, z: 0.25 });
        // ±8g range -> sens 256
        expect(parseGsensori("gsensori,8,256,256,0,0")).toEqual({ x: 1, y: 0, z: 0 });
        expect(parseGsensori("gsensori,4,0,1,2,3")).toBeNull(); // zero divisor
        expect(parseGsensori("gsensori,4,512,x,2,3")).toBeNull(); // non-numeric
        expect(parseGsensori("gsensori,4,512,,2,3")).toBeNull(); // empty field -> rejected, not a real 0g
        expect(parseGsensori("gsensori,4,512")).toBeNull(); // too few fields
    });

    it("removeGsensoriBaseline subtracts the per-file mean in place", () => {
        const recs = [
            { accelXg: 1, accelYg: 0, accelZg: 0 },
            { accelXg: 3, accelYg: 0, accelZg: 0 },
        ] as any[];
        removeGsensoriBaseline(recs, [
            { x: 1, y: 0, z: 0 },
            { x: 3, y: 0, z: 0 },
        ]);
        // mean x = 2 -> centered around 0
        expect(recs[0].accelXg).toBe(-1);
        expect(recs[1].accelXg).toBe(1);
    });

    it("removeGsensoriBaseline is a no-op with fewer than 2 samples (keeps raw)", () => {
        const recs = [{ accelXg: 5, accelYg: 0, accelZg: 0 }] as any[];
        removeGsensoriBaseline(recs, [{ x: 5, y: 0, z: 0 }]);
        // one sample cannot separate bias from motion -> leave the raw value,
        // do not zero it out.
        expect(recs[0].accelXg).toBe(5);
    });

    it("telemetry signature matches gsensori and bare/$ RMC, not arbitrary text", () => {
        expect(hasGpsTelemetrySignature("gsensori,4,512,1,2,3;CAR,0")).toBe(true);
        expect(hasGpsTelemetrySignature("GPRMC,120000.00,A,1,N,2,E,3,4,150126")).toBe(true);
        expect(hasGpsTelemetrySignature("$GNRMC,120000.00,A,1,N,2,E,3,4,150126")).toBe(true);
        expect(hasGpsTelemetrySignature("just a normal subtitle line")).toBe(false);
    });
});

describe("synthetic Thinkware fixture", () => {
    it("marker matches, parse yields the active fixes with decoded telemetry", async () => {
        const { vf, file } = loadVf("synthetic-fseries.mp4", "REC_2026_01_15_12_00_00_F.MP4");
        const index = await buildMp4Index(file);
        expect(await nmeaSubtitlePrimitive.marker(vf, index)).toBe(true);

        const result = await nmeaSubtitlePrimitive.parse(vf, index);
        // 6 GPRMC + 1 GNRMC active fixes; the 2 accel-only warm-up cues and the
        // void (status V) fix produce no records.
        expect(result.records).toHaveLength(7);

        const first = result.records[0]!;
        expect(first.lat).toBeCloseTo(50, 4);
        expect(first.lon).toBeCloseTo(30, 4);
        expect(first.bearingDeg).toBe(45);
        expect(first.speedMs).toBeCloseTo(25 * 0.514444, 4);
        // monotonic, north-east drift
        for (let i = 1; i < result.records.length; i++) {
            expect(result.records[i]!.lat).toBeGreaterThanOrEqual(result.records[i - 1]!.lat);
        }
        // accel is decoded and gravity-removed (mean-centred), so magnitudes are
        // small and never trip the 0.5g brake threshold on a calm track.
        const accelSet = result.records.some((r) => magnitude(r) > 0);
        expect(accelSet).toBe(true);
        expect(Math.max(...result.records.map(magnitude))).toBeLessThan(0.5);
    });
});

describe("real-anonymized Thinkware F200 PRO fixture", () => {
    it("10 fixes at the 50N/30E sentinel with real timestamps and accel", async () => {
        const { vf, file } = loadVf("real-anonymized.mp4", "REC_2026_06_01_21_16_47_F.MP4");
        const index = await buildMp4Index(file);
        const track = await findNmeaSubtitleTrack(vf, index);
        expect(track).not.toBeNull();

        const result = await extractFromNmeaSubtitleTrack(vf, index, track!);
        expect(result).not.toBeNull();
        const recs = result!.records;
        expect(recs.length).toBe(10);

        for (let i = 0; i < recs.length; i++) {
            const r = recs[i]!;
            // sentinel coordinates - no PII
            expect(r.lat).toBeCloseTo(50 + i * 0.0001, 4);
            expect(r.lon).toBeCloseTo(30 + i * 0.0001, 4);
            expect(r.active).toBe(true);
            // real (non-PII) timestamps from 2026-06-02
            expect(r.unixSeconds).toBeGreaterThan(Date.UTC(2026, 5, 1) / 1000);
            expect(r.unixSeconds).toBeLessThan(Date.UTC(2026, 5, 3) / 1000);
        }
        // monotonic time, realistic speed, no false brake events
        for (let i = 1; i < recs.length; i++) expect(recs[i]!.unixSeconds).toBeGreaterThan(recs[i - 1]!.unixSeconds);
        expect(Math.max(...recs.map((r) => r.speedMs))).toBeLessThan(60);
        expect(Math.max(...recs.map(magnitude))).toBeLessThan(0.5);
        // accel is present (real gsensori counts, baseline-removed)
        expect(recs.some((r) => magnitude(r) > 0)).toBe(true);
        // Pin baseline-removal end-to-end: this fixture has a strong static X
        // tilt (~-0.245g raw). After removeGsensoriBaseline the per-record mean
        // must sit at ~0. Without it the mean stays ~-0.245g and brake detection
        // loses half its 0.5g headroom - and the looser max<0.5 check above would
        // still pass, so it cannot catch a removal regression on its own.
        const meanX = recs.reduce((acc, r) => acc + r.accelXg, 0) / recs.length;
        const meanY = recs.reduce((acc, r) => acc + r.accelYg, 0) / recs.length;
        const meanZ = recs.reduce((acc, r) => acc + r.accelZg, 0) / recs.length;
        expect(Math.abs(meanX)).toBeLessThan(0.02);
        expect(Math.abs(meanY)).toBeLessThan(0.02);
        expect(Math.abs(meanZ)).toBeLessThan(0.02);
    });
});

describe("rear / accel-only Thinkware track yields no GPS", () => {
    it("a subtitle track with gsensori cues but no RMC returns null (front-only GPS model)", async () => {
        // The rear camera records the G-sensor but not GPS. marker still matches
        // (the gsensori signature is in every cue), but the extractor must yield
        // no records and the primitive must throw WrongFormatError - the rear
        // contributes no embedded GPS; the trip's track comes from the front file.
        const { vf, file } = loadVf("synthetic-rear.mp4", "REC_2026_01_15_12_00_00_R.MP4");
        const index = await buildMp4Index(file);
        expect(await nmeaSubtitlePrimitive.marker(vf, index)).toBe(true);

        const track = await findNmeaSubtitleTrack(vf, index);
        expect(track).not.toBeNull();
        expect(await extractFromNmeaSubtitleTrack(vf, index, track!)).toBeNull();
        await expect(nmeaSubtitlePrimitive.parse(vf, index)).rejects.toBeInstanceOf(WrongFormatError);
    });
});

describe("non-telemetry subtitle is rejected", () => {
    it("parse throws WrongFormatError when the track carries no GPS", async () => {
        // Reuse the synthetic container shape but with a plain caption: marker
        // must say no, and a forced parse must throw rather than invent records.
        const { vf, file } = loadVf("synthetic-fseries.mp4", "REC_2026_01_15_12_00_00_F.MP4");
        const index = await buildMp4Index(file);
        // sanity: the real fixture DOES match; the negative path is the helper.
        expect(_internal.hasGpsTelemetrySignature("hello world")).toBe(false);
        // A track-less index makes parse throw WrongFormatError.
        const emptyIndex = { ...index, tracks: [] };
        await expect(nmeaSubtitlePrimitive.parse(vf, emptyIndex)).rejects.toBeInstanceOf(WrongFormatError);
    });
});

// ---------------------------------------------------------------------------
// Mini 0806 CSV dialect. Implemented from foreign source (ExifTool v13.59
// QuickTimeStream.pl:1232-1248), not validated against a real sample - the
// fixtures below are reconstructed from ExifTool's verbatim comment example.

// Verbatim example cue from the ExifTool comment (QuickTimeStream.pl:1233).
// Expected decode: 2019-05-27 20:15:55 UTC, lat 33+56.8925/60 = 33.948208,
// lon -(84+20.2071/60) = -84.336785, speed 0; accel magnitude ~9.99 m/s2 at
// rest = gravity-included raw data.
const MINI0806_EXAMPLE = "A,270519,201555.000,3356.8925,N,08420.2071,W,000.0,331.0M,+01.84,-09.80,-00.61;\n";

// In-memory MP4 builder for the Mini 0806 end-to-end tests. TS port of
// `buildSbtlMp4` from __fixtures__/thinkware/build-synthetic.mjs (kept local:
// the .mjs builder is untyped and tsconfig has no allowJs, so importing it
// would fail typecheck). Same minimal layout: ftyp + moov with one tx3g
// 'sbtl' track (single chunk) + mdat; each sample = uint16-BE length prefix +
// ASCII text.
function u32(n: number): Uint8Array<ArrayBuffer> {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setUint32(0, n >>> 0, false);
    return b;
}
function fourCC(s: string): Uint8Array<ArrayBuffer> {
    return new TextEncoder().encode(s);
}
function concatBytes(parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let pos = 0;
    for (const p of parts) {
        out.set(p, pos);
        pos += p.length;
    }
    return out;
}
function mp4Box(type: string, ...payload: Uint8Array[]): Uint8Array<ArrayBuffer> {
    const body = concatBytes(payload);
    return concatBytes([u32(8 + body.length), fourCC(type), body]);
}
/** One byte per char - the obfuscated dialects carry non-UTF-8 byte values. */
function latin1(text: string): Uint8Array<ArrayBuffer> {
    const out = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff;
    return out;
}
// A cue may be given as text or as raw bytes (ciphered dialects).
function tx3gSample(cue: string | Uint8Array): Uint8Array<ArrayBuffer> {
    const body = typeof cue === "string" ? latin1(cue) : cue;
    const prefix = new Uint8Array(2);
    new DataView(prefix.buffer).setUint16(0, body.length, false);
    return concatBytes([prefix, body]);
}

const MP4_CREATION_TIME = 3851323200; // 2026-01-15 12:00:00 in the MP4 epoch (as in the .mjs builder)

function buildSbtlMp4(cues: (string | Uint8Array)[]): Uint8Array<ArrayBuffer> {
    const samples = cues.map(tx3gSample);

    const mvhdPayload = new Uint8Array(108);
    const mvhdDv = new DataView(mvhdPayload.buffer);
    mvhdDv.setUint32(4, MP4_CREATION_TIME);
    mvhdDv.setUint32(8, MP4_CREATION_TIME);
    mvhdDv.setUint32(12, 1000);
    mvhdDv.setUint32(16, samples.length * 1000);
    const mvhd = mp4Box("mvhd", mvhdPayload);

    const hdlrPayload = new Uint8Array(33);
    hdlrPayload.set(fourCC("sbtl"), 8);
    const hdlr = mp4Box("hdlr", hdlrPayload);

    const mdhdPayload = new Uint8Array(24);
    const mdhdDv = new DataView(mdhdPayload.buffer);
    mdhdDv.setUint32(4, MP4_CREATION_TIME);
    mdhdDv.setUint32(8, MP4_CREATION_TIME);
    mdhdDv.setUint32(12, 1000);
    mdhdDv.setUint32(16, samples.length * 1000);
    const mdhd = mp4Box("mdhd", mdhdPayload);

    const stsd = mp4Box("stsd", new Uint8Array(4), u32(1), u32(16), fourCC("tx3g"), new Uint8Array(8));
    const stts = mp4Box("stts", new Uint8Array(4), u32(1), u32(samples.length), u32(1000));
    const stsc = mp4Box("stsc", new Uint8Array(4), u32(1), u32(1), u32(samples.length), u32(1));
    const stsz = mp4Box("stsz", new Uint8Array(4), u32(0), u32(samples.length), ...samples.map((s) => u32(s.length)));

    const dref = mp4Box("dref", new Uint8Array(4), u32(1), u32(12), fourCC("url "), Uint8Array.from([0, 0, 0, 1]));
    const dinf = mp4Box("dinf", dref);

    const tkhdPayload = new Uint8Array(84);
    const tkhdDv = new DataView(tkhdPayload.buffer);
    tkhdDv.setUint32(0, 7);
    tkhdDv.setUint32(4, MP4_CREATION_TIME);
    tkhdDv.setUint32(8, MP4_CREATION_TIME);
    tkhdDv.setUint32(12, 1);
    tkhdDv.setUint32(20, samples.length * 1000);

    const buildMoov = (chunkOffset: number): Uint8Array<ArrayBuffer> => {
        const stco = mp4Box("stco", new Uint8Array(4), u32(1), u32(chunkOffset));
        const stbl = mp4Box("stbl", stsd, stts, stsc, stsz, stco);
        const minf = mp4Box("minf", dinf, stbl);
        const mdia = mp4Box("mdia", mdhd, hdlr, minf);
        const trak = mp4Box("trak", mp4Box("tkhd", tkhdPayload), mdia);
        return mp4Box("moov", mvhd, trak);
    };

    const ftyp = mp4Box("ftyp", fourCC("isom"), u32(512), fourCC("isom"), fourCC("avc1"), fourCC("mp41"));
    // moov size does not depend on the stco value (fixed 4 bytes): build once
    // to measure, then rebuild with the real mdat payload offset.
    const mdatPayloadStart = ftyp.length + buildMoov(0).length + 8;
    return concatBytes([ftyp, buildMoov(mdatPayloadStart), mp4Box("mdat", ...samples)]);
}

async function loadMini0806(
    cues: (string | Uint8Array)[],
    name = "FILE0001.MP4",
): Promise<{ vf: VendorFile; index: Awaited<ReturnType<typeof buildMp4Index>> }> {
    const file = new File([buildSbtlMp4(cues)], name);
    const vf: VendorFile = { file, relativePath: name };
    const index = await buildMp4Index(file);
    return { vf, index };
}

describe("Mini 0806 signature matrix", () => {
    const { MINI0806_SIG, THINKWARE_GSENSOR_SIG, NMEA_RMC_SIG, hasGpsTelemetrySignature } = _internal;
    // Representative first cues of the two existing dialects (gsensori one is
    // the ExifTool Thinkware example, QuickTimeStream.pl:1272-1273).
    const GSENSORI_CUE =
        "gsensori,4,512,-67,-12,100;GNRMC,161313.00,A,4529.87489,N,07337.01215,W,6.225,35.34,310819,,,A*52;CAR,0,0,0,0.0,0,0,0,0,0,0,0,0";
    const LEGACY_CUE = "$GPRMC,120000.00,A,5000.0,N,03000.0,E,1,2,150126,,,A*00";

    it("mini0806 line matches its signature and the marker helper", () => {
        expect(MINI0806_SIG.test(MINI0806_EXAMPLE)).toBe(true);
        expect(hasGpsTelemetrySignature(MINI0806_EXAMPLE)).toBe(true);
    });

    it("new signature does not claim the existing dialects", () => {
        expect(MINI0806_SIG.test(GSENSORI_CUE)).toBe(false);
        expect(MINI0806_SIG.test(LEGACY_CUE)).toBe(false);
    });

    it("old signatures do not claim the mini0806 line", () => {
        expect(THINKWARE_GSENSOR_SIG.test(MINI0806_EXAMPLE)).toBe(false);
        expect(NMEA_RMC_SIG.test(MINI0806_EXAMPLE)).toBe(false);
    });

    it("near-misses are rejected", () => {
        expect(MINI0806_SIG.test("V,270519,201555.000,")).toBe(false); // void/no-fix status
        expect(MINI0806_SIG.test("A,2705,201555.000,")).toBe(false); // 4-digit date
        expect(MINI0806_SIG.test("A,270519,201555")).toBe(false); // no field separator after time
        expect(MINI0806_SIG.test(";A,270519,201555.000,")).toBe(false); // not anchored at cue start
    });
});

describe("parseMini0806", () => {
    const { parseMini0806 } = _internal;
    const NAME = "FILE0001.MP4";
    const G = 9.80665;

    it("decodes the verbatim ExifTool example line", () => {
        // In the real flow splitCueSegments strips the trailing ';\n'; parse the
        // bare segment here.
        const res = parseMini0806(MINI0806_EXAMPLE.replace(/;\s*$/, ""), NAME);
        expect("error" in res).toBe(false);
        if ("error" in res) return;
        expect(res.record.unixSeconds).toBe(Date.UTC(2019, 4, 27, 20, 15, 55) / 1000);
        expect(res.record.lat).toBeCloseTo(33.948208, 5);
        expect(res.record.lon).toBeCloseTo(-84.336785, 5);
        expect(res.record.speedMs).toBe(0);
        expect(res.record.active).toBe(true);
        expect(res.record.bearingDeg).toBe(0);
        expect(res.record.timeUnsynced).toBeUndefined();
        expect(res.record.mp4Filename).toBe(NAME);
        // Raw m/s2 divided by standard gravity; the at-rest example must come
        // out at ~1g magnitude (gravity still included until baseline removal).
        expect(res.accelG).not.toBeNull();
        expect(res.accelG!.x).toBeCloseTo(1.84 / G, 6);
        expect(res.accelG!.y).toBeCloseTo(-9.8 / G, 6);
        expect(res.accelG!.z).toBeCloseTo(-0.61 / G, 6);
        expect(Math.sqrt(res.accelG!.x ** 2 + res.accelG!.y ** 2 + res.accelG!.z ** 2)).toBeCloseTo(1, 1);
    });

    it("tolerates an unsplit line ending (';\\n' on the last accel field)", () => {
        const res = parseMini0806(MINI0806_EXAMPLE, NAME);
        expect("error" in res).toBe(false);
        if ("error" in res) return;
        expect(res.accelG!.z).toBeCloseTo(-0.61 / G, 6);
    });

    it("decodes fractional seconds and km/h speed", () => {
        const res = parseMini0806("A,270519,201555.500,3356.8925,N,08420.2071,W,036.0,331.0M", NAME);
        expect("error" in res).toBe(false);
        if ("error" in res) return;
        expect(res.record.unixSeconds).toBeCloseTo(Date.UTC(2019, 4, 27, 20, 15, 55) / 1000 + 0.5, 6);
        // 36 km/h -> 10 m/s ((NC) km/h convention per ExifTool GPSSpeed)
        expect(res.record.speedMs).toBeCloseTo(10, 6);
        // altitude-only tail (no accel fields) -> record valid, accel absent
        expect(res.accelG).toBeNull();
    });

    it("southern/eastern hemisphere signs", () => {
        const res = parseMini0806("A,270519,201555.000,3356.8925,S,08420.2071,E,000.0,331.0M", NAME);
        expect("error" in res).toBe(false);
        if ("error" in res) return;
        expect(res.record.lat).toBeCloseTo(-33.948208, 5);
        expect(res.record.lon).toBeCloseTo(84.336785, 5);
    });

    it("rejects malformed lines with a reason, keeps the fix on garbled accel only", () => {
        const err = (s: string): string => {
            const r = parseMini0806(s, NAME);
            return "error" in r ? r.error : "<parsed>";
        };
        expect(err("A,271319,201555.000,3356.8925,N,08420.2071,W,000.0")).toBe("mini0806: bad date"); // month 13
        expect(err("A,320519,201555.000,3356.8925,N,08420.2071,W,000.0")).toBe("mini0806: bad date"); // day 32
        expect(err("A,270519,241555.000,3356.8925,N,08420.2071,W,000.0")).toBe("mini0806: bad time"); // hour 24
        expect(err("A,270519,201555.000,3356.8925,X,08420.2071,W,000.0")).toBe("mini0806: bad latitude hemisphere");
        expect(err("A,270519,201555.000,3356.8925,N,08420.2071,Q,000.0")).toBe("mini0806: bad longitude hemisphere");
        expect(err("A,270519,201555.000,,N,08420.2071,W,000.0")).toBe("mini0806: bad coordinates");
        expect(err("A,270519,201555.000,3356.8925,N,08420.2071,W,fast")).toBe("mini0806: bad speed");
        expect(err("A,270519,201555.000,3356.8925,N,08420.2071,W,-5.0")).toBe("mini0806: bad speed"); // digits-only
        expect(err("A,270519,201555.000,3356.8925,N")).toBe("mini0806: too few fields");
        // garbled accel (empty X field) is lenient: the GPS fix survives with no accel
        const r = parseMini0806("A,270519,201555.000,3356.8925,N,08420.2071,W,000.0,331.0M,,-09.80,-00.61", NAME);
        expect("error" in r).toBe(false);
        if (!("error" in r)) expect(r.accelG).toBeNull();
    });
});

describe("synthetic Mini 0806 MP4 (in-memory, ExifTool-derived cues)", () => {
    const G = 9.80665;
    const CUES = [
        MINI0806_EXAMPLE, // verbatim ExifTool example, at rest
        "A,270519,201556.000,3356.8930,N,08420.2080,W,036.0,331.0M,+01.84,-09.80,-00.61;\n", // +1 s, 36 km/h
        "A,270519,201557.000,3356.8940,N,08420.2095,W,036.0,331.2M,+02.04,-09.60,-00.61;\n", // +0.2 m/s2 dynamic accel on X and Y
    ];

    it("marker fires; records decode; gravity baseline is removed", async () => {
        const { vf, index } = await loadMini0806(CUES);
        expect(await nmeaSubtitlePrimitive.marker(vf, index)).toBe(true);

        const result = await nmeaSubtitlePrimitive.parse(vf, index);
        expect(result.skipped).toHaveLength(0);
        expect(result.records).toHaveLength(3);

        const r0 = result.records[0]!;
        expect(r0.lat).toBeCloseTo(33.948208, 5);
        expect(r0.lon).toBeCloseTo(-84.336785, 5);
        expect(r0.unixSeconds).toBe(Date.UTC(2019, 4, 27, 20, 15, 55) / 1000);
        expect(r0.speedMs).toBe(0);
        expect(r0.active).toBe(true);
        expect(r0.timeUnsynced).toBeUndefined();
        expect(result.records[1]!.speedMs).toBeCloseTo(10, 6);
        expect(result.records[2]!.unixSeconds - r0.unixSeconds).toBe(2);

        // Gravity-included raw accel must come out mean-centred at 0 per axis,
        // with the dynamic inter-record delta preserved (raw delta / g) and no
        // record keeping the raw ~1g floor (would fire the impact detector).
        for (const axis of ["accelXg", "accelYg", "accelZg"] as const) {
            const mean = result.records.reduce((acc, r) => acc + r[axis], 0) / result.records.length;
            expect(Math.abs(mean)).toBeLessThan(1e-9);
        }
        expect(result.records[2]!.accelXg - r0.accelXg).toBeCloseTo(0.2 / G, 6);
        expect(result.records[2]!.accelYg - r0.accelYg).toBeCloseTo(0.2 / G, 6);
        for (const r of result.records) expect(magnitude(r)).toBeLessThan(0.5);
    });

    it("single-record file zeroes the gravity-included accel (<2 baseline samples)", async () => {
        const { vf, index } = await loadMini0806([CUES[0]!]);
        const result = await nmeaSubtitlePrimitive.parse(vf, index);
        expect(result.records).toHaveLength(1);
        const r = result.records[0]!;
        // The baseline cannot be estimated from one sample; leaking the raw
        // ~1g gravity vector would violate the GpsRecord contract, so the
        // extractor zeroes it (unlike gsensori, whose raw is near-dynamic).
        expect(r.accelXg).toBe(0);
        expect(r.accelYg).toBe(0);
        expect(r.accelZg).toBe(0);
        expect(r.lat).toBeCloseTo(33.948208, 5);
    });

    it("malformed line lands in skipped, valid neighbours survive", async () => {
        const { vf, index } = await loadMini0806([
            CUES[0]!,
            "A,271319,201556.000,3356.8930,N,08420.2080,W,000.0,331.0M,+01.84,-09.80,-00.61;\n", // month 13
            CUES[2]!,
        ]);
        const result = await nmeaSubtitlePrimitive.parse(vf, index);
        expect(result.records).toHaveLength(2);
        expect(result.skipped).toHaveLength(1);
        expect(result.skipped[0]!.reason).toBe("mini0806: bad date");
    });

    it("plain-caption track in the same container is not claimed", async () => {
        const { vf, index } = await loadMini0806(["This is just a caption\n"]);
        expect(await nmeaSubtitlePrimitive.marker(vf, index)).toBe(false);
        await expect(nmeaSubtitlePrimitive.parse(vf, index)).rejects.toBeInstanceOf(WrongFormatError);
    });
});

/** Frames a plain cue the way an E-PRANCE B47FS writes it: leading NUL, the
 *  difference-ciphered text, trailing newline. */
function encodeEprance(plain: string, shift: number): Uint8Array<ArrayBuffer> {
    const cue = new Uint8Array(plain.length + 2);
    cue[0] = 0x00;
    for (let i = 0; i < plain.length; i++) cue[i + 1] = (plain.charCodeAt(i) - shift) & 0xff;
    cue[cue.length - 1] = 0x0a;
    return cue;
}

describe("obfuscated cue dialects", () => {
    const { decodeCue, parseRoadhawkAccel, parseEpranceAccel } = _internal;

    // Verbatim encoded/decoded pair from ExifTool (QuickTimeStream.pl:1251-1255,
    // v13.55). The decoded form is what the substitution table must produce.
    const ROADHAWK_ENCODED =
        ".;;;;D?JL;6+;;;D;R?;4;;;;DBB;;O;;;=D;L;;HO71G>F;-?=J-F:FNJJ;DPP-JF3F;;PL=DBRLBF0F;=?DNF-RD-PF;N;?=JF;;?D=F:*6F~";
    const ROADHAWK_DECODED =
        "X0000.2340Y-000.0720Z0000.9900G0001.0400$GPRMC,082138,A,5330.6683,N,00641.9749,W,012.5,87.86,050213,002.1,A";

    it("Roadhawk: the substitution table reproduces upstream's decoded sample", () => {
        const decoded = decodeCue(latin1(ROADHAWK_ENCODED));
        // A ';' is inserted so the accel prefix and the sentence split into
        // separate segments downstream.
        expect(decoded.replace(";$", "$")).toBe(ROADHAWK_DECODED);
    });

    it("Roadhawk: a cue that ends like one but decodes to nothing is left alone", () => {
        const notRoadhawk = "totally unrelated subtitle text*AB~";
        expect(decodeCue(latin1(notRoadhawk))).toBe(notRoadhawk);
    });

    it("Roadhawk: the accel prefix parses as a g triple, magnitude dropped", () => {
        expect(parseRoadhawkAccel("X0000.2340Y-000.0720Z0000.9900G0001.0400")).toEqual({
            x: 0.234,
            y: -0.072,
            z: 0.99,
        });
        expect(parseRoadhawkAccel("gsensori,4,512,-67,-12,100")).toBeNull();
    });

    it("E-PRANCE: the difference cipher is recovered from the known '*'", () => {
        const plain = "$GPRMC,082138,A,5330.6683,N,00641.9749,W,012.5,87.86,050213,,,A*59";
        expect(decodeCue(encodeEprance(plain, 0x11))).toBe(plain);
        // Same cue as a real sbtl sample carries it: behind a tx3g length
        // prefix, which the decoder must drop before testing the leading NUL.
        expect(decodeCue(tx3gSample(encodeEprance(plain, 0x11)))).toBe(plain);
    });

    it("E-PRANCE: the RawGSensor prefix is split off, not glued to the sentence", () => {
        // Upstream splits the deciphered cue on /^(.*?)(\$[A-Z]{2}RMC.*)/s and
        // keeps only the sentence as text; the prefix is milli-g accel, and TABs
        // are mapped to spaces before it is split (QuickTimeStream.pl:1495-1498).
        const sentence = "$GPRMC,082138,A,5330.6683,N,00641.9749,W,012.5,87.86,050213,,,A*59";
        const cue = tx3gSample(encodeEprance(`12\t-5\t980\t${sentence}`, 0x07));
        expect(decodeCue(cue)).toBe(`12 -5 980;${sentence}`);
    });

    it("E-PRANCE: the RawGSensor prefix parses as milli-g", () => {
        expect(parseEpranceAccel("12 -5 980")).toEqual({ x: 0.012, y: -0.005, z: 0.98 });
        expect(parseEpranceAccel("12  -5   980")).toEqual({ x: 0.012, y: -0.005, z: 0.98 });
        expect(parseEpranceAccel("12 -5")).toBeNull(); // two axes
        expect(parseEpranceAccel("12 -5 980 3")).toBeNull(); // four fields
        expect(parseEpranceAccel("X0000.2340Y-000.0720Z0000.9900G0001.0400")).toBeNull();
        expect(parseEpranceAccel("$GPRMC,082138,A,5330.6683,N")).toBeNull();
    });

    it("E-PRANCE: a NUL-led cue that deciphers to non-telemetry is left alone", () => {
        // The gate is pure shape (leading NUL + trailing newline), so the
        // self-check is what keeps an unrelated cue from being mangled: the
        // bytes must survive verbatim, not come back shifted.
        const cue = new Uint8Array([0x00, 0x41, 0x42, 0x43, 0x44, 0x45, 0x0a]);
        expect(decodeCue(cue)).toBe("\u0000ABCDE\n");
    });

    it("E-PRANCE: an ordinary LF-terminated NMEA cue is not claimed as ciphertext", () => {
        // Every tx3g cue under 256 bytes starts with a 0x00 length-prefix high
        // byte, and an LF-terminated NMEA cue has its checksum '*' exactly where
        // the cipher key is read - testing the raw sample would hijack it.
        const plain = "$GPRMC,062502.00,A,4137.12345,N,00204.54321,E,10.0,90.0,190419,,,A*4E\n";
        expect(decodeCue(tx3gSample(plain))).toBe(plain);
        const crlf = plain.replace("\n", "\r\n");
        expect(decodeCue(tx3gSample(crlf))).toBe(crlf);
    });
});

describe("plain NMEA cues survive the ciphered-dialect gates", () => {
    const PLAIN_CUES = [
        "$GPRMC,062502.00,A,4137.12345,N,00204.54321,E,10.0,90.0,190419,,,A*4E\n",
        "$GPRMC,062503.00,A,4137.12400,N,00204.54400,E,10.0,90.0,190419,,,A*4E\n",
    ];

    it("an LF-terminated tx3g track still yields records", async () => {
        const { vf, index } = await loadMini0806(PLAIN_CUES, "PLAIN.MP4");
        expect(await nmeaSubtitlePrimitive.marker(vf, index)).toBe(true);

        const result = await nmeaSubtitlePrimitive.parse(vf, index);
        expect(result.records).toHaveLength(2);
        expect(result.records[0]!.lat).toBeCloseTo(41.618724, 5);
        expect(result.records[0]!.lon).toBeCloseTo(2.07572, 5);
        expect(result.records[0]!.speedMs).toBeCloseTo(10 * KNOTS_TO_MS, 5);
    });

    it("a CRLF-terminated tx3g track still yields records", async () => {
        const { vf, index } = await loadMini0806(
            PLAIN_CUES.map((c) => c.replace("\n", "\r\n")),
            "PLAIN.MP4",
        );
        const result = await nmeaSubtitlePrimitive.parse(vf, index);
        expect(result.records).toHaveLength(2);
    });
});

describe("synthetic E-PRANCE MP4 (in-memory, ExifTool-derived cues)", () => {
    const SENTENCES = [
        "$GPRMC,082138,A,5330.6683,N,00641.9749,W,012.5,87.86,050213,,,A*59",
        "$GPRMC,082139,A,5330.6700,N,00641.9800,W,013.5,87.86,050213,,,A*59",
    ];
    // milli-g triples ahead of the sentence, gravity-included (Z ~ 1 g). The
    // tx3g length prefix is added by the container builder, as in a real file.
    const cue = (i: number, accel: string): Uint8Array => encodeEprance(`${accel}\t${SENTENCES[i]!}`, 0x07);

    it("marker fires through the cipher; records and accel decode", async () => {
        const { vf, index } = await loadMini0806([cue(0, "12\t-5\t980"), cue(1, "22\t-5\t990")], "EPRANCE.MP4");
        expect(await nmeaSubtitlePrimitive.marker(vf, index)).toBe(true);

        const result = await nmeaSubtitlePrimitive.parse(vf, index);
        expect(result.records).toHaveLength(2);
        const r0 = result.records[0]!;
        expect(r0.lat).toBeCloseTo(53.511138, 5);
        expect(r0.lon).toBeCloseTo(-6.699582, 5);
        expect(r0.unixSeconds).toBe(Date.UTC(2013, 1, 5, 8, 21, 38) / 1000);
        expect(r0.speedMs).toBeCloseTo(12.5 * KNOTS_TO_MS, 5);

        // The prefix is gravity-included milli-g, so the per-file baseline must
        // leave the axes centred at 0 while keeping the inter-cue delta.
        for (const axis of ["accelXg", "accelYg", "accelZg"] as const) {
            const mean = result.records.reduce((acc, r) => acc + r[axis], 0) / result.records.length;
            expect(Math.abs(mean)).toBeLessThan(1e-9);
        }
        expect(result.records[1]!.accelXg - r0.accelXg).toBeCloseTo(0.01, 9);
        expect(result.records[1]!.accelZg - r0.accelZg).toBeCloseTo(0.01, 9);
        for (const r of result.records) expect(magnitude(r)).toBeLessThan(0.5);
    });

    it("single-cue file zeroes the gravity-included accel (<2 baseline samples)", async () => {
        const { vf, index } = await loadMini0806([cue(0, "12\t-5\t980")], "EPRANCE.MP4");
        const result = await nmeaSubtitlePrimitive.parse(vf, index);
        expect(result.records).toHaveLength(1);
        expect(magnitude(result.records[0]!)).toBe(0);
        expect(result.records[0]!.lat).toBeCloseTo(53.511138, 5);
    });
});

describe("synthetic Roadhawk MP4 (in-memory, ExifTool-derived cues)", () => {
    /** Re-encodes a plain cue with the Roadhawk table so the fixture is built
     *  the way the camera writes it, not the way we read it. */
    function encodeRoadhawk(plain: string): string {
        const table = "-I8XQWRVNZOYPUTA0B1C2SJ9K.L,M$D3E4F5G6H7";
        let out = "";
        for (const ch of plain) {
            const idx = table.indexOf(ch);
            out += idx >= 0 ? String.fromCharCode(idx + 43) : ch;
        }
        // Trailer the gate keys on; its two hex digits are not validated.
        return `${out}*6F~`;
    }

    const CUES = [
        encodeRoadhawk(
            "X0000.2340Y-000.0720Z0000.9900G0001.0400$GPRMC,082138,A,5330.6683,N,00641.9749,W,012.5,87.86,050213,,,A",
        ),
        encodeRoadhawk(
            "X0000.2440Y-000.0620Z0000.9800G0001.0400$GPRMC,082139,A,5330.6700,N,00641.9800,W,013.5,87.86,050213,,,A",
        ),
    ];

    it("marker fires through the descrambler and records decode", async () => {
        const { vf, index } = await loadMini0806(CUES, "ROADHAWK.MP4");
        expect(await nmeaSubtitlePrimitive.marker(vf, index)).toBe(true);

        const result = await nmeaSubtitlePrimitive.parse(vf, index);
        expect(result.records).toHaveLength(2);
        const r0 = result.records[0]!;
        expect(r0.lat).toBeCloseTo(53.511138, 5);
        expect(r0.lon).toBeCloseTo(-6.699582, 5);
        expect(r0.unixSeconds).toBe(Date.UTC(2013, 1, 5, 8, 21, 38) / 1000);
        expect(r0.speedMs).toBeCloseTo(12.5 * KNOTS_TO_MS, 5);

        // Accel rides the same cue and is gravity-included, so the per-file
        // baseline must leave the vertical axis centred near 0 rather than 1g.
        const meanZ = result.records.reduce((s, r) => s + r.accelZg, 0) / result.records.length;
        expect(Math.abs(meanZ)).toBeLessThan(0.01);
        // The dynamic delta between the two cues survives that centring.
        expect(result.records[1]!.accelZg - result.records[0]!.accelZg).toBeCloseTo(-0.01, 6);
    });

    it("single-cue file zeroes the gravity-included accel (<2 baseline samples)", async () => {
        const { vf, index } = await loadMini0806([CUES[0]!], "ROADHAWK.MP4");
        const result = await nmeaSubtitlePrimitive.parse(vf, index);
        expect(result.records).toHaveLength(1);
        // One sample cannot separate the ~1g gravity vector from motion; keeping
        // the raw Z=0.99 would fire the impact detector on the only record.
        expect(magnitude(result.records[0]!)).toBe(0);
        expect(result.records[0]!.lat).toBeCloseTo(53.511138, 5);
    });
});
