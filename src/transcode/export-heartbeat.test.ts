import { describe, expect, it, vi } from "vitest";

import type { Logger } from "../log.js";
import { createExportHeartbeat } from "./export-heartbeat.js";

// Full-interface fake: the heartbeat only calls info(), the rest exists to
// satisfy Logger without reaching the real ring buffer (module-level state).
function collectingLogger(sink: Array<Record<string, unknown>>): Logger {
    const logger: Logger = {
        debug: () => {},
        info: (_msg, ctx) => {
            sink.push(ctx as Record<string, unknown>);
        },
        warn: () => {},
        error: () => {},
        child: () => logger,
    };
    return logger;
}

describe("createExportHeartbeat", () => {
    // Timing itself is under test, so performance.now is faked (the allowed
    // fake-timer case). Sequential: fake timers are process-global.
    it("stays silent inside the interval and logs the throughput slope past it", () => {
        vi.useFakeTimers({ toFake: ["performance"] });
        try {
            const beats: Array<Record<string, unknown>> = [];
            const beat = createExportHeartbeat(collectingLogger(beats));

            beat(10, 1_000);
            expect(beats, "no beat before the interval elapses").toHaveLength(0);

            vi.advanceTimersByTime(30_000);
            beat(910, 5_000_000);
            expect(beats).toHaveLength(1);
            expect(beats[0]).toMatchObject({
                framesDone: 910,
                bytesWritten: 5_000_000,
                // (910 - 0) frames over the 30 s window.
                fpsSinceLast: 30,
            });

            beat(1000, 6_000_000);
            expect(beats, "the window restarts after a beat").toHaveLength(1);

            vi.advanceTimersByTime(30_000);
            beat(1900, 7_000_000);
            expect(beats).toHaveLength(2);
            expect(beats[1], "slope is measured from the previous beat, not from start").toMatchObject({
                framesDone: 1900,
                fpsSinceLast: 33,
            });
        } finally {
            vi.useRealTimers();
        }
    });
});
