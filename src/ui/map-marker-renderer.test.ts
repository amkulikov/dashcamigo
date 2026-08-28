import { describe, expect, it } from "vitest";

import { isMapMarkerBodyPixel, mapMarkerPitchScale, recolorMapMarkerBodyPixel } from "./map-marker-renderer.js";

describe("map marker recoloring", () => {
    it("selects blue paint but leaves glass, lights and tires alone", () => {
        expect(isMapMarkerBodyPixel(20, 90, 220), "blue body paint").toBe(true);
        expect(isMapMarkerBodyPixel(32, 51, 62), "blue-gray glass").toBe(false);
        expect(isMapMarkerBodyPixel(245, 235, 205), "headlight").toBe(false);
        expect(isMapMarkerBodyPixel(230, 28, 12), "tail light").toBe(false);
        expect(isMapMarkerBodyPixel(18, 18, 18), "tire").toBe(false);
    });

    it("keeps red paint red instead of wrapping its hue into black", () => {
        const [red, green, blue] = recolorMapMarkerBodyPixel(20, 90, 220, "#e5484d");
        expect(red).toBeGreaterThan(120);
        expect(red).toBeGreaterThan(green * 1.8);
        expect(red).toBeGreaterThan(blue * 1.5);
    });

    it("honors light and dark custom colors without flattening the paint", () => {
        const white = recolorMapMarkerBodyPixel(20, 90, 220, "#ffffff");
        const black = recolorMapMarkerBodyPixel(20, 90, 220, "#000000");
        expect(Math.min(...white)).toBeGreaterThan(180);
        expect(Math.max(...black)).toBeLessThan(70);
        expect(white[0]).toBe(white[1]);
        expect(black[1]).toBe(black[2]);
    });

    it("foreshortens pitched markers without collapsing them", () => {
        expect(mapMarkerPitchScale(0)).toBe(1);
        expect(mapMarkerPitchScale(58)).toBeCloseTo(0.93, 1);
        expect(mapMarkerPitchScale(70)).toBeGreaterThan(0.9);
        expect(mapMarkerPitchScale(100)).toBe(mapMarkerPitchScale(70));
    });
});
