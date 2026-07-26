// Unit tests for the close watchdog. Covers:
//  - a fast close resolves and is not affected by the watchdog,
//  - a wedged close with no size hint rejects at the absolute floor (120s),
//  - the deadline scales with bytesWritten so a large flush is NOT killed at
//    the floor (a ~20 GB export to slow media stays legitimately flushing well past the
//    flat 120s floor)

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Logger } from "../log.js";
import {
    CLOSE_TIMEOUT_FLOOR_MS as FLOOR_MS,
    closeWritableWithWatchdog,
    MIN_FLUSH_BYTES_PER_MS as BYTES_PER_MS,
} from "./writable-finalize.js";

function makeLog(): Logger {
    return {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    } as unknown as Logger;
}

describe("closeWritableWithWatchdog", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it("resolves when close resolves before the deadline", async () => {
        const writable = { close: () => Promise.resolve() };
        await expect(closeWritableWithWatchdog(writable, makeLog(), "test")).resolves.toBeUndefined();
    });

    it("rejects at the absolute floor when no size hint is given", async () => {
        // close never settles; only the watchdog can end the race.
        const writable = { close: () => new Promise<void>(() => {}) };
        const p = closeWritableWithWatchdog(writable, makeLog(), "stream-copy");
        // Attach the rejection expectation up front so the fake-timer flush that
        // fires the watchdog does not surface as an unhandled rejection.
        const assertion = expect(p).rejects.toThrow(`timed out after ${FLOOR_MS}ms (stream-copy)`);

        // One tick short of the floor: still pending.
        await vi.advanceTimersByTimeAsync(FLOOR_MS - 1);
        // Crossing the floor fires the watchdog.
        await vi.advanceTimersByTimeAsync(1);
        await assertion;
    });

    it("scales the deadline with bytesWritten (does not kill a large flush at the floor)", async () => {
        const bytes = 600 * 1024 * 1024; // 600 MiB
        const expectedMs = Math.ceil(bytes / BYTES_PER_MS); // ~307200ms, well above the floor
        expect(expectedMs).toBeGreaterThan(FLOOR_MS); // guards the test's own premise

        const writable = { close: () => new Promise<void>(() => {}) };
        const p = closeWritableWithWatchdog(writable, makeLog(), "stream-copy", bytes);
        const assertion = expect(p).rejects.toThrow(`timed out after ${expectedMs}ms (stream-copy)`);

        // Past the flat floor the old code would have killed it here - the scaled
        // deadline keeps it alive.
        await vi.advanceTimersByTimeAsync(FLOOR_MS);
        // Only the scaled deadline ends it.
        await vi.advanceTimersByTimeAsync(expectedMs - FLOOR_MS);
        await assertion;
    });
});
