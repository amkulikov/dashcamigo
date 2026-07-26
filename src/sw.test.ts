// Deterministic unit tests for public/sw.js: the navigation handler, the
// install/activate lifecycle and the cacheFirst asset route. The SW is plain JS
// the browser loads directly (no exports, not importable), so we run its source
// in a vm sandbox with mocked web globals and reach the module-private
// functions: sloppy-mode function declarations leak onto the vm context's
// global object, and install/activate listeners are captured off the
// addEventListener stub.
//
// Why a vm unit test and not e2e: Playwright's network emulation does not
// compose reliably with SW navigation interception (offline.spec.ts header,
// microsoft/playwright#2311), and an UPDATE flow (two SW versions, waiting,
// reconcile) would need two full builds. The vm approach is fully deterministic
// and covers both.
//
// What this gates:
//   - navigation is network-first WITH a bounded wait: online the fast response
//     wins (deploy freshness); offline-limbo the hung fetch is aborted at
//     NAV_NETWORK_TIMEOUT_MS and the cached shell is served.
//   - install fails loudly when an /assets/ chunk cannot be cached (a silent
//     hole in app code detonates later as a module-worker load-failure), but
//     tolerates degradable entries (shells, icons).
//   - activate DEMOTES the previous deploy's precache entries to RUNTIME
//     instead of deleting them, and cacheFirst falls back to that copy when the
//     network 404s a stale hash - together these keep an old-build tab alive
//     across a deploy (the version-skew crash).

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";

const ORIGIN = "https://dashcamigo.app";
const SW_SRC_RAW = readFileSync(resolve(__dirname, "..", "public", "sw.js"), "utf-8");

// Read the timeout from the source so the test tracks the real constant rather
// than a hand-copied number that could silently drift.
const NAV_TIMEOUT_MS = Number(SW_SRC_RAW.match(/NAV_NETWORK_TIMEOUT_MS = (\d+)/)?.[1]);

// Mirrors the internal MANIFEST_KEY constant in public/sw.js (not extractable -
// it is interpolated into template strings there).
const MANIFEST_KEY = "/__dc-precache-manifest__";

// Default injected manifest: enough for LOCALE_SHELLS (derived from it) to be
// populated so the locale-fallback branch is reachable. Tests that exercise the
// install path pass their own manifest via LoadOptions.
const DEFAULT_MANIFEST = [
    { url: "/", revision: "r" },
    { url: "/en/", revision: "r" },
    { url: "/ru/", revision: "r" },
];

// Inject the manifests the way the build plugins do (mirrors
// vite-plugins/sw-precache.ts and tracker-assets.ts placeholder replacement).
function buildSwSrc(manifest: Array<{ url: string; revision: string }>, trackerUrls: string[] = []): string {
    return SW_SRC_RAW.replace(
        /const PRECACHE_MANIFEST = \[\];\s*\/\/ __DC_PRECACHE_MANIFEST__/,
        `const PRECACHE_MANIFEST = ${JSON.stringify(manifest)};`,
    ).replace(
        /const TRACKER_ASSET_URLS = \[\];\s*\/\/ __DC_TRACKER_ASSET_URLS__/,
        `const TRACKER_ASSET_URLS = ${JSON.stringify(trackerUrls)};`,
    );
}

// Minimal Response-like cache value. `_tag` lets a test assert WHICH response
// came back (network vs a specific cached shell vs the baked-in fallback).
interface FakeResponse {
    _tag: string;
    ok: boolean;
    status: number;
    type: string;
    redirected: boolean;
    clone(): FakeResponse;
}
function res(tag: string, extra: Partial<FakeResponse> = {}): FakeResponse {
    const value: FakeResponse = {
        _tag: tag,
        ok: true,
        status: 200,
        type: "basic",
        redirected: false,
        clone: () => value,
        ...extra,
    };
    return value;
}

const abs = (u: string): string => new URL(u, ORIGIN).toString();
const stripSearch = (u: string): string => {
    const url = new URL(u);
    url.search = "";
    return url.toString();
};

// In-memory Cache stub. match() accepts a string URL (relative ok) or a
// request-like {url}, honouring { ignoreSearch } like the real Cache API.
// delete() really deletes - the activate reconcile tests assert on it.
function makeCache(init: Record<string, FakeResponse> = {}) {
    const map = new Map<string, FakeResponse>(Object.entries(init).map(([k, v]) => [abs(k), v]));
    return {
        async match(input: string | { url: string }, opts?: { ignoreSearch?: boolean }) {
            const key = typeof input === "string" ? abs(input) : input.url;
            if (map.has(key)) return map.get(key);
            if (opts?.ignoreSearch) {
                const bare = stripSearch(key);
                for (const [storedKey, value] of map) {
                    if (stripSearch(storedKey) === bare) return value;
                }
            }
            return undefined;
        },
        async put(request: string | { url: string }, response: FakeResponse) {
            map.set(typeof request === "string" ? abs(request) : request.url, response);
        },
        async keys() {
            return [...map.keys()].map((url) => ({ url }));
        },
        async delete(input: string | { url: string }) {
            return map.delete(typeof input === "string" ? abs(input) : input.url);
        },
    };
}

interface LoadOptions {
    onLine: boolean;
    fetch: (...args: never[]) => Promise<unknown>;
    pre?: Record<string, FakeResponse>;
    rt?: Record<string, FakeResponse>;
    /** TRACKER cache seed (the blur-tracker's /ort/ + /models/ entries). */
    tr?: Record<string, FakeResponse>;
    /** Precache manifest to inject; DEFAULT_MANIFEST when omitted. */
    manifest?: Array<{ url: string; revision: string }>;
    /** Injected tracker asset URL set; [] (dev, no activate cleanup) when omitted. */
    trackerUrls?: string[];
}

// Run public/sw.js in a sandbox. Returns the captured module-private functions,
// the fetch spy, the two cache stubs and fire() for dispatching captured
// lifecycle events. setTimeout/clearTimeout are read from the CURRENT
// globalThis, so a test that calls vi.useFakeTimers() before loadSw() gets the
// fake clock.
function loadSw(opts: LoadOptions) {
    const pre = makeCache(opts.pre);
    const rt = makeCache(opts.rt);
    const tr = makeCache(opts.tr);
    const caches = {
        async open(name: string) {
            if (name.includes("tracker")) return tr;
            return name.includes("runtime") ? rt : pre;
        },
        async keys() {
            return [];
        },
        async delete() {
            return true;
        },
        async match() {
            return undefined;
        },
    };
    const fetchSpy = vi.fn(opts.fetch);
    const listeners = new Map<string, (evt: unknown) => void>();
    const ctx: Record<string, unknown> = {
        self: {
            addEventListener(type: string, fn: (evt: unknown) => void) {
                listeners.set(type, fn);
            },
            location: { origin: ORIGIN },
            skipWaiting() {},
            clients: { claim() {} },
        },
        navigator: { onLine: opts.onLine },
        caches,
        fetch: fetchSpy,
        URL,
        Request: class {
            url: string;
            constructor(input: string, _init?: unknown) {
                this.url = new URL(input, ORIGIN).toString();
            }
        },
        // The SW constructs `new Response(...)` for the baked-in offline page
        // and the stored manifest; tag it so a test can recognise those.
        Response: class {
            _tag = "offline-fallback";
            ok = true;
            status = 200;
            type = "basic";
            redirected = false;
            body: unknown;
            init: unknown;
            constructor(body: unknown, init: unknown) {
                this.body = body;
                this.init = init;
            }
            clone() {
                return this;
            }
        },
        AbortController,
        setTimeout: globalThis.setTimeout,
        clearTimeout: globalThis.clearTimeout,
        CountQueuingStrategy: class {},
        ReadableStream: class {},
        console,
    };
    vm.createContext(ctx);
    vm.runInContext(buildSwSrc(opts.manifest ?? DEFAULT_MANIFEST, opts.trackerUrls), ctx);
    return {
        navigationResponse: ctx.navigationResponse as (
            req: { url: string; mode: string },
            evt: { waitUntil(p: unknown): void },
        ) => Promise<FakeResponse>,
        cacheFirst: ctx.cacheFirst as (
            req: { url: string },
            evt: { waitUntil(p: unknown): void },
        ) => Promise<FakeResponse>,
        fetchSpy,
        pre,
        rt,
        tr,
        // Dispatch a captured lifecycle event and await its waitUntil payload -
        // exactly what the browser does with install/activate.
        async fire(type: "install" | "activate"): Promise<void> {
            const listener = listeners.get(type);
            if (!listener) throw new Error(`no ${type} listener registered`);
            let pending: unknown;
            listener({
                waitUntil(p: unknown) {
                    pending = p;
                },
            });
            await pending;
        },
    };
}

const navEvent = () => ({ waitUntil() {} });
const navRequest = (url: string) => ({ url: abs(url), mode: "navigate" });

describe("sw navigationResponse", () => {
    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it("online: serves the fresh network response (deploy freshness preserved)", async () => {
        const network = res("network");
        const { navigationResponse, fetchSpy } = loadSw({
            onLine: true,
            fetch: async () => network,
            pre: { "/ru/": res("cached-ru") },
        });

        const out = await navigationResponse(navRequest("/ru/?source=pwa"), navEvent());

        expect(fetchSpy).toHaveBeenCalledTimes(1);
        expect(out._tag).toBe("network");
    });

    it("offline-limbo (onLine true, fetch hangs): aborts at the timeout and serves the cached shell", async () => {
        vi.useFakeTimers();
        // Mirrors "connected but no internet": the request never settles on its
        // own; it only rejects when the navigation handler aborts it.
        const { navigationResponse, fetchSpy } = loadSw({
            onLine: true,
            fetch: (_req, init: { signal?: AbortSignal }) =>
                new Promise((_resolve, reject) => {
                    init.signal?.addEventListener("abort", () =>
                        reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
                    );
                }),
            pre: { "/ru/": res("cached-ru") },
        });

        const pending = navigationResponse(navRequest("/ru/?source=pwa"), navEvent());
        await vi.advanceTimersByTimeAsync(NAV_TIMEOUT_MS + 50);
        const out = await pending;

        expect(fetchSpy).toHaveBeenCalledTimes(1);
        // Step-2 (ignoreSearch) hit: the "?source=pwa" query is dropped.
        expect(out._tag).toBe("cached-ru");
    });

    it("hard offline (navigator.onLine false): never touches the network", async () => {
        const { navigationResponse, fetchSpy } = loadSw({
            onLine: false,
            fetch: async () => res("network"),
            pre: { "/ru/": res("cached-ru") },
        });

        const out = await navigationResponse(navRequest("/ru/?source=pwa"), navEvent());

        expect(fetchSpy).not.toHaveBeenCalled();
        expect(out._tag).toBe("cached-ru");
    });

    it("locale-derived fallback: an uncached sub-page resolves to that locale's cached home", async () => {
        const { navigationResponse } = loadSw({
            onLine: true,
            fetch: async () => {
                throw new Error("network down");
            },
            pre: { "/ru/": res("cached-ru") },
        });

        // No exact / query-agnostic hit for /ru/cameras/... -> LOCALE_SHELLS step.
        const out = await navigationResponse(navRequest("/ru/cameras/70mai"), navEvent());

        expect(out._tag).toBe("cached-ru");
    });

    it("evicted precache, live SW: serves the baked-in offline page, not a browser error", async () => {
        const { navigationResponse } = loadSw({
            onLine: true,
            fetch: async () => {
                throw new Error("network down");
            },
            pre: {},
            rt: {},
        });

        const out = await navigationResponse(navRequest("/de/anything"), navEvent());

        expect(out._tag).toBe("offline-fallback");
    });

    // Regression: a precache install that transiently failed to fetch one
    // locale shell (e.g. "/en/") but succeeded for the root stub ("/") used to
    // send an offline request for that locale straight into an infinite
    // navigation loop - the root stub's inline JS unconditionally redirects to
    // a locale, landing back on the same request with the same miss, forever
    // (observed in CI: 10+ repeated navigations to the same URL, page never
    // settles). The fallback must recognize "this request IS the missing
    // locale shell" and stop at the offline page instead of bouncing through
    // the stub.
    it("a locale's own shell is missing but the root stub is cached: serves the offline page, not the stub (would otherwise redirect-loop)", async () => {
        const { navigationResponse } = loadSw({
            onLine: true,
            fetch: async () => {
                throw new Error("network down");
            },
            pre: { "/": res("root-stub") }, // "/en/" deliberately absent
        });

        const out = await navigationResponse(navRequest("/en/"), navEvent());

        expect(out._tag).toBe("offline-fallback");
    });
});

describe("sw install", () => {
    // These run on real timers: a failing entry costs fetchForPrecache its full
    // 3-attempt backoff (~450ms) - bounded and simpler than faking the clock
    // through Promise.allSettled.

    it("fails the install when an /assets/ chunk cannot be fetched (no silent hole in app code)", async () => {
        const manifest = [
            { url: "/assets/app-AAAA.js", revision: "r1" },
            { url: "/en/", revision: "r2" },
        ];
        const { fire, pre } = loadSw({
            onLine: true,
            manifest,
            fetch: async (req: { url: string }) =>
                req.url.includes("/assets/") ? res("net-404", { ok: false, status: 404 }) : res("net-shell"),
        });

        await expect(fire("install")).rejects.toThrow(/missing app code.*app-AAAA/);
        // Entries that DID land stay cached and the manifest was persisted
        // before the throw, so the browser's retried install re-fetches only
        // what is still missing.
        expect(await pre.match("/en/")).toBeTruthy();
        expect(await pre.match(MANIFEST_KEY)).toBeTruthy();
    });

    it("tolerates a failed locale shell (degradable - navigation has its own layered fallback)", async () => {
        const manifest = [
            { url: "/assets/app-AAAA.js", revision: "r1" },
            { url: "/en/", revision: "r2" },
        ];
        const { fire, pre } = loadSw({
            onLine: true,
            manifest,
            fetch: async (req: { url: string }) =>
                req.url.endsWith("/en/") ? res("net-404", { ok: false, status: 404 }) : res("net-chunk"),
        });

        await fire("install");

        expect(await pre.match("/assets/app-AAAA.js")).toBeTruthy();
        expect(await pre.match("/en/")).toBeUndefined();
    });
});

describe("sw activate", () => {
    it("demotes the previous deploy's precache entries to RUNTIME instead of deleting them", async () => {
        const { fire, pre, rt } = loadSw({
            onLine: true,
            fetch: async () => res("network"),
            pre: {
                "/en/": res("shell"), // still in the manifest - stays put
                "/assets/old-chunk-DEAD.js": res("old-chunk"), // renamed by the deploy - demoted
                [MANIFEST_KEY]: res("stored-manifest"), // internal key - never reconciled away
            },
        });

        await fire("activate");

        expect(await pre.match("/en/")).toBeTruthy();
        expect(await pre.match(MANIFEST_KEY)).toBeTruthy();
        // The stale chunk left PRECACHE but survives in RUNTIME: a bfcache'd or
        // late-claimed old-build tab can still lazy-load it (via the cacheFirst
        // 404 fallback) instead of crashing its module worker.
        expect(await pre.match("/assets/old-chunk-DEAD.js")).toBeUndefined();
        expect((await rt.match("/assets/old-chunk-DEAD.js"))?._tag).toBe("old-chunk");
    });

    it("drops superseded tracker assets, keeps the current build's set", async () => {
        const { fire, tr } = loadSw({
            onLine: true,
            fetch: async () => res("network"),
            trackerUrls: [
                "/ort/1.27.0/ort-wasm-simd-threaded.wasm",
                "/models/plate/yolo-v9-t-512-license-plates-end2end.abc12345.onnx",
            ],
            tr: {
                "/ort/1.27.0/ort-wasm-simd-threaded.wasm": res("current-wasm"),
                "/ort/1.26.0/ort-wasm-simd-threaded.wasm": res("stale-wasm"),
                "/models/plate/yolo-v9-t-512-license-plates-end2end.abc12345.onnx": res("current-model"),
                "/models/plate/yolo-v9-t-512-license-plates-end2end.old00000.onnx": res("stale-model"),
            },
        });

        await fire("activate");

        // The current build's entries survive; the previous ort dir and the old
        // model hash are dropped from the non-FIFO cache (the ABI-skew /
        // stale-weights guard).
        expect((await tr.match("/ort/1.27.0/ort-wasm-simd-threaded.wasm"))?._tag).toBe("current-wasm");
        expect((await tr.match("/models/plate/yolo-v9-t-512-license-plates-end2end.abc12345.onnx"))?._tag).toBe(
            "current-model",
        );
        expect(await tr.match("/ort/1.26.0/ort-wasm-simd-threaded.wasm")).toBeUndefined();
        expect(await tr.match("/models/plate/yolo-v9-t-512-license-plates-end2end.old00000.onnx")).toBeUndefined();
    });

    it("leaves the tracker cache untouched when no asset set is injected (dev)", async () => {
        const { fire, tr } = loadSw({
            onLine: true,
            fetch: async () => res("network"),
            // trackerUrls omitted -> [] -> cleanup skipped, dev cache preserved.
            tr: { "/ort/ort-wasm-simd-threaded.wasm": res("dev-wasm") },
        });

        await fire("activate");

        expect((await tr.match("/ort/ort-wasm-simd-threaded.wasm"))?._tag).toBe("dev-wasm");
    });
});

describe("sw cacheFirst", () => {
    const assetRequest = (url: string) => ({ url: abs(url) });

    it("deploy-skew 404: serves the demoted RUNTIME copy instead of the error page", async () => {
        const { cacheFirst, fetchSpy } = loadSw({
            onLine: true,
            fetch: async () => res("net-404", { ok: false, status: 404 }),
            rt: { "/assets/old-chunk-DEAD.js": res("runtime-copy") },
        });

        const out = await cacheFirst(assetRequest("/assets/old-chunk-DEAD.js"), navEvent());

        expect(fetchSpy).toHaveBeenCalledTimes(1);
        expect(out._tag).toBe("runtime-copy");
    });

    it("404 with no cached copy anywhere passes through unchanged", async () => {
        const { cacheFirst } = loadSw({
            onLine: true,
            fetch: async () => res("net-404", { ok: false, status: 404 }),
        });

        const out = await cacheFirst(assetRequest("/assets/never-seen.js"), navEvent());

        expect(out._tag).toBe("net-404");
    });
});
