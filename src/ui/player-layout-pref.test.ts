import { describe, expect, it } from "vitest";
import type { Channel } from "../parsers/types.js";
import { cameraSetKey, reconcileStoredLayout } from "./player-layout-pref.js";

describe("cameraSetKey", () => {
    it("prefers fingerprints, sorted and de-duplicated", () => {
        expect(cameraSetKey(["b", "a", "b"], ["front", "rear"])).toBe("fp:a|b");
    });

    it("falls back to the channel set when no fingerprint is present", () => {
        expect(cameraSetKey([], ["rear", "front"])).toBe("ch:front|rear");
    });

    it("ignores empty fingerprints", () => {
        expect(cameraSetKey(["", ""], ["front"])).toBe("ch:front");
    });
});

describe("reconcileStoredLayout", () => {
    const playable: Channel[] = ["front", "rear"];

    it("returns null with no stored entry", () => {
        expect(reconcileStoredLayout(null, playable)).toBeNull();
    });

    it("returns null for single-channel trips (nothing to arrange)", () => {
        expect(reconcileStoredLayout({ layout: "single", channelOrder: ["front"] }, ["front"])).toBeNull();
    });

    it("keeps a matching stored order + layout verbatim", () => {
        const out = reconcileStoredLayout({ layout: "pip2", channelOrder: ["rear", "front"] }, playable);
        expect(out).toEqual({ layout: "pip2", channelOrder: ["rear", "front"] });
    });

    it("drops a channel the trip no longer has and adjusts the layout", () => {
        // Stored 3-cam pip3 order, but this trip only has front+rear.
        const out = reconcileStoredLayout({ layout: "pip3", channelOrder: ["interior", "rear", "front"] }, playable);
        // interior dropped; order keeps the stored relative order of survivors.
        expect(out).toEqual({ layout: "pip2", channelOrder: ["rear", "front"] });
    });

    it("appends a playable channel missing from the stored order (canonical order)", () => {
        const out = reconcileStoredLayout({ layout: "pip2", channelOrder: ["rear", "front"] }, [
            "front",
            "rear",
            "interior",
        ]);
        // interior appended; layout grows from pip2 to the 3-slot default.
        expect(out).toEqual({ layout: "pip3", channelOrder: ["rear", "front", "interior"] });
    });

    it("falls back to the default layout when the stored layout's slot count no longer fits", () => {
        // Stored a 3-slot layout but only 2 cameras survive.
        const out = reconcileStoredLayout({ layout: "pip3", channelOrder: ["rear", "front"] }, playable);
        expect(out).toEqual({ layout: "pip2", channelOrder: ["rear", "front"] });
    });
});
