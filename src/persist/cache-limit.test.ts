import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    DEFAULT_INDEX_CACHE_LIMIT_BYTES,
    getIndexCacheLimitBytes,
    INDEX_CACHE_LIMIT_MAX_BYTES,
    INDEX_CACHE_LIMIT_MIN_BYTES,
    setIndexCacheLimitBytes,
} from "./cache-limit.js";

// Minimal localStorage stand-in: the node test environment has none, and the
// pref must be exercised through the same get/set surface the browser offers.
function stubStorage(): Map<string, string> {
    const backing = new Map<string, string>();
    vi.stubGlobal("localStorage", {
        getItem: (key: string) => backing.get(key) ?? null,
        setItem: (key: string, value: string) => backing.set(key, value),
    });
    return backing;
}

describe("index cache limit pref", () => {
    let backing: Map<string, string>;

    beforeEach(() => {
        backing = stubStorage();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("returns the default when nothing is stored", () => {
        expect(getIndexCacheLimitBytes()).toBe(DEFAULT_INDEX_CACHE_LIMIT_BYTES);
    });

    it("returns the default when localStorage is unavailable", () => {
        vi.stubGlobal("localStorage", {
            getItem: () => {
                throw new Error("denied");
            },
        });
        expect(getIndexCacheLimitBytes()).toBe(DEFAULT_INDEX_CACHE_LIMIT_BYTES);
    });

    it("round-trips a value inside the accepted range", () => {
        setIndexCacheLimitBytes(256 * 1024 * 1024);
        expect(getIndexCacheLimitBytes()).toBe(256 * 1024 * 1024);
    });

    it("clamps writes below the minimum and above the maximum", () => {
        setIndexCacheLimitBytes(1);
        expect(getIndexCacheLimitBytes()).toBe(INDEX_CACHE_LIMIT_MIN_BYTES);
        setIndexCacheLimitBytes(Number.MAX_SAFE_INTEGER);
        expect(getIndexCacheLimitBytes()).toBe(INDEX_CACHE_LIMIT_MAX_BYTES);
    });

    it("clamps a stored out-of-range value on read (hand-edited storage)", () => {
        backing.set("dashcamigo:indexCache:limitBytes", "1");
        expect(getIndexCacheLimitBytes()).toBe(INDEX_CACHE_LIMIT_MIN_BYTES);
    });

    it("falls back to the default on an unparsable stored value", () => {
        backing.set("dashcamigo:indexCache:limitBytes", "lots");
        expect(getIndexCacheLimitBytes()).toBe(DEFAULT_INDEX_CACHE_LIMIT_BYTES);
    });

    it("ignores a non-finite or non-positive write", () => {
        setIndexCacheLimitBytes(256 * 1024 * 1024);
        setIndexCacheLimitBytes(Number.NaN);
        setIndexCacheLimitBytes(-5);
        setIndexCacheLimitBytes(0);
        expect(getIndexCacheLimitBytes()).toBe(256 * 1024 * 1024);
    });
});
