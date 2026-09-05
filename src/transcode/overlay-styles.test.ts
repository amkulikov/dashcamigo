// Unit tests for the overlay style table + helpers. The drawing code reads
// STYLE_CHROME instead of branching on the style id, so these guards keep the
// table complete and the resolve/compose helpers honest.

import { describe, expect, it } from "vitest";

import { composeFont, resolveStyleColor, STYLE_CHROME } from "./overlay-styles.js";
import type { OverlayStyleId } from "./types.js";

const STYLES: OverlayStyleId[] = ["min", "card", "bold"];

describe("STYLE_CHROME", () => {
    it("keeps min plate-less + shadowed (the legacy look)", () => {
        expect(STYLE_CHROME.min.plate).toBeNull();
        expect(STYLE_CHROME.min.plateBorder).toBeNull();
        expect(STYLE_CHROME.min.shadow).toBe(true);
        expect(STYLE_CHROME.min.heroSpeed).toBe(false);
    });

    it("gives card a bordered plate and no shadow", () => {
        expect(STYLE_CHROME.card.plate).not.toBeNull();
        expect(STYLE_CHROME.card.plateBorder).not.toBeNull();
        expect(STYLE_CHROME.card.shadow).toBe(false);
        expect(STYLE_CHROME.card.heroSpeed).toBe(false);
    });

    it("makes bold plate-less, shadowed, with a hero speed", () => {
        expect(STYLE_CHROME.bold.plate).toBeNull();
        expect(STYLE_CHROME.bold.shadow).toBe(true);
        expect(STYLE_CHROME.bold.heroSpeed).toBe(true);
    });

    it("accents the coordinate hemisphere keys in every style", () => {
        for (const id of STYLES) expect(STYLE_CHROME[id].coordKeyColor).toBe("accent");
    });
});

describe("resolveStyleColor", () => {
    it("maps the 'accent' token to the run accent and passes literals through", () => {
        expect(resolveStyleColor("accent", "#123456")).toBe("#123456");
        expect(resolveStyleColor("#FFFFFF", "#123456")).toBe("#FFFFFF");
    });
});

describe("composeFont", () => {
    it("builds a canvas font string and rounds/floors the px", () => {
        expect(composeFont("700", 24.6, `"Inter"`)).toBe(`700 25px "Inter"`);
        expect(composeFont("800", 2, "monospace")).toBe("800 8px monospace"); // min 8px
    });
});
