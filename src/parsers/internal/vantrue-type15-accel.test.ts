// Vantrue N4/N2X Type-15 accel: the binary preamble read that sits alongside
// the RMC tail the GPS already comes from (ExifTool GPSType 15,
// QuickTimeStream.pl:2240-2261, v13.55).

import { describe, it, expect } from "vitest";
import { createFreeGpsBlockParser } from "./freegps.js";
import { _internal } from "../primitives/freegps.js";

const { removeGravityIncludedAccelBaseline } = _internal;

const MAGIC = "freeGPS ";
const RMC = "$GNRMC,132230.000,A,4721.35197,N,00830.80859,E,22.519,199.88,141222,,,A*75\r\n";

/**
 * Type-15 block, laid out from upstream's hexdump: literal 0 is the `freeGPS `
 * literal, the status/hemisphere gate bytes sit at 24/36/52, the accel triple
 * at 88 and the RMC sentence at 100.
 */
function type15Block(accel: [number, number, number] | null): DataView {
    const bytes = new Uint8Array(512);
    const dv = new DataView(bytes.buffer);
    for (let i = 0; i < MAGIC.length; i++) bytes[i] = MAGIC.charCodeAt(i);

    bytes[24] = 0x41; // 'A' - fix valid
    bytes[36] = 0x4e; // 'N'
    bytes[52] = 0x45; // 'E'
    if (accel) {
        dv.setInt32(88, Math.round(accel[0] * 1000), true);
        dv.setInt32(92, Math.round(accel[1] * 1000), true);
        dv.setInt32(96, Math.round(accel[2] * 1000), true);
    }
    for (let i = 0; i < RMC.length; i++) bytes[100 + i] = RMC.charCodeAt(i);
    return dv;
}

function parseBlock(dv: DataView) {
    return createFreeGpsBlockParser()(dv, "vantrue.mp4");
}

describe("Vantrue Type-15 accel", () => {
    it("attaches the preamble triple to the record the RMC tail produced", () => {
        // Upstream's own hexdump values: -1.038 / 0.066 / 0.002 - about 1 g on
        // one axis, i.e. gravity is included in the raw reading. The block
        // level pins the RAW triple on purpose; gravity removal is the
        // per-file pass below, which cannot run on one block.
        const records = parseBlock(type15Block([-1.038, 0.066, 0.002]));
        expect(records).toHaveLength(1);
        expect(records[0]!.accelXg).toBeCloseTo(-1.038, 6);
        expect(records[0]!.accelYg).toBeCloseTo(0.066, 6);
        expect(records[0]!.accelZg).toBeCloseTo(0.002, 6);
        // GPS still comes from the sentence, unchanged.
        expect(records[0]!.lat).toBeCloseTo(47 + 21.35197 / 60, 6);
    });

    it("leaves accel at zero when the preamble is an all-zero placeholder", () => {
        // With gravity included a real reading always has ~1 g somewhere, so an
        // all-zero triple is a placeholder, not a car at rest.
        const records = parseBlock(type15Block(null));
        expect(records).toHaveLength(1);
        expect([records[0]!.accelXg, records[0]!.accelYg, records[0]!.accelZg]).toEqual([0, 0, 0]);
    });

    it("does not read the triple when the block is not Type-15 geometry", () => {
        // Same RMC, but the status/hemisphere gate bytes are absent - whatever
        // sits at offset 88 belongs to some other layout and must not be read
        // as gravity.
        const dv = type15Block([-1.038, 0.066, 0.002]);
        new Uint8Array(dv.buffer)[24] = 0x00;
        const records = parseBlock(dv);
        expect(records).toHaveLength(1);
        expect([records[0]!.accelXg, records[0]!.accelYg, records[0]!.accelZg]).toEqual([0, 0, 0]);
    });
});

// The gravity-included triple must not reach GpsRecord as-is: 1.04 g on every
// record clears the impact threshold, so the trip would show a brake marker
// every few seconds for its whole length.
describe("Vantrue Type-15 accel: per-file gravity removal in the primitive", () => {
    it("subtracts the per-axis mean over the file, keeping the deviation", () => {
        const fileParser = createFreeGpsBlockParser();
        const records = [
            ...fileParser(type15Block([-1.0, 0.05, 0.0]), "vantrue.mp4"),
            ...fileParser(type15Block([-1.1, 0.05, 0.02]), "vantrue.mp4"),
        ];
        expect(records).toHaveLength(2);

        removeGravityIncludedAccelBaseline(records, fileParser);

        // Mean is the gravity+tilt estimate: X -1.05, Y 0.05, Z 0.01.
        expect(records[0]!.accelXg).toBeCloseTo(0.05, 6);
        expect(records[1]!.accelXg).toBeCloseTo(-0.05, 6);
        expect(records[0]!.accelYg).toBeCloseTo(0, 6);
        expect(records[0]!.accelZg).toBeCloseTo(-0.01, 6);
        expect(records[1]!.accelZg).toBeCloseTo(0.01, 6);
    });

    it("zeroes the accel of a single-sample file", () => {
        // One observation cannot separate the static bias from motion, and a
        // raw ~1 g left in place false-triggers the impact detector.
        const fileParser = createFreeGpsBlockParser();
        const records = [...fileParser(type15Block([-1.038, 0.066, 0.002]), "vantrue.mp4")];

        removeGravityIncludedAccelBaseline(records, fileParser);

        expect([records[0]!.accelXg, records[0]!.accelYg, records[0]!.accelZg]).toEqual([0, 0, 0]);
    });
});
