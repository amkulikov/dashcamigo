// XOR-0xAA ASCII GPS: the decoder plus its two newer carriers (Lamax S9 gps0,
// Rove Stealth gpmd). The third carrier - the Azdome freeGPS block - is covered
// by its own real-sample fixtures in freegps.test.ts, which is what keeps this
// shared decoder honest.

import { describe, it, expect } from "vitest";
import { buildMp4Index } from "./mp4-index.js";
import { parseNavitelTail } from "./navitel-gps0.js";
import { roveGpmdPrimitive } from "../primitives/rove-gpmd.js";
import { decodeXorAsciiGpsText, decryptXorAscii, hasXorAsciiSignature, XOR_ASCII_KEY } from "./xor-ascii-gps.js";
import { KMH_TO_MS, type VendorFile } from "../types.js";

// Verbatim from ExifTool's decrypted Ambarella A12 hexdump
// (QuickTimeStream.pl:1164-1170, v13.55): "20191116100901 ... N55451167E037430041".
// Those coordinates resolve to central Moscow, which is the only end-to-end
// sanity check available without a device.
const DECRYPTED = (() => {
    const text = new Uint8Array(320).fill(0x00);
    const put = (at: number, s: string) => {
        for (let i = 0; i < s.length; i++) text[at + i] = s.charCodeAt(i);
    };
    put(0, "\xaa\xaaXKZD\xfe\xfe");
    put(8, "20191116100901");
    text[22] = 0x0c;
    put(23, "01191016070859"); // the 15-byte label slot upstream skips
    text[37] = 0x03;
    put(38, "N55451167");
    put(47, "E037430041");
    put(57, "+015700"); // 0x39 altitude, then the first speed digit
    put(64, "0-000-023-003-00"); // 0x40: rest of the speed digits, then accel
    return text;
})();

/** Encrypts a decrypted record back into wire form. */
function encrypt(decrypted: Uint8Array): Uint8Array {
    const out = new Uint8Array(decrypted.length);
    for (let i = 0; i < decrypted.length; i++) out[i] = decrypted[i]! ^ XOR_ASCII_KEY;
    return out;
}

/** Wire-form record as the Ambarella carriers store it (leading \0\0). */
function wireRecord(size: number): Uint8Array {
    const rec = new Uint8Array(size);
    rec.set(encrypt(DECRYPTED).subarray(0, Math.min(size, DECRYPTED.length)), 0);
    // Ambarella keeps the first two bytes clear where the freeGPS wrapper has
    // 0xaa 0xaa - the decoder skips both, which is why one helper serves both.
    rec[0] = 0;
    rec[1] = 0;
    return rec;
}

describe("decodeXorAsciiGpsText", () => {
    it("decodes the upstream Ambarella record", () => {
        const text = decryptXorAscii(wireRecord(311), 0, 311);
        const record = decodeXorAsciiGpsText(text, "clip.mp4");
        expect(record).not.toBeNull();
        // DD + minutes*1e4: 55 + 451167/600000 and 37 + 430041/600000.
        expect(record!.lat).toBeCloseTo(55.751945, 5);
        expect(record!.lon).toBeCloseTo(37.716735, 5);
        expect(record!.unixSeconds).toBe(Date.UTC(2019, 10, 16, 10, 9, 1) / 1000);
        // No track field exists in this format.
        expect(record!.bearingDeg).toBe(0);
    });

    it("carries upstream's bytes at the altitude/speed/accel run verbatim", () => {
        // Pins the fixture against the dump it claims to be: "+0157" at 57 is
        // the distrusted altitude slot, "000" at 62 the km/h field, "-000-023
        // -003" from 65 the accel triple. Digits at 62 are what the speed
        // branch keys on - a fixture off by a byte here silently stops
        // exercising it.
        const text = decryptXorAscii(wireRecord(311), 0, 311);
        expect(text.slice(57, 80)).toBe("+0157000-000-023-003-00");
    });

    it("reads the EEEkit-form speed when no inline digits follow the longitude", () => {
        // Upstream's own record is 000 km/h - indistinguishable from the
        // no-speed-found default - so this copy is deliberately mutated at the
        // speed field only; the rest stays the verbatim dump.
        const wire = wireRecord(311);
        wire.set(encrypt(Uint8Array.from("042", (ch) => ch.charCodeAt(0))), 62);
        const record = decodeXorAsciiGpsText(decryptXorAscii(wire, 0, 311), "clip.mp4");
        expect(record!.speedMs).toBeCloseTo(42 * KMH_TO_MS, 6);
    });

    it("returns null for a record with no fix", () => {
        const noFix = wireRecord(311);
        // Break the datetime: upstream emits accel-only records like this.
        noFix.set(encrypt(Uint8Array.from("xxxxxxxxxxxxxx", (c) => c.charCodeAt(0))), 8);
        expect(decodeXorAsciiGpsText(decryptXorAscii(noFix, 0, 311), "clip.mp4")).toBeNull();
    });

    it("signature check rejects unrelated bytes", () => {
        expect(hasXorAsciiSignature(wireRecord(311), 2)).toBe(true);
        expect(hasXorAsciiSignature(new Uint8Array(311), 2)).toBe(false);
    });
});

describe("Lamax S9 gps0 carrier", () => {
    /** Top-level gps0 atom payload: N 311-byte records behind an 8-byte header. */
    function gps0Atom(recordCount: number): Uint8Array {
        const payload = new Uint8Array(8 + recordCount * 311);
        for (let i = 0; i < recordCount; i++) payload.set(wireRecord(311), 8 + i * 311);
        return payload;
    }

    it("decodes records that the 32-byte navitel stride would have mangled", () => {
        const parsed = parseNavitelTail(null, gps0Atom(3), "lamax.mov");
        expect(parsed).not.toBeNull();
        expect(parsed!.records).toHaveLength(3);
        expect(parsed!.records[0]!.lat).toBeCloseTo(55.751945, 5);
    });

    it("stops at the first record that loses the signature", () => {
        const atom = gps0Atom(3);
        atom.fill(0, 8 + 311 * 2, 8 + 311 * 3); // wipe the third record
        expect(parseNavitelTail(null, atom, "lamax.mov")!.records).toHaveLength(2);
    });

    it("zeroes accel when a clip has too few samples to estimate gravity", () => {
        // One record cannot separate the static ~1 g bias from motion.
        const parsed = parseNavitelTail(null, gps0Atom(1), "lamax.mov");
        const r = parsed!.records[0]!;
        expect([r.accelXg, r.accelYg, r.accelZg]).toEqual([0, 0, 0]);
    });
});

describe("Rove Stealth gpmd carrier", () => {
    const ascii = (text: string): Uint8Array => Uint8Array.from(text, (ch) => ch.charCodeAt(0) & 0xff);

    function box(type: string, payload: Uint8Array): Uint8Array<ArrayBuffer> {
        const out = new Uint8Array(8 + payload.length);
        new DataView(out.buffer).setUint32(0, out.length, false);
        out.set(ascii(type), 4);
        out.set(payload, 8);
        return out;
    }

    function concat(parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
        const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
        let at = 0;
        for (const p of parts) {
            out.set(p, at);
            at += p.length;
        }
        return out;
    }

    function u32(value: number): Uint8Array {
        const out = new Uint8Array(4);
        new DataView(out.buffer).setUint32(0, value, false);
        return out;
    }

    /** Minimal moov with one gpmd track whose samples sit in mdat. */
    function buildFile(sampleCount: number, sampleSize: number, mdatOffset: number): Uint8Array<ArrayBuffer> {
        const stsd = box("stsd", concat([u32(0), u32(1), box("gpmd", new Uint8Array(8))]));
        const stts = box("stts", concat([u32(0), u32(1), u32(sampleCount), u32(1)]));
        const stsc = box("stsc", concat([u32(0), u32(1), u32(1), u32(sampleCount), u32(1)]));
        const stsz = box("stsz", concat([u32(0), u32(sampleSize), u32(sampleCount)]));
        const stco = box("stco", concat([u32(0), u32(1), u32(mdatOffset)]));
        const stbl = box("stbl", concat([stsd, stts, stsc, stsz, stco]));
        const minf = box("minf", stbl);
        const hdlr = box("hdlr", concat([u32(0), u32(0), ascii("meta"), new Uint8Array(13)]));
        const mdia = box("mdia", concat([hdlr, minf]));
        const trak = box("trak", mdia);
        return box("moov", trak);
    }

    async function loadFile(sampleCount: number) {
        const ftyp = box("ftyp", ascii("mp42\0\0\0\0mp42isom"));
        const sampleSize = 311;
        // mdat payload starts 8 bytes into the mdat box.
        const samples = concat(Array.from({ length: sampleCount }, () => wireRecord(sampleSize)));
        const moovLen = buildFile(sampleCount, sampleSize, 0).length;
        const mdatOffset = ftyp.length + moovLen + 8;
        const bytes = concat([ftyp, buildFile(sampleCount, sampleSize, mdatOffset), box("mdat", samples)]);

        const file = new File([bytes as BlobPart], "rove.mp4");
        const vf: VendorFile = { file, relativePath: "rove.mp4" };
        return { vf, index: await buildMp4Index(file) };
    }

    it("marks and decodes a gpmd track of encrypted records", async () => {
        const { vf, index } = await loadFile(3);
        expect(await roveGpmdPrimitive.marker(vf, index)).toBe(true);

        const parsed = await roveGpmdPrimitive.parse(vf, index);
        expect(parsed.records).toHaveLength(3);
        expect(parsed.records[0]!.lat).toBeCloseTo(55.751945, 5);
        expect(parsed.records[0]!.lon).toBeCloseTo(37.716735, 5);
    });

    it("does not claim a gpmd track of unrelated bytes", async () => {
        const { vf } = await loadFile(2);
        // Same shape, different content: GPMF KLV, which the gpmf primitive owns.
        const other = new File([new Uint8Array(await vf.file.arrayBuffer()).fill(0x44, 0, 4) as BlobPart], "other.mp4");
        const otherVf: VendorFile = { file: other, relativePath: "other.mp4" };
        const otherIndex = await buildMp4Index(other);
        expect(await roveGpmdPrimitive.marker(otherVf, otherIndex)).toBe(false);
    });
});
