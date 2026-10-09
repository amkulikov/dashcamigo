import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.resetModules();
});

it("forwards a worker log once using the current envelope marker", async () => {
    const postMessage = vi.fn();
    vi.stubGlobal("window", undefined);
    vi.stubGlobal("postMessage", postMessage);
    vi.spyOn(console, "info").mockImplementation(() => {});
    const { createLogger, getLogBuffer } = await import("./log.js");

    createLogger("gps").info("metadata ready", { count: 2 });

    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(postMessage).toHaveBeenCalledWith({ __type: "__everydashcam:log", record: getLogBuffer()[0] });
});
