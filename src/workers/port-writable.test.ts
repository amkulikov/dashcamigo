import { describe, expect, it } from "vitest";

import { flushMicrotasks } from "./_protocol/test-helpers.js";
import {
    PORT_WRITABLE_HWM,
    type PortLike,
    type PortWritableDown,
    type PortWritableUp,
    servePortWritable,
    wrapPortAsFsaWritable,
} from "./port-writable.js";

// Fake MessagePort: captures posted messages in `sent`, delivers to `peer` (if
// wired) via queueMicrotask to mirror real postMessage async semantics. Node /
// vitest has no DOM MessagePort, so this is the only way to exercise the bridge
// concurrency logic outside a browser.
class FakePort implements PortLike {
    onmessage: ((ev: { data: unknown }) => void) | null = null;
    peer: FakePort | null = null;
    closed = false;
    readonly sent: unknown[] = [];

    postMessage(message: unknown): void {
        this.sent.push(message);
        const peer = this.peer;
        if (!peer) return;
        queueMicrotask(() => {
            if (!peer.closed) peer.onmessage?.({ data: message });
        });
    }

    close(): void {
        this.closed = true;
    }

    /** Test helper: inject a message as if it arrived from the other end. */
    deliver(msg: PortWritableDown | PortWritableUp): void {
        this.onmessage?.({ data: msg });
    }

    ups(): PortWritableUp[] {
        return this.sent as PortWritableUp[];
    }
}

function pair(): [FakePort, FakePort] {
    const a = new FakePort();
    const b = new FakePort();
    a.peer = b;
    b.peer = a;
    return [a, b];
}

// Fully drains the microtask queue: a setTimeout(0) callback runs only after the
// microtask queue empties, so awaiting it settles the whole promise-chain tail
// the main-side server builds (several async write/close steps deep). More
// robust than counting flushMicrotasks() rounds.
function drain(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

// Typed as FileSystemWriteChunkType so it passes the FSA write() signature the
// worker-side writable exposes; the bridge itself treats the chunk as opaque.
function chunk(tag: number): FileSystemWriteChunkType {
    return { type: "write", position: tag, data: new Uint8Array([tag & 0xff]) };
}

describe("wrapPortAsFsaWritable (worker side)", () => {
    it("posts a write immediately when the credit window has room", async () => {
        const port = new FakePort();
        const w = wrapPortAsFsaWritable(port);

        await w.write(chunk(0));

        expect(port.ups()).toEqual([{ k: "write", chunk: chunk(0) }]);
    });

    it("blocks the write past the HWM until an ack frees a credit", async () => {
        const port = new FakePort();
        const w = wrapPortAsFsaWritable(port);

        // Fill the window - all post immediately.
        for (let i = 0; i < PORT_WRITABLE_HWM; i++) await w.write(chunk(i));
        expect(port.sent).toHaveLength(PORT_WRITABLE_HWM);

        // The next write parks: not posted, promise pending.
        let resolved = false;
        const parked = w.write(chunk(PORT_WRITABLE_HWM)).then(() => {
            resolved = true;
        });
        await flushMicrotasks();
        expect(resolved).toBe(false);
        expect(port.sent).toHaveLength(PORT_WRITABLE_HWM);

        // One ack frees exactly one slot -> the parked chunk posts and resolves.
        port.deliver({ k: "ack" });
        await parked;
        expect(resolved).toBe(true);
        expect(port.sent).toHaveLength(PORT_WRITABLE_HWM + 1);
        expect(port.ups()[PORT_WRITABLE_HWM]).toEqual({ k: "write", chunk: chunk(PORT_WRITABLE_HWM) });
    });

    it("releases parked writes in FIFO order as acks arrive", async () => {
        const port = new FakePort();
        const w = wrapPortAsFsaWritable(port);

        for (let i = 0; i < PORT_WRITABLE_HWM; i++) await w.write(chunk(i));
        const first = w.write(chunk(100));
        const second = w.write(chunk(101));

        port.deliver({ k: "ack" });
        port.deliver({ k: "ack" });
        await Promise.all([first, second]);

        // Posted in the order they parked, right after the window-filling writes.
        expect(port.ups()[PORT_WRITABLE_HWM]).toEqual({ k: "write", chunk: chunk(100) });
        expect(port.ups()[PORT_WRITABLE_HWM + 1]).toEqual({ k: "write", chunk: chunk(101) });
    });

    it("close posts {close} and resolves only after {closed}", async () => {
        const port = new FakePort();
        const w = wrapPortAsFsaWritable(port);
        await w.write(chunk(0));

        let done = false;
        const closeP = w.close().then(() => {
            done = true;
        });
        await flushMicrotasks();
        expect(port.ups().at(-1)).toEqual({ k: "close" });
        expect(done).toBe(false);

        port.deliver({ k: "closed" });
        await closeP;
        expect(done).toBe(true);
    });

    it("a main-side {error} rejects a parked write and every later op", async () => {
        const port = new FakePort();
        const w = wrapPortAsFsaWritable(port);
        for (let i = 0; i < PORT_WRITABLE_HWM; i++) await w.write(chunk(i));

        const parked = w.write(chunk(200));
        port.deliver({ k: "error", name: "Error", message: "disk full" });

        await expect(parked).rejects.toThrow("disk full");
        await expect(w.write(chunk(201))).rejects.toThrow("disk full");
        await expect(w.close()).rejects.toThrow("disk full");
    });

    it("restores the class name of a main-side failure", async () => {
        const port = new FakePort();
        const w = wrapPortAsFsaWritable(port);

        port.deliver({ k: "error", name: "NotFoundError", message: "the file is gone" });

        // The name is what the export flow classifies on - a bare Error here
        // collapses an actionable failure into "something went wrong".
        await expect(w.write(chunk(0))).rejects.toMatchObject({
            name: "NotFoundError",
            message: "the file is gone",
        });
    });

    it("abort posts {abort} and unblocks anything still parked", async () => {
        const port = new FakePort();
        const w = wrapPortAsFsaWritable(port);
        for (let i = 0; i < PORT_WRITABLE_HWM; i++) await w.write(chunk(i));

        const parked = w.write(chunk(300));
        await w.abort("cancelled");

        await expect(parked).rejects.toThrow("cancelled");
        expect(port.ups().some((m) => m.k === "abort")).toBe(true);
    });

    it("rejects a close after abort without posting {close}", async () => {
        // Output.cancel() closes its target even on the failure path
        // (discardOutputQuietly aborts first, then cancels) - the abort must
        // turn that close into a loud no-op, or the main side would COMMIT the
        // partial file to the user's destination.
        const port = new FakePort();
        const w = wrapPortAsFsaWritable(port);

        await w.abort("transcode failed");

        await expect(w.close()).rejects.toThrow("transcode failed");
        expect(port.ups().some((m) => m.k === "close")).toBe(false);
    });
});

// Fake real FSA writable the main-side server drives.
function fakeSink() {
    const writes: unknown[] = [];
    const state = { closed: false, aborted: false };
    return {
        writes,
        state,
        write: async (c: unknown): Promise<void> => {
            writes.push(c);
        },
        close: async (): Promise<void> => {
            state.closed = true;
        },
        abort: async (): Promise<void> => {
            state.aborted = true;
        },
    };
}

describe("servePortWritable (main side)", () => {
    it("applies each write to the sink in order and acks it", async () => {
        const port = new FakePort();
        const sink = fakeSink();
        servePortWritable(port, { ...sink, onFinalized: () => {} });

        port.deliver({ k: "write", chunk: chunk(0) });
        port.deliver({ k: "write", chunk: chunk(1) });
        await drain();

        expect(sink.writes).toEqual([chunk(0), chunk(1)]);
        // One ack per applied write.
        expect((port.sent as PortWritableDown[]).filter((m) => m.k === "ack")).toHaveLength(2);
    });

    it("close commits the sink, posts {closed}, and finalizes", async () => {
        const port = new FakePort();
        const sink = fakeSink();
        let finalized = false;
        servePortWritable(port, { ...sink, onFinalized: () => (finalized = true) });

        port.deliver({ k: "close" });
        await drain();

        expect(sink.state.closed).toBe(true);
        expect(finalized).toBe(true);
        expect((port.sent as PortWritableDown[]).some((m) => m.k === "closed")).toBe(true);
    });

    it("a sink write failure posts {error}, aborts the sink, finalizes, drops the rest", async () => {
        const port = new FakePort();
        const writes: unknown[] = [];
        const state = { aborted: false };
        let finalized = false;
        let reported: unknown = null;
        servePortWritable(port, {
            write: async () => {
                const err = new Error("the file is gone");
                err.name = "NotFoundError";
                throw err;
            },
            close: async () => {},
            abort: async () => {
                state.aborted = true;
            },
            onFinalized: () => (finalized = true),
            onWriteError: (err) => (reported = err),
        });

        port.deliver({ k: "write", chunk: chunk(0) });
        // A follow-up write after the failure must be dropped, not re-applied.
        port.deliver({ k: "write", chunk: chunk(1) });
        await drain();

        expect(writes).toHaveLength(0);
        expect(state.aborted).toBe(true);
        expect(finalized).toBe(true);
        const down = port.sent as PortWritableDown[];
        const errors = down.filter((m) => m.k === "error");
        expect(errors).toHaveLength(1);
        // The class name rides along - the worker rebuilds the error from it.
        expect(errors[0]).toMatchObject({ name: "NotFoundError", message: "the file is gone" });
        expect(down.some((m) => m.k === "ack")).toBe(false);
        // The RAW error goes to the caller: only this copy can still be tested
        // with instanceof / carry the sink tag.
        expect(reported, "onWriteError must receive the error object, not a string").toBeInstanceOf(Error);
    });

    it("a sink close failure reports the raw error and posts its name", async () => {
        const port = new FakePort();
        let reported: unknown = null;
        servePortWritable(port, {
            write: async () => {},
            close: async () => {
                const err = new Error("no space");
                err.name = "QuotaExceededError";
                throw err;
            },
            abort: async () => {},
            onFinalized: () => {},
            onWriteError: (err) => (reported = err),
        });

        port.deliver({ k: "close" });
        await drain();

        expect(reported).toBeInstanceOf(Error);
        const errors = (port.sent as PortWritableDown[]).filter((m) => m.k === "error");
        expect(errors[0]).toMatchObject({ name: "QuotaExceededError" });
    });

    it("an {abort} message discards the sink and finalizes", async () => {
        const port = new FakePort();
        const sink = fakeSink();
        let finalized = false;
        servePortWritable(port, { ...sink, onFinalized: () => (finalized = true) });

        port.deliver({ k: "abort", reason: "cancelled" });
        await drain();

        expect(sink.state.aborted).toBe(true);
        expect(finalized).toBe(true);
    });

    it("ignores a {close} that arrives after {abort} - the sink stays discarded", async () => {
        // The worker-side wrapper already refuses to post close after abort,
        // but the two can race on the wire; the terminal-once guard is the
        // second line keeping an aborted export from committing.
        const port = new FakePort();
        const sink = fakeSink();
        servePortWritable(port, { ...sink, onFinalized: () => {} });

        port.deliver({ k: "abort", reason: "transcode failed" });
        port.deliver({ k: "close" });
        await drain();

        expect(sink.state.aborted).toBe(true);
        expect(sink.state.closed, "a committed sink after abort means the partial file landed").toBe(false);
    });

    it("forceAbort discards the sink once and is idempotent", async () => {
        const port = new FakePort();
        let abortCount = 0;
        let finalized = 0;
        const server = servePortWritable(port, {
            write: async () => {},
            close: async () => {},
            abort: async () => {
                abortCount++;
            },
            onFinalized: () => finalized++,
        });

        await server.forceAbort("worker crashed");
        await server.forceAbort("again");

        expect(abortCount).toBe(1);
        expect(finalized).toBe(1);
    });

    it("forceAbort is a no-op after a normal close", async () => {
        const port = new FakePort();
        const sink = fakeSink();
        const server = servePortWritable(port, { ...sink, onFinalized: () => {} });

        port.deliver({ k: "close" });
        await drain();
        await server.forceAbort("late");

        expect(sink.state.closed).toBe(true);
        expect(sink.state.aborted).toBe(false);
    });
});

describe("port bridge end-to-end (both halves wired)", () => {
    it("round-trips writes + close: sink gets every chunk in order and finalizes", async () => {
        const [workerPort, mainPort] = pair();
        const sink = fakeSink();
        let resolveFin!: () => void;
        const finalized = new Promise<void>((resolve) => (resolveFin = resolve));
        servePortWritable(mainPort, { ...sink, onFinalized: resolveFin });

        const w = wrapPortAsFsaWritable(workerPort);
        await w.write(chunk(0));
        await w.write(chunk(1));
        await w.write(chunk(2));
        await w.close();
        await finalized;

        expect(sink.writes).toEqual([chunk(0), chunk(1), chunk(2)]);
        expect(sink.state.closed).toBe(true);
    });

    it("propagates a main-side write failure back to the worker's close()", async () => {
        const [workerPort, mainPort] = pair();
        const state = { aborted: false };
        let resolveFin!: () => void;
        const finalized = new Promise<void>((resolve) => (resolveFin = resolve));
        servePortWritable(mainPort, {
            write: async () => {
                throw new Error("disk full");
            },
            close: async () => {},
            abort: async () => {
                state.aborted = true;
            },
            onFinalized: resolveFin,
        });

        const w = wrapPortAsFsaWritable(workerPort);
        await w.write(chunk(0)); // resolves on post; the failure surfaces async on main
        await expect(w.close()).rejects.toThrow("disk full");
        await finalized;

        expect(state.aborted).toBe(true);
    });
});
