import { describe, expect, it } from "vitest";

import { packBgrPlanarStandardized } from "./vittrack-pixels.js";

describe("packBgrPlanarStandardized", () => {
    it("matches scalar normalization bit for bit for every byte in every BGR plane", () => {
        const rgba = new Uint8ClampedArray(256 * 4);
        const expected = new Float32Array(256 * 3);
        for (let value = 0; value < 256; value++) {
            const red = value;
            const green = 255 - value;
            const blue = (value * 73) & 255;
            rgba.set([red, green, blue, value], value * 4);
            expected[value] = (blue / 255 - 0.485) / 0.229;
            expected[256 + value] = (green / 255 - 0.456) / 0.224;
            expected[512 + value] = (red / 255 - 0.406) / 0.225;
        }
        const actual = new Float32Array(expected.length);
        packBgrPlanarStandardized(rgba, actual);
        expect(new Uint32Array(actual.buffer)).toEqual(new Uint32Array(expected.buffer));
    });

    it("fully replaces a reused tensor and ignores alpha", () => {
        const target = new Float32Array(6);
        packBgrPlanarStandardized(new Uint8ClampedArray([255, 128, 0, 0, 64, 32, 16, 255]), target);
        const expected = target.slice();
        target.fill(42);
        packBgrPlanarStandardized(new Uint8ClampedArray([255, 128, 0, 255, 64, 32, 16, 0]), target);
        expect(target).toEqual(expected);
    });
});
