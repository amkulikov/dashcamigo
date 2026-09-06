import { afterEach, describe, expect, it, vi } from "vitest";
import { loadFontsIntoScope } from "./worker-fonts.js";

const specs = [
    { family: "Overlay", weight: "400", url: "/fonts/overlay.woff2" },
    { family: "Watermark", weight: "700", url: "/fonts/watermark.woff2" },
];

function pendingFontLoad() {
    let resolve!: () => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<void>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

function fontEnvironment(load: (family: string) => Promise<void>): string[] {
    const registered: string[] = [];
    vi.stubGlobal("fonts", { add: (face: { family: string }) => registered.push(face.family) });
    vi.stubGlobal(
        "FontFace",
        class {
            constructor(readonly family: string) {}
            async load() {
                await load(this.family);
                return this;
            }
        },
    );
    return registered;
}

afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
});

describe("loadFontsIntoScope", () => {
    it("registers available fonts when another face fails to load", async () => {
        vi.useFakeTimers();
        const registered = fontEnvironment(async (family) => {
            if (family === "Overlay") throw new DOMException("font unavailable", "NetworkError");
        });
        await loadFontsIntoScope(specs);
        expect(registered).toEqual(["Watermark"]);
        expect(vi.getTimerCount()).toBe(0);
    });

    it("releases stalled loads and keeps fallback metrics when a late font arrives", async () => {
        vi.useFakeTimers();
        const pending = pendingFontLoad();
        const registered = fontEnvironment((family) => (family === "Overlay" ? pending.promise : Promise.resolve()));
        const loaded = loadFontsIntoScope(specs);
        await vi.advanceTimersByTimeAsync(10_000);
        await loaded;
        expect(registered).toEqual(["Watermark"]);
        expect(vi.getTimerCount()).toBe(0);

        pending.resolve();
        await vi.advanceTimersByTimeAsync(0);
        expect(registered).toEqual(["Watermark"]);
    });

    it("handles a rejection that arrives after falling back", async () => {
        vi.useFakeTimers();
        const pending = pendingFontLoad();
        const registered = fontEnvironment(() => pending.promise);
        const loaded = loadFontsIntoScope(specs);
        await vi.advanceTimersByTimeAsync(10_000);
        await loaded;
        pending.reject(new Error("late font request failure"));
        await vi.advanceTimersByTimeAsync(0);
        expect(registered).toEqual([]);
    });

    it("propagates cancellation instead of treating it as a missing font", async () => {
        const aborted = Object.assign(new Error("cancelled"), { name: "AbortError" });
        fontEnvironment(async () => {
            throw aborted;
        });
        await expect(loadFontsIntoScope(specs)).rejects.toBe(aborted);
    });
});
