// Tests for the Vueroid TXET primitive: marker gate (structural tvxt/mp4s +
// constant 72-byte samples), full parse on the synthetic fixtures (hemisphere
// combos, local-clock quarantine, media-time pacing, accel DC removal), and
// the WrongFormatError path on a structural look-alike with alien content.
// The real-anonymized end-to-end lives in
// __fixtures__/vueroid-txet/real-anonymized.test.ts.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { buildMp4Index, type Mp4Index } from "../internal/mp4-index.js";
import { WrongFormatError, type VendorFile } from "../types.js";
import { vueroidTxetPrimitive } from "./vueroid-txet.js";

const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), "../__fixtures__");

// Camera-local wall clock of the synthetic rows (2026-03-15T10:00:00 written
// as fake-UTC unix) - must round-trip into unixSeconds verbatim.
const BASE_LOCAL_UNIX = Date.UTC(2026, 2, 15, 10, 0, 0) / 1000;

function loadFixture(relPath: string, name: string): VendorFile {
    const buf = readFileSync(resolve(FIXTURES, relPath));
    const file = new File([buf], name);
    return { file, relativePath: name };
}

async function indexOf(vf: VendorFile): Promise<Mp4Index> {
    return await buildMp4Index(vf.file);
}

describe("vueroidTxetPrimitive.marker", () => {
    it("fires on the synthetic happy fixture (tvxt/mp4s, 72-byte samples)", async () => {
        const vf = loadFixture("vueroid-txet/synthetic-happy.mp4", "20260315_100000_INF_F_N.mp4");
        expect(await vueroidTxetPrimitive.marker(vf, await indexOf(vf))).toBe(true);
    });

    it("fires on the structural look-alike too - content is parse()'s job", async () => {
        const vf = loadFixture("vueroid-txet/synthetic-wrong-format.mp4", "20260315_100000_INF_F_N.mp4");
        expect(await vueroidTxetPrimitive.marker(vf, await indexOf(vf))).toBe(true);
    });

    it("does not fire without an index", async () => {
        const vf = loadFixture("vueroid-txet/synthetic-happy.mp4", "a.mp4");
        expect(await vueroidTxetPrimitive.marker(vf, undefined)).toBe(false);
    });

    it("does not fire on other subtitle/meta-track formats", async () => {
        // Garmin PNDM (text-track), Thinkware NMEA subtitle, RVMI data track -
        // none carries a 'tvxt' handler, the structural gate must stay quiet.
        for (const [rel, name] of [
            ["garmin/synthetic-pndm.mp4", "GRMN0001.MP4"],
            ["thinkware/synthetic-fseries.mp4", "REC_2025_01_01_10_00_00_F.MP4"],
            ["rvmi/sample.mp4", "sample.mp4"],
        ] as const) {
            const vf = loadFixture(rel, name);
            expect(await vueroidTxetPrimitive.marker(vf, await indexOf(vf)), rel).toBe(false);
        }
    });
});

describe("vueroidTxetPrimitive.parse - happy path", () => {
    it("decodes 5 fixes, skips the zeroed terminator row silently", async () => {
        const vf = loadFixture("vueroid-txet/synthetic-happy.mp4", "20260315_100000_INF_F_N.mp4");
        const result = await vueroidTxetPrimitive.parse(vf, await indexOf(vf));

        expect(result.records).toHaveLength(5);
        expect(result.skipped).toHaveLength(0);

        for (let i = 0; i < 5; i++) {
            const r = result.records[i]!;
            expect(r.lat, `record ${i} lat`).toBeCloseTo(50 + i * 0.0001, 4);
            expect(r.lon, `record ${i} lon`).toBeCloseTo(30 + i * 0.0001, 4);
            expect(r.speedMs, `record ${i} speed`).toBeCloseTo((27 + i) / 3.6, 5);
            expect(r.active).toBe(true);
            expect(r.bearingDeg).toBe(0);
            expect(r.mp4Filename).toBe("20260315_100000_INF_F_N.mp4");
            // Local clock quarantine: flagged unsynced, re-anchorable by the
            // media-time offset.
            expect(r.timeUnsynced).toBe(true);
            expect(r.relStartSeconds, `record ${i} relStart`).toBeCloseTo(i * 0.5, 6);
            // Pacing = first fix clock + media-time delta (500 ms spacing).
            expect(r.unixSeconds, `record ${i} unix`).toBeCloseTo(BASE_LOCAL_UNIX + i * 0.5, 6);
        }
    });

    it("removes the static accel component per file (DC-block)", async () => {
        const vf = loadFixture("vueroid-txet/synthetic-happy.mp4", "20260315_100000_INF_F_N.mp4");
        const result = await vueroidTxetPrimitive.parse(vf, await indexOf(vf));

        // Raw axis A is 0.55, 0.65, 0.6, 0.6, 0.6 (mean 0.6); axes B/C are
        // constant 0.0 / 0.2 - after mean subtraction only the wobble stays.
        const xs = result.records.map((r) => r.accelXg);
        expect(xs[0]).toBeCloseTo(-0.05, 5);
        expect(xs[1]).toBeCloseTo(0.05, 5);
        expect(xs[2]).toBeCloseTo(0, 5);
        for (const r of result.records) {
            expect(r.accelYg).toBeCloseTo(0, 5);
            expect(r.accelZg).toBeCloseTo(0, 5);
        }
    });
});

describe("vueroidTxetPrimitive.parse - edge fixture", () => {
    it("decodes all four hemisphere flag combos and skips implausible rows", async () => {
        const vf = loadFixture("vueroid-txet/synthetic-edge.mp4", "20260315_100000_INF_F_N.mp4");
        const result = await vueroidTxetPrimitive.parse(vf, await indexOf(vf));

        // Valid rows: N/W, S/E, S/W (happy covers N/E) plus the NaN-speed
        // row - garbage speed on an otherwise valid row degrades to 0, it
        // does not drop the coordinate. SINGLE-HEMISPHERE CORPUS ASSUMPTION
        // pinned here: flag 0x34 signs lat (1=N), flag 0x35 signs lon (1=E) -
        // see internal/vueroid-txet-extract.ts.
        expect(result.records).toHaveLength(4);
        const [nw, se, sw, nanSpeed] = result.records as [
            (typeof result.records)[0],
            (typeof result.records)[0],
            (typeof result.records)[0],
            (typeof result.records)[0],
        ];
        expect(nw.lat).toBeCloseTo(50.0, 4);
        expect(nw.lon).toBeCloseTo(-30.0, 4);
        expect(se.lat).toBeCloseTo(-50.0001, 4);
        expect(se.lon).toBeCloseTo(30.0001, 4);
        expect(sw.lat).toBeCloseTo(-50.0002, 4);
        expect(sw.lon).toBeCloseTo(-30.0002, 4);
        expect(nanSpeed.lat).toBeCloseTo(50.0, 4);
        expect(nanSpeed.speedMs).toBe(0); // NaN speed -> unknown, not a reject

        // Clock anchors at the FIRST fix row (tick 500), not media time 0:
        // the leading zeroed row must not shift the baseline.
        expect(nw.unixSeconds).toBeCloseTo(BASE_LOCAL_UNIX, 6);
        expect(se.unixSeconds).toBeCloseTo(BASE_LOCAL_UNIX + 0.5, 6);
        expect(nw.relStartSeconds).toBeCloseTo(0.5, 6);
        // NaN-speed row sits at sample 8 (tick 4000).
        expect(nanSpeed.unixSeconds).toBeCloseTo(BASE_LOCAL_UNIX + 3.5, 6);

        // Rows 4..7 and 9: minutes>=60, lon>180, flag byte 2, out-of-century
        // clock (per-row skip - the rest of the file has a working clock),
        // negative raw lat.
        expect(result.skipped).toHaveLength(5);
        const reasons = result.skipped.map((s) => s.reason);
        expect(reasons.filter((r) => r === "implausible vueroid txet record")).toHaveLength(4);
        expect(reasons.filter((r) => r === "camera clock outside the plausible range")).toHaveLength(1);
    });
});

// ---------------------------------------------------------------------------
// In-test builder for row-level scenarios the committed fixtures do not carry
// (dead-RTC, all-garbage-speed). Same skeleton and field map as
// __fixtures__/vueroid-txet/build-synthetic.mjs, minimal boxes only.

function degToDdmm(deg: number): number {
    const whole = Math.floor(deg);
    return whole * 100 + (deg - whole) * 60;
}

function txetRow(opts: {
    latDeg: number;
    lonDeg: number;
    speedKmh?: number;
    nanSpeed?: boolean;
    unix: number;
}): Buffer {
    const b = Buffer.alloc(72);
    b.writeFloatLE(0.6, 0x28);
    b.writeFloatLE(0.0, 0x2c);
    b.writeFloatLE(0.2, 0x30);
    b.writeUInt8(1, 0x34); // N
    b.writeUInt8(1, 0x35); // E
    b.writeUInt16LE(55, 0x36);
    if (opts.nanSpeed) b.writeUInt32LE(0x7fc00000, 0x38);
    else b.writeFloatLE(opts.speedKmh ?? 27, 0x38);
    b.writeFloatLE(degToDdmm(opts.latDeg), 0x3c);
    b.writeFloatLE(degToDdmm(opts.lonDeg), 0x40);
    b.writeUInt32LE(opts.unix, 0x44);
    return b;
}

function buildTxetMp4(samples: Buffer[], tickDeltaMs = 500): Buffer {
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
        p.writeUInt32BE(n * tickDeltaMs, 16);
        return box("mvhd", p);
    })();
    const hdlr = (() => {
        const p = Buffer.alloc(33);
        fourCC("tvxt").copy(p, 8);
        return box("hdlr", p);
    })();
    const mdhd = (() => {
        const p = Buffer.alloc(24);
        p.writeUInt32BE(1000, 12);
        p.writeUInt32BE(n * tickDeltaMs, 16);
        return box("mdhd", p);
    })();
    const stsd = (() => {
        const entry = Buffer.alloc(16);
        entry.writeUInt32BE(16, 0);
        fourCC("mp4s").copy(entry, 4);
        return box("stsd", Buffer.concat([Buffer.alloc(4), u32be(1), entry]));
    })();
    const stts = box("stts", Buffer.concat([Buffer.alloc(4), u32be(1), u32be(n), u32be(tickDeltaMs)]));
    const stsc = box("stsc", Buffer.concat([Buffer.alloc(4), u32be(1), u32be(1), u32be(n), u32be(1)]));
    const stsz = box("stsz", Buffer.concat([Buffer.alloc(4), u32be(72), u32be(n)]));
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

async function loadBytes(bytes: Buffer, name: string): Promise<{ vf: VendorFile; index: Mp4Index }> {
    const file = new File([new Uint8Array(bytes)], name);
    const vf = { file, relativePath: name };
    return { vf, index: await buildMp4Index(file) };
}

describe("vueroidTxetPrimitive.parse - battery-dead RTC fallback", () => {
    it("emits all rows timeUnsynced with media-time pacing when EVERY clock is implausible", async () => {
        // Clock byte 100 (1970) on every row - the dead-RTC scenario: kept as
        // timeUnsynced instead of failing the whole file as WrongFormatError.
        const { vf, index } = await loadBytes(
            buildTxetMp4([
                txetRow({ latDeg: 50.0, lonDeg: 30.0, speedKmh: 27, unix: 100 }),
                txetRow({ latDeg: 50.0001, lonDeg: 30.0001, speedKmh: 28, unix: 100 }),
                txetRow({ latDeg: 50.0002, lonDeg: 30.0002, speedKmh: 29, unix: 101 }),
            ]),
            "20260315_100000_INF_F_N.mp4",
        );
        const result = await vueroidTxetPrimitive.parse(vf, index);

        expect(result.records).toHaveLength(3);
        expect(result.skipped).toHaveLength(0);
        for (let i = 0; i < 3; i++) {
            const r = result.records[i]!;
            expect(r.timeUnsynced).toBe(true);
            expect(r.relStartSeconds).toBeCloseTo(i * 0.5, 6);
            // No wall-clock exists - media time is the only axis.
            expect(r.unixSeconds).toBeCloseTo(i * 0.5, 6);
            expect(r.speedMs).toBeCloseTo((27 + i) / 3.6, 5);
        }
    });

    it("still rejects a track where no row passes the full strict validation", async () => {
        // Valid clocks but garbage speed on EVERY row: the claiming gate
        // stays as strict as before the per-row speed leniency.
        const base = Date.UTC(2026, 2, 15, 10, 0, 0) / 1000;
        const { vf, index } = await loadBytes(
            buildTxetMp4([
                txetRow({ latDeg: 50.0, lonDeg: 30.0, nanSpeed: true, unix: base }),
                txetRow({ latDeg: 50.0001, lonDeg: 30.0001, nanSpeed: true, unix: base + 1 }),
            ]),
            "20260315_100000_INF_F_N.mp4",
        );
        await expect(vueroidTxetPrimitive.parse(vf, index)).rejects.toThrow(WrongFormatError);
    });
});

describe("vueroidTxetPrimitive.parse - wrong format", () => {
    it("throws WrongFormatError on a structural look-alike with ASCII junk", async () => {
        const vf = loadFixture("vueroid-txet/synthetic-wrong-format.mp4", "20260315_100000_INF_F_N.mp4");
        const index = await indexOf(vf);
        await expect(vueroidTxetPrimitive.parse(vf, index)).rejects.toThrow(WrongFormatError);
    });

    it("throws WrongFormatError without an index", async () => {
        const vf = loadFixture("vueroid-txet/synthetic-happy.mp4", "a.mp4");
        await expect(vueroidTxetPrimitive.parse(vf, undefined)).rejects.toThrow(WrongFormatError);
    });
});
