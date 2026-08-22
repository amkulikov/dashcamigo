// Nextbase gdat: Base64+JSON decode, the upstream field semantics, and the
// dispatch path (a top-level atom whose kind-gate wiring is easy to forget).

import { describe, it, expect } from "vitest";
import { buildMp4Index } from "./mp4-index.js";
import { hasNextbaseGdatHead, parseNextbaseGdat } from "./nextbase-gdat.js";
import { nextbaseGdatPrimitive } from "../primitives/nextbase-gdat.js";
import { MPH_TO_MS, type VendorFile } from "../types.js";

// Key spellings are verbatim from Process_gdat (QuickTimeStream.pl:2809-2827,
// v13.55); the values are ours - no real gdat dump exists publicly.
const TRACK = {
    cameraModel: "622GW",
    gpsData: [
        {
            datetime: "2023-12-28T23:10:22",
            lat: 52.33495,
            lon: 6.6038683,
            speed: 30,
            bearing: 140,
            xAcc: 0.01,
            yAcc: -0.02,
            zAcc: 1.01,
            gpsStatus: "A",
        },
        {
            // Same row shape with string values - Perl casts either way, so we
            // must too.
            datetime: "2023-12-28T23:10:23",
            lat: "-33.865143",
            lon: "-151.209900",
            speed: "0",
            bearing: "359",
            gpsStatus: "A",
        },
        {
            // Void fix: upstream skips anything whose gpsStatus is not 'A'.
            datetime: "2023-12-28T23:10:24",
            lat: 52.4,
            lon: 6.7,
            speed: 31,
            bearing: 141,
            gpsStatus: "V",
        },
    ],
};

const encodeUtf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

function base64Bytes(text: string): Uint8Array {
    const bytes = encodeUtf8(text);
    let binary = "";
    for (const b of bytes) binary += String.fromCharCode(b);
    return Uint8Array.from(btoa(binary), (ch) => ch.charCodeAt(0));
}

/** `indent` produces the pretty-printed form desktop software may write. */
function base64Payload(obj: unknown, indent?: number): Uint8Array {
    return base64Bytes(JSON.stringify(obj, null, indent));
}

describe("parseNextbaseGdat", () => {
    it("decodes fixes and applies the upstream field semantics", () => {
        const parsed = parseNextbaseGdat(base64Payload(TRACK), "nextbase.mp4");
        expect(parsed).not.toBeNull();
        // The 'V' row is gone: gpsStatus gates emission upstream.
        expect(parsed!.records).toHaveLength(2);

        const first = parsed!.records[0]!;
        expect(first.unixSeconds).toBe(Date.UTC(2023, 11, 28, 23, 10, 22) / 1000);
        expect(first.lat).toBeCloseTo(52.33495, 6);
        expect(first.lon).toBeCloseTo(6.6038683, 6);
        // speed is mph upstream (it multiplies by mphToKph).
        expect(first.speedMs).toBeCloseTo(30 * MPH_TO_MS, 6);
        expect(first.bearingDeg).toBe(140);
        // x/y/zAcc carry no unit or axis order upstream - dropped, not guessed.
        expect([first.accelXg, first.accelYg, first.accelZg]).toEqual([0, 0, 0]);
    });

    it("accepts numeric strings as readily as numbers", () => {
        const parsed = parseNextbaseGdat(base64Payload(TRACK), "nextbase.mp4");
        const second = parsed!.records[1]!;
        expect(second.lat).toBeCloseTo(-33.865143, 6);
        expect(second.lon).toBeCloseTo(-151.2099, 6);
        expect(second.speedMs).toBe(0);
        expect(second.bearingDeg).toBe(359);
    });

    it("honors an explicit zone but never the host timezone", () => {
        const zoned = {
            gpsData: [{ ...TRACK.gpsData[0], datetime: "2023-12-28T23:10:22.5+02:00" }],
        };
        const parsed = parseNextbaseGdat(base64Payload(zoned), "nextbase.mp4");
        expect(parsed!.records[0]!.unixSeconds).toBe(Date.UTC(2023, 11, 28, 21, 10, 22) / 1000 + 0.5);

        const zulu = { gpsData: [{ ...TRACK.gpsData[0], datetime: "2023-12-28T23:10:22Z" }] };
        expect(parseNextbaseGdat(base64Payload(zulu), "nextbase.mp4")!.records[0]!.unixSeconds).toBe(
            Date.UTC(2023, 11, 28, 23, 10, 22) / 1000,
        );
    });

    it("drops a row with an unparseable datetime but keeps the rest", () => {
        const mixed = {
            gpsData: [
                { ...TRACK.gpsData[0], datetime: "28/12/2023 23:10:22" },
                { ...TRACK.gpsData[0], datetime: "2023-02-31T23:10:22Z" },
                { ...TRACK.gpsData[0], datetime: "2023-12-28T23:10:22+02:99" },
                TRACK.gpsData[1],
            ],
        };
        const parsed = parseNextbaseGdat(base64Payload(mixed), "nextbase.mp4");
        expect(parsed!.records).toHaveLength(1);
        expect(parsed!.skipped.map((entry) => entry.reason)).toEqual([
            "unparseable datetime",
            "unparseable datetime",
            "unparseable datetime",
        ]);
    });

    it("drops out-of-range and null-island coordinates", () => {
        const bad = {
            gpsData: [
                { ...TRACK.gpsData[0], lat: 95 },
                { ...TRACK.gpsData[0], lat: 0, lon: 0 },
            ],
        };
        expect(parseNextbaseGdat(base64Payload(bad), "nextbase.mp4")).toBeNull();
    });

    it("returns null on JSON without a gpsData array", () => {
        expect(parseNextbaseGdat(base64Payload({ cameraModel: "622GW" }), "nextbase.mp4")).toBeNull();
    });

    it("returns null on payload that is not Base64 JSON", () => {
        expect(parseNextbaseGdat(encodeUtf8("not base64 at all!!"), "nextbase.mp4")).toBeNull();
    });
});

describe("hasNextbaseGdatHead", () => {
    it("accepts the Base64 of a JSON object", () => {
        expect(hasNextbaseGdatHead(base64Payload(TRACK).slice(0, 64))).toBe(true);
    });

    it("accepts an indented dump, whose Base64 opens 'ew' and not 'ey'", () => {
        // The second Base64 character carries the top 4 bits of the byte after
        // `{`, so a newline there shifts it from 'y' to 'w'. The producer is
        // desktop software; a compact-only gate makes such a file unreachable.
        const head = base64Payload(TRACK, 2).slice(0, 64);
        expect(String.fromCharCode(head[0]!, head[1]!)).toBe("ew");
        expect(hasNextbaseGdatHead(head)).toBe(true);
    });

    it("accepts a CRLF-indented dump", () => {
        expect(hasNextbaseGdatHead(base64Bytes('{\r\n  "gpsData": [],\r\n  "cameraModel": "622GW"\r\n}'))).toBe(true);
    });

    it("tolerates the atom's trailing NUL padding", () => {
        const head = new Uint8Array(64);
        head.set(base64Payload(TRACK).slice(0, 40));
        expect(hasNextbaseGdatHead(head)).toBe(true);
    });

    it("rejects binary that happens to start with the same two letters", () => {
        const head = new Uint8Array(64).fill(0xff);
        head[0] = "e".charCodeAt(0);
        head[1] = "y".charCodeAt(0);
        expect(hasNextbaseGdatHead(head)).toBe(false);
    });

    it("rejects Base64 of something that is not a JSON object", () => {
        // Base64 of "hello world" - valid alphabet, wrong opening.
        expect(hasNextbaseGdatHead(Uint8Array.from(btoa("hello world!!!"), (c) => c.charCodeAt(0)))).toBe(false);
    });
});

const ascii = (text: string): Uint8Array => Uint8Array.from(text, (ch) => ch.charCodeAt(0) & 0xff);

function mp4Box(type: string, payload: Uint8Array): Uint8Array<ArrayBuffer> {
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

describe("gdat through indexing", () => {
    async function load(bytes: Uint8Array<ArrayBuffer>, name: string) {
        const file = new File([bytes as BlobPart], name);
        const vf: VendorFile = { file, relativePath: name };
        return { vf, index: await buildMp4Index(file) };
    }

    const FTYP = mp4Box("ftyp", ascii("mp42\0\0\0\0mp42isom"));

    it("indexes the atom, marks it, and parses it", async () => {
        const { vf, index } = await load(
            concat([FTYP, mp4Box("mdat", new Uint8Array(64)), mp4Box("gdat", base64Payload(TRACK))]),
            "nextbase.mp4",
        );
        expect(index.topLevelGdatAtom).not.toBeNull();
        expect(await nextbaseGdatPrimitive.marker(vf, index)).toBe(true);

        const parsed = await nextbaseGdatPrimitive.parse(vf, index);
        expect(parsed.records).toHaveLength(2);
    });

    it("does not claim a file without the atom", async () => {
        const { vf, index } = await load(concat([FTYP, mp4Box("mdat", new Uint8Array(64))]), "plain.mp4");
        expect(index.topLevelGdatAtom).toBeNull();
        expect(await nextbaseGdatPrimitive.marker(vf, index)).toBe(false);
    });
});
