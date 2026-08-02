import { describe, expect, it } from "vitest";

import { isAllocationFailure } from "./allocation-failure.js";

describe("isAllocationFailure", () => {
    it("matches the RangeErrors an oversized allocation actually throws", () => {
        expect(isAllocationFailure(new RangeError("Array buffer allocation failed"))).toBe(true);
        expect(isAllocationFailure(new RangeError("Invalid typed array length: 5000000000"))).toBe(true);
        expect(isAllocationFailure(new RangeError("in-memory export exceeds 4294967296 bytes"))).toBe(true);
    });

    it("does not read every RangeError as an allocation failure", () => {
        // mediabunny's demuxer range-checks a corrupt container with RangeError.
        // "Too large for this browser's memory" would send the user hunting for
        // RAM to open a file that is simply broken.
        expect(isAllocationFailure(new RangeError("Offset 12345 is outside the bounds of the DataView"))).toBe(false);
        expect(isAllocationFailure(new RangeError("Invalid array length"))).toBe(false);
    });

    it("matches engine-specific OOM wording thrown as a plain Error", () => {
        // V8 (also seen as a plain Error in some contexts), JSC, SpiderMonkey.
        expect(isAllocationFailure(new Error("Array buffer allocation failed"))).toBe(true);
        expect(isAllocationFailure(new Error("Out of memory"))).toBe(true);
        expect(isAllocationFailure(new Error("out of memory"))).toBe(true);
        expect(isAllocationFailure(new Error("allocation size overflow"))).toBe(true);
        expect(isAllocationFailure(new Error("memory exhausted"))).toBe(true);
    });

    it("matches a RangeError rebuilt from worker-port data, where instanceof no longer holds", () => {
        // The in-memory buffer's over-4-GiB throw crosses the port as plain data
        // and comes back as an Error carrying only the name. Its message names no
        // engine wording, so without the name check it lands in the generic bucket.
        const rebuilt = new Error("in-memory export exceeds 4294967296 bytes");
        rebuilt.name = "RangeError";
        expect(rebuilt).not.toBeInstanceOf(RangeError);
        expect(isAllocationFailure(rebuilt)).toBe(true);
    });

    it("does not read a rebuilt RangeError with unrelated wording as an allocation failure", () => {
        // The demuxer throws RangeError on a corrupt container's out-of-range
        // box offsets, and the worker port hands it back name-first. Reporting
        // that as "too large for this browser's memory" sends the user chasing
        // RAM for a broken file.
        const parseDefect = new Error("Offset 12345 is outside the bounds of the DataView");
        parseDefect.name = "RangeError";
        expect(isAllocationFailure(parseDefect)).toBe(false);
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
