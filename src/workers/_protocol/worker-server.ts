// Worker-side counterpart to worker-client.ts. Listens on a worker-scope
// endpoint (typically `self`), dispatches incoming WireRequests to a
// handler, forwards WireAborts as AbortSignal cancellation, and lets the
// handler push WireNotifications back to main.
//
// Lifecycle: the server is created once at the top of a worker module and
// remains alive for the worker's lifetime. There is no dispose() - workers
// die via self.close() or external terminate().
//
// Error contract: if the request handler throws, the server catches and
// sends a WireResponse{ok: false, error: serializedError}. The handler does
// NOT need to wrap calls in try/catch for the wire path.

import {
    type WireMessage,
    type WireNotification,
    type WireRequest,
    type WireResponseErr,
    type WireResponseOk,
    isWireMessage,
    serializeError,
} from "./wire.js";

/** Context passed to a request handler. */
export interface RequestContext {
    /**
     * Cancellation signal that fires when main sends WireAbort for this id.
     * Handlers should plumb this into the abortable APIs they call
     * (mediabunny Input, fetch, custom polling loops). Without it abort is
     * cosmetic: the request rejects on the main side but the handler keeps
     * burning CPU.
     */
    signal: AbortSignal;
    /**
     * Mark these transferables for ownership transfer with the response.
     * Call repeatedly to accumulate. Designed to match the natural shape of
     * a handler that builds an output buffer in pieces (e.g. an array of
     * ImageBitmaps) without forcing the handler to return tuples.
     */
    transfer(items: Transferable[]): void;
}

/** Constructor options for createWorkerServer. */
export interface WorkerServerOptions {
    /**
     * Async handler for WireRequest. Throws turn into WireResponseErr; the
     * handler does not need to try/catch for the wire path. Return value
     * becomes WireResponseOk.result.
     */
    onRequest?: (type: string, data: unknown, ctx: RequestContext) => unknown | Promise<unknown>;
    /**
     * Handler for WireNotification from main (cancel-like, dispose, tick).
     * Cannot reply - notifications are fire-and-forget by definition.
     */
    onNotification?: (type: string, data: unknown) => void;
}

/** Worker-scope endpoint, narrowed to the methods we use. `self` satisfies this. */
export interface WorkerScopeEndpoint {
    postMessage(message: unknown, transfer?: Transferable[]): void;
    addEventListener(type: "message", listener: (ev: MessageEvent) => void): void;
}

/** Handle returned by createWorkerServer for push-side notifications. */
export interface WorkerServer {
    /**
     * Push a notification back to main. No correlation, no reply expected.
     * Used for progress events, push streams (media-segment in per-file-mse),
     * one-shot signals (feed-done, seek-done).
     */
    notify(type: string, data?: unknown, transfer?: Transferable[]): void;
}

/**
 * Wraps a worker-scope endpoint in a typed onRequest / onNotification API.
 * Returns a handle for pushing notifications.
 *
 * Concurrent requests: the server does NOT serialize handlers. Multiple
 * requests in flight at once run in parallel (their promises overlap). If
 * the handler needs serialization (e.g. mutating shared decoder state), it
 * must implement its own gate - see frame-extract-worker's serialize() for
 * the canonical pattern.
 */
export function createWorkerServer(endpoint: WorkerScopeEndpoint, opts: WorkerServerOptions): WorkerServer {
    /** Active AbortControllers keyed by request id, for cancellation forwarding. */
    const inflight = new Map<number, AbortController>();

    endpoint.addEventListener("message", (ev: MessageEvent) => {
        const msg = ev.data;
        if (!isWireMessage(msg)) return;
        if (msg.__k === "req") {
            void handleRequest(msg);
        } else if (msg.__k === "abort") {
            const ctrl = inflight.get(msg.id);
            // Late abort after the handler already replied - drop quietly.
            if (ctrl) ctrl.abort();
        } else if (msg.__k === "ntf") {
            if (opts.onNotification) {
                try {
                    opts.onNotification(msg.type, msg.data);
                } catch {
                    // A throwing notification handler is a worker-side bug;
                    // logging is best done from within the handler since we
                    // have no per-message context here. Swallowing keeps the
                    // message loop alive.
                }
            }
        }
        // WireResponse on the worker scope means a misconfiguration on the
        // sending side; we drop silently.
    });

    async function handleRequest(req: WireRequest): Promise<void> {
        if (!opts.onRequest) {
            // No handler registered. Reply with an error so the caller knows
            // they hit an unconfigured worker rather than waiting forever.
            const errReply: WireResponseErr = {
                __k: "res",
                id: req.id,
                ok: false,
                error: serializeError(new Error(`no onRequest handler for type=${req.type}`)),
            };
            endpoint.postMessage(errReply);
            return;
        }
        const ctrl = new AbortController();
        inflight.set(req.id, ctrl);
        const transferList: Transferable[] = [];
        const ctx: RequestContext = {
            signal: ctrl.signal,
            transfer(items) {
                for (const it of items) transferList.push(it);
            },
        };
        try {
            const result = await opts.onRequest(req.type, req.data, ctx);
            const okReply: WireResponseOk = { __k: "res", id: req.id, ok: true, result };
            endpoint.postMessage(okReply, transferList);
        } catch (err) {
            const errReply: WireResponseErr = {
                __k: "res",
                id: req.id,
                ok: false,
                error: serializeError(err),
            };
            // No transferables on the error path - the handler may have populated
            // transferList before throwing, but those buffers would arrive on the
            // main side without a clean owner. Drop them; GC reclaims.
            endpoint.postMessage(errReply);
        } finally {
            inflight.delete(req.id);
        }
    }

    return {
        notify(type: string, data?: unknown, transfer?: Transferable[]): void {
            const msg: WireNotification = { __k: "ntf", type, data };
            endpoint.postMessage(msg, transfer ?? []);
        },
    };
}

/** Re-export for shims that build their own messages on top. */
export type { WireMessage };
