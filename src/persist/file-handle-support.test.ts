import { afterEach, describe, expect, it, vi } from "vitest";

import { canPersistFileHandles } from "./file-handle-support.js";

afterEach(() => vi.unstubAllGlobals());

describe("file-handle storage compatibility", () => {
    it.each([
        "Mozilla/5.0 Chrome/153.0.8010.36 Safari/537.36",
        "Mozilla/5.0 HeadlessChrome/153.0.8010.12 Safari/537.36",
        "Mozilla/5.0 Chrome/153.0.0.0 Safari/537.36 Edg/153.0.0.0",
        "Mozilla/5.0 Chromium/154.0.0.0",
    ])("avoids handle deserialization in affected or unverified Chromium: %s", (userAgent) => {
        vi.stubGlobal("navigator", { userAgent });
        expect(canPersistFileHandles()).toBe(false);
    });

    it.each([
        "Mozilla/5.0 Chrome/152.0.7977.83 Safari/537.36",
        "Mozilla/5.0 Firefox/153.0",
        "Mozilla/5.0 Version/26.0 Safari/605.1.15",
        "Mozilla/5.0 CriOS/153.0.0.0 Mobile/15E148 Safari/604.1",
    ])("retains handle persistence for other engines: %s", (userAgent) => {
        vi.stubGlobal("navigator", { userAgent });
        expect(canPersistFileHandles()).toBe(true);
    });

    it("prefers Chromium client hints over an overridden user-agent string", () => {
        vi.stubGlobal("navigator", {
            userAgent: "Mozilla/5.0 Firefox/153.0",
            userAgentData: { brands: [{ brand: "Chromium", version: "153" }] },
        });
        expect(canPersistFileHandles()).toBe(false);
    });

    it.each([{}, { brands: [] }, { brands: [{ brand: "Chromium", version: "" }] }])(
        "falls back to the user-agent when client hints lack a valid version: %j",
        (userAgentData) => {
            vi.stubGlobal("navigator", { userAgent: "Chrome/153.0.8010.12", userAgentData });
            expect(canPersistFileHandles()).toBe(false);
        },
    );
});
