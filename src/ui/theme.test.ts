// Regression coverage for withAlpha - the fix for the #000b8 trail-overlay bug.
//
// The production CSS minifier shortens #rrggbb -> #rgb (#000000 -> #000). The
// theme colors append an 8-bit alpha to a hex color; on a shortened #000 a naive
// concat produced the invalid 5-digit #000b8, which maplibre rejected outright
// (breaking the dark-theme trail overlay on every trip load). withAlpha expands
// the shorthand first so the result is always a valid #rrggbbaa.

import { describe, expect, it } from "vitest";

import { withAlpha } from "./theme.js";

describe("withAlpha", () => {
    it("expands a 3-digit shorthand before appending alpha (the #000b8 bug)", () => {
        expect(withAlpha("#000", "b8")).toBe("#000000b8");
        expect(withAlpha("#fff", "33")).toBe("#ffffff33");
        expect(withAlpha("#abc", "55")).toBe("#aabbcc55");
    });

    it("passes a 6-digit hex through unchanged", () => {
        expect(withAlpha("#f5f4f1", "b8")).toBe("#f5f4f1b8");
        expect(withAlpha("#ff9000", "33")).toBe("#ff900033");
    });

    it("trims surrounding whitespace (getComputedStyle can return padded values)", () => {
        expect(withAlpha("  #000  ", "b8")).toBe("#000000b8");
    });

    it("leaves a non-hex color (rgb(), named) untouched aside from the appended alpha", () => {
        // Not a case we hit today (tokens are hex), but the guard must not
        // corrupt a non-#rgb value into something worse.
        expect(withAlpha("rgb(0,0,0)", "b8")).toBe("rgb(0,0,0)b8");
    });
});
