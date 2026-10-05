import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
    _resetForTests,
    encoderAcceleration,
    getEncoderPreference,
    setEncoderPreference,
    subscribeEncoderPreference,
} from "./encoder-pref.js";

beforeEach(_resetForTests);
afterEach(() => vi.unstubAllGlobals());

it("defaults to automatic for unavailable or invalid storage", () => {
    expect(getEncoderPreference()).toBe("auto");
    _resetForTests();
    vi.stubGlobal("localStorage", { getItem: () => "unknown" });
    expect(getEncoderPreference()).toBe("auto");
});

it("retains explicit choices and notifies once even when storage rejects writes", () => {
    vi.stubGlobal("localStorage", {
        getItem: () => "hardware",
        setItem: () => {
            throw new Error("storage denied");
        },
    });
    expect(encoderAcceleration(getEncoderPreference())).toBe("prefer-hardware");
    let calls = 0;
    subscribeEncoderPreference(() => calls++);
    setEncoderPreference("software");
    setEncoderPreference("software");
    expect(encoderAcceleration(getEncoderPreference())).toBe("prefer-software");
    expect(calls).toBe(1);
    setEncoderPreference("auto");
    expect(encoderAcceleration(getEncoderPreference())).toBe("no-preference");
});
