#!/usr/bin/env node
// Builds minimal MPEG-TS fixtures for the novatek-ts primitive. Mirrors the
// real stream shape (see docs/format-novatek-ts.md): PAT/PMT advertising ONLY
// HEVC+AAC (the GPS PES is absent from the PMT, exactly like the real
// camera), filler video PES packets on PID 0x200, and GPS PES on PID 0x300 -
// stream_id 0xbf, PES_packet_length 1008, spanning 6 TS packets (1 PUSI + 5
// continuations, the last padded with adaptation-field stuffing).
//
// All coordinates are synthetic sentinels (50 N / 30 E), never real.
//
// Run: node src/parsers/__fixtures__/novatek-ts/build-synthetic.mjs

import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const TS_SIZE = 188;
const PID_PMT = 0x40;
const PID_VIDEO = 0x200;
const PID_GPS = 0x300;
const GPS_PES_BODY = 1008;

const continuity = new Map();

function tsPacket({ pid, pusi, payload, afStuffing = 0 }) {
    const pkt = Buffer.alloc(TS_SIZE, 0xff);
    pkt[0] = 0x47;
    pkt[1] = ((pusi ? 0x40 : 0) | (pid >> 8)) & 0xff;
    pkt[2] = pid & 0xff;
    const cc = continuity.get(pid) ?? 0;
    continuity.set(pid, (cc + 1) & 0x0f);
    let off = 4;
    if (afStuffing > 0) {
        // adaptation_field_control = 3: AF length + flags byte + 0xff stuffing.
        pkt[3] = 0x30 | cc;
        pkt[4] = afStuffing - 1; // AF length excludes the length byte itself
        pkt[5] = 0x00; // AF flags
        off = 4 + afStuffing;
    } else {
        pkt[3] = 0x10 | cc; // payload only
    }
    if (payload.length !== TS_SIZE - off) {
        throw new Error(`payload ${payload.length} does not fill packet (need ${TS_SIZE - off})`);
    }
    payload.copy(pkt, off);
    return pkt;
}

function patPacket() {
    const sec = Buffer.alloc(184, 0xff);
    // pointer_field + minimal PAT: program 1 -> PMT PID. CRC is a dummy - the
    // parser never reads PSI (the GPS PES is not advertised there anyway).
    sec.set([0x00, 0x00, 0xb0, 0x0d, 0x30, 0x34, 0xc3, 0x00, 0x00, 0x00, 0x01, 0xe0 | (PID_PMT >> 8), PID_PMT & 0xff, 0xde, 0xad, 0xbe, 0xef]);
    return tsPacket({ pid: 0, pusi: true, payload: sec });
}

function pmtPacket() {
    const sec = Buffer.alloc(184, 0xff);
    // Program 1, PCR PID = video. Two ES entries: HEVC (0x24) + AAC (0x0f).
    // Deliberately NO entry for the GPS PID - mirrors the real camera.
    sec.set([
        0x00, 0x02, 0xb0, 0x17, 0x00, 0x01, 0xc3, 0x00, 0x00,
        0xe0 | (PID_VIDEO >> 8), PID_VIDEO & 0xff, 0xf0, 0x00,
        0x24, 0xe0 | (PID_VIDEO >> 8), PID_VIDEO & 0xff, 0xf0, 0x00,
        0x0f, 0xe0 | ((PID_VIDEO + 1) >> 8), (PID_VIDEO + 1) & 0xff, 0xf0, 0x00,
        0xde, 0xad, 0xbe, 0xef,
    ]);
    return tsPacket({ pid: PID_PMT, pusi: true, payload: sec });
}

function videoPesPacket() {
    const payload = Buffer.alloc(184, 0xab);
    // PES start, stream_id 0xe0 (video), extended header with no PTS.
    payload.set([0x00, 0x00, 0x01, 0xe0, 0x00, 0x00, 0x80, 0x00, 0x00]);
    return tsPacket({ pid: PID_VIDEO, pusi: true, payload });
}

function ddmm(deg) {
    const abs = Math.abs(deg);
    return Math.floor(abs) * 100 + (abs - Math.floor(abs)) * 60;
}

// 1008-byte GPS PES body: 44-byte record + zero padding, as on the real camera.
function gpsRecordBody({ h, mi, s, y, mo, d, fix = "A", lat = 50, lon = 30, speedKnots = 10, course = 70, latRawOverride = null }) {
    const body = Buffer.alloc(GPS_PES_BODY, 0x00);
    body.writeUInt32LE(h, 0);
    body.writeUInt32LE(mi, 4);
    body.writeUInt32LE(s, 8);
    body.writeUInt32LE(y, 12);
    body.writeUInt32LE(mo, 16);
    body.writeUInt32LE(d, 20);
    body[24] = fix.charCodeAt(0);
    body[25] = (lat >= 0 ? "N" : "S").charCodeAt(0);
    body[26] = (lon >= 0 ? "E" : "W").charCodeAt(0);
    body[27] = 0;
    if (latRawOverride === null) {
        body.writeFloatLE(ddmm(lat), 28);
    } else {
        body.writeUInt32LE(latRawOverride >>> 0, 28); // raw bit pattern (NaN case)
    }
    body.writeFloatLE(ddmm(lon), 32);
    body.writeFloatLE(speedKnots, 36);
    body.writeFloatLE(course, 40);
    return body;
}

// Splits a full PES (6-byte private_stream_2 header + body) into TS packets
// exactly as the real firmware does: PUSI + full continuations + a final
// continuation with AF stuffing for the remainder.
function gpsPesPackets(body) {
    const pes = Buffer.alloc(6 + body.length);
    pes.set([0x00, 0x00, 0x01, 0xbf, body.length >> 8, body.length & 0xff]);
    body.copy(pes, 6);

    const packets = [];
    let off = 0;
    let first = true;
    while (off < pes.length) {
        const remaining = pes.length - off;
        if (remaining >= 184) {
            packets.push(tsPacket({ pid: PID_GPS, pusi: first, payload: pes.subarray(off, off + 184) }));
            off += 184;
        } else {
            const afStuffing = 184 - remaining;
            packets.push(tsPacket({ pid: PID_GPS, pusi: first, payload: pes.subarray(off), afStuffing }));
            off = pes.length;
        }
        first = false;
    }
    return packets;
}

function buildFile(records) {
    const packets = [patPacket(), pmtPacket()];
    for (const rec of records) {
        packets.push(videoPesPacket(), videoPesPacket(), videoPesPacket());
        packets.push(...gpsPesPackets(rec));
    }
    packets.push(videoPesPacket());
    return Buffer.concat(packets);
}

// Timestamps mirror the real sample family (camera-LOCAL wall clock, 1 Hz).
const T0 = { h: 15, mi: 39, s: 34, y: 21, mo: 3, d: 18 };
function at(i, extra = {}) {
    return { ...T0, s: T0.s + i, lat: 50 + i * 0.0001, lon: 30 + i * 0.0001, speedKnots: 10 + i, course: 70 + i, ...extra };
}

const outDir = dirname(fileURLToPath(import.meta.url));

// Happy path: 6 valid records at 1 Hz.
continuity.clear();
writeFileSync(
    resolve(outDir, "synthetic-happy.TS"),
    buildFile([0, 1, 2, 3, 4, 5].map((i) => gpsRecordBody(at(i)))),
);

// Edge: valid, no-fix 'V', month out of range (fails the signature gate),
// NaN latitude, DDmm latitude out of range, valid. Expect 2 records + 4 skips.
const outOfRangeLat = gpsRecordBody(at(4));
outOfRangeLat.writeFloatLE(9930.0, 28); // 99 deg 30 min -> 99.5 deg, out of range
continuity.clear();
writeFileSync(
    resolve(outDir, "synthetic-edge.TS"),
    buildFile([
        gpsRecordBody(at(0)),
        gpsRecordBody(at(1, { fix: "V" })),
        gpsRecordBody({ ...at(2), mo: 13 }),
        gpsRecordBody(at(3, { latRawOverride: 0x7fc00000 })), // f32 NaN
        outOfRangeLat,
        gpsRecordBody(at(5)),
    ]),
);

// Wrong format: valid TS (PAT/PMT + video) with a private_stream_2 PES on the
// GPS PID that carries ASCII text (LigoGPS-plaintext-like, zero coords), not
// the binary record. marker's filename fallback may claim it; parse must
// throw WrongFormatError.
continuity.clear();
{
    const body = Buffer.alloc(152, 0x00);
    body.write("normal:2021/03/18 15:39:34 N:00.000000 E:00.000000 0.0 km/h x:0.0 y:0.0 z:0.0 A:0.0 H:0.0", 0, "latin1");
    writeFileSync(resolve(outDir, "synthetic-wrong-format.TS"), buildFile([body]));
}

console.log("novatek-ts synthetic fixtures written");
