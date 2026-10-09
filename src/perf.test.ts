import { afterEach, describe, expect, it, vi } from "vitest";

import { emitLifecycle, type LifecycleEvent } from "./perf.js";

afterEach(() => vi.unstubAllGlobals());

describe("lifecycle events", () => {
    it.each<LifecycleEvent>([
        "ingest-list-ready",
        "ingest-done",
        "trip-activated",
        "player-first-frame",
        "player-failed",
        "map-tracks-rendered",
        "chart-rendered",
    ])("emits %s once in each observer namespace with the same detail", (event) => {
        const target = new EventTarget();
        vi.stubGlobal("window", target);
        const current = vi.fn();
        const legacy = vi.fn();
        target.addEventListener(`everydashcam:${event}`, current);
        target.addEventListener(`dashcamigo:${event}`, legacy);
        const detail = { trip: 1 };

        emitLifecycle(event, detail);

        expect(current).toHaveBeenCalledTimes(1);
        expect(legacy).toHaveBeenCalledTimes(1);
        expect(current.mock.calls[0]?.[0].detail).toBe(detail);
        expect(legacy.mock.calls[0]?.[0].detail).toBe(detail);
    });

    it("does nothing outside a browser", () => {
        vi.stubGlobal("window", undefined);
        expect(() => emitLifecycle("ingest-done")).not.toThrow();
    });
});
