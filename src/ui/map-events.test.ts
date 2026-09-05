import { Evented } from "maplibre-gl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { waitForMapEvent } from "./map-events.js";

class MapEvents extends Evented {}

describe("waitForMapEvent", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("catches a synchronous render during the camera update", async () => {
        const map = new MapEvents();
        await waitForMapEvent(map, "render", 30, { start: () => map.fire("render") });
        expect(map.listens("render")).toBe(false);
        expect(vi.getTimerCount()).toBe(0);
    });

    it("keeps idle and render waits independent", async () => {
        const map = new MapEvents();
        const idle = waitForMapEvent(map, "idle", 2500);
        const render = waitForMapEvent(map, "render", 30);
        map.fire("render");
        await render;
        expect(map.listens("idle")).toBe(true);
        expect(vi.getTimerCount()).toBe(1);
        map.fire("idle");
        await idle;
        expect(map.listens("idle")).toBe(false);
        expect(vi.getTimerCount()).toBe(0);
    });

    it("allows the snapshot to continue when remote tiles never reach idle", async () => {
        const map = new MapEvents();
        const idle = waitForMapEvent(map, "idle", 2500);
        await vi.advanceTimersByTimeAsync(2500);
        await idle;
        expect(map.listens("idle")).toBe(false);
        expect(vi.getTimerCount()).toBe(0);
    });

    it("cancels prewarm and removes its timer and map listener", async () => {
        const map = new MapEvents();
        const controller = new AbortController();
        const idle = waitForMapEvent(map, "idle", 4000, { signal: controller.signal });
        const rejected = expect(idle).rejects.toMatchObject({ name: "AbortError" });
        controller.abort();
        await rejected;
        expect(map.listens("idle")).toBe(false);
        expect(vi.getTimerCount()).toBe(0);
    });

    it("does not move the camera when prewarm is already cancelled", async () => {
        const map = new MapEvents();
        const controller = new AbortController();
        controller.abort();
        let moved = false;
        await expect(
            waitForMapEvent(map, "idle", 4000, {
                signal: controller.signal,
                start: () => {
                    moved = true;
                },
            }),
        ).rejects.toMatchObject({ name: "AbortError" });
        expect(moved).toBe(false);
        expect(map.listens("idle")).toBe(false);
        expect(vi.getTimerCount()).toBe(0);
    });

    it("cleans up after a camera update throws and preserves the original failure", async () => {
        const map = new MapEvents();
        const error = new Error("camera update failed");
        await expect(
            waitForMapEvent(map, "idle", 4000, {
                start: () => {
                    throw error;
                },
            }),
        ).rejects.toBe(error);
        expect(map.listens("idle")).toBe(false);
        expect(vi.getTimerCount()).toBe(0);
    });
});
