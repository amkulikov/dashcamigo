// Tests for the SStar 40-byte ssmd GPS extractor: unit decode, fixture-driven
// marker+parse (synthetic fixtures built by __fixtures__/sstar-ssmd/
// build-synthetic.mjs), the filename date-anchor with month/year rollover,
// and the disjointness matrix against the other ssmd dwellers (Rove 32-byte,
// LigoGPS, the 12-byte accel sibling track).

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildMp4Index } from "../internal/mp4-index.js";
import {
    classifySstarFlagsWord,
    decodeSstarSsmdRow,
    findSstarSsmdTrack,
    hasSstarNoFixSentinel,
    localDateAnchorMsFromFilename,
    localNaiveSecondsFromNeolineFilename,
    looksLikeSstarSsmdSample,
    SSTAR_FLAGS_FIX,
    SSTAR_FLAGS_NO_FIX,
    SSTAR_SSMD_SAMPLE_SIZE,
    utcMsFromAnchoredDayTime,
} from "../internal/sstar-ssmd-extract.js";
import { WrongFormatError } from "../types.js";
import { ligoGpsPrimitive } from "./ligogps.js";
import { roveSsmdPrimitive } from "./rove-ssmd.js";
import { sstarSsmdPrimitive } from "./sstar-ssmd.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../..");
const FIXTURES = resolve(HERE, "../__fixtures__/sstar-ssmd");

// ---------------------------------------------------------------------------
// Byte builders (field map per internal/sstar-ssmd-extract.ts)

function fixSample(opts: {
    lat: number;
    lon: number;
    speedKmh?: number;
    courseDeg?: number;
    day?: number;
    hour?: number;
    min?: number;
    sec?: number;
    /** Flags word override - the 4K-cam variant writes base 0x067E. */
    flags?: number;
}): Buffer {
    const b = Buffer.alloc(SSTAR_SSMD_SAMPLE_SIZE);
    b.writeDoubleLE(opts.lat, 0);
    b.writeDoubleLE(opts.lon, 8);
    b.writeInt32LE(300, 16); // altitude-like word, not extracted
    b.writeUInt16LE(opts.speedKmh ?? 20, 20);
    b.writeUInt16LE(opts.flags ?? SSTAR_FLAGS_FIX, 22);
    b.writeUInt8(opts.day ?? 15, 24);
    b.writeUInt8(opts.hour ?? 17, 25);
    b.writeUInt8(opts.min ?? 39, 26);
    b.writeUInt8(opts.sec ?? 51, 27);
    b.writeUInt8((opts.courseDeg ?? 128) / 2, 28);
    Buffer.from([0x01, 0x01, 0x00]).copy(b, 29);
    b.writeUInt32LE(1, 32);
    return b;
}

function noFixSample(flags: number = SSTAR_FLAGS_NO_FIX): Buffer {
    const b = Buffer.alloc(SSTAR_SSMD_SAMPLE_SIZE);
    const sentinel = Buffer.from([0x00, 0x00, 0xe0, 0xff, 0xff, 0xff, 0xef, 0x41]);
    sentinel.copy(b, 0);
    sentinel.copy(b, 8);
    b.writeInt32LE(-1, 16);
    b.writeUInt16LE(0xffff, 20);
    b.writeUInt16LE(flags, 22);
    // local-RTC time bytes - the extractor must never read them
    Buffer.from([15, 20, 39, 50]).copy(b, 24);
    Buffer.from([0xff, 0x00, 0xff, 0xff]).copy(b, 28);
    b.writeUInt32LE(1, 32);
    return b;
}

function dv(buf: Buffer): DataView {
    // Standalone copy: Buffer.alloc may pool, so wrap the exact byte range.
    return new DataView(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}

// Minimal MP4 for negative shapes only (accel sibling, mixed sizes, wrong
// handler/format); the positive paths load the committed fixtures. Same
// skeleton as __fixtures__/sstar-ssmd/build-synthetic.mjs.
function buildMp4(samples: Buffer[], opts: { handler?: string; format?: string } = {}): Buffer {
    const handler = opts.handler ?? "meta";
    const format = opts.format ?? "ssmd";
    const n = samples.length;

    const fourCC = (s: string) => Buffer.from(s, "ascii");
    const u32be = (v: number) => {
        const b = Buffer.alloc(4);
        b.writeUInt32BE(v, 0);
        return b;
    };
    const box = (type: string, payload: Buffer) => {
        const head = Buffer.alloc(8);
        head.writeUInt32BE(8 + payload.length, 0);
        fourCC(type).copy(head, 4);
        return Buffer.concat([head, payload]);
    };

    const mvhd = (() => {
        const p = Buffer.alloc(108);
        p.writeUInt32BE(1000, 12);
        p.writeUInt32BE(n * 1000, 16);
        return box("mvhd", p);
    })();
    const hdlr = (() => {
        const p = Buffer.alloc(33);
        fourCC(handler).copy(p, 8);
        return box("hdlr", p);
    })();
    const mdhd = (() => {
        const p = Buffer.alloc(24);
        p.writeUInt32BE(1000, 12);
        p.writeUInt32BE(n * 1000, 16);
        return box("mdhd", p);
    })();
    const stsd = (() => {
        const entry = Buffer.alloc(16);
        entry.writeUInt32BE(16, 0);
        fourCC(format).copy(entry, 4);
        return box("stsd", Buffer.concat([Buffer.alloc(4), u32be(1), entry]));
    })();
    const stts = box("stts", Buffer.concat([Buffer.alloc(4), u32be(1), u32be(n), u32be(1000)]));
    const stsc = box("stsc", Buffer.concat([Buffer.alloc(4), u32be(1), u32be(1), u32be(n), u32be(1)]));
    const stsz = box(
        "stsz",
        Buffer.concat([Buffer.alloc(4), u32be(0), u32be(n), ...samples.map((s) => u32be(s.length))]),
    );
    const stcoPlaceholder = box("stco", Buffer.concat([Buffer.alloc(4), u32be(1), u32be(0)]));
    const stbl = box("stbl", Buffer.concat([stsd, stts, stsc, stsz, stcoPlaceholder]));
    const minf = box("minf", stbl);
    const mdia = box("mdia", Buffer.concat([mdhd, hdlr, minf]));
    const tkhd = (() => {
        const p = Buffer.alloc(84);
        p.writeUInt32BE(7, 0);
        p.writeUInt32BE(1, 12);
        return box("tkhd", p);
    })();
    const trak = box("trak", Buffer.concat([tkhd, mdia]));
    const moov = box("moov", Buffer.concat([mvhd, trak]));
    const ftyp = box("ftyp", Buffer.concat([fourCC("isom"), u32be(512), fourCC("isom"), fourCC("mp41")]));
    const mdat = box("mdat", Buffer.concat(samples));

    const mdatPayloadOffset = ftyp.length + moov.length + 8;
    const stcoPos = moov.indexOf(stcoPlaceholder);
    const moovPatched = Buffer.from(moov);
    moovPatched.writeUInt32BE(mdatPayloadOffset, stcoPos + 8 + 4 + 4);

    return Buffer.concat([ftyp, moovPatched, mdat]);
}

async function loadBytes(bytes: Buffer, name: string) {
    const file = new File([new Uint8Array(bytes)], name);
    const vf = { file, relativePath: name };
    const index = await buildMp4Index(file);
    return { vf, index };
}

async function loadFixture(fixture: string, name: string) {
    return await loadBytes(readFileSync(resolve(FIXTURES, fixture)), name);
}

// ---------------------------------------------------------------------------

describe("localDateAnchorMsFromFilename", () => {
    it("extracts the YYYYMMDD run from the Neoline pattern", () => {
        expect(localDateAnchorMsFromFilename("INF20260520-214526-1-F.mp4")).toBe(Date.UTC(2026, 4, 20));
    });

    it("prefers the strict Neoline shape over a foreign date run in a renamed file", () => {
        // Generic scan alone would anchor on 2025-01-01 and poison every fix.
        expect(localDateAnchorMsFromFilename("backup-20250101 INF20260520-134803-14-F.mp4")).toBe(
            Date.UTC(2026, 4, 20),
        );
        // Without the Neoline tail the generic run is the only source left.
        expect(localDateAnchorMsFromFilename("backup-20250101.mp4")).toBe(Date.UTC(2025, 0, 1));
    });

    it("rejects names without a plausible date run", () => {
        expect(localDateAnchorMsFromFilename("video.mp4")).toBeNull();
        expect(localDateAnchorMsFromFilename("INF20261320-214526-1-F.mp4")).toBeNull(); // month 13
        expect(localDateAnchorMsFromFilename("INF20260532-214526-1-F.mp4")).toBeNull(); // day 32
    });
});

describe("utcMsFromAnchoredDayTime", () => {
    it("resolves same-day, month rollover and year rollover", () => {
        // same day
        expect(utcMsFromAnchoredDayTime(Date.UTC(2026, 4, 20), 20, 18, 45, 27)).toBe(Date.UTC(2026, 4, 20, 18, 45, 27));
        // local May 1st, record still on UTC April 30th
        expect(utcMsFromAnchoredDayTime(Date.UTC(2026, 4, 1), 30, 21, 0, 0)).toBe(Date.UTC(2026, 3, 30, 21, 0, 0));
        // local Jan 1st, record still on UTC Dec 31st of the previous year
        expect(utcMsFromAnchoredDayTime(Date.UTC(2026, 0, 1), 31, 23, 59, 59)).toBe(Date.UTC(2025, 11, 31, 23, 59, 59));
        // camera date behind UTC (west-of-Greenwich TZ): anchor Dec 31, record Jan 1
        expect(utcMsFromAnchoredDayTime(Date.UTC(2026, 11, 31), 1, 0, 30, 0)).toBe(Date.UTC(2027, 0, 1, 0, 30, 0));
        // leap February
        expect(utcMsFromAnchoredDayTime(Date.UTC(2024, 2, 1), 29, 22, 0, 0)).toBe(Date.UTC(2024, 1, 29, 22, 0, 0));
    });

    it("returns null when the record day matches no adjacent candidate", () => {
        expect(utcMsFromAnchoredDayTime(Date.UTC(2026, 4, 20), 15, 18, 45, 27)).toBeNull();
    });
});

// 4K-front-cam flags words: base 0x067E instead of the mirror cam's 0x047E,
// same 0x0100 fix bit.
const FLAGS_FIX_4K = 0x077e;
const FLAGS_NO_FIX_4K = 0x067e;

describe("classifySstarFlagsWord", () => {
    it("accepts both observed bases with and without the fix bit", () => {
        expect(classifySstarFlagsWord(SSTAR_FLAGS_FIX)).toBe("fix");
        expect(classifySstarFlagsWord(SSTAR_FLAGS_NO_FIX)).toBe("nofix");
        expect(classifySstarFlagsWord(FLAGS_FIX_4K)).toBe("fix");
        expect(classifySstarFlagsWord(FLAGS_NO_FIX_4K)).toBe("nofix");
    });

    it("rejects foreign words", () => {
        expect(classifySstarFlagsWord(0x0000)).toBeNull();
        expect(classifySstarFlagsWord(0xffff)).toBeNull();
        expect(classifySstarFlagsWord(0x027e)).toBeNull(); // unobserved base
        expect(classifySstarFlagsWord(0x047f)).toBeNull(); // low bit off-pattern
        expect(classifySstarFlagsWord(0x326f)).toBeNull(); // arbitrary junk
    });
});

describe("decodeSstarSsmdRow", () => {
    it("decodes coordinates, km/h speed and the /2 course byte", () => {
        const fix = decodeSstarSsmdRow(dv(fixSample({ lat: 50.0, lon: 30.0, speedKmh: 108, courseDeg: 76 })));
        expect(fix).not.toBeNull();
        expect(fix).not.toBe("nofix");
        if (fix === null || fix === "nofix") return;
        expect(fix.lat).toBeCloseTo(50.0, 9);
        expect(fix.lon).toBeCloseTo(30.0, 9);
        expect(fix.speedMs).toBeCloseTo(30, 6); // 108 km/h
        expect(fix.bearingDeg).toBe(76);
        expect(fix.day).toBe(15);
        expect(fix.hour).toBe(17);
    });

    it("treats 0xFFFF speed on a fix row as unknown, not a reject", () => {
        const fix = decodeSstarSsmdRow(dv(fixSample({ lat: 50.0, lon: 30.0, speedKmh: 0xffff })));
        expect(fix).not.toBeNull();
        expect(fix).not.toBe("nofix");
        if (fix === null || fix === "nofix") return;
        expect(fix.speedMs).toBe(0);
    });

    it("decodes the 4K-cam flags base the same way", () => {
        const fix = decodeSstarSsmdRow(dv(fixSample({ lat: 50.0, lon: 30.0, speedKmh: 54, flags: FLAGS_FIX_4K })));
        expect(fix).not.toBeNull();
        expect(fix).not.toBe("nofix");
        if (fix === null || fix === "nofix") return;
        expect(fix.lat).toBeCloseTo(50.0, 9);
        expect(fix.speedMs).toBeCloseTo(15, 6); // 54 km/h
        expect(decodeSstarSsmdRow(dv(noFixSample(FLAGS_NO_FIX_4K)))).toBe("nofix");
    });

    it('returns "nofix" for a no-fix row and null for implausible rows', () => {
        expect(decodeSstarSsmdRow(dv(noFixSample()))).toBe("nofix");
        expect(decodeSstarSsmdRow(dv(fixSample({ lat: 0, lon: 0 })))).toBeNull(); // empty fix
        expect(decodeSstarSsmdRow(dv(fixSample({ lat: 95, lon: 30 })))).toBeNull();
        expect(decodeSstarSsmdRow(dv(fixSample({ lat: 50, lon: 181 })))).toBeNull();
        expect(decodeSstarSsmdRow(dv(fixSample({ lat: Number.NaN, lon: 30 })))).toBeNull();
        expect(decodeSstarSsmdRow(dv(fixSample({ lat: 50, lon: 30, hour: 24 })))).toBeNull();
        expect(decodeSstarSsmdRow(dv(fixSample({ lat: 50, lon: 30, day: 0 })))).toBeNull();
        expect(decodeSstarSsmdRow(new DataView(new ArrayBuffer(12)))).toBeNull();
    });
});

describe("looksLikeSstarSsmdSample", () => {
    it("accepts a coherent no-fix row and a plausible fix", () => {
        expect(looksLikeSstarSsmdSample(dv(noFixSample()))).toBe(true);
        expect(hasSstarNoFixSentinel(dv(noFixSample()))).toBe(true);
        expect(looksLikeSstarSsmdSample(dv(fixSample({ lat: 50, lon: 30 })))).toBe(true);
    });

    it("accepts the 4K-cam flags base", () => {
        expect(looksLikeSstarSsmdSample(dv(noFixSample(FLAGS_NO_FIX_4K)))).toBe(true);
        expect(looksLikeSstarSsmdSample(dv(fixSample({ lat: 50, lon: 30, flags: FLAGS_FIX_4K })))).toBe(true);
    });

    it("rejects rows without the constant flags word or with incoherent content", () => {
        expect(looksLikeSstarSsmdSample(new DataView(new ArrayBuffer(SSTAR_SSMD_SAMPLE_SIZE)))).toBe(false);
        const ascii = Buffer.alloc(SSTAR_SSMD_SAMPLE_SIZE);
        Buffer.from("LIGOGPSINFO 2026-03-15 17:39:51 junk....", "ascii").copy(ascii, 0);
        expect(looksLikeSstarSsmdSample(dv(ascii))).toBe(false);
        // fix flags but out-of-range coordinates
        expect(looksLikeSstarSsmdSample(dv(fixSample({ lat: 95, lon: 30 })))).toBe(false);
        // no-fix flags but no sentinel
        const halfBaked = fixSample({ lat: 50, lon: 30 });
        halfBaked.writeUInt16LE(SSTAR_FLAGS_NO_FIX, 22);
        expect(looksLikeSstarSsmdSample(dv(halfBaked))).toBe(false);
        // wrong size
        expect(looksLikeSstarSsmdSample(new DataView(new ArrayBuffer(32)))).toBe(false);
    });
});

describe("sstar-ssmd primitive on the synthetic-happy fixture", () => {
    // Camera-local date 2026-03-15 (UTC+3 camera; fixes carry UTC 17:39).
    const NAME = "INF20260315-203950-7-F.mp4";

    it("marker fires (first sample is a coherent no-fix row)", async () => {
        const { vf, index } = await loadFixture("synthetic-happy.mp4", NAME);
        expect(findSstarSsmdTrack(index)).not.toBeNull();
        expect(await sstarSsmdPrimitive.marker(vf, index)).toBe(true);
    });

    it("parse skips the no-fix lead-in silently and anchors UTC to the filename date", async () => {
        const { vf, index } = await loadFixture("synthetic-happy.mp4", NAME);
        const result = await sstarSsmdPrimitive.parse(vf, index);
        expect(result.records).toHaveLength(5);
        expect(result.skipped).toHaveLength(0);

        const r0 = result.records[0]!;
        expect(r0.lat).toBeCloseTo(50.0, 9);
        expect(r0.lon).toBeCloseTo(30.0, 9);
        expect(r0.unixSeconds).toBe(Date.UTC(2026, 2, 15, 17, 39, 51) / 1000);
        expect(r0.timeUnsynced).toBeUndefined();
        expect(r0.speedMs).toBeCloseTo(20 / 3.6, 6);
        expect(r0.bearingDeg).toBe(76);
        expect(r0.active).toBe(true);
        expect(r0.mp4Filename).toBe(NAME);

        // videoStartUtcHint ties frame 0 to wall-clock: first emitted fix is
        // sample 1 (media time 1 s), so frame 0 = 17:39:51 - 1 s = 17:39:50.
        expect(result.videoStartUtcHint).toBe(Date.UTC(2026, 2, 15, 17, 39, 50) / 1000);

        // 1 Hz pacing straight from the record clock.
        expect(result.records[4]!.unixSeconds - r0.unixSeconds).toBe(4);
        // Course 0 = "not updated by the firmware" - carries the previous
        // record's bearing forward instead of snapping to due north.
        expect(result.records[3]!.bearingDeg).toBe(78);
        expect(result.records[4]!.bearingDeg).toBe(78);
    });

    it("falls back to timeUnsynced + media-time pacing when the name has no date", async () => {
        // mvhd creation_time is 0 in the fixture (like the real firmware), so
        // a dateless name leaves no anchor at all.
        const { vf, index } = await loadFixture("synthetic-happy.mp4", "video.mp4");
        const result = await sstarSsmdPrimitive.parse(vf, index);
        expect(result.records).toHaveLength(5);
        for (const r of result.records) expect(r.timeUnsynced).toBe(true);
        // Samples 1..5 of the 1 Hz track (sample 0 is the no-fix lead-in).
        expect(result.records.map((r) => r.relStartSeconds)).toEqual([1, 2, 3, 4, 5]);
        // No wall-clock anchor on the unsynced path - no frame-0 hint to emit.
        expect(result.videoStartUtcHint).toBeUndefined();
    });

    it("anchors on the strict Neoline tail of a renamed file, not the foreign date run", async () => {
        // The generic scan would pick 2025-01-01, whose day-of-month happens
        // to match nothing - the strict suffix must win and give synced UTC.
        const { vf, index } = await loadFixture("synthetic-happy.mp4", "backup-20250101 INF20260315-203950-7-F.mp4");
        const result = await sstarSsmdPrimitive.parse(vf, index);
        expect(result.records).toHaveLength(5);
        expect(result.skipped).toHaveLength(0);
        expect(result.records[0]!.unixSeconds).toBe(Date.UTC(2026, 2, 15, 17, 39, 51) / 1000);
        expect(result.records[0]!.timeUnsynced).toBeUndefined();
    });

    it("treats an anchor no fix row matches as untrusted and falls back to timeUnsynced", async () => {
        // Foreign date run only (day 1 vs record day 15): the anchor matches no
        // fix row, so it is discarded and the media-time fallback keeps the
        // track instead of dropping every record.
        const { vf, index } = await loadFixture("synthetic-happy.mp4", "backup-20250101.mp4");
        const result = await sstarSsmdPrimitive.parse(vf, index);
        expect(result.records).toHaveLength(5);
        expect(result.skipped).toHaveLength(0);
        for (const r of result.records) expect(r.timeUnsynced).toBe(true);
        expect(result.records.map((r) => r.relStartSeconds)).toEqual([1, 2, 3, 4, 5]);
    });
});

describe("sstar-ssmd primitive on the synthetic-edge fixture", () => {
    // Local anchor date 2026-03-01; fix rows carry UTC day 28 (Feb 28 - month
    // rollover through the anchor-1 candidate).
    const NAME = "INF20260301-001005-2-F.mp4";

    it("handles month rollover, bad day bytes, 0xFFFF speed, out-of-range lat", async () => {
        const { vf, index } = await loadFixture("synthetic-edge.mp4", NAME);
        expect(await sstarSsmdPrimitive.marker(vf, index)).toBe(true);

        const result = await sstarSsmdPrimitive.parse(vf, index);
        // Samples: [0] no-fix, [1,2] day-28 fixes, [3] day-15 fix (no anchor
        // candidate), [4] 0xFFFF-speed fix, [5] lat 95.
        expect(result.records).toHaveLength(3);
        expect(result.records[0]!.unixSeconds).toBe(Date.UTC(2026, 1, 28, 21, 10, 5) / 1000);
        expect(result.records[2]!.unixSeconds).toBe(Date.UTC(2026, 1, 28, 21, 10, 8) / 1000);
        expect(result.records[2]!.speedMs).toBe(0); // 0xFFFF -> unknown

        expect(result.skipped).toHaveLength(2);
        expect(result.skipped[0]!.line).toBe(4);
        expect(result.skipped[0]!.reason).toContain("date anchor");
        expect(result.skipped[1]!.line).toBe(6);
        expect(result.skipped[1]!.reason).toContain("implausible");
    });
});

describe("sstar-ssmd 4K-cam flags base end-to-end", () => {
    const NAME = "INF20260315-203950-7-F.mp4";

    it("marker fires on a 0x067E-base track and parse anchors as usual", async () => {
        const { vf, index } = await loadBytes(
            buildMp4([
                noFixSample(FLAGS_NO_FIX_4K),
                fixSample({ lat: 50.0, lon: 30.0, day: 15, hour: 17, min: 39, sec: 51, flags: FLAGS_FIX_4K }),
                fixSample({ lat: 50.0001, lon: 30.0001, day: 15, hour: 17, min: 39, sec: 52, flags: FLAGS_FIX_4K }),
                fixSample({ lat: 50.0002, lon: 30.0002, day: 15, hour: 17, min: 39, sec: 53, flags: FLAGS_FIX_4K }),
            ]),
            NAME,
        );
        expect(await sstarSsmdPrimitive.marker(vf, index)).toBe(true);
        const result = await sstarSsmdPrimitive.parse(vf, index);
        expect(result.records).toHaveLength(3);
        expect(result.skipped).toHaveLength(0);
        expect(result.records[0]!.unixSeconds).toBe(Date.UTC(2026, 2, 15, 17, 39, 51) / 1000);
        expect(result.records[0]!.timeUnsynced).toBeUndefined();
    });
});

describe("sstar-ssmd cold-start pre-sync prefix", () => {
    const NAME = "INF20260315-203950-7-F.mp4";
    // Two pre-sync rows ~95 s ahead of truth, then the clock locks and steps
    // backward - the shape observed on the real cold-start clip.
    const coldStartRows = [
        fixSample({ lat: 50.2, lon: 30.2, day: 15, hour: 17, min: 41, sec: 26 }),
        fixSample({ lat: 50.2001, lon: 30.2001, day: 15, hour: 17, min: 41, sec: 27 }),
        fixSample({ lat: 50.0, lon: 30.0, day: 15, hour: 17, min: 39, sec: 53 }),
        fixSample({ lat: 50.0001, lon: 30.0001, day: 15, hour: 17, min: 39, sec: 54 }),
        fixSample({ lat: 50.0002, lon: 30.0002, day: 15, hour: 17, min: 39, sec: 55 }),
    ];

    it("drops the pre-sync prefix before the backward clock jump (anchored path)", async () => {
        const { vf, index } = await loadBytes(buildMp4(coldStartRows), NAME);
        const result = await sstarSsmdPrimitive.parse(vf, index);

        expect(result.records).toHaveLength(3);
        expect(result.records[0]!.unixSeconds).toBe(Date.UTC(2026, 2, 15, 17, 39, 53) / 1000);
        expect(result.records[0]!.lat).toBeCloseTo(50.0, 9);

        // The hint anchors on the first EMITTED fix (sample 2, media time 2 s),
        // not the dropped cold-start prefix: frame 0 = 17:39:53 - 2 s = 17:39:51.
        expect(result.videoStartUtcHint).toBe(Date.UTC(2026, 2, 15, 17, 39, 51) / 1000);

        expect(result.skipped).toHaveLength(2);
        expect(result.skipped.map((s) => s.line)).toEqual([1, 2]);
        for (const s of result.skipped) expect(s.reason).toContain("cold-start");
    });

    it("drops the pre-sync prefix on the timeUnsynced path too", async () => {
        const { vf, index } = await loadBytes(buildMp4(coldStartRows), "video.mp4");
        const result = await sstarSsmdPrimitive.parse(vf, index);

        expect(result.records).toHaveLength(3);
        for (const r of result.records) expect(r.timeUnsynced).toBe(true);
        // Kept rows are samples 3..5 of the 1 Hz track.
        expect(result.records.map((r) => r.relStartSeconds)).toEqual([2, 3, 4]);
        expect(result.skipped).toHaveLength(2);
        for (const s of result.skipped) expect(s.reason).toContain("cold-start");
    });

    it("keeps small backward jitter - only jumps above the threshold cut", async () => {
        const { vf, index } = await loadBytes(
            buildMp4([
                fixSample({ lat: 50.0, lon: 30.0, day: 15, hour: 17, min: 39, sec: 51 }),
                fixSample({ lat: 50.0001, lon: 30.0001, day: 15, hour: 17, min: 39, sec: 53 }),
                fixSample({ lat: 50.0002, lon: 30.0002, day: 15, hour: 17, min: 39, sec: 52 }),
                fixSample({ lat: 50.0003, lon: 30.0003, day: 15, hour: 17, min: 39, sec: 54 }),
            ]),
            NAME,
        );
        const result = await sstarSsmdPrimitive.parse(vf, index);
        expect(result.records).toHaveLength(4);
        expect(result.skipped).toHaveLength(0);
    });
});

describe("localNaiveSecondsFromNeolineFilename", () => {
    it("extracts the full local time from the strict Neoline shape (suffix match)", () => {
        expect(localNaiveSecondsFromNeolineFilename("INF20260520-134803-14-F.mp4")).toBe(
            Date.UTC(2026, 4, 20, 13, 48, 3) / 1000,
        );
        expect(localNaiveSecondsFromNeolineFilename("backup INF20260520-134803-14-F.mp4")).toBe(
            Date.UTC(2026, 4, 20, 13, 48, 3) / 1000,
        );
    });

    it("rejects non-Neoline names and implausible time fields", () => {
        expect(localNaiveSecondsFromNeolineFilename("video.mp4")).toBeNull();
        expect(localNaiveSecondsFromNeolineFilename("trip 20260315 dump.mp4")).toBeNull();
        expect(localNaiveSecondsFromNeolineFilename("INF20260520-250000-1-F.mp4")).toBeNull(); // hour 25
    });
});

describe("sstar-ssmd stale-clock gate", () => {
    const NAME = "INF20260315-203950-7-F.mp4"; // camera RTC 20:39:50, true TZ +3h

    it("demotes every fix to timeUnsynced when the GPS clock disagrees with the filename off the TZ grid", async () => {
        // Clock ~110 s behind the RTC (observed on a real clip: ~104 s behind,
        // no resync in file): implied start 17:38:00-1 -> filename delta
        // 10911 s, 111 s off the 15-min grid.
        const { vf, index } = await loadBytes(
            buildMp4([
                noFixSample(),
                fixSample({ lat: 50.0, lon: 30.0, day: 15, hour: 17, min: 38, sec: 1 }),
                fixSample({ lat: 50.0001, lon: 30.0001, day: 15, hour: 17, min: 38, sec: 2 }),
                fixSample({ lat: 50.0002, lon: 30.0002, day: 15, hour: 17, min: 38, sec: 3 }),
            ]),
            NAME,
        );
        const result = await sstarSsmdPrimitive.parse(vf, index);
        expect(result.records).toHaveLength(3);
        for (const r of result.records) expect(r.timeUnsynced).toBe(true);
        // Positions and media offsets survive - only the absolute times go.
        expect(result.records.map((r) => r.relStartSeconds)).toEqual([1, 2, 3]);
        expect(result.records[0]!.lat).toBeCloseTo(50.0, 9);
        expect(result.videoStartUtcHint).toBeUndefined();
    });

    it("keeps a small RTC drift synced (on-grid within tolerance)", async () => {
        // 8 s drift between RTC and GPS clock - inside the 30 s gate.
        const { vf, index } = await loadBytes(
            buildMp4([
                fixSample({ lat: 50.0, lon: 30.0, day: 15, hour: 17, min: 39, sec: 58 }),
                fixSample({ lat: 50.0001, lon: 30.0001, day: 15, hour: 17, min: 39, sec: 59 }),
            ]),
            NAME,
        );
        const result = await sstarSsmdPrimitive.parse(vf, index);
        expect(result.records).toHaveLength(2);
        expect(result.records[0]!.timeUnsynced).toBeUndefined();
        expect(result.videoStartUtcHint).toBe(Date.UTC(2026, 2, 15, 17, 39, 58) / 1000);
    });

    it("drops the stale prefix on a mid-file forward resync and anchors on the tail", async () => {
        // Clock starts ~119 s behind, then locks: a forward step far beyond
        // the elapsed media time. The pre-resync rows are skipped, the tail
        // anchors, and the hint comes from the first post-resync fix.
        const { vf, index } = await loadBytes(
            buildMp4([
                fixSample({ lat: 50.0, lon: 30.0, day: 15, hour: 17, min: 38, sec: 0 }),
                fixSample({ lat: 50.0001, lon: 30.0001, day: 15, hour: 17, min: 38, sec: 1 }),
                fixSample({ lat: 50.0002, lon: 30.0002, day: 15, hour: 17, min: 40, sec: 0 }),
                fixSample({ lat: 50.0003, lon: 30.0003, day: 15, hour: 17, min: 40, sec: 1 }),
            ]),
            NAME,
        );
        const result = await sstarSsmdPrimitive.parse(vf, index);
        expect(result.records).toHaveLength(2);
        expect(result.records[0]!.unixSeconds).toBe(Date.UTC(2026, 2, 15, 17, 40, 0) / 1000);
        expect(result.records[0]!.timeUnsynced).toBeUndefined();
        // First emitted fix sits at media time 2 s -> frame 0 = 17:39:58.
        expect(result.videoStartUtcHint).toBe(Date.UTC(2026, 2, 15, 17, 39, 58) / 1000);
        expect(result.skipped).toHaveLength(2);
        for (const s of result.skipped) expect(s.reason).toContain("cold-start");
    });

    it("skips the gate when the name lacks the strict Neoline shape (generic date anchor)", async () => {
        // A renamed file with only a generic date run still anchors, and the
        // gate cannot run (no RTC time to compare against) - the GPS clock is
        // trusted as before.
        const { vf, index } = await loadBytes(
            buildMp4([
                fixSample({ lat: 50.0, lon: 30.0, day: 15, hour: 17, min: 38, sec: 1 }),
                fixSample({ lat: 50.0001, lon: 30.0001, day: 15, hour: 17, min: 38, sec: 2 }),
            ]),
            "trip 20260315 dump.mp4",
        );
        const result = await sstarSsmdPrimitive.parse(vf, index);
        expect(result.records).toHaveLength(2);
        expect(result.records[0]!.timeUnsynced).toBeUndefined();
        expect(result.records[0]!.unixSeconds).toBe(Date.UTC(2026, 2, 15, 17, 38, 1) / 1000);
    });
});

describe("sstar-ssmd phantom-track quality gate", () => {
    const NAME = "INF20260315-203950-7-F.mp4"; // camera RTC 20:39:50, true TZ +3h
    // Fix clock starts at 17:39:50 UTC (exactly filename - 3 h, so the
    // stale-clock gate stays out of the way) and advances with media time.
    const clockAt = (offsetSec: number) => {
        const total = 39 * 60 + 50 + offsetSec;
        return { min: Math.floor(total / 60), sec: total % 60 };
    };

    // Phantom shape distilled from the real night clips: heavy no-fix
    // interleave (weak signal) + fix rows whose recorded speed and position
    // movement contradict each other. Here the position is FROZEN while the
    // speed field claims 126 km/h - the inverse of the parked-car phantom,
    // same mismatch class.
    const phantomRows = (n: number): Buffer[] => {
        const rows: Buffer[] = [];
        for (let i = 0; i < n; i++) {
            const t = clockAt(i * 2); // fix at every even 1 Hz sample
            rows.push(fixSample({ lat: 50.0, lon: 30.0, speedKmh: 126, courseDeg: 90, min: t.min, sec: t.sec }));
            rows.push(noFixSample());
        }
        return rows;
    };

    it("drops every fix of a weak-signal file with speed/position mismatch, keeps the hint", async () => {
        const { vf, index } = await loadBytes(buildMp4(phantomRows(8)), NAME);
        const result = await sstarSsmdPrimitive.parse(vf, index);

        expect(result.records).toHaveLength(0);
        expect(result.skipped).toHaveLength(8);
        for (const s of result.skipped) expect(s.reason).toContain("phantom-track quality gate");
        // The clock survives the gate: first fix 17:39:50 UTC at media 0.
        expect(result.videoStartUtcHint).toBe(Date.UTC(2026, 2, 15, 17, 39, 50) / 1000);
    });

    it("does not fire on a clean-signal file even with the same mismatch", async () => {
        // Same contradictory rows but zero no-fix rows: the no-fix-share
        // conjunct keeps the gate out of clean-sky data.
        const rows = Array.from({ length: 8 }, (_, i) => {
            const t = clockAt(i);
            return fixSample({ lat: 50.0, lon: 30.0, speedKmh: 126, courseDeg: 90, min: t.min, sec: t.sec });
        });
        const { vf, index } = await loadBytes(buildMp4(rows), NAME);
        const result = await sstarSsmdPrimitive.parse(vf, index);
        expect(result.records).toHaveLength(8);
        expect(result.skipped).toHaveLength(0);
        expect(result.records[0]!.timeUnsynced).toBeUndefined();
    });

    it("does not fire on a weak-signal file whose fixes are internally consistent", async () => {
        // Sparse fixes but position movement matches the recorded speed
        // (0.0005 deg lat / 2 s = ~28 m/s = ~100 km/h): a genuine drive
        // through bad reception keeps its track.
        const rows: Buffer[] = [];
        for (let i = 0; i < 8; i++) {
            const t = clockAt(i * 2);
            rows.push(
                fixSample({ lat: 50.0 + i * 0.0005, lon: 30.0, speedKmh: 100, courseDeg: 0, min: t.min, sec: t.sec }),
            );
            rows.push(noFixSample());
        }
        const { vf, index } = await loadBytes(buildMp4(rows), NAME);
        const result = await sstarSsmdPrimitive.parse(vf, index);
        expect(result.records).toHaveLength(8);
        expect(result.skipped).toHaveLength(0);
    });

    it("emits no hint on the unsynced path even when gated", async () => {
        // Dateless name -> no anchor -> no real UTC. The gate still fires,
        // and with no hint the registry treats the parse as a non-claim.
        const { vf, index } = await loadBytes(buildMp4(phantomRows(8)), "video.mp4");
        const result = await sstarSsmdPrimitive.parse(vf, index);
        expect(result.records).toHaveLength(0);
        expect(result.videoStartUtcHint).toBeUndefined();
    });

    it("stays quiet below the pair floor", async () => {
        // 4 fixes = 3 pairs < PHANTOM_MIN_PAIRS: too little evidence, keep.
        const { vf, index } = await loadBytes(buildMp4(phantomRows(4)), NAME);
        const result = await sstarSsmdPrimitive.parse(vf, index);
        expect(result.records).toHaveLength(4);
    });
});

describe("sstar-ssmd stale-course forward fill", () => {
    it("carries the previous bearing over course-not-updated rows", async () => {
        const { vf, index } = await loadBytes(
            buildMp4([
                fixSample({ lat: 50.0, lon: 30.0, courseDeg: 0, sec: 50 }),
                fixSample({ lat: 50.0001, lon: 30.0001, courseDeg: 76, sec: 51 }),
                fixSample({ lat: 50.0002, lon: 30.0002, courseDeg: 0, sec: 52 }),
                fixSample({ lat: 50.0003, lon: 30.0003, courseDeg: 90, sec: 53 }),
            ]),
            "INF20260315-203950-7-F.mp4",
        );
        const result = await sstarSsmdPrimitive.parse(vf, index);
        // Leading 0 stays 0 (no prior bearing to carry).
        expect(result.records.map((r) => r.bearingDeg)).toEqual([0, 76, 76, 90]);
    });
});

describe("sstar-ssmd primitive rejections", () => {
    it("wrong-format fixture: marker false, parse throws WrongFormatError", async () => {
        const { vf, index } = await loadFixture("synthetic-wrong-format.mp4", "INF20260315-203950-7-F.mp4");
        expect(await sstarSsmdPrimitive.marker(vf, index)).toBe(false);
        await expect(sstarSsmdPrimitive.parse(vf, index)).rejects.toBeInstanceOf(WrongFormatError);
    });

    it("no Mp4Index: marker false, parse throws WrongFormatError", async () => {
        const { vf } = await loadFixture("synthetic-happy.mp4", "INF20260315-203950-7-F.mp4");
        expect(await sstarSsmdPrimitive.marker(vf)).toBe(false);
        await expect(sstarSsmdPrimitive.parse(vf)).rejects.toBeInstanceOf(WrongFormatError);
    });

    it("no-fix-only track parses to empty records (format matched, no GPS)", async () => {
        const { vf, index } = await loadBytes(
            buildMp4([noFixSample(), noFixSample(), noFixSample()]),
            "INF20260315-203950-7-F.mp4",
        );
        expect(await sstarSsmdPrimitive.marker(vf, index)).toBe(true);
        const result = await sstarSsmdPrimitive.parse(vf, index);
        expect(result.records).toHaveLength(0);
        expect(result.skipped).toHaveLength(0);
    });
});

describe("sstar-ssmd disjointness with the other ssmd dwellers", () => {
    it("does not claim the 12-byte accel sibling track or mixed sizes", async () => {
        const accel = Buffer.alloc(12);
        accel.writeUInt32LE(0x6a, 0);
        accel.writeUInt32LE(0x66, 4);
        accel.writeUInt32LE(0x27e, 8);
        const accelFile = await loadBytes(buildMp4([accel, accel, accel]), "INF20260315-203950-7-F.mp4");
        expect(findSstarSsmdTrack(accelFile.index)).toBeNull();
        expect(await sstarSsmdPrimitive.marker(accelFile.vf, accelFile.index)).toBe(false);

        const mixed = await loadBytes(
            buildMp4([fixSample({ lat: 50, lon: 30 }), Buffer.alloc(64)]),
            "INF20260315-203950-7-F.mp4",
        );
        expect(await sstarSsmdPrimitive.marker(mixed.vf, mixed.index)).toBe(false);
    });

    it("does not claim 40-byte tracks outside meta/ssmd", async () => {
        const sample = fixSample({ lat: 50, lon: 30 });
        const wrongFormat = await loadBytes(buildMp4([sample], { format: "gpmd" }), "INF20260315-203950-7-F.mp4");
        expect(await sstarSsmdPrimitive.marker(wrongFormat.vf, wrongFormat.index)).toBe(false);
        const wrongHandler = await loadBytes(buildMp4([sample], { handler: "sbtl" }), "INF20260315-203950-7-F.mp4");
        expect(await sstarSsmdPrimitive.marker(wrongHandler.vf, wrongHandler.index)).toBe(false);
    });

    it("does not claim the LigoGPS / CarCam / Rove-32 fixtures, and they do not claim ours", async () => {
        const ligo = await loadBytes(
            readFileSync(resolve(HERE, "../__fixtures__/ligogps/synthetic-ligogps.mp4")),
            "synthetic-ligogps.mp4",
        );
        expect(await sstarSsmdPrimitive.marker(ligo.vf, ligo.index)).toBe(false);

        const carcam = await loadBytes(
            readFileSync(resolve(REPO_ROOT, "tests/testdata/carcam-real-anonymized/carcam-4ch-front.mp4")),
            "REC20250607-180600-001-A.mp4",
        );
        expect(await sstarSsmdPrimitive.marker(carcam.vf, carcam.index)).toBe(false);

        // Cross-checks with the Rove 32-byte dialect: sizes keep the two
        // ssmd GPS gates disjoint in both directions.
        const happy = await loadFixture("synthetic-happy.mp4", "INF20260315-203950-7-F.mp4");
        expect(await roveSsmdPrimitive.marker(happy.vf, happy.index)).toBe(false);
        expect(await ligoGpsPrimitive.marker(happy.vf, happy.index)).toBe(false);

        const rove32 = Buffer.alloc(32);
        Buffer.from([0x00, 0x00, 0xe0, 0xff, 0xff, 0xff, 0xef, 0x41]).copy(rove32, 0);
        const roveFile = await loadBytes(buildMp4([rove32, rove32]), "REC_0001.MP4");
        expect(await sstarSsmdPrimitive.marker(roveFile.vf, roveFile.index)).toBe(false);
        expect(await roveSsmdPrimitive.marker(roveFile.vf, roveFile.index)).toBe(true);
    });
});
