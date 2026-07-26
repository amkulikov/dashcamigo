// Blueskysea B4K dialect of the Novatek-TS PES: the same record behind a fixed
// 164-byte prefix, which pushes it past the end of the PES-start packet. These
// tests exist mainly to pin the reassembly - a single-packet probe is
// permanently blind to this dialect.

import { describe, it, expect } from "vitest";
import { extractNovatekTsGps, findNovatekTsGpsPid } from "./novatek-ts-extract.js";
import { KNOTS_TO_MS, type VendorFile } from "../types.js";

const TS_SIZE = 188;
const GPS_PID = 0x300;
const B4K_PREFIX = 164;

/** 44-byte Novatek record: 6 u32 datetime, status triple, 4 f32. */
function novatekRecord(): Uint8Array {
    const rec = new Uint8Array(44);
    const dv = new DataView(rec.buffer);
    for (const [i, v] of [7, 32, 13, 21, 3, 18].entries()) dv.setUint32(i * 4, v, true);
    rec[24] = 0x41; // 'A'
    rec[25] = 0x4e; // 'N'
    rec[26] = 0x45; // 'E'
    rec[27] = 0;
    dv.setFloat32(28, 5220.097, true); // DDmm -> 52.33495
    dv.setFloat32(32, 636.2321, true); // DDDmm -> 6.6038683
    dv.setFloat32(36, 10, true); // knots
    dv.setFloat32(40, 140, true); // course
    return rec;
}

/** One TS packet on GPS_PID. */
function tsPacket(payload: Uint8Array, pusi: boolean, counter: number): Uint8Array {
    const pkt = new Uint8Array(TS_SIZE).fill(0xff);
    pkt[0] = 0x47;
    pkt[1] = (pusi ? 0x40 : 0) | ((GPS_PID >> 8) & 0x1f);
    pkt[2] = GPS_PID & 0xff;
    pkt[3] = 0x10 | (counter & 0x0f);
    pkt.set(payload.subarray(0, TS_SIZE - 4), 4);
    return pkt;
}

/**
 * Builds a B4K-shaped PES split across two packets. `prefix` fills the 164
 * bytes ahead of the record, so a test can make the pre-filter miss.
 */
function b4kStream(prefix = new Uint8Array(B4K_PREFIX), record = novatekRecord()): Uint8Array {
    const body = new Uint8Array(B4K_PREFIX + record.length);
    body.set(prefix.subarray(0, B4K_PREFIX), 0);
    body.set(record, B4K_PREFIX);

    // private_stream_2 header, then as much body as fits.
    const first = new Uint8Array(6 + body.length);
    first.set([0x00, 0x00, 0x01, 0xbf, (body.length >> 8) & 0xff, body.length & 0xff], 0);
    first.set(body, 6);

    const firstPayload = first.subarray(0, TS_SIZE - 4);
    const rest = first.subarray(TS_SIZE - 4);
    // The record MUST straddle the packet boundary or the test proves nothing.
    expect(rest.length).toBeGreaterThan(0);

    const out = new Uint8Array(TS_SIZE * 2);
    out.set(tsPacket(firstPayload, true, 0), 0);
    out.set(tsPacket(rest, false, 1), TS_SIZE);
    return out;
}

/**
 * The same B4K PES, but the PES-start packet carries an adaptation field of
 * `afLen` bytes - PCR or discontinuity stuffing, which any real mux writes.
 * Those bytes push the record further into the stream, so nothing about it is
 * readable from the first packet.
 */
function b4kStreamWithAdaptationField(afLen: number): Uint8Array {
    const body = new Uint8Array(B4K_PREFIX + 44);
    body.set(novatekRecord(), B4K_PREFIX);
    const pes = new Uint8Array(6 + body.length);
    pes.set([0x00, 0x00, 0x01, 0xbf, (body.length >> 8) & 0xff, body.length & 0xff], 0);
    pes.set(body, 6);

    const firstCapacity = TS_SIZE - 5 - afLen;
    const first = new Uint8Array(TS_SIZE).fill(0xff);
    first[0] = 0x47;
    first[1] = 0x40 | ((GPS_PID >> 8) & 0x1f);
    first[2] = GPS_PID & 0xff;
    first[3] = 0x30; // adaptation field AND payload
    first[4] = afLen;
    first[5] = 0; // no flags set, the remaining AF bytes are stuffing
    first.set(pes.subarray(0, firstCapacity), 5 + afLen);

    const out = new Uint8Array(TS_SIZE * 2);
    out.set(first, 0);
    out.set(tsPacket(pes.subarray(firstCapacity), false, 1), TS_SIZE);
    return out;
}

function vendorFile(bytes: Uint8Array): VendorFile {
    const name = "20210318073213_000001.TS";
    return { file: new File([bytes as BlobPart], name), relativePath: name };
}

describe("Novatek-TS B4K prefix dialect", () => {
    it("finds the GPS PID even though the record starts in the next packet", () => {
        expect(findNovatekTsGpsPid(b4kStream())).toBe(GPS_PID);
    });

    it("decodes the reassembled record", async () => {
        const parsed = await extractNovatekTsGps(vendorFile(b4kStream()));
        expect(parsed.records).toHaveLength(1);
        const r = parsed.records[0]!;
        expect(r.lat).toBeCloseTo(52.33495, 5);
        expect(r.lon).toBeCloseTo(6.6038683, 5);
        expect(r.speedMs).toBeCloseTo(10 * KNOTS_TO_MS, 5);
        expect(r.bearingDeg).toBe(140);
        // Same local-clock quarantine as the bare dialect.
        expect(r.timeUnsynced).toBe(true);
    });

    it("finds nothing when the continuation packet is missing", async () => {
        // Exactly the pre-fix behavior: a one-packet view of this dialect can
        // never produce a record, and must not fabricate one either.
        const truncated = b4kStream().subarray(0, TS_SIZE);
        expect(findNovatekTsGpsPid(truncated)).toBeNull();
        await expect(extractNovatekTsGps(vendorFile(truncated))).rejects.toThrow();
    });

    it("still detects and decodes when the PES-start packet carries an adaptation field", async () => {
        // Two AF bytes are enough to push the pre-filter's clock triple past
        // the packet end. Treating "cannot read it" as "not a record" makes the
        // whole dialect invisible on any mux that stuffs its packets.
        for (const afLen of [2, 7]) {
            const stream = b4kStreamWithAdaptationField(afLen);
            expect(findNovatekTsGpsPid(stream)).toBe(GPS_PID);
            const parsed = await extractNovatekTsGps(vendorFile(stream));
            expect(parsed.records).toHaveLength(1);
            expect(parsed.records[0]!.lat).toBeCloseTo(52.33495, 5);
        }
    });

    it("does not claim a PES whose prefix slot holds no plausible clock", async () => {
        // Prefix filled so that the u32 triple at 164 is out of range - the
        // cheap pre-filter must reject before any reassembly happens.
        const record = novatekRecord();
        new DataView(record.buffer).setUint32(0, 99, true); // hour 99
        expect(findNovatekTsGpsPid(b4kStream(new Uint8Array(B4K_PREFIX), record))).toBeNull();
    });

    it("keeps scanning past a PES that passes the pre-filter but never completes", async () => {
        // Pathological stream: many PES-start packets that look like B4K but
        // have no continuation. Reassembly must report "will not complete"
        // rather than "need more data" - the latter makes the chunk loop carry
        // an ever-growing tail. A real record after them must still be found.
        const decoys: Uint8Array[] = [];
        for (let i = 0; i < 8; i++) {
            const body = new Uint8Array(B4K_PREFIX + 44);
            const dv = new DataView(body.buffer);
            // Plausible clock at the prefix offset, garbage where the anchor goes.
            for (const [k, v] of [7, 32, 13].entries()) dv.setUint32(B4K_PREFIX + k * 4, v, true);
            const pes = new Uint8Array(6 + body.length);
            pes.set([0x00, 0x00, 0x01, 0xbf, (body.length >> 8) & 0xff, body.length & 0xff], 0);
            pes.set(body, 6);
            decoys.push(tsPacket(pes.subarray(0, TS_SIZE - 4), true, i));
        }
        const real = b4kStream();
        const stream = new Uint8Array(decoys.length * TS_SIZE + real.length);
        decoys.forEach((p, i) => {
            stream.set(p, i * TS_SIZE);
        });
        stream.set(real, decoys.length * TS_SIZE);

        const parsed = await extractNovatekTsGps(vendorFile(stream));
        expect(parsed.records).toHaveLength(1);
        expect(parsed.records[0]!.lat).toBeCloseTo(52.33495, 5);
    });

    it("still reads the bare dialect, where the record sits at body offset 0", async () => {
        const body = novatekRecord();
        const pes = new Uint8Array(6 + body.length);
        pes.set([0x00, 0x00, 0x01, 0xbf, 0x00, body.length], 0);
        pes.set(body, 6);
        const stream = tsPacket(pes, true, 0);

        expect(findNovatekTsGpsPid(stream)).toBe(GPS_PID);
        const parsed = await extractNovatekTsGps(vendorFile(stream));
        expect(parsed.records).toHaveLength(1);
        expect(parsed.records[0]!.lat).toBeCloseTo(52.33495, 5);
    });
});
