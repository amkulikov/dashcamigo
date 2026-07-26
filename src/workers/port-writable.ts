// Cross-thread writable bridge over a MessagePort. Replaces the transferable
// WritableStream the transcode worker used to receive: stable Safari cannot
// postMessage a WritableStream and throws DataCloneError "The object can not be
// cloned" (WebKit #215485, fixed only in Safari Technology Preview as of
// 2026-03). MessagePort IS transferable everywhere, so we tunnel the same
// write/close/abort protocol over a port and re-implement the highWaterMark
// backpressure the native stream gave us for free.
//
// Two halves, one wire contract:
//  - main side (servePortWritable): owns the real FSA writable, applies each
//    write in arrival order, acks each one, closes/aborts on request.
//  - worker side (wrapPortAsFsaWritable): exposes an FSA-shaped
//    {write,close,abort} to the pipeline and paces itself with a credit window
//    so up to HWM chunks are in flight before write() blocks - matching the old
//    CountQueuingStrategy({highWaterMark:16}) depth without a per-chunk round
//    trip (the naive one-ack-per-chunk model stalled the worker between chunks).
//
// Chunks are COPIED, not transferred: mediabunny's chunk-buffer ownership under
// StreamTarget({chunked}) is undocumented (it may reuse the buffer across
// flushes), and the native WritableStream we replaced also copied each chunk
// across the realm boundary - so copying is zero-regression and safe.

/** worker -> main. `chunk` is the mediabunny FSA write params ({type,position,
 *  data}); kept `unknown` because the worker only forwards it. */
export type PortWritableUp =
    | { readonly k: "write"; readonly chunk: unknown }
    | { readonly k: "close" }
    | { readonly k: "abort"; readonly reason: string };

/** main -> worker. `ack` replenishes one credit; `closed` resolves the worker's
 *  close(); `error` fails the pending op and every subsequent one. */
export type PortWritableDown =
    | { readonly k: "ack" }
    | { readonly k: "closed" }
    | { readonly k: "error"; readonly message: string };

/**
 * Minimal MessagePort surface both halves use. A real MessagePort satisfies it;
 * a fake satisfies it in unit tests (node/vitest has no DOM MessagePort, so the
 * concurrency logic here would otherwise be untestable outside a browser).
 */
export interface PortLike {
    postMessage(message: unknown): void;
    // MessageEvent (not a narrower {data} shape) so a real MessagePort assigns to
    // PortLike - its onmessage param is MessageEvent and function params are
    // contravariant. Tests deliver a `{ data } as MessageEvent`.
    onmessage: ((ev: MessageEvent) => void) | null;
    close(): void;
    /** No-op on a port whose onmessage already implicitly started it. */
    start?(): void;
}

/** Chunks in flight before write() blocks. Mirrors the old highWaterMark=16
 *  (~64 MB at mediabunny's 4 MB chunks). */
export const PORT_WRITABLE_HWM = 16;

/**
 * Worker-side FSA-shaped writable over a MessagePort. write() posts a chunk and
 * paces on a credit window (main replenishes one credit per ack); close() posts
 * close and resolves only once the main side reports the real close finished
 * (so the transcode request does not return before the file is committed);
 * abort() is best-effort. A main-side {k:"error"} rejects the pending op and all
 * subsequent ones. Cast to FileSystemWritableFileStream because the pipeline
 * only ever calls write/close/abort on it.
 */
export function wrapPortAsFsaWritable(port: PortLike): FileSystemWritableFileStream {
    let inFlight = 0;
    let failure: Error | null = null;
    // Producers parked because the window is full. FIFO to preserve write order;
    // each carries its chunk so the ack handler can post it the instant a slot
    // frees, consuming that slot atomically (never exceeding the in-flight cap).
    const parked: Array<{ chunk: unknown; resolve: () => void; reject: (err: Error) => void }> = [];
    let closeResolve: (() => void) | null = null;
    let closeReject: ((err: Error) => void) | null = null;

    const postChunk = (chunk: unknown): void => {
        inFlight++;
        port.postMessage({ k: "write", chunk } satisfies PortWritableUp);
    };

    const failAll = (err: Error): void => {
        failure = err;
        while (parked.length > 0) parked.shift()!.reject(err);
        closeReject?.(err);
        closeResolve = null;
        closeReject = null;
    };

    port.onmessage = (ev): void => {
        const msg = ev.data as PortWritableDown;
        if (msg.k === "ack") {
            inFlight--;
            // Hand the freed slot straight to the oldest parked producer so a
            // concurrent write() cannot slip in and overshoot the cap.
            const next = parked.shift();
            if (next) {
                postChunk(next.chunk);
                next.resolve();
            }
        } else if (msg.k === "closed") {
            closeResolve?.();
            closeResolve = null;
            closeReject = null;
        } else if (msg.k === "error") {
            failAll(new Error(msg.message));
        }
    };
    port.start?.();

    return {
        async write(chunk: unknown) {
            if (failure) throw failure;
            // Post now if a slot is free and no one is ahead in line; else park.
            if (inFlight < PORT_WRITABLE_HWM && parked.length === 0) {
                postChunk(chunk);
                return;
            }
            await new Promise<void>((resolve, reject) => {
                parked.push({ chunk, resolve, reject });
            });
        },
        async close() {
            if (failure) throw failure;
            // The stream calls close() only after the last write() resolved, and
            // write() resolves only once its chunk is posted - so nothing is
            // parked here. Post close (FIFO, after every write) and wait for the
            // main side to finish the real commit.
            await new Promise<void>((resolve, reject) => {
                closeResolve = resolve;
                closeReject = reject;
                port.postMessage({ k: "close" } satisfies PortWritableUp);
            });
        },
        async abort(reason?: unknown) {
            const message = reason instanceof Error ? reason.message : String(reason);
            try {
                port.postMessage({ k: "abort", reason: message } satisfies PortWritableUp);
            } catch {
                // Port already closed - nothing to abort on the main side.
            }
            // Unblock anything still parked; the pipeline is tearing down.
            failAll(new Error(message));
        },
    } as unknown as FileSystemWritableFileStream;
}

/** Real sink callbacks the main-side server drives. Kept as callbacks (not a
 *  concrete FSA writable) so this module has no dependency on the export-side
 *  close watchdog - the caller wraps it. */
export interface PortWritableSinkOps {
    /** Applies one write chunk to the real sink (mediabunny FSA write params). */
    write(chunk: unknown): Promise<void>;
    /** Commits the real sink (flush + atomic temp->final rename). The caller
     *  wraps the close watchdog here. */
    close(): Promise<void>;
    /** Aborts/discards the real sink. */
    abort(reason: string): Promise<void>;
    /** Fires exactly once when the sink reaches a terminal state (closed or
     *  aborted) - resolves the caller's `finalized` promise. */
    onFinalized(): void;
    /** Optional diagnostics for a mid-stream write failure. */
    onWriteError?(message: string): void;
}

/** Handle the main side keeps to force teardown when the worker cannot. */
export interface PortWritableServer {
    /**
     * Force the sink into its aborted-terminal state from the main side. Needed
     * when the worker was terminated / crashed / aborted before it could post
     * close or abort (the port then goes silent). Idempotent; a no-op once the
     * sink already closed or aborted.
     */
    forceAbort(reason: string): Promise<void>;
}

/**
 * Main-side server for the port bridge. Attaches to `port`, applies incoming
 * writes to the real sink strictly in order (MessagePort preserves order, but
 * each write is async, so a promise chain serializes them - positional writes
 * must not overlap and close must run after the last write), and acks each so
 * the worker's credit window advances.
 */
export function servePortWritable(port: PortLike, ops: PortWritableSinkOps): PortWritableServer {
    // Terminal-once flag. close(), abort/forceAbort, and a write failure are all
    // mutually exclusive terminal actions (a write failure funnels through
    // finalizeAbort); the guard makes every later message a no-op, and stops a
    // double abort on a real FSA writable (which throws InvalidStateError).
    let shutdownDone = false;

    const post = (msg: PortWritableDown): void => {
        try {
            port.postMessage(msg);
        } catch {
            // Port already closed on the worker side - nothing to notify.
        }
    };

    const finalizeAbort = async (reason: string | null): Promise<void> => {
        if (shutdownDone) return;
        shutdownDone = true;
        if (reason !== null) {
            try {
                await ops.abort(reason);
            } catch {
                // Writable may already be terminal - discard is best-effort.
            }
        }
        ops.onFinalized();
        try {
            port.close();
        } catch {
            // Already closed.
        }
    };

    const applyWrite = async (chunk: unknown): Promise<void> => {
        if (shutdownDone) return;
        try {
            await ops.write(chunk);
            post({ k: "ack" });
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            ops.onWriteError?.(message);
            post({ k: "error", message });
            // Discard the partial file and release the handle (sets shutdownDone).
            await finalizeAbort(message);
        }
    };

    const applyClose = async (): Promise<void> => {
        if (shutdownDone) return;
        shutdownDone = true;
        try {
            await ops.close();
            post({ k: "closed" });
        } catch (err) {
            post({ k: "error", message: err instanceof Error ? err.message : String(err) });
        } finally {
            ops.onFinalized();
            try {
                port.close();
            } catch {
                // Already closed.
            }
        }
    };

    let tail: Promise<void> = Promise.resolve();
    port.onmessage = (ev): void => {
        const msg = ev.data as PortWritableUp;
        if (msg.k === "write") tail = tail.then(() => applyWrite(msg.chunk));
        else if (msg.k === "close") tail = tail.then(() => applyClose());
        else if (msg.k === "abort") tail = tail.then(() => finalizeAbort(msg.reason));
    };
    port.start?.();

    return { forceAbort: (reason) => finalizeAbort(reason) };
}
