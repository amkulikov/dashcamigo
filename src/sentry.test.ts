// Tests for crash-reporting gating logic (build flag + opt-out flag +
// environment classification). The SDK itself is never loaded here: node has no
// `window`, so loadAndInit() returns before the dynamic import - we exercise the
// pure gating surface. Scrubbing is covered in sentry-scrub.test.ts.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    CRASH_REPORTING_STORAGE_KEY,
    captureSentryException,
    captureSentryMessage,
    crashReportingEnabled,
    isCrashReportingBuilt,
    resolveEnvironment,
    setCrashReportingEnabled,
    _resetForTests,
} from "./sentry.js";

function createFakeStorage(): Storage {
    const map = new Map<string, string>();
    return {
        getItem: (k: string) => map.get(k) ?? null,
        setItem: (k: string, v: string) => void map.set(k, String(v)),
        removeItem: (k: string) => void map.delete(k),
        clear: () => map.clear(),
        key: (i: number) => [...map.keys()][i] ?? null,
        get length() {
            return map.size;
        },
    } as Storage;
}

let fakeStorage: Storage;

const DSN = "https://deadbeef@o4511528520843264.ingest.de.sentry.io/9998887";

beforeEach(() => {
    _resetForTests();
    fakeStorage = createFakeStorage();
    vi.stubGlobal("localStorage", fakeStorage);
    vi.stubEnv("VITE_SENTRY_DSN", DSN);
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    _resetForTests();
});

describe("resolveEnvironment", () => {
    it("classifies by hostname", () => {
        expect(resolveEnvironment("localhost", "primary")).toBe("local");
        expect(resolveEnvironment("127.0.0.1", "primary")).toBe("local");
        expect(resolveEnvironment("192.168.1.5", "primary")).toBe("local");
        expect(resolveEnvironment("dashcamigo.app", "primary")).toBe("production");
        expect(resolveEnvironment("www.dashcamigo.app", "primary")).toBe("production");
        expect(resolveEnvironment("beta.dashcamigo.app", "primary")).toBe("staging");
        expect(resolveEnvironment("deploy-preview.pages.dev", "primary")).toBe("staging");
        expect(resolveEnvironment("mirror.example.test", "mirror")).toBe("production");
        expect(resolveEnvironment("localhost", "mirror")).toBe("local");
    });
});

describe("isCrashReportingBuilt", () => {
    it("true only when a DSN is baked in", () => {
        expect(isCrashReportingBuilt()).toBe(true);
        vi.stubEnv("VITE_SENTRY_DSN", "");
        expect(isCrashReportingBuilt()).toBe(false);
    });
});

describe("crashReportingEnabled", () => {
    it("default ON: enabled when built and no opt-out flag is stored", () => {
        expect(crashReportingEnabled()).toBe(true);
    });

    it("disabled when the opt-out flag is 'off'", () => {
        fakeStorage.setItem(CRASH_REPORTING_STORAGE_KEY, "off");
        expect(crashReportingEnabled()).toBe(false);
    });

    it("never enabled when not built, regardless of the flag", () => {
        vi.stubEnv("VITE_SENTRY_DSN", "");
        expect(crashReportingEnabled()).toBe(false);
        fakeStorage.removeItem(CRASH_REPORTING_STORAGE_KEY);
        expect(crashReportingEnabled()).toBe(false);
    });

    it("treats a blocked localStorage as enabled (matches absence)", () => {
        vi.stubGlobal("localStorage", {
            getItem: () => {
                throw new Error("blocked");
            },
        } as unknown as Storage);
        expect(crashReportingEnabled()).toBe(true);
    });
});

describe("setCrashReportingEnabled", () => {
    it("persists opt-out and clears it again (default-ON semantics: absence = enabled)", () => {
        setCrashReportingEnabled(false);
        expect(fakeStorage.getItem(CRASH_REPORTING_STORAGE_KEY)).toBe("off");
        expect(crashReportingEnabled()).toBe(false);

        setCrashReportingEnabled(true);
        // Re-enabling removes the key rather than storing "on".
        expect(fakeStorage.getItem(CRASH_REPORTING_STORAGE_KEY)).toBeNull();
        expect(crashReportingEnabled()).toBe(true);
    });
});

describe("capture helpers are safe no-ops without an initialized SDK", () => {
    it("do not throw when enabled but the SDK never loaded (node has no window)", () => {
        expect(() => captureSentryMessage("x", { level: "warning" })).not.toThrow();
        expect(() => captureSentryException(new Error("y"))).not.toThrow();
    });

    it("do not throw when opted out", () => {
        setCrashReportingEnabled(false);
        expect(() => captureSentryMessage("x")).not.toThrow();
        expect(() => captureSentryException(new Error("y"))).not.toThrow();
    });
});
