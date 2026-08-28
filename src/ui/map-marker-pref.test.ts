import { beforeEach, describe, expect, it } from "vitest";

import {
    _resetForTests,
    DEFAULT_MAP_MARKER_APPEARANCE,
    getMapMarkerAppearance,
    normalizeMapMarkerAppearance,
    setMapMarkerAppearance,
    subscribeMapMarkerAppearance,
} from "./map-marker-pref.js";

describe("map marker preference", () => {
    beforeEach(() => _resetForTests());

    it("falls back field by field for malformed stored values", () => {
        expect(normalizeMapMarkerAppearance({ shape: "suv", color: "#2F7EE6" })).toEqual({
            shape: "suv",
            color: "#2f7ee6",
            size: "medium",
        });
        expect(normalizeMapMarkerAppearance({ shape: "boat", color: "blue" })).toEqual(DEFAULT_MAP_MARKER_APPEARANCE);
    });

    it("keeps the choice for the session and notifies subscribers", () => {
        const seen: string[] = [];
        subscribeMapMarkerAppearance((appearance) => seen.push(`${appearance.shape}:${appearance.color}`));
        setMapMarkerAppearance({ shape: "truck", color: "#E5484D", size: "large" });
        expect(getMapMarkerAppearance()).toEqual({ shape: "truck", color: "#e5484d", size: "large" });
        expect(seen).toEqual(["truck:#e5484d"]);
    });
});
