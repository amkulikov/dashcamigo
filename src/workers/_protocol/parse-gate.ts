// Soft semaphore for worker request handlers. worker-server.ts does NOT
// serialize handlers (see its header) - the main-side pool's least-inflight
// router, plus callers that fire Promise.all/allSettled over a whole drop,
// can pile up many parse calls on a single slot at once. Without a cap that
// becomes ~10-15 concurrent parse() per slot, all hitting the same File
// reader / CPU / SD IO. A small capacity keeps some pipelining for the
// "one slow file + one fast file" case while preventing the worst-case
// fan-out; larger values just regress to the original problem.

export interface ParseGate {
    /**
     * Runs `fn` under the gate: waits (FIFO) for a free slot, runs it, and
     * releases the slot on settle - including when `fn` throws.
     */
    run<T>(fn: () => Promise<T>): Promise<T>;
}

/**
 * Creates a gate that admits at most `capacity` concurrent `run` bodies.
 * Waiters are served first-in-first-out.
 */
export function createParseGate(capacity: number): ParseGate {
    let inflight = 0;
    const waiters: Array<() => void> = [];

    async function acquire(): Promise<void> {
        if (inflight < capacity) {
            inflight++;
            return;
        }
        // The slot is handed to us by release() WITHOUT a decrement, so we do
        // not increment here either - release keeps the count at capacity.
        // This closes a race where a synchronous acquire sneaking in between
        // release's decrement and the waiter's microtask continuation would
        // push inflight past capacity.
        return new Promise<void>((resolve) => waiters.push(resolve));
    }

    function release(): void {
        const next = waiters.shift();
        if (next) {
            // Hand the slot directly to the next waiter; the counter stays at
            // capacity, so the waiter's continuation must not increment.
            next();
            return;
        }
        inflight--;
    }

    return {
        async run<T>(fn: () => Promise<T>): Promise<T> {
            await acquire();
            try {
                return await fn();
            } finally {
                release();
            }
        },
    };
}
