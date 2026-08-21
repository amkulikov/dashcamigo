// Auto-Vox RIFF trailer: chunk walk + record decode, plus the end-to-end
// dispatch path (the kind gate reads the trailer head from the index, so a
// primitive that parses fine can still be dead in production).

import { describe, it, expect } from "vitest";
import { buildMp4Index } from "./mp4-index.js";
import { hasAutoVoxTrailerSignature, parseAutoVoxTrailer } from "./autovox-riff.js";
import { autoVoxRiffPrimitive } from "../primitives/autovox-riff.js";
import { type ClassifiedFile, dispatchParseVideoEmbeddedGps } from "../registry.js";
import { KNOTS_TO_MS, type VendorFile } from "../types.js";
import { vendorFileKey } from "../../vendor-file-key.js";

// Verbatim ExifTool hexdumps (QuickTimeStream.pl:2933-2934 and 2969, v13.55).
const AITG_RECORD = [
    "41 49 54 47 74 46 94 f6 c6 c5 b4 40 34 a2 b4 37",
    "f8 7b 8a 40 ff ff 00 00 38 00 77 0a 1a 0c 12 28",
    "8d 01 02 40 29 07 00 00",
].join(" ");
const AITS_RECORD = "41 49 54 53 1a 0d 05 ff c8 00 00 00";

function hexBytes(hex: string): Uint8Array {
    return Uint8Array.from(hex.split(/\s+/).map((h) => Number.parseInt(h, 16)));
}

/** RIFF chunk: 4cc + u32 LE length + payload. */
function chunk(tag: string, payload: Uint8Array): Uint8Array {
    const out = new Uint8Array(8 + payload.length);
    out.set(new TextEncoder().encode(tag), 0);
    new DataView(out.buffer).setUint32(4, payload.length, true);
    out.set(payload, 8);
    return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) {
        out.set(p, at);
        at += p.length;
    }
    return out;
}

/** The verbatim AITG record, optionally byte-patched to model a bad record. */
function aitgRecord(patch?: (view: DataView) => void): Uint8Array {
    const bytes = hexBytes(AITG_RECORD);
    patch?.(new DataView(bytes.buffer));
    return bytes;
}

function buildTrailer(): Uint8Array {
    return concat([
        chunk("gps0", hexBytes(AITG_RECORD)),
        chunk("gsen", hexBytes(AITS_RECORD)),
        // Undecoded siblings upstream also reports; the walk must step over them.
        chunk("gpsa", hexBytes("01 20 00 00 08 03 02 08")),
        chunk("gsea", new Uint8Array(20)),
    ]);
}

describe("hasAutoVoxTrailerSignature", () => {
    it("accepts a gps0 chunk whose payload starts with AITG", () => {
        expect(hasAutoVoxTrailerSignature(buildTrailer())).toBe(true);
    });

    it("rejects an Ambarella-style gps0 atom - the chunk name alone is not enough", () => {
        // Same 4cc, but MP4 box framing (BE size) and no AITG magic behind it.
        const boxLike = new Uint8Array(16);
        boxLike.set(new TextEncoder().encode("gps0"), 0);
        new DataView(boxLike.buffer).setUint32(4, 0x100, false);
        expect(hasAutoVoxTrailerSignature(boxLike)).toBe(false);
    });

    it("rejects an unrelated trailing region", () => {
        expect(hasAutoVoxTrailerSignature(hexBytes("00 00 00 00 00 00 00 00 00 00 00 00"))).toBe(false);
    });
});

describe("parseAutoVoxTrailer", () => {
    it("decodes the verbatim gps0 record", () => {
        const parsed = parseAutoVoxTrailer(buildTrailer(), "autovox.mp4");
        expect(parsed).not.toBeNull();
        expect(parsed!.records).toHaveLength(1);
        const r = parsed!.records[0]!;
        // DDDMM.MMMM 5317.7772 / 847.4962 -> degrees.
        expect(r.lat).toBeCloseTo(53.296287, 5);
        // Hemisphere byte 0x02 read as W per upstream's stated guess. Worth
        // knowing what rides on it: as W this lands in Ireland, as E near
        // Bremen - both plausible, which is why the guess stays flagged
        // rather than silently "corrected".
        expect(r.lon).toBeCloseTo(-8.791603, 5);
        // year-1900 (not the -2000 the Ambarella gps0 uses).
        expect(r.unixSeconds).toBe(Date.UTC(2019, 9, 26, 12, 18, 40) / 1000);
        // u16 knots (the Ambarella gps0 stores km/h).
        expect(r.speedMs).toBeCloseTo(56 * KNOTS_TO_MS, 5);
        // direction byte is degrees/2.
        expect(r.bearingDeg).toBe(0x8d * 2);
    });

    it("decodes the verbatim gsen record with its own timestamp", () => {
        const parsed = parseAutoVoxTrailer(buildTrailer(), "autovox.mp4");
        expect(parsed!.accelSamples).toHaveLength(1);
        const a = parsed!.accelSamples![0]!;
        // Unlike the Ambarella gsen, the sample time is stored, not assumed.
        expect(a.msSinceStart).toBe(200);
        expect(a.accelXg).toBeCloseTo(26 / 24, 6);
        expect(a.accelYg).toBeCloseTo(13 / 24, 6);
        expect(a.accelZg).toBeCloseTo(5 / 24, 6);
    });

    it("returns null when the trailer carries accel but no GPS", () => {
        const accelOnly = chunk("gsen", hexBytes(AITS_RECORD));
        expect(parseAutoVoxTrailer(accelOnly, "autovox.mp4")).toBeNull();
    });
});

describe("parseAutoVoxTrailer: a bad record costs one record, not the chunk", () => {
    it("a zeroed date block at position 0 does not swallow the records behind it", () => {
        // Realistic shape: the camera writes records before the first fix, with
        // the date block still all zeros (year 1900). Records are fixed-stride
        // and self-magicked, so the walk can step over one.
        const noFix = aitgRecord((view) => {
            for (let i = 0x1a; i <= 0x1f; i++) view.setUint8(i, 0);
        });
        const trailer = chunk("gps0", concat([noFix, aitgRecord(), aitgRecord()]));

        const parsed = parseAutoVoxTrailer(trailer, "autovox.mp4");
        expect(parsed).not.toBeNull();
        expect(parsed!.records).toHaveLength(2);
        expect(parsed!.skipped).toHaveLength(1);
        expect(parsed!.skipped[0]!.line).toBe(1);
    });

    it("an out-of-range bearing byte drops only its own record", () => {
        // direction/2 = 0xff * 2 = 510 deg.
        const badBearing = aitgRecord((view) => view.setUint8(0x20, 0xff));
        const trailer = chunk("gps0", concat([aitgRecord(), badBearing, aitgRecord()]));

        const parsed = parseAutoVoxTrailer(trailer, "autovox.mp4");
        expect(parsed!.records).toHaveLength(2);
        expect(parsed!.skipped).toHaveLength(1);
    });

    it("a lost record magic still ends the chunk - the stride is no longer trustworthy", () => {
        const garbage = aitgRecord((view) => view.setUint8(0, 0x58)); // 'X' - not AITG
        const trailer = chunk("gps0", concat([aitgRecord(), garbage, aitgRecord()]));

        const parsed = parseAutoVoxTrailer(trailer, "autovox.mp4");
        expect(parsed!.records).toHaveLength(1);
        expect(parsed!.skipped[0]!.reason).toContain("alignment");
    });

    it("upstream's raw ddmm bail still ends the chunk", () => {
        // abs(lat) > 9000 is ExifTool's own 'Bad gps0 record' + last
        // (QuickTimeStream.pl ProcessRIFFTrailer, v13.55).
        const wildLat = aitgRecord((view) => view.setFloat64(0x04, 12345, true));
        const trailer = chunk("gps0", concat([aitgRecord(), wildLat, aitgRecord()]));

        const parsed = parseAutoVoxTrailer(trailer, "autovox.mp4");
        expect(parsed!.records).toHaveLength(1);
    });

    it("a non-finite coordinate is skipped, never emitted as a NaN fix", () => {
        const nanLon = aitgRecord((view) => view.setFloat64(0x0c, Number.NaN, true));
        const trailer = chunk("gps0", concat([nanLon, aitgRecord()]));

        const parsed = parseAutoVoxTrailer(trailer, "autovox.mp4");
        expect(parsed!.records).toHaveLength(1);
        expect(parsed!.records.every((r) => Number.isFinite(r.lat) && Number.isFinite(r.lon))).toBe(true);
    });
});

describe("Auto-Vox trailer through the dispatch path", () => {
    function mp4Box(type: string, payload: Uint8Array): Uint8Array {
        const out = new Uint8Array(8 + payload.length);
        new DataView(out.buffer).setUint32(0, out.length, false);
        out.set(new TextEncoder().encode(type), 4);
        out.set(payload, 8);
        return out;
    }

    async function loadFile(
        withTrailer: boolean,
    ): Promise<{ vf: VendorFile; index: Awaited<ReturnType<typeof buildMp4Index>> }> {
        const parts = [mp4Box("ftyp", new TextEncoder().encode("isomisom")), mp4Box("moov", new Uint8Array(0))];
        if (withTrailer) parts.push(buildTrailer());
        const file = new File([concat(parts) as BlobPart], "AUTOVOX.MP4");
        const vf: VendorFile = { file, relativePath: "AUTOVOX.MP4" };
        return { vf, index: await buildMp4Index(file) };
    }

    function classifiedVideo(file: File): ClassifiedFile {
        return {
            file: { file, relativePath: file.name },
            role: "video",
            sidecarId: null,
            sidecarMp4: null,
            logExtractorId: null,
        };
    }

    it("indexing exposes the trailer head and the marker fires on it", async () => {
        const { vf, index } = await loadFile(true);
        expect(index.trailerHead).not.toBeNull();
        expect(await autoVoxRiffPrimitive.marker(vf, index)).toBe(true);

        const parsed = await autoVoxRiffPrimitive.parse(vf, index);
        expect(parsed.records).toHaveLength(1);
        expect(parsed.accelSamples).toHaveLength(1);
    });

    it("the real dispatcher reaches the primitive - registration and the kind gate are live", async () => {
        // Calling marker/parse directly proves nothing about production: a
        // primitive missing from VIDEO_EMBEDDED_PRIMITIVES, or a kind gate that
        // classifies the file "none", is dead while its own tests stay green
        // (the regression class __fixtures__/dispatch-gate.test.ts exists for).
        const { vf } = await loadFile(true);
        const classified = classifiedVideo(vf.file);
        const result = await dispatchParseVideoEmbeddedGps([classified]);

        expect(result.appliedExtractors).toContain("autovox-riff");
        expect(result.records).toHaveLength(1);
        expect(result.errors).toHaveLength(0);
        expect(result.accelByFileKey.get(vendorFileKey(classified.file))).toHaveLength(1);
    });

    it("a file with no trailing region never claims", async () => {
        const { vf, index } = await loadFile(false);
        expect(index.trailerHead).toBeNull();
        expect(await autoVoxRiffPrimitive.marker(vf, index)).toBe(false);

        const result = await dispatchParseVideoEmbeddedGps([classifiedVideo(vf.file)]);
        expect(result.appliedExtractors).not.toContain("autovox-riff");
        expect(result.records).toHaveLength(0);
        expect(result.errors).toHaveLength(0);
    });

    it("the trailer signature skips the 4 MB marker probe", async () => {
        // The trailer is an exclusive structural signal read during indexing, so
        // embeddedGpsProbeNeeded must return false for it - otherwise every
        // Auto-Vox file pays a multi-MB head read that decides nothing.
        const padding = 5 * 1024 * 1024;
        const bytes = concat([
            mp4Box("ftyp", new TextEncoder().encode("isomisom")),
            mp4Box("moov", new Uint8Array(0)),
            mp4Box("mdat", new Uint8Array(padding)),
            buildTrailer(),
        ]);
        const file = new ReadCountingFile("AUTOVOX_BIG.MP4", bytes);
        const result = await dispatchParseVideoEmbeddedGps([classifiedVideo(file as unknown as File)]);

        expect(result.appliedExtractors).toContain("autovox-riff");
        // Box headers + the empty moov + the trailer itself; the 4 MB probe
        // window would dwarf this.
        expect(file.readBytesTotal).toBeLessThan(64 * 1024);
    });
});

/** File stand-in that counts the bytes a dispatch actually reads. */
class ReadCountingFile {
    public readBytesTotal = 0;
    public readonly size: number;
    public readonly lastModified = 0;
    public readonly type = "video/mp4";

    constructor(
        public readonly name: string,
        private readonly bytes: Uint8Array,
    ) {
        this.size = bytes.byteLength;
    }

    slice(start: number, end?: number): Blob {
        const stop = Math.min(end ?? this.size, this.size);
        const from = Math.max(0, Math.min(start, stop));
        this.readBytesTotal += stop - from;
        const part = this.bytes.slice(from, stop);
        return { arrayBuffer: async () => part.buffer } as unknown as Blob;
    }
}
