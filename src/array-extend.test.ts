import { describe, expect, it } from "vitest";

import { extendArray } from "./array-extend.js";

describe("extendArray", () => {
    it("appends source onto a non-empty target in order", () => {
        const target = [1, 2];
        extendArray(target, [3, 4, 5]);
        expect(target).toEqual([1, 2, 3, 4, 5]);
    });

    it("is a no-op for an empty source", () => {
        const target = [1, 2];
        extendArray(target, []);
        expect(target).toEqual([1, 2]);
    });

    it("fills an empty target", () => {
        const target: string[] = [];
        extendArray(target, ["a", "b"]);
        expect(target).toEqual(["a", "b"]);
    });

    // The whole reason this helper exists: target.push(...source) passes every
    // element as a call argument and overflows the engine's argument limit
    // (~125k in V8) on a whole-card 70mai GPS log (130k+ rows), throwing
    // "RangeError: Maximum call stack size exceeded" and aborting the ingest.
    // 500k is comfortably past any plausible engine ceiling.
    it("handles an array far larger than the spread argument limit without overflowing", () => {
        const source = Array.from({ length: 500_000 }, (_, i) => i);
        const target = [-1];
        expect(() => extendArray(target, source)).not.toThrow();
        expect(target.length).toBe(500_001);
        expect(target[0]).toBe(-1);
        expect(target[1]).toBe(0);
        expect(target[500_000]).toBe(499_999);
    });
});
