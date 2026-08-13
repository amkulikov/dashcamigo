// Pins the label-scale transform against the REAL shipped styles: every
// text-size form that exists in public/styles/*.json (plain number, legacy
// stops function, interpolate expression) must scale its size outputs while
// zoom breakpoints stay put - MapLibre rejects a zoom expression that is not
// top-level interpolate/step, so a wrong shape here kills the whole style.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { StyleSpecification } from "maplibre-gl";
import { describe, expect, it } from "vitest";

import { scaleStyleTextSizes } from "./map-label-scale.js";

const STYLE_NAMES = ["light", "dark", "neon"] as const;

function loadStyle(name: string): StyleSpecification {
    const raw = readFileSync(join(__dirname, "..", "..", "public", "styles", `${name}.json`), "utf8");
    return JSON.parse(raw) as StyleSpecification;
}

/** Flattens one text-size value into its size outputs (the numbers that must
 *  scale) and its zoom breakpoints (the numbers that must not). */
function splitSizesAndZooms(value: unknown): { sizes: number[]; zooms: number[] } {
    if (typeof value === "number") return { sizes: [value], zooms: [] };
    if (Array.isArray(value) && value[0] === "interpolate") {
        const tail = value.slice(3);
        return {
            sizes: tail.filter((_, i) => i % 2 === 1).filter((v): v is number => typeof v === "number"),
            zooms: tail.filter((_, i) => i % 2 === 0).filter((v): v is number => typeof v === "number"),
        };
    }
    const stops = (value as { stops?: [number, number][] }).stops;
    if (Array.isArray(stops)) {
        return { sizes: stops.map((p) => p[1]), zooms: stops.map((p) => p[0]) };
    }
    return { sizes: [], zooms: [] };
}

describe("scaleStyleTextSizes", () => {
    it("returns the same reference untouched for factor 1", () => {
        const style = loadStyle("light");
        expect(scaleStyleTextSizes(style, 1)).toBe(style);
    });

    for (const name of STYLE_NAMES) {
        it(`scales every text size in ${name}.json and leaves zoom breakpoints alone`, () => {
            const original = loadStyle(name);
            const scaled = scaleStyleTextSizes(original, 1.5);
            expect(scaled, "must be a clone, the cached style stays pristine").not.toBe(original);

            let textLayers = 0;
            for (let i = 0; i < original.layers.length; i++) {
                const before = original.layers[i]!;
                const after = scaled.layers[i]!;
                const beforeSize = (before.layout as Record<string, unknown> | undefined)?.["text-size"];
                const afterSize = (after.layout as Record<string, unknown> | undefined)?.["text-size"];
                if (beforeSize === undefined) {
                    expect(afterSize, `${before.id}: layer without text-size stays untouched`).toBeUndefined();
                    continue;
                }
                textLayers++;
                const b = splitSizesAndZooms(beforeSize);
                const a = splitSizesAndZooms(afterSize);
                expect(a.sizes.length, `${before.id}: every size output survives`).toBe(b.sizes.length);
                expect(b.sizes.length, `${before.id}: the splitter recognized the shape`).toBeGreaterThan(0);
                for (let s = 0; s < b.sizes.length; s++) {
                    expect(a.sizes[s]!, `${before.id}: size output ${s}`).toBeCloseTo(b.sizes[s]! * 1.5, 6);
                }
                expect(a.zooms, `${before.id}: zoom breakpoints must not move`).toEqual(b.zooms);
            }
            // Plausibility: the styles genuinely carry label layers - a transform
            // over zero layers would vacuously pass everything above.
            expect(textLayers, "style has text layers").toBeGreaterThan(10);
        });

        it(`every text layer in ${name}.json has an explicit text-size (default-16 never needs scaling)`, () => {
            const style = loadStyle(name);
            const relyingOnDefault = style.layers.filter(
                (l) =>
                    l.type === "symbol" &&
                    (l.layout as Record<string, unknown> | undefined)?.["text-field"] !== undefined &&
                    (l.layout as Record<string, unknown> | undefined)?.["text-size"] === undefined,
            );
            expect(relyingOnDefault.map((l) => l.id)).toEqual([]);
        });
    }

    it("scales step-expression outputs but not its input breakpoints", () => {
        const style = {
            version: 8,
            sources: {},
            layers: [
                {
                    id: "t",
                    type: "symbol",
                    layout: { "text-size": ["step", ["zoom"], 10, 14, 12] },
                },
            ],
        } as unknown as StyleSpecification;
        const scaled = scaleStyleTextSizes(style, 2);
        expect((scaled.layers[0]!.layout as Record<string, unknown>)["text-size"]).toEqual([
            "step",
            ["zoom"],
            20,
            14,
            24,
        ]);
    });

    it("leaves an unrecognized expression unchanged instead of corrupting it", () => {
        const weird = ["match", ["get", "class"], "motorway", 14, 10];
        const style = {
            version: 8,
            sources: {},
            layers: [{ id: "t", type: "symbol", layout: { "text-size": weird } }],
        } as unknown as StyleSpecification;
        const scaled = scaleStyleTextSizes(style, 2);
        expect((scaled.layers[0]!.layout as Record<string, unknown>)["text-size"]).toEqual(weird);
    });
});
