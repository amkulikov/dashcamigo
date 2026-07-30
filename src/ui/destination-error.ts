// The export DESTINATION dying mid-write, told apart from every other failure.
//
// Windows reports a save target that disappeared under an in-flight export (the
// drive was unplugged, a sync client or an antivirus moved Chrome's .crswap
// staging file) as a NotFoundError from the writable - one of the few export
// failures the user can actually act on, and the one the generic message helps
// least with.
//
// Classifying by error name alone is not enough: a source recording that goes
// away throws the same names. So the writable is wrapped once at the point it is
// opened (tagSinkFailures) and every throw that comes OUT of it is tagged as
// sink-originated; only a tagged failure is ever read as "the destination is
// gone". The tag is a non-enumerable own property, so it survives being passed
// around but never leaks into logs or JSON.

/** Marker property set on errors thrown by the export sink. Not a symbol: the
 *  in-memory shim and mediabunny both re-throw the same object, and a string key
 *  keeps the check trivial for the unit test. */
const SINK_FAILURE_FLAG = "__dcSinkFailure";

/** DOMException names that mean "the file we were writing is no longer there /
 *  no longer writable". NotReadableError is deliberately absent - that is the
 *  SOURCE-side shape (see source-read-error.ts). InvalidStateError is absent
 *  too: it points at our own writable lifecycle, not at the user's disk, and
 *  telling them to pick another folder would send them chasing our bug. */
const DESTINATION_LOST_NAMES = new Set(["NotFoundError", "NotAllowedError", "NoModificationAllowedError"]);

function markSinkFailure(err: unknown): unknown {
    if (typeof err === "object" && err !== null) {
        try {
            Object.defineProperty(err, SINK_FAILURE_FLAG, { value: true, enumerable: false, configurable: true });
        } catch {
            // Frozen/exotic error object - classification degrades to generic,
            // which is exactly the behaviour we had before the tag existed.
        }
    }
    return err;
}

/** True when `err` came out of the export sink (as opposed to a source read, a
 *  codec, or our own logic). */
export function isSinkFailure(err: unknown): boolean {
    return typeof err === "object" && err !== null && (err as Record<string, unknown>)[SINK_FAILURE_FLAG] === true;
}

/**
 * True when the export failed because its DESTINATION went away: a sink-tagged
 * throw whose name says the file is missing or no longer writable. Both halves
 * are required - the name alone also fires for source-side failures, and the tag
 * alone would swallow ordinary sink errors that deserve their own message.
 *
 * Errors that crossed the worker port arrive as plain Errors carrying the
 * original name (port-writable.ts re-attaches it), so the name check holds for
 * the re-encode path too.
 */
export function isDestinationLostError(err: unknown): boolean {
    if (!isSinkFailure(err)) return false;
    const name = typeof err === "object" && err !== null ? (err as { name?: unknown }).name : undefined;
    return typeof name === "string" && DESTINATION_LOST_NAMES.has(name);
}

/** The subset of FileSystemWritableFileStream the export drives - mux writes go
 *  through write(), the GPMF post-process and the in-memory shim also use
 *  truncate/seek, and every path ends in close() or abort(). */
interface WritableSubset {
    write(chunk: unknown): Promise<void>;
    close(): Promise<void>;
    abort?(reason?: unknown): Promise<void>;
    truncate?(size: number): Promise<void>;
    seek?(position: number): Promise<void>;
}

/**
 * Wraps an export writable so every failure it throws is tagged as
 * sink-originated. Apply once, right after createWritable, and pass the wrapper
 * everywhere the raw writable would have gone: the tag then survives all the way
 * to the export flow's catch, on the main thread (stream-copy, where mediabunny
 * re-throws the original object) and through the worker bridge alike (the bridge
 * keeps the tagged object on this side and re-throws it in place of the
 * flattened copy that came back over the port).
 *
 * abort() is deliberately NOT tagged: it runs on paths that are already failing,
 * and its own failure must never displace the error that caused the teardown.
 */
export function tagSinkFailures(writable: FileSystemWritableFileStream): FileSystemWritableFileStream {
    const inner = writable as unknown as WritableSubset;
    const tagged = async <T>(op: () => Promise<T>): Promise<T> => {
        try {
            return await op();
        } catch (err) {
            throw markSinkFailure(err);
        }
    };
    const wrapper: WritableSubset = {
        write: (chunk) => tagged(() => inner.write(chunk)),
        close: () => tagged(() => inner.close()),
        abort: (reason) => (inner.abort ? inner.abort(reason) : Promise.resolve()),
    };
    // Optional members are forwarded only when the real writable has them, so a
    // caller feature-detecting them (`typeof w.truncate === "function"`) sees the
    // same surface it would see without the wrapper.
    if (inner.truncate) wrapper.truncate = (size) => tagged(() => inner.truncate!(size));
    if (inner.seek) wrapper.seek = (position) => tagged(() => inner.seek!(position));
    return wrapper as unknown as FileSystemWritableFileStream;
}
