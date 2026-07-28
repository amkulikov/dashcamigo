// Shared fixtures + helpers for the e2e regression suite.
//
// What makes this suite different from the old visual/qa specs (and why it can
// actually catch the bugs they missed):
//
//  1. HERMETIC. The only external dependency the app makes at runtime is the
//     OpenFreeMap tile/sprite/glyph/font server. We abort every request to it.
//     That removes network flakiness from CI AND doubles as a regression test
//     for the documented invariant "if the tile server is down, the functional
//     app keeps working" (CLAUDE.md / docs). Everything else (video, GPS, chart,
//     export) is local files, so the suite is fully deterministic offline.
//
//  2. FAIL-LOUD on errors. Every test asserts, at teardown, that no uncaught
//     exception (pageerror / unhandledrejection) and no unexpected console.error
//     fired. The project routes diagnostics through a ring buffer, not console.*,
//     so a stray console.error is a real signal.
//
//  3. NO SILENT PASSES. Helpers assert presence before reading geometry; specs
//     use web-first auto-retrying assertions instead of `waitForTimeout` +
//     `if (box) { ... }` blocks that pass green when an element is absent.

import path from "node:path";
import { fileURLToPath } from "node:url";

import { type Page, expect, test as base } from "@playwright/test";

// Type-only (erased at runtime - no app module is pulled into the Playwright
// process). Mirrors the production tour-id union below.
import type { OnboardTourId } from "../../src/ui/onboarding.js";

// The e2e suppression / clear lists, kept in lock-step with the production
// OnboardTourId union: `satisfies Record<OnboardTourId, true>` turns adding or
// removing a tour into a compile error here, so a new tour can never silently
// escape the suppression that keeps its overlay from blocking unrelated specs.
export const ONBOARD_TOUR_IDS = Object.keys({
    ingest: true,
    player: true,
    export: true,
    multichannel: true,
} satisfies Record<OnboardTourId, true>) as OnboardTourId[];

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, "../..");
export const SCREENSHOT_DIR = path.join(HERE, "screenshots");

// 70mai multichannel: 6 MP4 (Front/Back/Interior) + GPS log. Exercises every
// panel - chart, strip, mini-map, multichannel grid, channel reorder/exclude.
export const SAMPLE_70MAI = path.join(REPO_ROOT, "tests/testdata/70mai-multichannel");
// GoPro HERO5: single-channel clip with embedded GPMF. Used for the "no
// multichannel UI on a single camera" path. (novatek/carcam fixtures are
// <1KB parser stubs with no real video track and won't render in the viewer.)
export const SAMPLE_GOPRO = path.join(REPO_ROOT, "tests/testdata/gopro-gpmf");
// hev1-tagged HEVC (ffmpeg-generated, no GPS). The hev1 sample entry forces the
// needsHevcRemux path -> per-file MSE backend (mediabunny remux), the BlackVue
// ELITE / Vantrue playback route otherwise covered only by hand.
export const SAMPLE_HEVC = path.join(REPO_ROOT, "tests/testdata/hevc-hev1");
// Synthetic H.264 single-channel clip with NO GPS. The fixture for the
// GPS-dependent export gate: every other public sample carries a track. H.264
// (not HEVC) so the gate assertions run on CI Chrome, not only on macOS.
export const SAMPLE_NOGPS = path.join(REPO_ROOT, "tests/testdata/no-gps-h264");
// Synthetic H.264 + AAC Matroska (.mkv), no GPS. Browsers do not play .mkv via
// <video>.src, so this forces the MSE-remux path (like TS/HEVC) - but H.264
// decodes everywhere, so playback + stream-copy export assertions run on CI
// Chrome without a self-skip.
export const SAMPLE_MKV = path.join(REPO_ROOT, "tests/testdata/mkv-h264");

export const DESKTOP = { width: 1440, height: 900 };
export const MOBILE = { width: 390, height: 844 }; // iPhone 14 portrait
export const MOBILE_LANDSCAPE = { width: 844, height: 390 };

// console.error lines we tolerate. Kept as narrow as possible - over-filtering
// here would re-introduce the "tests miss bugs" problem. Failures of the
// deliberately-aborted tile server are EXPECTED; everything else stays loud.
function isBenignConsole(text: string, url: string): boolean {
    // Browser resource-load failure for an aborted tile-server request
    // ("Failed to load resource: net::ERR_FAILED"): msg.location().url is the
    // openfreemap request URL itself.
    if (/openfreemap\.org/i.test(url)) return true;
    // Firefox raw browser CORS console error for an aborted tile request
    // ("Cross-Origin Request Blocked: ... https://tiles.openfreemap.org/...")
    // carries the domain in the TEXT, not in the console message's url field, so
    // the url check above misses it. The openfreemap.org domain only ever appears
    // because WE abort every request to it, so trusting it in text is as safe as
    // trusting it in the url - a tile server being unreachable IS the invariant.
    if (/openfreemap\.org/i.test(text)) return true;
    // src/ui/map.ts mirrors map.on("error") / mini.on("error") through the app
    // logger as "[map] maplibre [mini ]error <cause>". Tolerate ONLY the causes
    // the aborted tile server actually produces (verified by capturing every
    // console.error across the suite):
    //  - Chromium: MapLibre AJAXError "Failed to fetch (0): https://tiles.
    //    openfreemap.org/..." - the message embeds the request URL, and tile,
    //    sprite and glyph requests all hit openfreemap.org, so require it.
    //  - AbortError: MapLibre cancels its own in-flight tile/style requests on
    //    teardown / style swap; the DOMException carries no URL, so scope it to
    //    this logger line instead of matching it anywhere.
    // A maplibre error with any other cause - and any app error that merely
    // mentions "tile" or "AbortError" outside this exact logger line (e.g. a
    // video-tile feature, an export/ingest cancel) - is NOT masked.
    const isMaplibreLogLine = /^\[map\] maplibre (mini )?error /.test(text);
    if (isMaplibreLogLine && /openfreemap\.org/i.test(text)) return true;
    if (isMaplibreLogLine && /\bAbortError\b/.test(text)) return true;
    // MapLibre "Style is not done loading" race on style swap - phrasing is
    // maplibre-specific, safe to match anywhere.
    if (text.includes("style is not done loading")) return true;
    // Expected only when a spec deliberately disables WebGL (compat): the map
    // degrades and the logger mirrors its error level to console.error.
    if (/\[map] map unavailable: no WebGL/i.test(text)) return true;
    // Firefox shapes the aborted-tile-server failure as a generic MapLibre
    // error event with NO message, where Chromium surfaces the AJAXError /
    // AbortError forms already caught above. Same hermetic cause (we abort
    // openfreemap.org), different engine wording. Match the bare generic form
    // only - a maplibre error carrying a real message/name is still NOT masked.
    if (/^\[map] maplibre (mini )?error Error$/.test(text)) return true;
    // Expected only when the onboarding fail-open spec deliberately injects a
    // fault: the engine logs at error level as it tears the broken tour down.
    // Other specs suppress tours, so these never fire there.
    if (/onboarding (failed to start|control failed)/i.test(text)) return true;
    return false;
}

// Body large enough to be a media/file upload rather than a small beacon. Video
// is MB-scale; a GPX/telemetry POST would be well under this. Combined with the
// host allowlist below, it turns "video is never uploaded" into an assertion.
const UPLOAD_BODY_LIMIT = 256 * 1024;

/**
 * Whether a request URL is an allowed network egress for the hermetic suite:
 * same-origin (the preview server) or openfreemap (which we abort anyway).
 * data:/blob: and any non-HTTP scheme are inert (not egress). Anything else -
 * a request to a third-party host - would mean bytes leaving the machine,
 * violating CLAUDE.md's "No backend. Video is never uploaded."
 */
function isEgressAllowed(reqUrl: string, baseHost: string): boolean {
    let u: URL;
    try {
        u = new URL(reqUrl);
    } catch {
        return true; // relative / malformed - resolves same-origin, not egress
    }
    if (u.protocol !== "http:" && u.protocol !== "https:") return true;
    if (u.host === baseHost) return true;
    return /(^|\.)openfreemap\.org$/i.test(u.hostname);
}

// Override the built-in `page` fixture.
export const test = base.extend<{ tolerateConsole: RegExp[] }>({
    // Per-spec opt-in tolerance for console errors a fault-injection spec
    // causes ON PURPOSE (e.g. asset-retry 404s the bundle). Default empty so
    // the suite stays fail-loud; a spec opts in via
    // test.use({ tolerateConsole: [...] }).
    tolerateConsole: [[], { option: true }],
    page: async ({ page, baseURL, tolerateConsole }, use) => {
        const pageErrors: string[] = [];
        const consoleErrors: string[] = [];
        // Invariant #1 guard: nothing may be uploaded. Record every request; on
        // teardown fail if any hit a non-allowlisted host or carried a body big
        // enough to be a video/file upload (even to same-origin).
        const offHostRequests: string[] = [];
        const uploadRequests: string[] = [];
        const baseHost = baseURL ? new URL(baseURL).host : "localhost:4173";

        page.on("pageerror", (err) => {
            pageErrors.push(`${err.name}: ${err.message}`);
        });
        page.on("console", (msg) => {
            if (msg.type() !== "error") return;
            const url = msg.location().url ?? "";
            if (isBenignConsole(msg.text(), url)) return;
            if (tolerateConsole.some((re) => re.test(msg.text()))) return;
            consoleErrors.push(msg.text());
        });
        page.on("request", (req) => {
            const url = req.url();
            if (!isEgressAllowed(url, baseHost)) offHostRequests.push(`${req.method()} ${url}`);
            const body = req.postDataBuffer();
            if (body && body.length > UPLOAD_BODY_LIMIT) {
                uploadRequests.push(`${req.method()} ${url} (${body.length} bytes)`);
            }
        });

        // Hermetic + degradation guard: block the tile server.
        await page.route(/openfreemap\.org/i, (route) => route.abort());

        await use(page);

        // Hard failures. pageErrors must ALWAYS be empty; console.error must be
        // empty after the benign filter. If either trips the test fails with the
        // captured text so the regression is visible, not swallowed.
        expect(pageErrors, "uncaught exceptions / unhandledrejections").toEqual([]);
        expect(consoleErrors, "unexpected console.error (not tile-server noise)").toEqual([]);
        // No bytes leave the machine: no third-party host, no large upload body.
        expect(offHostRequests, "requests to a non-allowlisted host (nothing may be uploaded)").toEqual([]);
        expect(uploadRequests, "request carrying a large body (possible video/file upload)").toEqual([]);
    },
});

export { expect };

/**
 * Preset localStorage BEFORE app code runs (addInitScript). Without this the
 * upload-warning / PWA toast pop over the UI on first load and cover the very
 * elements under test. Defaults to dark theme; override per test.
 */
export async function presetLocalStorage(
    page: Page,
    opts?: { theme?: "dark" | "light"; lang?: string },
): Promise<void> {
    const theme = opts?.theme ?? "dark";
    const lang = opts?.lang;
    await page.addInitScript(
        ({ theme, lang, tourIds }) => {
            try {
                const now = String(Date.now());
                localStorage.setItem("dc-theme", theme);
                localStorage.setItem("dashcamigo:upload-warning-shown-at", now);
                localStorage.setItem("dashcamigo:pwa:toast:shown", "1");
                localStorage.setItem("dashcamigo:pwa:toast:dismissedAt", now);
                localStorage.setItem("dashcamigo:lang-banner-dismissed", "1");
                // Suppress the onboarding tours by default: their full-screen
                // overlay blocks interaction and would break every spec that
                // loads a trip / opens export. The onboarding spec clears these
                // selectively via clearOnboarding() to test the first-run path.
                for (const id of tourIds) {
                    localStorage.setItem(`dashcamigo:onboarding:${id}`, "1");
                }
                if (lang) localStorage.setItem("dashcamigo:lang", lang);
            } catch {
                /* private mode - ignore */
            }
        },
        { theme, lang, tourIds: ONBOARD_TOUR_IDS },
    );
}

/** Navigate to a locale home. Defaults to /en/ so copy assertions are stable. */
export async function gotoApp(page: Page, locale = "en"): Promise<void> {
    await page.goto(`/${locale}/`);
}

/**
 * Re-enable onboarding tours for a first-run test. presetLocalStorage() seeds
 * all four as "done"; call this AFTER it (so the removal wins) to make the
 * listed tours fire again. Must run before gotoApp (uses addInitScript).
 */
export async function clearOnboarding(page: Page, ids: OnboardTourId[] = ONBOARD_TOUR_IDS): Promise<void> {
    await page.addInitScript((ids) => {
        try {
            for (const id of ids) localStorage.removeItem(`dashcamigo:onboarding:${id}`);
        } catch {
            /* private mode - ignore */
        }
    }, ids);
}

/**
 * Pick the sample folder and activate its first trip. Resolves only once the
 * active trip is actually playable (chart rendered, or - on layouts that hide
 * the chart - the total-time readout has advanced past 0:00). Fails loudly
 * within the timeouts rather than racing on a fixed sleep.
 */
export async function loadTrip(page: Page, sampleDir: string = SAMPLE_70MAI): Promise<void> {
    await page.locator("#folder-input").setInputFiles(sampleDir);
    const firstTrip = page.locator("li.trip:not(.unindexed-note)").first();
    await expect(firstTrip, "a trip card must appear after ingest").toBeVisible({ timeout: 30_000 });
    await firstTrip.click();
    await page.waitForFunction(
        () => {
            const c = document.getElementById("player-chart-canvas") as HTMLCanvasElement | null;
            if (c && c.getBoundingClientRect().width > 0) return true;
            const total = document.getElementById("player-total");
            return total !== null && total.textContent !== null && total.textContent !== "0:00";
        },
        { timeout: 15_000 },
    );
}

/**
 * Open the export panel, regardless of viewport. Export is the LAST control to
 * overflow into the player-bar kebab on a narrow bar, so click it directly when
 * visible, otherwise reach it through the overflow menu. Both branches end with
 * the panel asserted visible.
 *
 * Precondition: an ACTIVE player (a decodable trip). On a browser without an
 * H.264 decoder the viewer shows a "no decoder" overlay instead of the player
 * bar and there is no export button - see the codec note in the e2e README /
 * CI workflow (the suite needs Chrome, not the codec-less bundled Chromium, on
 * Linux).
 */
export async function openExport(page: Page): Promise<void> {
    const btn = page.locator("#player-export");
    await expect(btn, "export must be enabled once a decodable trip is active").toBeEnabled();
    if (await btn.isVisible()) {
        await btn.click();
    } else {
        await page.locator("#player-overflow").click();
        const item = page.locator("#player-overflow-menu button.overflow-menu-btn", {
            hasText: /export|экспорт/i,
        });
        await expect(item).toBeVisible();
        await item.click();
    }
    await expect(page.locator("#export-panel")).toBeVisible();
}

/** Alias kept for readability at mobile call sites; the logic is viewport-agnostic. */
export const openMobileExport = openExport;

/**
 * Assert an element is present and return its bounding box, non-null. Replaces
 * the `const box = await loc.boundingBox(); if (box) { ... }` anti-pattern that
 * silently skips its assertions when the element is missing.
 */
export async function boxOf(
    page: Page,
    selector: string,
): Promise<{ x: number; y: number; width: number; height: number }> {
    const loc = page.locator(selector);
    await expect(loc).toBeVisible();
    const box = await loc.boundingBox();
    expect(box, `${selector} must have a bounding box`).not.toBeNull();
    return box!;
}

/**
 * Current playback position of the MASTER tile in seconds - the element a frame
 * step / seek actually moves (getTripCurrentTime / seekTripTime read dom.player,
 * the active-channel, active-slot <video>). The `.active` tile marks the master
 * channel; each tile carries three <video>s (a decorative `.tile-blur-bg`
 * backdrop, the live slot, and a hot `.preload-slot`), so exclude the other two
 * to land on the live slot - the same `video:not(.tile-blur-bg)` convention the
 * player CSS uses.
 *
 * Do NOT use Math.max over every <video>: during playback the slave tiles drift
 * a frame or two ahead of the master and pause freezes that drift, so a pre-step
 * max is a stale slave that the first step re-syncs *down* to master+1/fps -
 * which reads as a step that went backwards and flakes the frame-step assertions.
 */
export async function masterVideoTime(page: Page): Promise<number> {
    const master = page.locator(".video-tile.active video:not(.preload-slot):not(.tile-blur-bg)");
    await expect(master).toHaveCount(1);
    return master.evaluate((v: HTMLVideoElement) => v.currentTime);
}

/** Screenshot helper - artifacts for human review, written next to the suite. */
export async function shot(page: Page, name: string): Promise<void> {
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, `${name}.png`), fullPage: false });
}

/**
 * Stub `window.showSaveFilePicker` with an in-memory file BEFORE the bundle
 * loads. The native-file-system-adapter ponyfill captures
 * `globalThis.showSaveFilePicker` at module-eval time and delegates to it when
 * present, so this routes the entire export write path (createWritable / write /
 * seek / truncate / getFile, including the GPMF meta-track re-open with
 * keepExistingData) into a buffer we can inspect - exercising the REAL mux /
 * re-encode / telemetry-injection pipeline, stubbing only the disk handle.
 *
 * Must be called before `gotoApp`. Read the result with `readExportResult`.
 */
export async function installExportCapture(page: Page): Promise<void> {
    await page.addInitScript(() => {
        const enc = new TextEncoder();
        const toU8 = (data: unknown): Uint8Array => {
            if (data == null) return new Uint8Array(0);
            if (typeof data === "string") return enc.encode(data);
            if (data instanceof Uint8Array) return data;
            if (data instanceof ArrayBuffer) return new Uint8Array(data);
            if (ArrayBuffer.isView(data)) {
                const v = data as ArrayBufferView;
                return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
            }
            return new Uint8Array(0);
        };
        const makeHandle = (name: string): Record<string, unknown> => {
            const h = { name, kind: "file", _buf: new Uint8Array(0), _pos: 0 } as {
                name: string;
                kind: string;
                _buf: Uint8Array;
                _pos: number;
                _ensure: (n: number) => void;
                _put: (u8: Uint8Array, at?: number) => void;
                createWritable: (opts?: { keepExistingData?: boolean }) => Promise<unknown>;
                getFile: () => Promise<File>;
            };
            h._ensure = (n) => {
                if (n > h._buf.length) {
                    const nb = new Uint8Array(n);
                    nb.set(h._buf);
                    h._buf = nb;
                }
            };
            h._put = (u8, at) => {
                const p = at ?? h._pos;
                h._ensure(p + u8.length);
                h._buf.set(u8, p);
                h._pos = p + u8.length;
            };
            h.createWritable = async (opts) => {
                if (!opts?.keepExistingData) h._buf = new Uint8Array(0);
                h._pos = 0;
                return {
                    // FSA write() accepts BufferSource | Blob | string, or a command
                    // object {type:'write'|'seek'|'truncate', ...}. Match the command
                    // form by its specific type values - a Blob also has a `.type`
                    // (its MIME), so a bare `"type" in chunk` check would misread it.
                    write: async (chunk: unknown) => {
                        const cmd = chunk as { type?: string; position?: number; size?: number; data?: unknown };
                        if (cmd && (cmd.type === "write" || cmd.type === "seek" || cmd.type === "truncate")) {
                            if (cmd.type === "seek") {
                                h._pos = cmd.position ?? h._pos;
                                return;
                            }
                            if (cmd.type === "truncate") {
                                const size = cmd.size ?? 0;
                                h._buf = h._buf.slice(0, size);
                                if (h._pos > size) h._pos = size;
                                return;
                            }
                            if (cmd.position != null) h._pos = cmd.position;
                            const d = cmd.data;
                            h._put(d instanceof Blob ? new Uint8Array(await d.arrayBuffer()) : toU8(d));
                            return;
                        }
                        h._put(chunk instanceof Blob ? new Uint8Array(await chunk.arrayBuffer()) : toU8(chunk));
                    },
                    seek: async (p: number) => {
                        h._pos = p;
                    },
                    truncate: async (n: number) => {
                        h._buf = h._buf.slice(0, n);
                        if (h._pos > n) h._pos = n;
                    },
                    close: async () => {},
                    // A real FileSystemWritableFileStream is a WritableStream and
                    // has abort(); export-flow calls it to discard a cancelled /
                    // failed stream-copy.
                    abort: async () => {},
                };
            };
            h.getFile = async () => new File([h._buf as BlobPart], h.name, { type: "video/mp4" });
            return h;
        };
        const w = window as unknown as { showSaveFilePicker: unknown; __lastExportHandle: unknown };
        w.showSaveFilePicker = async (options?: { suggestedName?: string }) => {
            const h = makeHandle(options?.suggestedName ?? "export.mp4");
            w.__lastExportHandle = h;
            return h;
        };
    });
}

/**
 * Simulates a browser WITHOUT the native File System Access save picker
 * (Android Chrome / Firefox / Safari), forcing the export through the in-memory
 * path (src/ui/in-memory-file.ts). Also intercepts `URL.createObjectURL` to
 * record every Blob handed to a download, so the test can read the produced MP4
 * bytes (the file never touches disk - it is offered via the done-view Download
 * button). Must be called before `gotoApp`; read with `readInMemoryDownload`.
 */
export async function installInMemoryExportCapture(page: Page): Promise<void> {
    await page.addInitScript(() => {
        // typeof check in nativeFsaAvailable() treats a present-but-undefined
        // getter as "no native picker" - matches the compat-spec removal style.
        // With no native picker the export takes the in-memory (RAM) path, which
        // is the only no-native path now.
        Object.defineProperty(window, "showSaveFilePicker", { configurable: true, get: () => undefined });
        const orig = URL.createObjectURL.bind(URL);
        (window as unknown as { __downloads: Blob[] }).__downloads = [];
        URL.createObjectURL = (obj: Blob | MediaSource): string => {
            if (obj instanceof Blob) (window as unknown as { __downloads: Blob[] }).__downloads.push(obj);
            return orig(obj);
        };
    });
}

/** The frame counters the single-channel pipeline reports when it finishes. */
export interface TranscodeDoneFields {
    framesEncoded: number;
    /** Frames handed to the encoder without going through the composition canvas. */
    framesDirect: number;
}

/**
 * Pulls the transcode worker's "transcode done" counters out of the log ring
 * buffer (worker records are bridged into the main-thread buffer). Null when the
 * line is absent - i.e. the single-channel pipeline never ran to completion.
 */
export async function readTranscodeDoneFields(page: Page): Promise<TranscodeDoneFields | null> {
    return page.evaluate(() => {
        const dump = (window as unknown as { __dashcamigo?: { dumpLog: () => unknown[] } }).__dashcamigo?.dumpLog;
        if (!dump) return null;
        const rec = dump()
            .reverse()
            .find((r) => (r as { msg?: string }).msg === "transcode done") as
            | { ctx?: { framesEncoded?: number; framesDirect?: number } }
            | undefined;
        if (!rec?.ctx) return null;
        return {
            framesEncoded: rec.ctx.framesEncoded ?? 0,
            framesDirect: rec.ctx.framesDirect ?? 0,
        };
    });
}

export interface ExportResult {
    len: number;
    ftyp: boolean;
    moov: boolean;
    mdat: boolean;
    gpmd: boolean;
    /** An audio media handler ('soun' in a hdlr box) is present - i.e. the export
     *  carries an audio track. Gates that audio survives the export (stream-copy
     *  copies it; the re-encode path passes AAC/MP3 through without an encoder). */
    soun: boolean;
}

/** Inspect the bytes the export pipeline wrote into the stubbed handle. */
export async function readExportResult(page: Page): Promise<ExportResult | null> {
    return page.evaluate(() => {
        const h = (window as unknown as { __lastExportHandle?: { _buf: Uint8Array } }).__lastExportHandle;
        if (!h) return null;
        const buf: Uint8Array = h._buf;
        const has = (needle: string): boolean => {
            const n = [...needle].map((c) => c.charCodeAt(0));
            outer: for (let i = 0; i + n.length <= buf.length; i++) {
                for (let j = 0; j < n.length; j++) if (buf[i + j] !== n[j]) continue outer;
                return true;
            }
            return false;
        };
        return {
            len: buf.length,
            ftyp: has("ftyp"),
            moov: has("moov"),
            mdat: has("mdat"),
            gpmd: has("gpmd"),
            soun: has("soun"),
        };
    });
}

/**
 * Whether this runner can encode the exact H.264 config the re-encode/compositing
 * pipeline asks of WebCodecs. The probe MUST mirror the real config or the test
 * skips on the wrong platforms: mediabunny emits HIGH-profile H.264 for codec
 * "avc" (profile 0x64, hardcoded) and gates on a single
 * VideoEncoder.isConfigSupported() with no hardwareAcceleration preference. On a
 * headless Linux runner without a hardware encoder the only software path is
 * Chrome's bundled OpenH264, which does NOT implement High - so High-profile
 * encode is impossible there and mediabunny throws. A baseline-profile probe
 * would return supported on that same runner and fail to skip. Used by both
 * re-encode export tests to skip (not fail) where encode is unavailable.
 *
 * NOTE: this does NOT catch Firefox - isConfigSupported returns true there but
 * the real encode throws (Bugzilla 1918769), and even a probe-frame encode of a
 * blank canvas succeeds while the actual split-screen export fails. The re-encode
 * tests therefore skip Firefox explicitly by browserName, not via this probe.
 */
export async function canEncodeHighProfileH264(page: Page): Promise<boolean> {
    return page.evaluate(async () => {
        const VE = (
            globalThis as unknown as {
                VideoEncoder?: { isConfigSupported(c: unknown): Promise<{ supported?: boolean }> };
            }
        ).VideoEncoder;
        if (!VE) return false;
        try {
            const s = await VE.isConfigSupported({
                codec: "avc1.64001f", // High profile, level 3.1 (720p) - what mediabunny emits
                width: 1280,
                height: 720,
                bitrate: 3_686_400,
                framerate: 30,
            });
            return !!s?.supported;
        } catch {
            return false;
        }
    });
}

/**
 * Whether a real WebGPU adapter can be acquired here. Plate/face detection is
 * WebGPU-only (no wasm fallback), and the checkbox is DISABLED without an
 * adapter - so a detect spec that .check()s it would hang the full 180 s
 * timeout on a runner whose (SwiftShader) adapter is missing. Guards those
 * specs into a clean skip instead. Presence of navigator.gpu is not enough:
 * requestAdapter() can still resolve null, which is what actually gates the UI.
 */
export async function hasWebGpuAdapter(page: Page): Promise<boolean> {
    return page.evaluate(async () => {
        const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
        if (!gpu) return false;
        try {
            return !!(await gpu.requestAdapter());
        } catch {
            return false;
        }
    });
}

/** Inspect the MP4 Blob handed to the download on the in-memory export path
 *  (the most recent captured video/mp4 blob). Null when none was produced. */
export async function readInMemoryDownload(page: Page): Promise<ExportResult | null> {
    return page.evaluate(async () => {
        const blobs = (window as unknown as { __downloads?: Blob[] }).__downloads ?? [];
        const mp4 = [...blobs].reverse().find((b) => b.type === "video/mp4");
        if (!mp4) return null;
        const buf = new Uint8Array(await mp4.arrayBuffer());
        const has = (needle: string): boolean => {
            const n = [...needle].map((c) => c.charCodeAt(0));
            outer: for (let i = 0; i + n.length <= buf.length; i++) {
                for (let j = 0; j < n.length; j++) if (buf[i + j] !== n[j]) continue outer;
                return true;
            }
            return false;
        };
        return {
            len: buf.length,
            ftyp: has("ftyp"),
            moov: has("moov"),
            mdat: has("mdat"),
            gpmd: has("gpmd"),
            soun: has("soun"),
        };
    });
}
