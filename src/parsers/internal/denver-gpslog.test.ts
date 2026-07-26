// Denver bracketed GPS log: decode, strictness, and both carriers it can
// arrive in (top-level `udat`, and the `gps ` child of a `free` box, where it
// must not disturb the BlackVue NMEA path that owns the same bytes).

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildMp4Index } from "./mp4-index.js";
import { dispatchParseVideoEmbeddedGps } from "../registry.js";
import { hasDenverRecordStart, parseDenverGpsLog } from "./denver-gpslog.js";
import { tryExtractFreeGpsBox } from "./free-gps-box-extract.js";
import { gpsLogAtomPrimitive, gpsLogNbmtPrimitive } from "../primitives/gpslog-atom.js";
import { KMH_TO_MS, type VendorFile } from "../types.js";

// Verbatim from the ExifTool source comment (QuickTimeStream.pl:3116-3118,
// v13.55) - the only dump of this format that exists publicly.
const VERBATIM_RECORD = `210318073213[1][N][52200970][E][006362321][+00152][100][00140][C000000]${"+000".repeat(18)}`;

// Southern/western hemispheres, a zero speed and a 359 heading - none of which
// the single upstream record exercises.
const SOUTHWEST_RECORD = "210318073214[1][S][12345678][W][123456789][-00020][000][00359][C000010]+001-002+003";

describe("parseDenverGpsLog", () => {
    it("decodes the verbatim upstream record", () => {
        const parsed = parseDenverGpsLog(VERBATIM_RECORD, "denver.mp4");
        expect(parsed).not.toBeNull();
        expect(parsed!.records).toHaveLength(1);
        const r = parsed!.records[0]!;

        expect(r.unixSeconds).toBe(Date.UTC(2021, 2, 18, 7, 32, 13) / 1000);
        // DD + minutes*1e4: 52 + 200970/600000. Lands near Hengelo, NL - a
        // sanity signal only, the layout is not sample-validated.
        expect(r.lat).toBeCloseTo(52.33495, 6);
        expect(r.lon).toBeCloseTo(6.6038683, 6);
        expect(r.speedMs).toBeCloseTo(100 * KMH_TO_MS, 6);
        expect(r.bearingDeg).toBe(140);
        expect(r.active).toBe(true);
        // The trailing +NNN run has no documented scale or axis order upstream.
        expect([r.accelXg, r.accelYg, r.accelZg]).toEqual([0, 0, 0]);
    });

    it("applies the hemisphere signs", () => {
        const parsed = parseDenverGpsLog(SOUTHWEST_RECORD, "denver.mp4");
        const r = parsed!.records[0]!;
        expect(r.lat).toBeCloseTo(-12.57613, 5);
        expect(r.lon).toBeCloseTo(-123.761315, 6);
        expect(r.speedMs).toBe(0);
        expect(r.bearingDeg).toBe(359);
    });

    it("reads every record of a newline-separated log", () => {
        const parsed = parseDenverGpsLog(`${VERBATIM_RECORD}\n${SOUTHWEST_RECORD}\n`, "denver.mp4");
        expect(parsed!.records).toHaveLength(2);
    });

    it("reads back-to-back records with no separator", () => {
        // This is what the dropped `\b` buys: the accel run ends in a digit, so
        // upstream's anchor would match only the first record here.
        const parsed = parseDenverGpsLog(VERBATIM_RECORD + SOUTHWEST_RECORD, "denver.mp4");
        expect(parsed!.records).toHaveLength(2);
        expect(parsed!.records[1]!.lat).toBeLessThan(0);
    });

    it("rejects a minutes field that cannot be minutes", () => {
        // 700000 = 70.0 minutes.
        const bad = VERBATIM_RECORD.replace("[52200970]", "[52700000]");
        expect(parseDenverGpsLog(bad, "denver.mp4")).toBeNull();
    });

    it("rejects an out-of-range latitude", () => {
        const bad = VERBATIM_RECORD.replace("[52200970]", "[95200970]");
        expect(parseDenverGpsLog(bad, "denver.mp4")).toBeNull();
    });

    it("rejects an impossible month instead of letting Date.UTC roll it over", () => {
        const bad = VERBATIM_RECORD.replace("210318073213", "211918073213");
        expect(parseDenverGpsLog(bad, "denver.mp4")).toBeNull();
    });

    it("drops a null-island fix even though it claims a valid status", () => {
        const zeroed = VERBATIM_RECORD.replace("[52200970]", "[00000000]").replace("[006362321]", "[000000000]");
        expect(parseDenverGpsLog(zeroed, "denver.mp4")).toBeNull();
    });

    it("does not claim NMEA text", () => {
        const nmea =
            "[1555957502837]$GPRMC,062502.00,A,4137.12345,N,00204.54321,E,0.0,0.0,190419,,,A*7A\n" +
            "[1555957503837]$GPGGA,062503.00,4137.12345,N,00204.54321,E,1,08,0.9,120.0,M,,,,*5A\n";
        expect(hasDenverRecordStart(nmea)).toBe(false);
        expect(parseDenverGpsLog(nmea, "blackvue.mp4")).toBeNull();
    });

    it("does not claim a record whose status slot is not 1", () => {
        const noFix = VERBATIM_RECORD.replace("[1][N]", "[0][N]");
        expect(hasDenverRecordStart(noFix)).toBe(false);
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

const FTYP = mp4Box("ftyp", ascii("mp42\0\0\0\0mp42isom"));

async function loadFile(bytes: Uint8Array<ArrayBuffer>, name: string) {
    const file = new File([bytes as BlobPart], name);
    const vf: VendorFile = { file, relativePath: name };
    return { vf, index: await buildMp4Index(file) };
}

describe("udat carrier", () => {
    it("indexes the atom and parses a Denver log out of it", async () => {
        // NUL padding, as the atom is padded to its box size.
        const payload = ascii(`${VERBATIM_RECORD}\n${SOUTHWEST_RECORD}\n`.padEnd(256, "\0"));
        const { vf, index } = await loadFile(
            concat([FTYP, mp4Box("mdat", new Uint8Array(64)), mp4Box("udat", payload)]),
            "denver.mp4",
        );

        expect(index.topLevelUdatAtom).not.toBeNull();
        expect(await gpsLogAtomPrimitive.marker(vf, index)).toBe(true);

        const parsed = await gpsLogAtomPrimitive.parse(vf, index);
        expect(parsed.records).toHaveLength(2);
        expect(parsed.records[0]!.lat).toBeCloseTo(52.33495, 6);
    });

    it("parses NMEA out of the same atom - the dialect upstream expects first", async () => {
        const nmea = "$GPRMC,062502.00,A,4137.12345,N,00204.54321,E,10.0,90.0,190419,,,A*4E\n";
        const { vf, index } = await loadFile(
            concat([FTYP, mp4Box("mdat", new Uint8Array(64)), mp4Box("udat", ascii(nmea.padEnd(256, "\0")))]),
            "datakam.mp4",
        );

        expect(await gpsLogAtomPrimitive.marker(vf, index)).toBe(true);
        const parsed = await gpsLogAtomPrimitive.parse(vf, index);
        expect(parsed.records).toHaveLength(1);
        expect(parsed.records[0]!.lat).toBeCloseTo(41 + 37.12345 / 60, 6);
    });

    it("does not claim a udat atom holding something else", async () => {
        const { vf, index } = await loadFile(
            concat([FTYP, mp4Box("udat", ascii("some unrelated user data".padEnd(128, "\0")))]),
            "other.mp4",
        );
        expect(index.topLevelUdatAtom).not.toBeNull();
        expect(index.topLevelUdatAtom!.head).not.toBeNull();
        expect(await gpsLogAtomPrimitive.marker(vf, index)).toBe(false);
    });

    it("reads a head long enough for a clock-prefixed NMEA line", async () => {
        // 15-char `[camera clock]` before the sentence: the head window has to
        // clear the prefix or the marker misses every BlackVue-style log.
        const prefixed = "[1555957502837]$GPRMC,062502.00,A,4137.12345,N,00204.54321,E,10.0,90.0,190419,,,A*4E\n";
        const { vf, index } = await loadFile(
            concat([FTYP, mp4Box("udat", ascii(prefixed.padEnd(256, "\0")))]),
            "prefixed.mp4",
        );
        expect(await gpsLogAtomPrimitive.marker(vf, index)).toBe(true);
    });

    it("claims a log that opens with a sentence the parser does not decode", async () => {
        // A receiver dump opens with whatever its firmware emits first, and one
        // GGA line alone is 73 bytes. Gating on "an RMC in the first line" would
        // drop this file with no diagnostic, though the RMC is right behind it.
        const log =
            "$GPGGA,062502.00,4137.12345,N,00204.54321,E,1,08,0.9,545.4,M,46.9,M,,*47\n" +
            "$GPRMC,062502.00,A,4137.12345,N,00204.54321,E,10.0,90.0,190419,,,A*4E\n";
        const { vf, index } = await loadFile(
            concat([FTYP, mp4Box("udat", ascii(log.padEnd(512, "\0")))]),
            "gga-first.mp4",
        );
        expect(await gpsLogAtomPrimitive.marker(vf, index)).toBe(true);
        const parsed = await gpsLogAtomPrimitive.parse(vf, index);
        expect(parsed.records).toHaveLength(1);
        expect(parsed.records[0]!.lat).toBeCloseTo(41 + 37.12345 / 60, 6);
    });

    it("finds a Denver record that does not start the payload", async () => {
        // Same exposure on the other dialect: the head window has to clear
        // whatever the firmware writes ahead of the first record.
        const header = "ACG-8050WMK2 driving log - firmware 1.02 - records follow\n";
        const { vf, index } = await loadFile(
            concat([FTYP, mp4Box("udat", ascii(`${header}${VERBATIM_RECORD}\n`.padEnd(512, "\0")))]),
            "denver-header.mp4",
        );
        expect(await gpsLogAtomPrimitive.marker(vf, index)).toBe(true);
        expect((await gpsLogAtomPrimitive.parse(vf, index)).records).toHaveLength(1);
    });

    it("has no atom, no claim", async () => {
        const { vf, index } = await loadFile(concat([FTYP, mp4Box("mdat", new Uint8Array(64))]), "plain.mp4");
        expect(index.topLevelUdatAtom).toBeNull();
        expect(await gpsLogAtomPrimitive.marker(vf, index)).toBe(false);
    });

    it("reads the Nextbase `nbmt` atom through the same decoders", async () => {
        // Upstream routes nbmt to its generic text parser and documents nothing
        // about the payload, so this is speculative by construction - what the
        // test pins is that the carrier is wired, not what a real camera writes.
        const nmea = "$GPRMC,062502.00,A,4137.12345,N,00204.54321,E,10.0,90.0,190419,,,A*4E\n";
        const { vf, index } = await loadFile(
            concat([FTYP, mp4Box("mdat", new Uint8Array(64)), mp4Box("nbmt", ascii(nmea.padEnd(256, "\0")))]),
            "nextbase.mp4",
        );
        expect(index.topLevelNbmtAtom).not.toBeNull();
        expect(await gpsLogNbmtPrimitive.marker(vf, index)).toBe(true);
        expect((await gpsLogNbmtPrimitive.parse(vf, index)).records).toHaveLength(1);
        // The two carriers are separate primitives so they can sit at different
        // points of the walk - neither may answer for the other's atom.
        expect(await gpsLogAtomPrimitive.marker(vf, index)).toBe(false);
    });

    it("the nbmt primitive does not answer for a udat log", async () => {
        const nmea = "$GPRMC,062502.00,A,4137.12345,N,00204.54321,E,10.0,90.0,190419,,,A*4E\n";
        const { vf, index } = await loadFile(
            concat([FTYP, mp4Box("mdat", new Uint8Array(64)), mp4Box("udat", ascii(nmea.padEnd(256, "\0")))]),
            "datakam.mp4",
        );
        expect(await gpsLogNbmtPrimitive.marker(vf, index)).toBe(false);
    });
});

describe("udat does not shadow other carriers", () => {
    it("an unrelated udat leaves a real freeGPS file parsing", async () => {
        // A camera may write unrelated user data in `udat` and its GPS
        // elsewhere. The udat primitive must not claim such a file, and the
        // real winner must still be reached.
        const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
        const original = readFileSync(resolve(REPO_ROOT, "tests/testdata/novatek-real-anonymized/2e-drive-730.mp4"));
        const name = "2021_1013_183759_050.MP4";
        const bytes = concat([
            new Uint8Array(original),
            mp4Box("udat", ascii("some unrelated user data".padEnd(128, "\0"))),
        ]);

        const result = await dispatchParseVideoEmbeddedGps([
            {
                file: { file: new File([bytes as BlobPart], name), relativePath: name },
                role: "video",
                sidecarId: null,
                sidecarMp4: null,
                logExtractorId: null,
            },
        ]);
        expect(result.appliedExtractors).toContain("freegps");
        expect(result.records.length).toBeGreaterThan(0);
    });
});

describe("free/`gps ` carrier", () => {
    async function loadFreeBox(gpsPayload: string) {
        const free = mp4Box("free", mp4Box("gps ", ascii(gpsPayload)));
        return loadFile(concat([FTYP, free, mp4Box("mdat", new Uint8Array(64))]), "clip.mp4");
    }

    it("falls through to the Denver decode when the NMEA pass finds nothing", async () => {
        const { vf, index } = await loadFreeBox(`${VERBATIM_RECORD}\n`);
        const parsed = await tryExtractFreeGpsBox(vf, index);
        expect(parsed).not.toBeNull();
        expect(parsed!.records).toHaveLength(1);
        expect(parsed!.records[0]!.lat).toBeCloseTo(52.33495, 6);
    });

    it("leaves the BlackVue NMEA path untouched", async () => {
        const { vf, index } = await loadFreeBox(
            "[1555957502837]$GPRMC,062502.00,A,4137.12345,N,00204.54321,E,10.0,90.0,190419,,,A*4E\n",
        );
        const parsed = await tryExtractFreeGpsBox(vf, index);
        expect(parsed!.records).toHaveLength(1);
        expect(parsed!.records[0]!.lat).toBeCloseTo(41 + 37.12345 / 60, 6);
    });

    it("still returns null when the box holds neither dialect", async () => {
        const { vf, index } = await loadFreeBox("nothing parseable here\n");
        expect(await tryExtractFreeGpsBox(vf, index)).toBeNull();
    });
});
