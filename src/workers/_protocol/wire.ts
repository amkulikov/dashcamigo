// Shared wire-protocol types for our Web Worker abstraction. Both
// worker-client.ts (main side) and worker-server.ts (worker side) speak this
// envelope. Feature-specific protocols (gps-extract, transcode, ...) ride
// inside `data` / `result` as plain user payloads.
//
// Envelope shape:
//  - __k discriminates the message kind: req | res | ntf | abort.
//  - The `__` prefix mirrors the `__type: "__dashcamigo:log"` marker used by
//    installWorkerLogBridge (log.ts). Anything starting with `__` on the wire
//    is reserved for the framework, never for user payloads.
//  - User payloads sit under `data` (req/ntf) or `result` (res) so they never
//    collide with envelope fields if the user adds `id`/`type` of their own.
//
// id correlation: a request carries an id; the matching response carries the
// same id. Notifications and aborts are id-less for ntf, id-tagged for abort
// (abort references an in-flight request).
//
// Error serialization mirrors comlink's `throwTransferHandler`: we keep
// name + message + stack. On the receiving side we rebuild with
// `Object.assign(new Error(message), { name, stack })`, which preserves the
// stack in DevTools and downloaded logs. Custom Error subclasses lose their
// prototype - a tradeoff we accept (deserializing to an arbitrary constructor
// requires a class registry, which we do not need).

/** Serialized Error. Preserves what users will read in a log dump. */
export interface SerializedError {
    name: string;
    message: string;
    stack?: string;
}

/** Request from caller to handler. Awaits a matching WireResponse(id). */
export interface WireRequest {
    __k: "req";
    id: number;
    /** Routes to a handler on the receiving side. */
    type: string;
    /** User payload. May be undefined for type-only pings. */
    data?: unknown;
}

/** Successful response to a WireRequest with the same id. */
export interface WireResponseOk {
    __k: "res";
    id: number;
    ok: true;
    result?: unknown;
}

/** Failed response to a WireRequest with the same id. */
export interface WireResponseErr {
    __k: "res";
    id: number;
    ok: false;
    error: SerializedError;
}

export type WireResponse = WireResponseOk | WireResponseErr;

/**
 * Fire-and-forget message. Used in both directions:
 *  - main → worker: cancel-like operations that do not need an ack (dispose,
 *    tick, seek).
 *  - worker → main: push events (progress, media-segment, init-segment).
 *
 * No id, no matching reply. The sender does not block.
 */
export interface WireNotification {
    __k: "ntf";
    type: string;
    data?: unknown;
}

/**
 * Cancellation marker for an in-flight request. main posts this when the
 * caller's AbortSignal fires; the server aborts the AbortController it
 * created for that id and lets the handler unwind. The server still sends
 * a WireResponse (typically ok=false with an AbortError-like payload) so the
 * client cleans the pending entry.
 */
export interface WireAbort {
    __k: "abort";
    id: number;
}

export type WireMessage = WireRequest | WireResponse | WireNotification | WireAbort;

/** True for any of our envelope shapes. Used as a guard on incoming messages. */
export function isWireMessage(value: unknown): value is WireMessage {
    if (!value || typeof value !== "object") return false;
    const k = (value as { __k?: unknown }).__k;
    return k === "req" || k === "res" || k === "ntf" || k === "abort";
}

/**
 * Serializes an Error (or arbitrary thrown value) into a structured-cloneable
 * form. Non-Error throws are wrapped: `throw "boom"` becomes
 * `{ name: "Error", message: "boom", stack: undefined }` - bad practice on the
 * thrower's side, but we do not want to lose information here.
 */
export function serializeError(value: unknown): SerializedError {
    if (value instanceof Error) {
        return {
            name: value.name,
            message: value.message,
            stack: value.stack,
        };
    }
    if (typeof value === "string") {
        return { name: "Error", message: value };
    }
    try {
        return { name: "Error", message: JSON.stringify(value) };
    } catch {
        return { name: "Error", message: String(value) };
    }
}

/**
 * Rebuilds an Error from SerializedError. The result has the original name
 * and stack visible in DevTools; the prototype chain is plain Error.
 *
 * AbortError is rebuilt as a DOMException so callers can match the standard
 * `err.name === "AbortError"` discriminator they use with fetch and friends.
 */
export function deserializeError(serialized: SerializedError): Error {
    if (serialized.name === "AbortError") {
        return new DOMException(serialized.message, "AbortError");
    }
    const err = new Error(serialized.message);
    err.name = serialized.name;
    if (serialized.stack) err.stack = serialized.stack;
    return err;
}
