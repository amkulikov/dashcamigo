import { describe, expect, it } from "vitest";

import { createParseGate } from "./parse-gate.js";

// Externally-resolvable promise: lets a test hold a gated task open until it
// chooses to resolve, so we can observe how many tasks the gate admits at once.
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((res) => {
        resolve = res;
    });
    return { promise, resolve };
}

// Drain the microtask queue via a macrotask hop, so gate hand-offs (which are
// chains of microtasks: acquire resolve -> fn continuation -> release) settle
// before we assert.
function flush(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("createParseGate", () => {
    it("admits at most `capacity` tasks concurrently", async () => {
        const gate = createParseGate(2);
        let active = 0;
        const peaks: number[] = [];
        const gates = Array.from({ length: 5 }, () => deferred<void>());
        const runs = gates.map((g) =>
            gate.run(async () => {
                active++;
                peaks.push(active);
                await g.promise;
                active--;
            }),
        );

        await flush();
        // Only the first `capacity` run; the other three sit queued.
        expect(active).toBe(2);

        // Drain one at a time; each release admits exactly one waiter.
        for (const g of gates) {
            g.resolve();
            await flush();
        }
        await Promise.all(runs);

        expect(Math.max(...peaks)).toBe(2);
    });

    it("runs queued waiters in FIFO order", async () => {
        const gate = createParseGate(1);
        const started: number[] = [];
        const gates = [0, 1, 2].map(() => deferred<void>());
        const runs = [0, 1, 2].map((i) =>
            gate.run(async () => {
                started.push(i);
                await gates[i]!.promise;
            }),
        );

        await flush();
        expect(started).toEqual([0]);

        gates[0]!.resolve();
        await flush();
        expect(started).toEqual([0, 1]);

        gates[1]!.resolve();
        await flush();
        expect(started).toEqual([0, 1, 2]);

        gates[2]!.resolve();
        await Promise.all(runs);
    });

    it("releases the slot when a task throws", async () => {
        const gate = createParseGate(1);

        await expect(
            gate.run(async () => {
                throw new Error("boom");
            }),
        ).rejects.toThrow("boom");

        // If the throwing task leaked its slot, this would deadlock (never run).
        let ran = false;
        await gate.run(async () => {
            ran = true;
        });
        expect(ran).toBe(true);
    });
});
