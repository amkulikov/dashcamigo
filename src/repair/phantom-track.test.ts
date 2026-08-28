// Tests for phantom (no-data) media track repair (see src/repair/phantom-track.ts).
//
// Fixtures are synthetic on purpose. The defect lives entirely in the moov
// sample tables (stco all-zero / stsz all-zero), so a hand-built minimal moov
// reproduces it exactly and lets each branch be exercised in isolation. A
// real-anonymized fixture would be the wrong tool here: scripts/anonymize-*
// re-encode the video via ffmpeg, which writes a fresh, VALID audio table and
// destroys the very defect under test.

import { describe, expect, it } from "vitest";

import { findPhantomTracks, repairPhantomTracks } from "./phantom-track.js";

// ====== minimal ISOBMFF box builders ======

function u32(n: number): number[] {
    return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
}
function fourcc(s: string): number[] {
    return [...s].map((c) => c.charCodeAt(0));
}
function box(type: string, ...parts: number[][]): number[] {
    const body = parts.flat();
    return [...u32(8 + body.length), ...fourcc(type), ...body];
}
/** A truncated header-only box (size 8, no payload) - the shape a power-loss cut leaves behind. */
function headerOnly(type: string): number[] {
    return [...u32(8), ...fourcc(type)];
}
/** Builds a trak from raw stbl child boxes - lets a test place a truncated table box precisely. */
function trakFromStbl(handler: string, ...stblBoxes: number[][]): number[] {
    const stbl = box("stbl", ...stblBoxes);
    const minf = box("minf", stbl);
    const mdia = box("mdia", hdlr(handler), minf);
    return box("trak", mdia);
}

/** hdlr with the given handler_type ('vide' / 'soun' / 'meta'). */
function hdlr(handler: string): number[] {
    return box(
        "hdlr",
        u32(0), // version + flags
        u32(0), // pre_defined
        fourcc(handler), // handler_type
        u32(0),
        u32(0),
        u32(0), // 12 reserved bytes
    );
}

interface TrackSpec {
    handler: string;
    /** Chunk offsets (one per chunk; we use one sample per chunk). */
    offsets: number[];
    /** Per-sample sizes; same length as offsets. */
    sizes: number[];
}

/** Builds a trak whose stbl exposes stts/stsc/stsz/stco for the given samples. */
function trak(spec: TrackSpec): number[] {
    const n = spec.offsets.length;
    const stts = box("stts", u32(0), u32(1), u32(n), u32(3003));
    const stsc = box("stsc", u32(0), u32(1), u32(1), u32(1), u32(1));
    // stsz: sample_size field 0 → per-sample table follows.
    const stsz = box("stsz", u32(0), u32(0), u32(n), ...spec.sizes.map(u32));
    const stco = box("stco", u32(0), u32(n), ...spec.offsets.map(u32));
    const stbl = box("stbl", stts, stsc, stsz, stco);
    const minf = box("minf", stbl);
    const mdia = box("mdia", hdlr(spec.handler), minf);
    return box("trak", mdia);
}

function moovWith(...traks: number[][]): Uint8Array {
    const mvhd = box("mvhd", new Array(100).fill(0));
    return new Uint8Array(box("moov", mvhd, ...traks));
}

const VALID_VIDEO: TrackSpec = { handler: "vide", offsets: [0x10000, 0x20000, 0x30000], sizes: [1200, 900, 1100] };
const PHANTOM_AUDIO_ZERO_OFFSETS: TrackSpec = { handler: "soun", offsets: [0, 0, 0], sizes: [0, 0, 0] };
const HEALTHY_AUDIO: TrackSpec = { handler: "soun", offsets: [0x40000, 0x40400], sizes: [256, 256] };

describe("findPhantomTracks", () => {
    it("flags an audio track with all-zero chunk offsets, not the intact video", () => {
        const moov = moovWith(trak(VALID_VIDEO), trak(PHANTOM_AUDIO_ZERO_OFFSETS));
        const edits = findPhantomTracks(moov);
        expect(edits).toHaveLength(1);
        expect(edits[0]!.handler).toBe("soun");
        expect(edits[0]!.reason).toBe("zero-offsets");
        expect(edits[0]!.declaredSamples).toBe(3);
        // stts + stsc + stsz + stco entry-count fields.
        expect(edits[0]!.countOffsets).toHaveLength(4);
    });

    it("flags a track whose chunk offsets are valid but every sample size is 0", () => {
        const zeroSizeAudio: TrackSpec = { handler: "soun", offsets: [0x40000, 0x40400, 0x40800], sizes: [0, 0, 0] };
        const edits = findPhantomTracks(moovWith(trak(VALID_VIDEO), trak(zeroSizeAudio)));
        expect(edits).toHaveLength(1);
        expect(edits[0]!.reason).toBe("zero-size");
    });

    it("does not flag a healthy audio track", () => {
        const edits = findPhantomTracks(moovWith(trak(VALID_VIDEO), trak(HEALTHY_AUDIO)));
        expect(edits).toHaveLength(0);
    });

    it("never neutralizes a video track even if it is itself phantom (nothing to fall back to)", () => {
        const phantomVideo: TrackSpec = { handler: "vide", offsets: [0, 0], sizes: [0, 0] };
        const edits = findPhantomTracks(moovWith(trak(phantomVideo), trak(HEALTHY_AUDIO)));
        expect(edits).toHaveLength(0);
    });

    it("is idempotent: zeroing the reported counts removes the defect", () => {
        const moov = moovWith(trak(VALID_VIDEO), trak(PHANTOM_AUDIO_ZERO_OFFSETS));
        const edits = findPhantomTracks(moov);
        const dv = new DataView(moov.buffer);
        for (const off of edits[0]!.countOffsets) dv.setUint32(off, 0);
        // Now the track declares 0 samples → no longer phantom, no further edits.
        expect(findPhantomTracks(moov)).toHaveLength(0);
    });

    it("handles multiple phantom tracks (e.g. audio + a dead meta track)", () => {
        const phantomMeta: TrackSpec = { handler: "meta", offsets: [0, 0], sizes: [0, 0] };
        const edits = findPhantomTracks(
            moovWith(trak(VALID_VIDEO), trak(PHANTOM_AUDIO_ZERO_OFFSETS), trak(phantomMeta)),
        );
        expect(edits.map((e) => e.handler).sort()).toEqual(["meta", "soun"]);
    });
});

// Reproduces the A7/G6 corruption cases: a power-loss cut can leave a truncated
// header-only sample-table box as the last box in moov. An unguarded read past
// its end throws RangeError (which used to discard the whole file's index), and
// an unguarded write clobbers a neighbor box's bytes. The guards must degrade
// such a box to "cannot verify -> not phantom" without throwing or overwriting.
describe("findPhantomTracks bounds guards (truncated tables)", () => {
    it("does not throw or repair on a header-only stsz as the last box in moov", () => {
        // stsz truncated to its header sits last, so reading sample_count at
        // payloadStart+8 runs past the buffer end -> RangeError without the guard.
        const stts = box("stts", u32(0), u32(1), u32(3), u32(3003));
        const stsc = box("stsc", u32(0), u32(1), u32(1), u32(1), u32(1));
        const stco = box("stco", u32(0), u32(3), u32(0), u32(0), u32(0)); // all-zero -> would be phantom if readable
        const audioTrak = trakFromStbl("soun", stts, stsc, stco, headerOnly("stsz"));
        const moov = moovWith(trak(VALID_VIDEO), audioTrak);
        expect(() => findPhantomTracks(moov)).not.toThrow();
        expect(findPhantomTracks(moov)).toHaveLength(0);
    });

    it("does not throw or repair on a header-only stco as the last box in moov", () => {
        // Valid all-zero-size stsz would flag zero-size, but the chunk-offset box
        // is truncated: reading its entry_count at payloadStart+4 (last box) runs
        // past the buffer -> RangeError without the guard.
        const stts = box("stts", u32(0), u32(1), u32(3), u32(3003));
        const stsc = box("stsc", u32(0), u32(1), u32(1), u32(1), u32(1));
        const stsz = box("stsz", u32(0), u32(0), u32(3), u32(0), u32(0), u32(0)); // 3 samples, all-zero sizes
        const audioTrak = trakFromStbl("soun", stts, stsc, stsz, headerOnly("stco"));
        const moov = moovWith(trak(VALID_VIDEO), audioTrak);
        expect(() => findPhantomTracks(moov)).not.toThrow();
        expect(findPhantomTracks(moov)).toHaveLength(0);
    });

    it("repairs a genuine phantom track without writing into truncated stts/stsc neighbor boxes", () => {
        // Real defect: all-zero chunk offsets. stts/stsc are truncated header-only
        // stubs - their entry_count field does not exist, so a blind write to
        // stub.payloadStart+4 would land in the following box. The repair must
        // touch only the stsz + stco entry-count words it reported.
        const sttsStub = headerOnly("stts");
        const stscStub = headerOnly("stsc");
        const stsz = box("stsz", u32(0), u32(0), u32(2), u32(0), u32(0)); // 2 samples, all-zero sizes
        const stco = box("stco", u32(0), u32(2), u32(0), u32(0)); // 2 chunks, all-zero offsets -> phantom
        const audioTrak = trakFromStbl("soun", sttsStub, stscStub, stsz, stco);
        const moov = moovWith(trak(VALID_VIDEO), audioTrak);

        const edits = findPhantomTracks(moov);
        expect(edits).toHaveLength(1);
        expect(edits[0]!.reason).toBe("zero-offsets");
        // Only stsz.sample_count + stco.entry_count - the header-only stts/stsc are skipped.
        expect(edits[0]!.countOffsets).toHaveLength(2);

        // Apply the patch and prove nothing outside the reported offsets changed:
        // the truncated stts/stsc stub bytes (and every neighbor) stay identical.
        const original = moov.slice();
        const patched = moov.slice();
        const dv = new DataView(patched.buffer);
        for (const off of edits[0]!.countOffsets) dv.setUint32(off, 0);
        const changed = new Set<number>();
        for (const off of edits[0]!.countOffsets) for (let i = 0; i < 4; i++) changed.add(off + i);
        for (let i = 0; i < original.length; i++) {
            if (changed.has(i)) continue;
            expect(patched[i]).toBe(original[i]);
        }
        // And the patch actually removed the defect.
        expect(findPhantomTracks(patched)).toHaveLength(0);
    });
});

describe("repairPhantomTracks (File round-trip)", () => {
    /** Wraps top-level boxes into a File the way ingest hands one to the repair. */
    function fileFrom(...topLevel: number[][]): File {
        const bytes = new Uint8Array(topLevel.flat());
        return new File([bytes], "phantom.mp4", { type: "video/mp4" });
    }

    const ftyp = box("ftyp", fourcc("isom"), u32(0x200), fourcc("isomiso2"));
    // A dummy mdat so the top-level walk has something to skip before moov.
    const mdat = box("mdat", new Array(64).fill(0xaa));

    it("zeroes the phantom audio counts and keeps the file byte-length constant", async () => {
        const moov = [...moovWith(trak(VALID_VIDEO), trak(PHANTOM_AUDIO_ZERO_OFFSETS))];
        const file = fileFrom(ftyp, mdat, moov);
        const repaired = await repairPhantomTracks(file);
        expect(repaired).not.toBeNull();
        expect(repaired!.neutralized).toEqual(["soun"]);
        expect(repaired!.file.size).toBe(file.size); // constant-size patch keeps every offset valid

        // Re-scan the patched moov: no phantom track remains.
        const patched = new Uint8Array(await repaired!.file.arrayBuffer());
        const moovStart = ftyp.length + mdat.length;
        const patchedMoov = patched.subarray(moovStart, moovStart + moov.length);
        expect(findPhantomTracks(patchedMoov)).toHaveLength(0);

        // Bytes before moov (ftyp + mdat) are untouched.
        expect(Array.from(patched.subarray(0, moovStart))).toEqual([...ftyp, ...mdat]);
    });

    it("returns null when no track is phantom (file used as-is)", async () => {
        const moov = [...moovWith(trak(VALID_VIDEO), trak(HEALTHY_AUDIO))];
        const repaired = await repairPhantomTracks(fileFrom(ftyp, mdat, moov));
        expect(repaired).toBeNull();
    });
});
