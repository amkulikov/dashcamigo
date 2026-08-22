import { describe, expect, it } from "vitest";

import { utcMillisecondsFromParts } from "./calendar.js";

describe("utcMillisecondsFromParts", () => {
    it("keeps a valid leap day", () => {
        expect(utcMillisecondsFromParts(2024, 2, 29, 12, 34, 56)).toBe(Date.UTC(2024, 1, 29, 12, 34, 56));
    });

    it("rejects a day that JavaScript would roll into the next month", () => {
        expect(utcMillisecondsFromParts(2026, 2, 31, 12, 0, 0)).toBeNull();
        expect(utcMillisecondsFromParts(2026, 4, 31, 12, 0, 0)).toBeNull();
    });

    it("normalizes an allowed leap second to the next UTC second", () => {
        expect(utcMillisecondsFromParts(2016, 12, 31, 23, 59, 60, true)).toBe(Date.UTC(2017, 0, 1));
    });

    it("rejects negative clock fields", () => {
        expect(utcMillisecondsFromParts(2026, 1, 1, -1, 0, 0)).toBeNull();
    });
});
