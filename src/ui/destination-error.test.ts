import { describe, expect, it, vi } from "vitest";

import { isDestinationLostError, isSinkFailure, tagSinkFailures } from "./destination-error.js";

/** An error shaped like one that crossed the worker port: a plain Error carrying
 *  the original DOMException name (port-writable.ts re-attaches it). */
function named(name: string, message = "boom"): Error {
    const err = new Error(message);
    err.name = name;
    return err;
}

/** Minimal writable stub - the wrapper only needs the methods it forwards. */
function fakeWritable(overrides: Record<string, unknown> = {}) {
    return {
        write: vi.fn(async () => {}),
        close: vi.fn(async () => {}),
        abort: vi.fn(async () => {}),
        truncate: vi.fn(async () => {}),
        seek: vi.fn(async () => {}),
        ...overrides,
    } as unknown as FileSystemWritableFileStream;
}

describe("isSinkFailure", () => {
    it("is false for an error that never went through the sink", () => {
        expect(isSinkFailure(named("NotFoundError"))).toBe(false);
    });

    it("is false for non-objects", () => {
        expect(isSinkFailure("NotFoundError")).toBe(false);
        expect(isSinkFailure(null)).toBe(false);
        expect(isSinkFailure(undefined)).toBe(false);
    });
});

describe("tagSinkFailures", () => {
    it("tags a write failure and re-throws the same error object", async () => {
        const original = named("NotFoundError");
        const w = tagSinkFailures(fakeWritable({ write: async () => Promise.reject(original) }));

        const caught = await w.write(new Uint8Array()).catch((err: unknown) => err);

        expect(caught, "the wrapper must not replace the error").toBe(original);
        expect(isSinkFailure(caught)).toBe(true);
    });

    it("tags a close failure - the commit is where a full disk usually surfaces", async () => {
        const original = named("QuotaExceededError");
        const w = tagSinkFailures(fakeWritable({ close: async () => Promise.reject(original) }));

        const caught = await w.close().catch((err: unknown) => err);

        expect(isSinkFailure(caught)).toBe(true);
    });

    it("leaves an abort failure untagged so it cannot displace the real cause", async () => {
        const original = named("InvalidStateError");
        const w = tagSinkFailures(fakeWritable({ abort: async () => Promise.reject(original) }));

        const caught = await w.abort("cancelled").catch((err: unknown) => err);

        expect(isSinkFailure(caught)).toBe(false);
    });

    it("forwards every call and its arguments to the real writable", async () => {
        const inner = fakeWritable();
        const w = tagSinkFailures(inner);
        const chunk = { type: "write", position: 7, data: new Uint8Array([1]) } as FileSystemWriteChunkType;

        await w.write(chunk);
        await w.truncate(42);
        await w.seek(9);
        await w.close();

        expect(inner.write).toHaveBeenCalledWith(chunk);
        expect(inner.truncate).toHaveBeenCalledWith(42);
        expect(inner.seek).toHaveBeenCalledWith(9);
        expect(inner.close).toHaveBeenCalled();
    });

    it("omits optional members the real writable does not have", () => {
        const bare = { write: async () => {}, close: async () => {} } as unknown as FileSystemWritableFileStream;
        const w = tagSinkFailures(bare) as unknown as Record<string, unknown>;

        expect(w.truncate, "feature detection must see the same surface").toBeUndefined();
        expect(w.seek).toBeUndefined();
    });
});

describe("isDestinationLostError", () => {
    it("is true for a sink failure whose name says the file is gone", async () => {
        const w = tagSinkFailures(fakeWritable({ write: async () => Promise.reject(named("NotFoundError")) }));

        const caught = await w.write(new Uint8Array()).catch((err: unknown) => err);

        expect(isDestinationLostError(caught)).toBe(true);
    });

    it("classifies a real DOMException without relying on instanceof", async () => {
        const w = tagSinkFailures(
            fakeWritable({ write: async () => Promise.reject(new DOMException("gone", "NoModificationAllowedError")) }),
        );

        const caught = await w.write(new Uint8Array()).catch((err: unknown) => err);

        expect(isDestinationLostError(caught)).toBe(true);
    });

    it("is false for the same name coming from a source read, not the sink", () => {
        expect(isDestinationLostError(named("NotFoundError"))).toBe(false);
    });

    it("is false for a sink failure that means something else", async () => {
        // NotReadableError is the SOURCE-side shape; InvalidStateError points at
        // our own writable lifecycle. Neither should send the user hunting for a
        // disconnected drive.
        for (const name of ["NotReadableError", "InvalidStateError", "QuotaExceededError", "Error"]) {
            const w = tagSinkFailures(fakeWritable({ write: async () => Promise.reject(named(name)) }));
            const caught = await w.write(new Uint8Array()).catch((err: unknown) => err);
            expect(isDestinationLostError(caught), name).toBe(false);
        }
    });
});
