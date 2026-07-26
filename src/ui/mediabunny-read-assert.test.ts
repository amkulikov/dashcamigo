import { describe, expect, it } from "vitest";
import { isMediabunnyReadAssert } from "./mediabunny-read-assert.js";

describe("isMediabunnyReadAssert", () => {
    it("matches mediabunny's exact assert error", () => {
        // Mirrors node_modules/mediabunny/src/misc.ts: throw new Error("Assertion failed.")
        expect(isMediabunnyReadAssert(new Error("Assertion failed."))).toBe(true);
    });

    it("rejects unrelated errors and non-Error values", () => {
        expect(isMediabunnyReadAssert(new Error("something else"))).toBe(false);
        // A subclass with a different name is not mediabunny's assert (avoids
        // over-matching a coincidental message from other code).
        expect(isMediabunnyReadAssert(new TypeError("Assertion failed."))).toBe(false);
        // Cancellation must never be mistaken for the read defect.
        expect(isMediabunnyReadAssert(new DOMException("aborted", "AbortError"))).toBe(false);
        expect(isMediabunnyReadAssert("Assertion failed.")).toBe(false);
        expect(isMediabunnyReadAssert(null)).toBe(false);
        expect(isMediabunnyReadAssert(undefined)).toBe(false);
    });
});
