// Tests for the centralized logger. Covers:
//  - ring buffer drop on overflow,
//  - level gate (debug/info/warn/error filtering),
//  - localStorage pattern parser: exact match, wildcard, last-match-wins, invalid rules,
//  - child() concatenates namespace with a colon,
//  - normalizePayload separates Error from plain object.
//
// Approach: the logger holds module-level state (buffer/rules/cache/installed),
// so each test block resets state via `_resetForTests()`. Console methods are
// stubbed via vi.spyOn so tests don't pollute output and can verify calls.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { _resetForTests, createLogger, downloadLogBuffer, getLogBuffer } from "./log.js";

// Minimal in-memory Storage. Same pattern as in i18n/index.test.ts -
// intentionally duplicated: both tests are small and a shared helper would
// need its own test-utils file for just two usages.
function makeMockStorage(): Storage {
    const data = new Map<string, string>();
    return {
        getItem: (key: string) => data.get(key) ?? null,
        setItem: (key: string, value: string) => {
            data.set(key, String(value));
        },
        removeItem: (key: string) => {
            data.delete(key);
        },
        clear: () => data.clear(),
        key: (i: number) => Array.from(data.keys())[i] ?? null,
        get length() {
            return data.size;
        },
    };
}

beforeEach(() => {
    _resetForTests();
    vi.stubGlobal("localStorage", makeMockStorage());
    // Silence console methods by default. Tests that verify actual console.X
    // calls will override the spy below.
    vi.spyOn(console, "debug").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe("ring buffer", () => {
    it("captures all log records regardless of console-output level", () => {
        // In DEV default min-level = debug, both emitted to console and buffer.
        // Verified separately below. Here only the capture itself matters.
        const log = createLogger("test");
        log.debug("d");
        log.info("i");
        log.warn("w");
        log.error("e");
        const buf = getLogBuffer();
        expect(buf).toHaveLength(4);
        expect(buf.map((r) => r.level)).toEqual(["debug", "info", "warn", "error"]);
    });

    it("drops oldest record on overflow at 500 entries", () => {
        const log = createLogger("test");
        // Write 600 - first 100 should be evicted.
        for (let i = 0; i < 600; i++) log.debug(`msg-${i}`);
        const buf = getLogBuffer();
        expect(buf).toHaveLength(500);
        // First remaining is msg-100 (0..99 evicted).
        expect(buf[0]?.msg).toBe("msg-100");
        expect(buf[buf.length - 1]?.msg).toBe("msg-599");
    });

    it("captures buffer entries even when console-output is silenced by level gate", () => {
        // Restrict console via a very strict rule: everything at error level.
        localStorage.setItem("dashcamigo:log", "*=error");
        const log = createLogger("any");
        log.debug("d");
        log.info("i");
        log.warn("w");
        // Buffer has all three (buffer is independent of the gate).
        expect(getLogBuffer()).toHaveLength(3);
        // Console has zero (debug/info/warn suppressed, no error was logged).
        expect(console.debug).not.toHaveBeenCalled();
        expect(console.info).not.toHaveBeenCalled();
        expect(console.warn).not.toHaveBeenCalled();
    });

    it("getLogBuffer returns a copy, not the live buffer", () => {
        const log = createLogger("test");
        log.warn("first");
        const snap1 = getLogBuffer();
        log.warn("second");
        const snap2 = getLogBuffer();
        expect(snap1).toHaveLength(1);
        expect(snap2).toHaveLength(2);
    });
});

describe("level gate", () => {
    it("respects min-level set via wildcard rule", () => {
        localStorage.setItem("dashcamigo:log", "*=warn");
        const log = createLogger("ingest");
        log.debug("d");
        log.info("i");
        log.warn("w");
        log.error("e");
        expect(console.debug).not.toHaveBeenCalled();
        expect(console.info).not.toHaveBeenCalled();
        expect(console.warn).toHaveBeenCalledTimes(1);
        expect(console.error).toHaveBeenCalledTimes(1);
    });

    it("uses console method matching the level", () => {
        localStorage.setItem("dashcamigo:log", "*=debug");
        const log = createLogger("test");
        log.debug("d");
        log.info("i");
        log.warn("w");
        log.error("e");
        expect(console.debug).toHaveBeenCalledTimes(1);
        expect(console.info).toHaveBeenCalledTimes(1);
        expect(console.warn).toHaveBeenCalledTimes(1);
        expect(console.error).toHaveBeenCalledTimes(1);
    });

    it("formats console output with [namespace] prefix", () => {
        localStorage.setItem("dashcamigo:log", "*=debug");
        const log = createLogger("ingest");
        log.warn("hello");
        expect(console.warn).toHaveBeenCalledWith("[ingest] hello");
    });

    it("passes ctx as a separate argument to console", () => {
        localStorage.setItem("dashcamigo:log", "*=debug");
        const log = createLogger("ingest");
        log.warn("with ctx", { count: 5 });
        expect(console.warn).toHaveBeenCalledWith("[ingest] with ctx", { count: 5 });
    });

    it("passes Error as a separate argument so DevTools shows the stack", () => {
        localStorage.setItem("dashcamigo:log", "*=debug");
        const err = new Error("boom");
        const log = createLogger("ingest");
        log.error("failed", err);
        expect(console.error).toHaveBeenCalledWith("[ingest] failed", err);
    });
});

describe("localStorage rule pattern", () => {
    it("exact match wins over default", () => {
        localStorage.setItem("dashcamigo:log", "ingest=warn");
        const ingest = createLogger("ingest");
        const other = createLogger("other");
        ingest.info("ignored");
        other.info("emitted");
        // ingest: level warn, info < warn → suppressed.
        // other: falls through to DEFAULT_MIN_LEVEL (in vitest DEV=true → debug).
        expect(console.info).toHaveBeenCalledTimes(1);
        expect(console.info).toHaveBeenCalledWith("[other] emitted");
    });

    it("trailing wildcard matches a namespace prefix", () => {
        localStorage.setItem("dashcamigo:log", "*=error,vendor:*=info");
        const v70 = createLogger("vendor:70mai");
        const vBlackvue = createLogger("vendor:blackvue");
        const ingest = createLogger("ingest");
        v70.info("v70");
        vBlackvue.info("vbv");
        ingest.info("ingest");
        // vendor:* → info level → info fires;
        // ingest only matches "*=error" → info suppressed.
        expect(console.info).toHaveBeenCalledTimes(2);
        expect(console.info).toHaveBeenNthCalledWith(1, "[vendor:70mai] v70");
        expect(console.info).toHaveBeenNthCalledWith(2, "[vendor:blackvue] vbv");
    });

    it("last matching rule wins (general first, override later)", () => {
        // First "everything at debug", then override "ingest at warn".
        localStorage.setItem("dashcamigo:log", "*=debug,ingest=warn");
        const ingest = createLogger("ingest");
        const other = createLogger("other");
        ingest.info("ignored");
        other.info("emitted");
        expect(console.info).toHaveBeenCalledTimes(1);
        expect(console.info).toHaveBeenCalledWith("[other] emitted");
    });

    it("first rule wins if last is less specific (override semantics broken on purpose)", () => {
        // Document the semantics: LAST wins, not most specific. Users write
        // rules in "general to specific" order.
        localStorage.setItem("dashcamigo:log", "ingest=warn,*=debug");
        const ingest = createLogger("ingest");
        ingest.info("emitted because *=debug came last");
        expect(console.info).toHaveBeenCalledTimes(1);
    });

    it("ignores malformed rules silently", () => {
        // "no-eq", "=missingPattern", "ingest=invalidLevel" are all invalid;
        // only "*=warn" should survive.
        localStorage.setItem("dashcamigo:log", "no-eq,=warn,ingest=funky,*=warn");
        const log = createLogger("ingest");
        log.info("ignored");
        log.warn("emitted");
        expect(console.info).not.toHaveBeenCalled();
        expect(console.warn).toHaveBeenCalledTimes(1);
    });

    it("'*' alone matches every namespace", () => {
        localStorage.setItem("dashcamigo:log", "*=error");
        createLogger("a").warn("a");
        createLogger("b:c:d").warn("b");
        createLogger("vendor:x").warn("v");
        expect(console.warn).not.toHaveBeenCalled();
    });
});

describe("child()", () => {
    it("appends suffix with colon separator", () => {
        localStorage.setItem("dashcamigo:log", "*=debug");
        const parent = createLogger("parser");
        const sub = parent.child("gpx");
        sub.warn("hi");
        expect(console.warn).toHaveBeenCalledWith("[parser:gpx] hi");
    });

    it("child namespace is matched independently by wildcard rules", () => {
        // "parser:*=warn" - parent ("parser") does not match, child ("parser:gpx") does.
        localStorage.setItem("dashcamigo:log", "*=debug,parser:*=warn");
        const parent = createLogger("parser");
        const child = parent.child("gpx");
        parent.info("parent emitted (default debug)");
        child.info("child suppressed (parser:* → warn)");
        expect(console.info).toHaveBeenCalledTimes(1);
        expect(console.info).toHaveBeenCalledWith("[parser] parent emitted (default debug)");
    });
});

describe("payload normalization", () => {
    it("stores Error in record.err with name/message/stack", () => {
        const err = new Error("boom");
        createLogger("test").error("failed", err);
        const buf = getLogBuffer();
        expect(buf[0]?.err).toMatchObject({ name: "Error", message: "boom" });
        // stack may be absent in some runtimes - check the type, not the exact value.
        expect(typeof buf[0]?.err?.stack === "string" || buf[0]?.err?.stack === undefined).toBe(true);
        expect(buf[0]?.ctx).toBeUndefined();
    });

    it("stores plain object as record.ctx", () => {
        createLogger("test").warn("with ctx", { a: 1, b: "x" });
        const buf = getLogBuffer();
        expect(buf[0]?.ctx).toEqual({ a: 1, b: "x" });
        expect(buf[0]?.err).toBeUndefined();
    });

    it("wraps a primitive payload into ctx.value", () => {
        createLogger("test").warn("primitive", 42);
        const buf = getLogBuffer();
        expect(buf[0]?.ctx).toEqual({ value: 42 });
    });

    it("leaves ctx and err undefined when no payload is passed", () => {
        createLogger("test").warn("bare");
        const buf = getLogBuffer();
        expect(buf[0]?.ctx).toBeUndefined();
        expect(buf[0]?.err).toBeUndefined();
    });
});

describe("downloadLogBuffer()", () => {
    it("creates a blob and triggers an <a download> click", () => {
        // Minimal DOM stub for downloadLogBuffer without full jsdom:
        // stub createElement, document.body, URL.createObjectURL.
        const clicked: HTMLAnchorElement[] = [];
        const created: string[] = [];
        const revoked: string[] = [];
        vi.stubGlobal("URL", {
            createObjectURL: (b: Blob) => {
                created.push(`blob:${b.size}`);
                return `blob:${b.size}`;
            },
            revokeObjectURL: (u: string) => {
                revoked.push(u);
            },
        });
        const fakeAnchor: Partial<HTMLAnchorElement> & { click: () => void; remove: () => void } = {
            href: "",
            download: "",
            click: () => {
                clicked.push(fakeAnchor as HTMLAnchorElement);
            },
            remove: () => {},
        };
        vi.stubGlobal("document", {
            createElement: (tag: string) => {
                expect(tag).toBe("a");
                return fakeAnchor;
            },
            body: { appendChild: () => {} },
        });

        createLogger("test").warn("entry");
        downloadLogBuffer();

        expect(clicked).toHaveLength(1);
        expect(fakeAnchor.download).toMatch(/^dashcamigo-log-.+\.json$/);
        expect(created).toHaveLength(1);
    });
});
