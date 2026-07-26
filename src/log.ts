// Centralized logger. Single source of truth for all console.* calls.
//
// Key properties:
//  - Namespace-based: each module calls createLogger("ingest") or
//    createLogger("vendor:70mai") - prefix in the console and filterable
//    via localStorage.
//  - Levels debug/info/warn/error. Prod default "info", dev default "debug".
//    Below min-level: not written to the console, but always captured in the
//    ring buffer.
//  - Ring buffer (500 entries) in memory - the user exports it via
//    __dashcamigo.downloadLog() for a bug report. No backend; this is the
//    primary local diagnostic channel. An optional, opt-out Sentry sink
//    (setLogSink) mirrors scrubbed records as breadcrumbs - see src/sentry.ts.
//  - Override via localStorage["dashcamigo:log"]: format
//    "ingest=debug,vendor:*=info,*=warn". Wildcard only at the end of the
//    namespace ("vendor:*"). Multiple rules: LAST match wins.
//
// What we do NOT do:
//  - No hot-path logging (rAF, per-record, per-packet, timeupdate).
//  - No paired "X started" / "X finished" without meaning.
//  - No "entered function" - that is what stack traces are for.
//  - No PII scrubbing: coordinates, file names, paths are fine;
//    the buffer is local and only leaves the machine on explicit user action.

import { downloadBlob } from "./download.js";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_RANK: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
};

const LEVELS: ReadonlyArray<LogLevel> = ["debug", "info", "warn", "error"];

interface LogRecord {
    // Wall-clock milliseconds (Date.now). Useful in bug reports for correlating
    // with real time.
    ts: number;
    // Milliseconds since THIS scope's page/worker start (performance.now). For
    // relative ordering WITHIN one scope only - a Worker has its own time origin,
    // so worker and main nsec are not on one timeline. Use ts (Date.now) for
    // cross-scope correlation; see the scope field.
    nsec: number;
    level: LogLevel;
    // "worker" when forwarded from a Worker scope (its nsec is worker-relative).
    // Absent => main scope.
    scope?: "worker";
    ns: string;
    msg: string;
    // Arbitrary structured context. Serialized as-is in downloadLog via
    // JSON.stringify - don't put circular references or Map/Set here.
    ctx?: Record<string, unknown>;
    // Serialized Error: name+message+stack. Stored separately from ctx
    // so downloadLog renders the stack readably.
    err?: { name: string; message: string; stack?: string };
}

/**
 * Public subset of a log record handed to an optional external sink
 * (setLogSink). Lets the Sentry module mirror logs as breadcrumbs without
 * coupling log.ts to it - the sink is registered at runtime via a callback,
 * so log.ts stays a graph root with no import of the Sentry module.
 */
export interface LogSinkEntry {
    level: LogLevel;
    ns: string;
    msg: string;
    scope?: "worker";
    ctx?: Record<string, unknown>;
    err?: { name: string; message: string; stack?: string };
}

export interface Logger {
    debug(msg: string, ctx?: unknown): void;
    info(msg: string, ctx?: unknown): void;
    warn(msg: string, ctx?: unknown): void;
    error(msg: string, errOrCtx?: unknown): void;
    // Returns a logger with ns = `${parent.ns}:${suffix}`. Use when a module
    // has subsystems (createLogger("parser").child("gpx") → ns="parser:gpx").
    child(suffix: string): Logger;
}

const STORAGE_KEY = "dashcamigo:log";
const RING_BUFFER_SIZE = 500;

// Default min-level. import.meta.env.DEV: true in `vite dev`, false in
// `vite build`. In tests vitest runs its own dev server so DEV=true.
const DEFAULT_MIN_LEVEL: LogLevel = import.meta.env.DEV ? "debug" : "info";

// Parsed rules from localStorage. Order is preserved - last match wins
// (see resolveLevel).
interface Rule {
    pattern: string;
    level: LogLevel;
}

let rules: Rule[] = [];
// Cache of resolved level per namespace. Cleared on reloadRules.
const levelCache = new Map<string, LogLevel>();
// Circular ring buffer (O(1) push). buffer[head] is the next write slot;
// once count==RING_BUFFER_SIZE every push overwrites the oldest entry.
const buffer: Array<LogRecord | undefined> = new Array(RING_BUFFER_SIZE);
let bufferHead = 0;
let bufferCount = 0;
const pageStart = typeof performance !== "undefined" ? performance.now() : 0;

let installed = false;

// Optional external sink invoked for every emitted record (and forwarded worker
// records). Registered by the Sentry module to mirror logs as breadcrumbs; null
// when crash reporting is off/disabled. Never set in worker scope - the SDK runs
// only on the main thread. Single nullable callback - exactly one consumer.
let logSink: ((entry: LogSinkEntry) => void) | null = null;

/**
 * Registers (or clears, with null) a sink invoked for every record right after
 * it is buffered. The reverse dependency (Sentry -> logger) is broken by this
 * callback. Sink errors are swallowed by the callers (emit / bridge) - a sink
 * must never break logging.
 */
export function setLogSink(sink: ((entry: LogSinkEntry) => void) | null): void {
    logSink = sink;
}

// True when running inside a Web Worker (not main thread, not Node).
// Workers lack window but have globalThis.postMessage. Node.js has no
// postMessage, so IS_WORKER_SCOPE=false and forwarding is not activated
// (tests don't try to postMessage).
const IS_WORKER_SCOPE =
    typeof window === "undefined" && typeof (globalThis as { postMessage?: unknown }).postMessage === "function";

// Marker for forwarded log entries. Workers send messages in this format to
// the main thread; the main-side ring buffer receives them via
// installWorkerLogBridge. The "__dashcamigo:" prefix avoids collisions with
// regular worker messages.
const FORWARD_MESSAGE_TYPE = "__dashcamigo:log";

interface ForwardedLogMessage {
    __type: typeof FORWARD_MESSAGE_TYPE;
    record: LogRecord;
}

/**
 * Parses the "dashcamigo:log" localStorage value. Invalid rules are silently
 * skipped - a bad config must not crash the page.
 */
function parseRules(spec: string | null): Rule[] {
    if (!spec) return [];
    const out: Rule[] = [];
    for (const part of spec.split(",")) {
        const trimmed = part.trim();
        if (!trimmed) continue;
        const eq = trimmed.indexOf("=");
        if (eq < 0) continue;
        const pattern = trimmed.slice(0, eq).trim();
        const levelRaw = trimmed
            .slice(eq + 1)
            .trim()
            .toLowerCase();
        if (!pattern) continue;
        if (!LEVELS.includes(levelRaw as LogLevel)) continue;
        out.push({ pattern, level: levelRaw as LogLevel });
    }
    return out;
}

/**
 * Tests whether a pattern matches a namespace. Only trailing glob is
 * supported (`*`, `vendor:*`) - sufficient for our use cases.
 */
function matchesPattern(pattern: string, ns: string): boolean {
    if (pattern === "*") return true;
    if (pattern.endsWith("*")) {
        const prefix = pattern.slice(0, -1);
        return ns.startsWith(prefix);
    }
    return pattern === ns;
}

/**
 * Resolves the min-level for a namespace. Iterates rules in declaration
 * order; last match wins. Falls back to DEFAULT_MIN_LEVEL. Result is cached
 * since resolution runs on every log() call.
 */
function resolveLevel(ns: string): LogLevel {
    const cached = levelCache.get(ns);
    if (cached !== undefined) return cached;
    let level: LogLevel = DEFAULT_MIN_LEVEL;
    for (const r of rules) {
        if (matchesPattern(r.pattern, ns)) level = r.level;
    }
    levelCache.set(ns, level);
    return level;
}

/**
 * Reloads rules from localStorage and clears the cache. Called on first
 * logger access (lazy init via ensureInstalled) and on "storage" events
 * (user changed the key in DevTools or another tab).
 */
function reloadRules(): void {
    let raw: string | null = null;
    try {
        raw = typeof localStorage !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
    } catch {
        // localStorage blocked (private mode on some browsers) - fall back
        // to default silently.
    }
    rules = parseRules(raw);
    levelCache.clear();
}

function ensureInstalled(): void {
    if (installed) return;
    installed = true;
    reloadRules();
    // React to config changes from another tab or DevTools.
    if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
        window.addEventListener("storage", (ev) => {
            if (ev.key === STORAGE_KEY) reloadRules();
        });
    }
}

/**
 * Pushes a record into the ring buffer in O(1). The oldest entry is silently
 * overwritten once the buffer fills.
 */
function pushBuffer(rec: LogRecord): void {
    buffer[bufferHead] = rec;
    bufferHead = (bufferHead + 1) % RING_BUFFER_SIZE;
    if (bufferCount < RING_BUFFER_SIZE) bufferCount++;
}

/**
 * Splits the second argument of a log method into ctx (plain object) and
 * err (Error), enabling calls like:
 *   log.error("ingest failed", err)
 *   log.warn("gps log errors", { count: 5 })
 *   log.debug("merged samples", { vendor: "blackvue", count: 10 })
 */
function normalizePayload(payload: unknown): {
    ctx?: Record<string, unknown>;
    err?: { name: string; message: string; stack?: string };
} {
    if (payload === undefined || payload === null) return {};
    if (payload instanceof Error) {
        return { err: { name: payload.name, message: payload.message, stack: payload.stack } };
    }
    if (typeof payload === "object") {
        return { ctx: payload as Record<string, unknown> };
    }
    // Primitive (string/number/boolean) - wrap in ctx.value so it is
    // not lost in the ring buffer or DevTools.
    return { ctx: { value: payload } };
}

/**
 * Writes a record to the ring buffer and, if the level is permitted, to the
 * console. debug→console.debug, info→console.info, warn→console.warn,
 * error→console.error. DevTools hides console.debug by default - intentional.
 *
 * The console receives the original payload (Error object, plain object, or
 * primitive) so DevTools can render a clickable stack trace. The ring buffer
 * stores the normalized form (via normalizePayload) so JSON.stringify
 * preserves Error stacks.
 */
function emit(ns: string, level: LogLevel, msg: string, payload?: unknown): void {
    ensureInstalled();
    const { ctx, err } = normalizePayload(payload);
    const rec: LogRecord = {
        ts: Date.now(),
        nsec: typeof performance !== "undefined" ? performance.now() - pageStart : 0,
        level,
        ns,
        msg,
        ...(ctx ? { ctx } : {}),
        ...(err ? { err } : {}),
    };
    pushBuffer(rec);

    if (logSink) {
        try {
            logSink(rec);
        } catch {
            // A sink (e.g. Sentry breadcrumb forwarding) must never break logging.
        }
    }

    // In a worker, also forward the record to the main thread so it ends up
    // in the main ring buffer (exported via __dashcamigo.downloadLog). Without
    // forwarding, worker logs would be missing from bug reports (no backend;
    // the ring buffer is the local record). Console output stays per-scope: each worker writes to its
    // own DevTools tab; we don't duplicate to the main console.
    if (IS_WORKER_SCOPE) {
        try {
            const forwarded: ForwardedLogMessage = { __type: FORWARD_MESSAGE_TYPE, record: rec };
            (globalThis as { postMessage(d: unknown): void }).postMessage(forwarded);
        } catch {
            // postMessage can throw on a closed channel (worker terminated during
            // emit). Not critical - the record is in the worker-local buffer and
            // can be retrieved via the worker's DevTools if it's still alive.
        }
    }

    const minLevel = resolveLevel(ns);
    if (LEVEL_RANK[level] < LEVEL_RANK[minLevel]) return;

    const head = `[${ns}] ${msg}`;
    const fn =
        level === "debug"
            ? console.debug
            : level === "info"
              ? console.info
              : level === "warn"
                ? console.warn
                : console.error;
    if (payload !== undefined && payload !== null) fn(head, payload);
    else fn(head);
}

/**
 * Creates a logger with the given namespace. Namespace is short, by convention
 * module or module:subsystem ("ingest", "export", "map", "parser:gpx",
 * "vendor:70mai", "uncaught"). The colon is reserved for hierarchical suffixes
 * via child().
 */
export function createLogger(ns: string): Logger {
    return {
        debug: (msg, ctx) => emit(ns, "debug", msg, ctx),
        info: (msg, ctx) => emit(ns, "info", msg, ctx),
        warn: (msg, ctx) => emit(ns, "warn", msg, ctx),
        error: (msg, errOrCtx) => emit(ns, "error", msg, errOrCtx),
        child: (suffix) => createLogger(`${ns}:${suffix}`),
    };
}

/**
 * Snapshot of the ring buffer. Returns a copy so the caller can sort or
 * filter without side effects on the buffer.
 */
export function getLogBuffer(): LogRecord[] {
    const out: LogRecord[] = [];
    if (bufferCount < RING_BUFFER_SIZE) {
        // Pre-fill state: entries occupy [0..bufferCount).
        for (let i = 0; i < bufferCount; i++) out.push(buffer[i]!);
    } else {
        // Full: oldest entry is at bufferHead; walk forward wrapping.
        for (let i = 0; i < RING_BUFFER_SIZE; i++) {
            out.push(buffer[(bufferHead + i) % RING_BUFFER_SIZE]!);
        }
    }
    return out;
}

/**
 * Registers a main-thread listener that forwards Worker log entries into the
 * main ring buffer. Without this, worker logs (transcode/gps-extract/preview)
 * would be absent from __dashcamigo.downloadLog() bug reports.
 *
 * Not idempotent: calling it twice for the same worker adds a second listener
 * and duplicates entries. Each shim that creates a Worker must call this
 * EXACTLY ONCE right after `new Worker(...)`.
 *
 * Unknown/third-party messages are silently ignored - filter is on
 * `__type === "__dashcamigo:log"`.
 */
export function installWorkerLogBridge(worker: Worker): void {
    worker.addEventListener("message", (ev) => {
        const data = ev.data as Partial<ForwardedLogMessage> | null | undefined;
        if (!data || typeof data !== "object") return;
        if (data.__type !== FORWARD_MESSAGE_TYPE) return;
        const rec = data.record;
        if (!rec || typeof rec !== "object") return;
        // Tag as worker-originated so a reader of the downloaded buffer knows
        // this record's nsec is on the worker's clock, not the main thread's.
        // No re-emit to the console - the worker already wrote to its own
        // DevTools tab; duplicating to the main console adds noise.
        const entry: LogRecord = { ...rec, scope: "worker" };
        pushBuffer(entry);
        // Forward worker logs to the sink too (Sentry breadcrumbs) so a crash
        // on main has the worker's trail; tagged scope:"worker".
        if (logSink) {
            try {
                logSink(entry);
            } catch {
                // sink must never break the bridge
            }
        }
    });
}

/**
 * Downloads the current ring buffer as a .json file via a hidden <a download>.
 * The file stays on the user's machine; nothing is sent anywhere.
 */
export function downloadLogBuffer(): void {
    if (typeof document === "undefined") return;
    const payload = JSON.stringify(getLogBuffer(), null, 2);
    const blob = new Blob([payload], { type: "application/json" });
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    downloadBlob(blob, `dashcamigo-log-${ts}.json`);
}

// Test-only reset: clears the buffer and rules. Never called in production.
export function _resetForTests(): void {
    buffer.fill(undefined);
    bufferHead = 0;
    bufferCount = 0;
    rules = [];
    levelCache.clear();
    installed = false;
    logSink = null;
}
