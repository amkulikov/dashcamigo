import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { scheduleServiceWorkerRegistration } from "./sw-registration.js";

let windowEvents: EventTarget;
let stop: (() => void) | undefined;

beforeEach(() => {
    vi.useFakeTimers();
    windowEvents = new EventTarget();
    vi.stubGlobal("window", windowEvents);
    vi.stubGlobal("document", { readyState: "interactive" });
    vi.stubGlobal("requestIdleCallback", undefined);
});

afterEach(() => {
    stop?.();
    stop = undefined;
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

describe("service worker registration", () => {
    it("starts even when a subresource keeps window load pending", async () => {
        const register = vi.fn(async () => {});
        stop = scheduleServiceWorkerRegistration(register);
        await vi.advanceTimersByTimeAsync(6000);
        expect(register).toHaveBeenCalledTimes(1);
        windowEvents.dispatchEvent(new Event("load"));
        await vi.runAllTimersAsync();
        expect(register).toHaveBeenCalledTimes(1);
    });

    it("uses the first idle slot after load with a bounded idle wait", async () => {
        const idle = vi.fn((callback: () => void) => {
            callback();
            return 1;
        });
        vi.stubGlobal("requestIdleCallback", idle);
        vi.stubGlobal("cancelIdleCallback", vi.fn());
        const register = vi.fn(async () => {});
        stop = scheduleServiceWorkerRegistration(register);
        windowEvents.dispatchEvent(new Event("load"));
        await vi.runAllTimersAsync();
        expect(register).toHaveBeenCalledTimes(1);
        expect(idle).toHaveBeenCalledWith(expect.any(Function), { timeout: 3000 });
    });

    it("retries a failed registration when the connection returns", async () => {
        vi.stubGlobal("document", { readyState: "complete" });
        const register = vi
            .fn<() => Promise<void>>()
            .mockRejectedValueOnce(new TypeError("failed to fetch"))
            .mockResolvedValue(undefined);
        stop = scheduleServiceWorkerRegistration(register);
        await vi.runAllTimersAsync();
        windowEvents.dispatchEvent(new Event("online"));
        await vi.runAllTimersAsync();
        expect(register).toHaveBeenCalledTimes(2);
    });

    it("coalesces connection events during scheduling and registration", async () => {
        let finish!: () => void;
        const register = vi.fn(
            () =>
                new Promise<void>((resolve) => {
                    finish = resolve;
                }),
        );
        stop = scheduleServiceWorkerRegistration(register);
        windowEvents.dispatchEvent(new Event("online"));
        windowEvents.dispatchEvent(new Event("online"));
        await vi.runAllTimersAsync();
        windowEvents.dispatchEvent(new Event("online"));
        await vi.runAllTimersAsync();
        expect(register).toHaveBeenCalledTimes(1);
        finish();
        await Promise.resolve();
    });

    it("cancels pending registration and listeners on disposal", async () => {
        const register = vi.fn(async () => {});
        stop = scheduleServiceWorkerRegistration(register);
        stop();
        windowEvents.dispatchEvent(new Event("load"));
        windowEvents.dispatchEvent(new Event("online"));
        await vi.runAllTimersAsync();
        expect(register).not.toHaveBeenCalled();
    });

    it("retries when reconnect arrives before an in-flight registration fails", async () => {
        vi.stubGlobal("document", { readyState: "complete" });
        let fail!: (error: Error) => void;
        const register = vi
            .fn<() => Promise<void>>()
            .mockImplementationOnce(
                () =>
                    new Promise<void>((_resolve, reject) => {
                        fail = reject;
                    }),
            )
            .mockResolvedValue(undefined);
        stop = scheduleServiceWorkerRegistration(register);
        await vi.runAllTimersAsync();
        windowEvents.dispatchEvent(new Event("online"));
        fail(new TypeError("failed to fetch"));
        await vi.runAllTimersAsync();
        expect(register).toHaveBeenCalledTimes(2);
    });
});
