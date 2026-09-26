import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { hasViidureBody, parseViidureBody } from "./viidure.js";
import { extractTsPesGps, findTsPesGpsStream } from "./ts-pes-gps.js";
import { WrongFormatError } from "../types.js";

const fixture = readFileSync(new URL("../__fixtures__/viidure-ts/20260926_132423_F.TS", import.meta.url));
const start = fixture.indexOf("Viidure");
const line = fixture.subarray(start, fixture.indexOf(0, start)).toString("ascii");
const body = (text: string) => new TextEncoder().encode(text);

describe("Viidure record validation", () => {
    it.each([
        ["Viidure", "OtherXX"],
        ["2026/09/26", "2026/02/30"],
        ["12:24:23", "24:24:23"],
        ["N:52.000000", "N:91.000000"],
        ["W:1.000000", "W:181.000000"],
        ["N:52.000000", "N:NaN"],
        ["km/h", "mph"],
        ["0.5 km/h", "-1.0 km/h"],
        ["km/h 0.50", "km/h 361.00"],
        [" z:-0.001", ""],
    ])("rejects %s replaced by %s", (from, to) => {
        expect(line).toContain(from);
        expect(parseViidureBody(body(line.replace(from, to)), "clip.ts")).toBeNull();
    });

    it("applies southern and eastern hemisphere signs", () => {
        const record = parseViidureBody(body(line.replace("N:", "S:").replace("W:", "E:")), "clip.ts");
        expect(record?.lat).toBe(-52);
        expect(record?.lon).toBe(1);
    });

    it("rejects a false-positive signature without GPS", async () => {
        const corrupt = Buffer.from(fixture);
        for (let at = corrupt.indexOf("Viidure"); at >= 0; at = corrupt.indexOf("Viidure", at + 7)) {
            corrupt.fill(0, at + 7, at + 100);
        }
        expect(hasViidureBody(body("Viidure"))).toBe(true);
        expect(findTsPesGpsStream(corrupt)?.dialect).toBe("viidure");
        await expect(
            extractTsPesGps({ file: new File([corrupt], "clip.ts"), relativePath: "clip.ts" }, corrupt),
        ).rejects.toBeInstanceOf(WrongFormatError);
    });

    it("passes cancellation through", async () => {
        const controller = new AbortController();
        controller.abort();
        await expect(
            extractTsPesGps(
                { file: new File([fixture], "clip.ts"), relativePath: "clip.ts" },
                fixture,
                controller.signal,
            ),
        ).rejects.toMatchObject({ name: "AbortError" });
    });
});
