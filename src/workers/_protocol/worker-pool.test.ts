import { afterEach, describe, expect, it, vi } from "vitest";

import { _resetForTests } from "../../log.js";
import { makePairedEndpoints, flushMicrotasks } from "./test-helpers.js";
import { createWorkerClient } from "./worker-client.js";
import { createWorkerPool } from "./worker-pool.js";
import { createWorkerServer } from "./worker-server.js";

afterEach(() => {
    _resetForTests();
});

interface SpawnedSlot {
    idx: number;
    pair: ReturnType<typeof makePairedEndpoints>;
}

/**
 * Spawn-tracking factory. Records which idx values had a slot spawned and
 * returns a paired client/server. Returns the spawn log so tests can assert
 * lazy spawn behavior.
 */
function makeFactory(spawnedLog: SpawnedSlot[]) {
    return (idx: number, opts: { onCrash: ((err: Error) => void) | undefined }) => {
        const pair = makePairedEndpoints();
        // Server side just echoes the request type+idx so tests can see which slot served it.
        createWorkerServer(pair.workerEndpoint, {
            onRequest: async (type, data) => ({ idx, type, data }),
        });
        spawnedLog.push({ idx, pair });
        return createWorkerClient(pair.mainEndpoint, { name: `pool-test-${idx}`, onCrash: opts.onCrash });
    };
}

describe("createWorkerPool", () => {
    it("spawns slots lazily on first use", async () => {
        const spawned: SpawnedSlot[] = [];
        const pool = createWorkerPool({ name: "lazy", capacity: 4, factory: makeFactory(spawned) });
        expect(spawned.length).toBe(0);
        expect(pool.inspect().every((s) => !s.spawned)).toBe(true);

        await pool.request("ping");
        // One request -> one slot, even though capacity is 4.
        expect(spawned.length).toBe(1);
    });

    it("least-inflight routes a second concurrent request to a different slot", async () => {
        const spawned: SpawnedSlot[] = [];
        const pool = createWorkerPool({
            name: "lb",
            capacity: 2,
            factory: (idx, opts) => {
                const pair = makePairedEndpoints();
                spawned.push({ idx, pair });
                createWorkerServer(pair.workerEndpoint, {
                    onRequest: async (_t, data) => {
                        // Block until released - lets us hold inflight high.
                        await (data as { wait: Promise<void> }).wait;
                        return idx;
                    },
                });
                return createWorkerClient(pair.mainEndpoint, { name: `lb-${idx}`, onCrash: opts.onCrash });
            },
        });

        let release1: () => void = () => undefined;
        let release2: () => void = () => undefined;
        const wait1 = new Promise<void>((r) => {
            release1 = r;
        });
        const wait2 = new Promise<void>((r) => {
            release2 = r;
        });

        // Both posted before either resolves; second must go to a different slot
        // because slot 0 has inflight=1 by then.
        const p1 = pool.request<number>("work", { wait: wait1 });
        await flushMicrotasks();
        const p2 = pool.request<number>("work", { wait: wait2 });
        await flushMicrotasks();

        // Slots 0 and 1 are spawned exactly once each.
        expect(spawned.map((s) => s.idx).sort()).toEqual([0, 1]);
        release1();
        release2();
        const [r1, r2] = await Promise.all([p1, p2]);
        // Returned indexes show actual slot routing; sorted to ignore order.
        expect([r1, r2].sort()).toEqual([0, 1]);
    });

    it("shardKey pins the same key to the same slot across calls", async () => {
        const spawned: SpawnedSlot[] = [];
        const pool = createWorkerPool({ name: "shard", capacity: 4, factory: makeFactory(spawned) });

        const r1 = await pool.request<{ idx: number }>("x", undefined, { shardKey: "group-A" });
        const r2 = await pool.request<{ idx: number }>("x", undefined, { shardKey: "group-A" });
        const r3 = await pool.request<{ idx: number }>("x", undefined, { shardKey: "group-A" });
        // All three on the same slot - and no other slots ever spawned.
        expect(r1.idx).toBe(r2.idx);
        expect(r2.idx).toBe(r3.idx);
        const uniqueIdx = new Set(spawned.map((s) => s.idx));
        expect(uniqueIdx.size).toBe(1);
    });

    it("crash respawn: after onCrash fires, the next request spins a fresh slot", async () => {
        const spawned: SpawnedSlot[] = [];
        const pool = createWorkerPool({ name: "respawn", capacity: 2, factory: makeFactory(spawned) });

        await pool.request("hello", undefined, { shardKey: "key1" });
        const firstIdx = spawned[0]!.idx;
        // Fire a worker-level error - client rejects pending, marks disposed,
        // pool's onCrash hook clears the slot.
        spawned[0]!.pair.fireMainError({ message: "boom", filename: "x", lineno: 1, colno: 1 });
        await flushMicrotasks();

        // Next request on the same shardKey hits the same idx, but the pool
        // sees the old client is disposed and recreates a fresh one - second
        // entry in spawned log.
        await pool.request("hello-again", undefined, { shardKey: "key1" });
        expect(spawned.length).toBe(2);
        expect(spawned[1]!.idx).toBe(firstIdx);
    });

    it("notifyAll only reaches already-spawned slots, does not spawn lazy ones", async () => {
        const spawned: SpawnedSlot[] = [];
        const notifiedAt: number[] = [];
        const pool = createWorkerPool({
            name: "ntf-all",
            capacity: 3,
            factory: (idx, opts) => {
                const pair = makePairedEndpoints();
                createWorkerServer(pair.workerEndpoint, {
                    onRequest: async () => idx,
                    onNotification: () => notifiedAt.push(idx),
                });
                spawned.push({ idx, pair });
                return createWorkerClient(pair.mainEndpoint, { name: `ntf-${idx}`, onCrash: opts.onCrash });
            },
        });

        // Force spawn slot for "k0" only.
        await pool.request("ping", undefined, { shardKey: "k0" });
        const spawnedIdx = spawned[0]!.idx;

        pool.notifyAll("hello");
        await flushMicrotasks();
        expect(notifiedAt).toEqual([spawnedIdx]);
        // Other slots stayed lazy.
        expect(spawned.length).toBe(1);
    });

    it("disposeAll terminates all spawned slots and rejects pending requests", async () => {
        const spawned: SpawnedSlot[] = [];
        const pool = createWorkerPool({
            name: "dispose",
            capacity: 2,
            factory: (idx, opts) => {
                const pair = makePairedEndpoints();
                createWorkerServer(pair.workerEndpoint, { onRequest: () => new Promise(() => undefined) });
                spawned.push({ idx, pair });
                return createWorkerClient(pair.mainEndpoint, { name: `disp-${idx}`, onCrash: opts.onCrash });
            },
        });
        const p1 = pool.request("hang", undefined, { shardKey: "a" });
        const p2 = pool.request("hang", undefined, { shardKey: "b" });
        await flushMicrotasks();
        pool.disposeAll("test");
        const rejections = await Promise.allSettled([p1, p2]);
        expect(rejections.every((r) => r.status === "rejected")).toBe(true);
        for (const slot of spawned) expect(slot.pair.terminated()).toBe(true);
    });
});

describe("createWorkerPool diagnostics", () => {
    it("inspect() reports spawned + inflight counts", async () => {
        const spawned: SpawnedSlot[] = [];
        const pool = createWorkerPool({
            name: "inspect",
            capacity: 2,
            factory: (idx, opts) => {
                const pair = makePairedEndpoints();
                createWorkerServer(pair.workerEndpoint, {
                    onRequest: async (_t, data) => {
                        await (data as { wait: Promise<void> }).wait;
                        return idx;
                    },
                });
                spawned.push({ idx, pair });
                return createWorkerClient(pair.mainEndpoint, { name: `i-${idx}`, onCrash: opts.onCrash });
            },
        });
        let release = (): void => undefined;
        const wait = new Promise<void>((r) => {
            release = r;
        });
        const p = pool.request("x", { wait }, { shardKey: "k" });
        await flushMicrotasks();
        const before = pool.inspect();
        expect(before.filter((s) => s.spawned).length).toBe(1);
        expect(before.find((s) => s.spawned)?.inflight).toBe(1);

        release();
        await p;
        await flushMicrotasks();
        const after = pool.inspect().find((s) => s.spawned);
        expect(after?.inflight).toBe(0);
    });
});

describe("error propagation across pool boundary", () => {
    it("pool.request rethrows handler errors with original stack", async () => {
        const pool = createWorkerPool({
            name: "err",
            capacity: 1,
            factory: (idx, opts) => {
                const pair = makePairedEndpoints();
                createWorkerServer(pair.workerEndpoint, {
                    onRequest: async () => {
                        const e = new Error("handler died");
                        e.stack = "pool-test-stack";
                        throw e;
                    },
                });
                return createWorkerClient(pair.mainEndpoint, { name: `err-${idx}`, onCrash: opts.onCrash });
            },
        });
        await expect(pool.request("x")).rejects.toMatchObject({
            message: "handler died",
            stack: "pool-test-stack",
        });
    });
});

describe("createWorkerPool race conditions", () => {
    it("disposeAll during a crash respawn cycle leaves the pool fully terminated", async () => {
        const spawned: SpawnedSlot[] = [];
        const pool = createWorkerPool({
            name: "race",
            capacity: 2,
            factory: (idx, opts) => {
                const pair = makePairedEndpoints();
                createWorkerServer(pair.workerEndpoint, {
                    // Hanging for the in-flight requests; respond promptly
                    // for any later "after-dispose" probe so the test does
                    // not deadlock on a regression that respawns after dispose.
                    onRequest: async (type) => {
                        if (type === "hang") return await new Promise<never>(() => undefined);
                        return idx;
                    },
                });
                spawned.push({ idx, pair });
                return createWorkerClient(pair.mainEndpoint, { name: `race-${idx}`, onCrash: opts.onCrash });
            },
        });

        // Spawn slots for both shardKeys so we have two live workers.
        const p1 = pool.request("hang", undefined, { shardKey: "a" });
        const p2 = pool.request("hang", undefined, { shardKey: "b" });
        await flushMicrotasks();
        expect(spawned.length).toBe(2);

        // Crash slot 0 - its onCrash hook clears slot in pool.
        spawned[0]!.pair.fireMainError({ message: "boom", filename: "w.js", lineno: 1, colno: 1 });
        // Without awaiting the microtask, immediately disposeAll - this is
        // the race scenario: pool's slot 0 is in a transient state (client
        // disposed by crash, slot ref still being cleared on the microtask).
        pool.disposeAll("test");
        const rejections = await Promise.allSettled([p1, p2]);
        expect(rejections.every((r) => r.status === "rejected")).toBe(true);
        // Both endpoints (the crashed slot 0 and slot 1) must be terminated.
        for (const slot of spawned) expect(slot.pair.terminated()).toBe(true);

        // After disposeAll the pool's slots are nulled - a new request still
        // works because ensureSlot respawns lazily. Probe with a non-"hang"
        // type so the new server responds.
        const probe = await pool.request<number>("ping", undefined, { shardKey: "c" });
        expect(typeof probe).toBe("number");
        expect(spawned.length).toBeGreaterThan(2);
    });

    it("crash on a slot does not affect other slots' pending requests", async () => {
        const spawned: SpawnedSlot[] = [];
        const pool = createWorkerPool({
            name: "isolation",
            capacity: 2,
            factory: (idx, opts) => {
                const pair = makePairedEndpoints();
                createWorkerServer(pair.workerEndpoint, {
                    onRequest: async (_t, data) => {
                        await (data as { wait: Promise<void> }).wait;
                        return idx;
                    },
                });
                spawned.push({ idx, pair });
                return createWorkerClient(pair.mainEndpoint, { name: `iso-${idx}`, onCrash: opts.onCrash });
            },
        });

        let releaseB: () => void = () => undefined;
        const waitB = new Promise<void>((r) => {
            releaseB = r;
        });
        let releaseA: () => void = () => undefined;
        const waitA = new Promise<void>((r) => {
            releaseA = r;
        });

        const pA = pool.request<number>("hangA", { wait: waitA }, { shardKey: "A" });
        await flushMicrotasks();
        const pB = pool.request<number>("hangB", { wait: waitB }, { shardKey: "B" });
        await flushMicrotasks();
        expect(spawned.length).toBe(2);

        // Crash slot for shardKey A only.
        const aSlotIdx = spawned[0]!.idx;
        spawned[0]!.pair.fireMainError({ message: "boom", filename: "w.js", lineno: 1, colno: 1 });
        await expect(pA).rejects.toBeDefined();

        // Slot B is untouched - its pending request must complete normally.
        releaseB();
        const rB = await pB;
        expect(rB).toBe(spawned[1]!.idx);
        // Releasing A is a no-op now (its worker is dead) - just preventing a
        // dangling promise in case some path holds onto it.
        releaseA();
        void aSlotIdx;
    });
});

describe("createWorkerPool guards", () => {
    it("guards against capacity=0 by clamping to 1", () => {
        const pool = createWorkerPool({
            name: "tiny",
            capacity: 0,
            factory: vi.fn(),
        });
        // 0 was clamped; inspect surface confirms.
        expect(pool.inspect().length).toBe(1);
    });
});
