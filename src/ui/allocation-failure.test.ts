import { describe, expect, it } from "vitest";

import { isAllocationFailure } from "./allocation-failure.js";

describe("isAllocationFailure", () => {
    it("treats any RangeError as an allocation failure (V8 throws RangeError for an oversized ArrayBuffer)", () => {
        expect(isAllocationFailure(new RangeError("Array buffer allocation failed"))).toBe(true);
        // Even a RangeError with unrelated wording: the in-house throw and V8's
        // oversize-buffer error both surface as RangeError, so the type is enough.
        expect(isAllocationFailure(new RangeError("Invalid array length"))).toBe(true);
    });

    it("matches engine-specific OOM wording thrown as a plain Error", () => {
        // V8 (also seen as a plain Error in some contexts), JSC, SpiderMonkey.
        expect(isAllocationFailure(new Error("Array buffer allocation failed"))).toBe(true);
        expect(isAllocationFailure(new Error("Out of memory"))).toBe(true);
        expect(isAllocationFailure(new Error("out of memory"))).toBe(true);
        expect(isAllocationFailure(new Error("allocation size overflow"))).toBe(true);
        expect(isAllocationFailure(new Error("memory exhausted"))).toBe(true);
    });

    it("matches the OOM wording case-insensitively", () => {
        expect(isAllocationFailure(new Error("ARRAY BUFFER allocation FAILED"))).toBe(true);
    });

    it("matches when the failure arrives as a non-Error value", () => {
        expect(isAllocationFailure("out of memory")).toBe(true);
        expect(isAllocationFailure({ message: "ignored - not read on a plain object" })).toBe(false);
    });

    it("is false for ordinary, non-allocation errors (so they surface their own message)", () => {
        expect(isAllocationFailure(new Error("network request failed"))).toBe(false);
        expect(isAllocationFailure(new TypeError("x is not a function"))).toBe(false);
        expect(isAllocationFailure(new DOMException("aborted", "AbortError"))).toBe(false);
        expect(isAllocationFailure(null)).toBe(false);
        expect(isAllocationFailure(undefined)).toBe(false);
    });
});
