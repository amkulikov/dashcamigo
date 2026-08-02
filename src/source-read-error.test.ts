import { describe, expect, it } from "vitest";

import { isSourceReadError } from "./source-read-error.js";

describe("isSourceReadError", () => {
    it("matches Chromium's blob.stream() read failure (TypeError: network error)", () => {
        expect(isSourceReadError(new TypeError("network error"))).toBe(true);
    });

    it("matches the same failure rebuilt from worker-port data, where instanceof no longer holds", () => {
        // A worker hands back name + message as data; the receiving side
        // rebuilds a plain Error and re-attaches the name. That copy is what
        // the re-encode export's error mapping sees.
        const overThePort = Object.assign(new Error("network error"), { name: "TypeError" });
        expect(overThePort instanceof TypeError, "the rebuilt copy is not a TypeError").toBe(false);
        expect(isSourceReadError(overThePort)).toBe(true);
    });

    it("matches the FileReader/arrayBuffer NotReadableError shape (incl. wrapped variants)", () => {
        expect(isSourceReadError(new DOMException("read failed", "NotReadableError"))).toBe(true);
        const wrapped = Object.assign(new Error("read failed"), { name: "NotReadableError" });
        expect(isSourceReadError(wrapped)).toBe(true);
        expect(isSourceReadError({ name: "NotReadableError" })).toBe(true);
    });

    it("matches the raw message text when the typed shape is lost", () => {
        // The exact Chromium NotReadableError message, stringified into a cause.
        expect(
            isSourceReadError(
                new Error(
                    "The requested file could not be read, typically due to permission problems that have occurred after a reference to a file was acquired.",
                ),
            ),
        ).toBe(true);
    });

    it("is false for unrelated errors - especially other TypeErrors and fetch failures", () => {
        // Chromium's REAL network failure literal must not be misattributed.
        expect(isSourceReadError(new TypeError("Failed to fetch"))).toBe(false);
        // The message alone is not enough when it is not the exact stream literal.
        expect(isSourceReadError(new Error("network error"))).toBe(false);
        expect(isSourceReadError(new DOMException("aborted", "AbortError"))).toBe(false);
        expect(isSourceReadError(new RangeError("Array buffer allocation failed"))).toBe(false);
        expect(isSourceReadError("file could not be opened")).toBe(false);
        expect(isSourceReadError(null)).toBe(false);
        expect(isSourceReadError(undefined)).toBe(false);
    });
});
