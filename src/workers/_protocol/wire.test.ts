import { describe, expect, it } from "vitest";

import {
    deserializeError,
    isWireMessage,
    serializeError,
    type WireAbort,
    type WireNotification,
    type WireRequest,
    type WireResponseErr,
    type WireResponseOk,
} from "./wire.js";

describe("isWireMessage", () => {
    it("accepts all four envelope kinds", () => {
        const req: WireRequest = { __k: "req", id: 1, type: "x" };
        const ok: WireResponseOk = { __k: "res", id: 1, ok: true, result: 42 };
        const err: WireResponseErr = {
            __k: "res",
            id: 1,
            ok: false,
            error: { name: "Error", message: "nope" },
        };
        const ntf: WireNotification = { __k: "ntf", type: "p", data: 1 };
        const abort: WireAbort = { __k: "abort", id: 1 };
        expect(isWireMessage(req)).toBe(true);
        expect(isWireMessage(ok)).toBe(true);
        expect(isWireMessage(err)).toBe(true);
        expect(isWireMessage(ntf)).toBe(true);
        expect(isWireMessage(abort)).toBe(true);
    });

    it("rejects foreign shapes", () => {
        // log-bridge forwarded entries land in the same message listener;
        // isWireMessage must not claim them as wire messages.
        expect(isWireMessage({ __type: "__dashcamigo:log", record: {} })).toBe(false);
        expect(isWireMessage(null)).toBe(false);
        expect(isWireMessage(undefined)).toBe(false);
        expect(isWireMessage("string")).toBe(false);
        expect(isWireMessage(42)).toBe(false);
        expect(isWireMessage({ id: 1 })).toBe(false);
        expect(isWireMessage({ __k: "unknown" })).toBe(false);
    });
});

describe("serializeError / deserializeError", () => {
    it("round-trips Error preserving name, message, stack", () => {
        const original = new TypeError("bad arg");
        const ser = serializeError(original);
        expect(ser.name).toBe("TypeError");
        expect(ser.message).toBe("bad arg");
        expect(ser.stack).toBeTruthy();
        const rebuilt = deserializeError(ser);
        expect(rebuilt.name).toBe("TypeError");
        expect(rebuilt.message).toBe("bad arg");
        expect(rebuilt.stack).toBe(original.stack);
    });

    it("rebuilds AbortError as DOMException so name-based checks work", () => {
        const abortErr = new DOMException("aborted", "AbortError");
        const ser = serializeError(abortErr);
        const rebuilt = deserializeError(ser);
        // Callers typically branch on `err.name === "AbortError"` regardless of class.
        expect(rebuilt.name).toBe("AbortError");
        expect(rebuilt).toBeInstanceOf(DOMException);
    });

    it("wraps non-Error throws so we never lose information", () => {
        expect(serializeError("boom")).toEqual({ name: "Error", message: "boom" });
        expect(serializeError({ code: 7, msg: "x" })).toEqual({
            name: "Error",
            message: '{"code":7,"msg":"x"}',
        });
    });
});
