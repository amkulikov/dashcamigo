import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseDdpaiNmea } from "./ddpai-nmea.js";
import { parseNmeaText } from "./nmea.js";

function fixture(name: string): string {
    return readFileSync(new URL(`../__fixtures__/ddpai-gps/${name}`, import.meta.url), "utf8");
}

// The current GPS section without the sensor block that normally terminates
// it: what a recording cut short leaves behind.
function unterminatedSection(text: string): string {
    return text.slice(0, text.indexOf("$GSENSORSTARTTIME"));
}

// Everything the previous recording left after the current sensor block.
function recycledTail(text: string): string {
    const marker = /^\$GSENSORENDTIME \d{14}\r?\n/m.exec(text);
    if (!marker) throw new Error("fixture has no sensor block");
    return text.slice(marker.index + marker[0].length);
}

describe("parseDdpaiNmea section boundaries", () => {
    it("stops at a mid-line write boundary when no sensor block follows the current section", () => {
        const staleTail = fixture("stale-tail.gpx");
        const tail = recycledTail(staleTail);
        // The anonymizer drops the real fragment (it may carry a partial
        // coordinate), so the write boundary is rebuilt from the first
        // recycled line. Without the cut the 15 older fixes would attach.
        expect(parseNmeaText(unterminatedSection(staleTail) + tail, "clip.mp4").records).toHaveLength(15);
        const text = unterminatedSection(staleTail) + tail.slice(3);
        expect(parseDdpaiNmea(text, "20261006213217_0009_D.gpx", "20261006213217_0009.mp4")).toEqual([]);
    });

    it("ends the section when a fix runs backwards in time across a clean line boundary", () => {
        const current = unterminatedSection(fixture("valid.gpx"));
        const older = recycledTail(fixture("stale-tail.gpx"))
            .split("\n")
            .filter((line) => /^\$GP(?:RMC|GGA),/.test(line))
            .join("\n");
        const records = parseDdpaiNmea(current + older, "20261006214554_0060.gpx", "20261006214554_0060.mp4");
        expect(records).toHaveLength(30);
        expect(records.at(-1)!.unixSeconds).toBe(Date.UTC(2026, 9, 6, 18, 44, 45) / 1000);
    });

    it("keeps the date gate from the filename clock when the header line is missing", () => {
        const stale = fixture("stale-date.gpx").replace(/^\$GPSCAMTIME \d{14}\r?\n/, "");
        expect(parseDdpaiNmea(stale, "20260913141341_0060.gpx", "20260913141341_0060.mp4")).toEqual([]);
        const valid = fixture("valid.gpx").replace(/^\$GPSCAMTIME \d{14}\r?\n/, "");
        expect(parseDdpaiNmea(valid, "20261006214554_0060.gpx", "20261006214554_0060.mp4")).toHaveLength(30);
    });
});
