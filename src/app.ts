// Frontend entry point. Vanilla DOM, no framework.
//
// Thin orchestrator shell: imports modules from ui/* and wires them via
// init callbacks. All meaningful logic lives in the modules:
//
//   ui/state.ts        - AppState singleton and helpers (activeFrame, activeCandidate)
//   ui/dom.ts          - DOM references, channelPlayers, $id/$sel
//   ui/format.ts       - pure formatters (formatTime, formatDuration, ...)
//   ui/theme.ts        - theme colors, getCssVar, refresh on prefers-color-scheme change
//   ui/notifications.ts - bell drawer + toast stack (replaces the old status bar)
//   ui/empty-state.ts  - empty-state and codec-unsupported overlay
//   ui/ingest-overlay.ts - blocking ingest overlay
//   ui/lang-switcher.ts - language toggle
//   ui/mobile-drawer.ts - mobile sidebar drawer
//   ui/sidebar-resize.ts / ui/player-resize.ts - drag-handle resizers
//   ui/sidebar.ts      - trip sidebar renderer
//   ui/ingest.ts       - main ingest flow (classify → parse → index → group)
//   ui/file-sources.ts - <input webkitdirectory> + DnD
//   ui/map.ts          - map, mini-map, markers, popup, expand/collapse, marker rAF
//   ui/chart.ts        - chart.js strip, cursor plugin, no-gps tooltip
//   ui/export-panel.ts - inline range-export panel (options/progress/done/error)
//   ui/player.ts       - playFrame, multichannel grid, toolbar, keyboard, scrubber

// CSS import order matters:
//  1) maplibre-gl.css FIRST - our rules must override map defaults.
//  2) fonts.css SECOND - @font-face for self-hosted fonts; Vite inlines
//     them into the shared CSS bundle, avoiding render-blocking @import.
//     The woff2 files live in public/fonts/ and are fetched on first use.
//  3) tokens.css THIRD - all --dc-* design-system variables.
//  4) styles/index.css FOURTH - aggregator that @imports component
//     stylesheets in cascade order. Individual files live under
//     styles/components and styles/modals; the aggregator keeps imports
//     here trivial and lets Vite inline everything into one prod bundle.
import "maplibre-gl/dist/maplibre-gl.css";
import "./styles/fonts.css";
import "./styles/tokens.css";
import "./styles/index.css";

import { applyStaticI18n, getCurrentLang } from "./i18n/index.js";
import { createLogger, downloadLogBuffer, getLogBuffer } from "./log.js";
import { initSentry } from "./sentry.js";
import { APP_VERSION } from "./version.js";

import { initCapabilityGate, surfaceDegradedCapabilities, surfaceMapUnavailable } from "./ui/capability-gate.js";
import { initConnectivity } from "./ui/connectivity.js";
import { initOfflineBanner } from "./ui/offline-banner.js";
import { initLangSuggestionBanner } from "./ui/lang-suggestion-banner.js";
import { initCspModal } from "./ui/csp-modal.js";
import { initLandingDock } from "./ui/landing-dock.js";
import { initLandingShot } from "./ui/landing-shot.js";
import { dom } from "./ui/dom.js";
import { syncEmptyState } from "./ui/empty-state.js";
import { initFileSources } from "./ui/file-sources.js";
import { initIngestOverlay } from "./ui/ingest-overlay.js";
import { initNotifications } from "./ui/notifications.js";
import { initPwaInstall } from "./ui/pwa-install.js";
import { initSettingsModal } from "./ui/settings-modal.js";
import { initNoRecordingsModal } from "./ui/no-recordings-modal.js";
import { isIntentionalNavigation } from "./ui/nav-intent.js";
import { initSwitchLangModal } from "./ui/switch-lang-modal.js";
import { initUnsupportedFormatsModal } from "./ui/unsupported-formats-modal.js";
import { initUploadWarningModal } from "./ui/upload-warning-modal.js";
import { initWebglEnableModal } from "./ui/webgl-enable-modal.js";
import { awaitLazyEmbeddedGpsForTrip, isCurrentTripOpen, takeTripOpenToken } from "./ui/lazy-embedded-gps.js";
import { hydrateTrip } from "./ui/lazy-hydrate.js";
import { initLazyGpsLoadModal } from "./ui/lazy-gps-load-modal.js";
import { initHotkeysModal } from "./ui/hotkeys-modal.js";
import { initExportMode } from "./ui/export-mode.js";
import { initExportPanel } from "./ui/export-panel.js";
import { initExportTrimBar } from "./ui/export-trim-bar.js";
import { initPlayerBlur } from "./ui/player-blur.js";
import { cancelTrackPass } from "./ui/blur-track.js";
import { setDroppedRegionPassCanceller } from "./ui/blur-regions-state.js";
import { initPlayerCrop } from "./ui/player-crop.js";
import { initPlayerOverlays } from "./ui/player-overlays.js";
import { initTimelineRange } from "./ui/timeline-range.js";
import { initTopPanel } from "./ui/top-panel.js";
import { initViewMenu } from "./ui/view-menu.js";
import { initFeedbackModal } from "./ui/feedback.js";
import { initLangSwitcher } from "./ui/lang-switcher.js";
import { initTopbarOverflow } from "./ui/topbar-overflow.js";
import { prewarmIndexer } from "./indexer.js";
import { loadChart } from "./ui/chart.js";
import { prewarmGpsExtract } from "./ui/gps-extract-shim.js";
import { prewarmIngest } from "./ui/ingest-shim.js";
import { isMapAvailable, loadMaplibre, reloadMapStyleForCurrentTheme } from "./ui/map.js";
import { prewarmPreview } from "./ui/trip-preview.js";
import { initThemeToggle } from "./ui/theme-toggle.js";
import { initMobileDrawer } from "./ui/mobile-drawer.js";
import {
    applyComposition,
    getTripCurrentTime,
    playFrame,
    playTripEvent,
    seekThenPlay,
    seekTripTime,
} from "./ui/player.js";
import { initTripUi } from "./ui/trip-ui-init.js";
import { initOnboarding, pickTripOpenTour, runTripOpenTour } from "./ui/onboarding.js";
import { resetVideoZoom } from "./ui/player-zoom.js";
import { initSidebar, syncSortControls } from "./ui/sidebar.js";
import { initSidebarResize } from "./ui/sidebar-resize.js";
import { state } from "./ui/state.js";
import type { AppState } from "./ui/state.js";
import { getThemeChoice, refreshThemeColors } from "./ui/theme.js";

// --- i18n bootstrap ---
//
// Apply translations to static [data-i18n] nodes once, before other
// handlers that may read button textContent etc. Also sync <html lang>
// to the resolved locale - the HTML ships as "en" (English baseline for
// search crawlers and social unfurl bots, see CLAUDE.md Localization).
applyStaticI18n();
document.documentElement.lang = getCurrentLang();

// --- crash reporting bootstrap ---
//
// Sentry (errors-only) kicked off as early as possible so its global handlers
// install before the user does anything. No-op unless VITE_SENTRY_DSN is built
// in AND the user has not opted out in settings (default ON). The SDK is
// dynamically imported, so an empty DSN ships nothing and the SEO landing entry
// stays lean. Privacy/scrubbing details live in src/sentry.ts + sentry-scrub.ts.
initSentry();

// --- browser capability gate ---
//
// Detect missing Web APIs, report the gaps to analytics, and - if a FATAL gap
// exists (no Web Workers / <video> / file load) - render a blocking gate
// explaining the problem and what to do. Runs after i18n + analytics bootstrap
// (so the gate is localized and the metric is sent) and before heavy init.
//
// On a fatal gap we still let the UI modules bind (harmless - the gate covers
// the whole viewport and the realistic fatal cap, "no Web Workers", breaks only
// ingest), but we skip the eager worker prewarm (prefetchDeferredLibs), which
// would otherwise throw `new Worker` on a Worker-less browser, and the proactive
// degraded notice (the gate already says everything). Degraded-but-usable
// browsers fall through to surfaceDegradedCapabilities() below.
const capabilityFatal = initCapabilityGate();

// Sync theme colors and map style when the user changes prefers-color-scheme
// in the OS or DevTools. Without this the color cache and canvas colors
// would stay frozen on the original theme.
const appLog = createLogger("app");
if (typeof window !== "undefined" && window.matchMedia) {
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (ev) => {
        // Only the "auto" choice follows the OS. With an explicit light/dark
        // override the CSS vars and the canvas palette are fixed, so an OS
        // scheme flip changes nothing - skip the cache flush + map/chart repaint.
        if (getThemeChoice() !== "auto") return;
        refreshThemeColors();
        reloadMapStyleForCurrentTheme();
        // The inferred-event strip repaints via its own theme subscription
        // (subscribeThemeChange in initChart), which refreshThemeColors fires -
        // same path applyTheme relies on, so no explicit redraw is needed here.
        // Theme change doesn't reload the page, so the entry stays in
        // the ring buffer for bug reports ("switched to dark, then broke").
        appLog.info("theme changed", { theme: ev.matches ? "dark" : "light" });
    });
}

// --- startup ---

// DevTools convenience handle. Not used in application code.
// dumpLog/downloadLog are the primary local diagnostic channel for bug
// reports: no backend - the ~500-entry ring buffer is the local way to get
// logs out of a user's session (optional opt-out Sentry augments it). See
// src/log.ts + src/sentry.ts.
declare global {
    interface Window {
        __dashcamigo: {
            state: AppState;
            dom: typeof dom;
            dumpLog: typeof getLogBuffer;
            downloadLog: typeof downloadLogBuffer;
        };
    }
}
window.__dashcamigo = { state, dom, dumpLog: getLogBuffer, downloadLog: downloadLogBuffer };

// Global uncaught-error hooks. Regular try/catch misses sync throws from
// event listeners and unhandled promise rejections. We route both through
// logger("uncaught") so they end up in the ring buffer for bug reports.
// Errors from cross-origin scripts and browser extensions arrive with an
// empty filename or a filename outside our origin - discard as noise.
const uncaughtLog = createLogger("uncaught");

// Known noise from DevTools panels (Performance Insights, Lighthouse) and
// browser extensions. These arrive with an empty filename ("<anonymous>"
// eval script), pollute the ring buffer, and look like our bugs in reports.
const NOISE_MESSAGE_PATTERNS: readonly RegExp[] = [
    /__chromium_devtools_/, // Chrome DevTools metrics reporter
    /__lighthouse_/, // Lighthouse extension
    /chrome-extension:\/\//, // any extension leaking through the stack
    // Benign browser behaviour: ResizeObserver fires this when an observer's
    // callback synchronously triggers another resize within the same frame,
    // so the browser defers the next notifications. It's a soft warning that
    // surfaces via window.onerror in Chrome - not an actual exception.
    // See https://developer.mozilla.org/en-US/docs/Web/API/ResizeObserver#observation_errors
    /^ResizeObserver loop /,
];
function isNoise(message: string, stack: string | undefined): boolean {
    for (const re of NOISE_MESSAGE_PATTERNS) {
        if (re.test(message)) return true;
        if (stack && re.test(stack)) return true;
    }
    return false;
}

window.addEventListener("error", (ev) => {
    const fn = ev.filename;
    if (fn && location.origin && !fn.startsWith(location.origin) && !fn.startsWith("/")) return;
    const message = ev.message || "error";
    const stack = ev.error instanceof Error ? ev.error.stack : undefined;
    if (isNoise(message, stack)) return;
    uncaughtLog.error(message, ev.error ?? { filename: fn, lineno: ev.lineno, colno: ev.colno });
});
window.addEventListener("unhandledrejection", (ev) => {
    const reason = ev.reason;
    const message = reason instanceof Error ? reason.message : String(reason);
    const stack = reason instanceof Error ? reason.stack : undefined;
    if (isNoise(message, stack)) return;
    uncaughtLog.error("unhandled promise rejection", reason);
});

// Hand-mirrored with the boot-time asset retry in index.html (dc-bootstrap):
// same key, same cap - reloads spent there and here draw from one budget,
// and dc:ready clears it after a successful boot.
const ASSET_RETRY_STORAGE_KEY = "dc-asset-retry";
const ASSET_RETRY_MAX_ATTEMPTS = 4;

// A lazy chunk that fails to load means the deployment changed under this
// session: the CF-edge propagation window right after a release, or a
// long-lived tab importing a chunk the new deployment no longer ships
// (docs/deploy.md, "Deployment pipeline"). Reload only while there is
// nothing to lose - with trips loaded or an ingest running a reload would
// destroy the tab's in-memory state, so the import rejection flows to the
// caller's error path instead (and gets logged by the handlers above). An
// immediate reload is enough: if the fresh HTML's assets still 404, the
// boot-time retry takes over with its backoff.
window.addEventListener("vite:preloadError", (ev) => {
    if (state.trips.length > 0 || state.ingestController !== null) return;
    // Offline a reload cannot fetch the missing chunk anyway - don't burn a
    // retry from the budget; the failure surfaces through the usual error
    // paths (the boot-time retry in dc-bootstrap waits for `online` instead).
    if (navigator.onLine === false) return;
    try {
        const attempts = Number.parseInt(sessionStorage.getItem(ASSET_RETRY_STORAGE_KEY) ?? "0", 10) || 0;
        if (attempts >= ASSET_RETRY_MAX_ATTEMPTS) return;
        sessionStorage.setItem(ASSET_RETRY_STORAGE_KEY, String(attempts + 1));
    } catch {
        // Storage unavailable: no way to cap - a visible failure beats a
        // potential reload loop.
        return;
    }
    ev.preventDefault();
    location.reload();
});

// Warn before close/reload. No backend: loaded trips and the index live
// only in the current tab's memory - reload resets state, files on disk
// remain but need re-indexing. The browser shows its own generic prompt
// ("Leave site?"), we can't customize the text. iOS Safari does not fire
// beforeunload - no warning there, known limitation.
// Triggers when trips are loaded OR an ingest is in progress.
window.addEventListener("beforeunload", (ev) => {
    if (state.trips.length === 0 && state.ingestController === null) return;
    // A deliberate language switch already confirmed the loss via its own modal -
    // don't stack the browser's generic prompt on top.
    if (isIntentionalNavigation()) return;
    ev.preventDefault();
    // returnValue = "" for legacy compat (some engines ignore preventDefault
    // without it). The text is not shown; the browser uses its own prompt.
    ev.returnValue = "";
});

// --- startup info log ---
//
// Logged once per page load as the FIRST ring-buffer entry, so every
// subsequent error in a bug report has context: build version, browser,
// viewport, theme, locale, hardware. Without this, "something is broken
// for this user" investigations stall immediately.
//
// Level=info; prod default min=warn, so it doesn't appear in the console
// but is always captured in the buffer. Visible via __dashcamigo.downloadLog().
{
    let localStorageWorks = false;
    try {
        const k = "__dashcamigo:probe";
        localStorage.setItem(k, "1");
        localStorage.removeItem(k);
        localStorageWorks = true;
    } catch {
        // localStorage blocked - private mode on some browsers.
    }
    appLog.info("app started", {
        version: APP_VERSION,
        userAgent: navigator.userAgent,
        lang: navigator.language,
        resolvedLang: getCurrentLang(),
        tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
        viewport: { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio },
        screen: { w: screen.width, h: screen.height },
        theme: window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light",
        online: navigator.onLine,
        hardwareConcurrency: navigator.hardwareConcurrency,
        // deviceMemory is Chromium-only (W3C Device Memory API, not
        // implemented in FF/Safari). Undefined on non-Chrome is correct.
        deviceMemory: (navigator as Navigator & { deviceMemory?: number }).deviceMemory,
        localStorageWorks,
        serviceWorkerSupported: "serviceWorker" in navigator,
    });
}

// Async storage estimate. Separate log entry - doesn't block startup.
// navigator.storage.estimate is absent on Safari < 16.4 - just no entry.
if (navigator.storage?.estimate) {
    navigator.storage
        .estimate()
        .then((est) => {
            appLog.info("storage estimate", { quota: est.quota, usage: est.usage });
        })
        .catch((err: unknown) => {
            appLog.warn("storage estimate failed", err);
        });
}

// Initialize PRE-TRIP modules - everything needed on the landing page
// (body.no-trips). Heavy modules (map, Chart.js, player, rAF loop) are
// lazily initialized in src/ui/trip-ui-init.ts on first ingest - MapLibre
// on the landing page would otherwise burn ~6% CPU for nothing.

// UX-24: init theme-toggle FIRST so applyTheme sets the class on <html>
// before the rest of the UI renders. Without this, users with stored=dark
// and system=light see a light-palette flash.
initThemeToggle({
    onThemeChange: () => {
        reloadMapStyleForCurrentTheme();
    },
});

// Splash loader dismissal. The inline bootstrap in index.html added
// .is-loading to <html> and showed #dc-loader, covering the English
// baseline HTML until applyStaticI18n() swapped the texts and
// initThemeToggle() synced aria-pressed on the buttons. rAF guarantees that
// at least one frame with these changes was painted before the fade starts.
// A 15s watchdog in the inline bootstrap removes the loader itself if this
// dispatch never happens (an early error in the imports).
requestAnimationFrame(() => {
    dispatchEvent(new Event("dc:ready"));
});

initLangSwitcher();
// Footer build id: which release this copy serves - tells the mirror and a
// self-host apart from production at a glance. Filled at runtime so the
// prerendered HTML stays build-agnostic; hidden when the build had no git.
const footerVersion = document.getElementById("footer-version");
if (footerVersion && APP_VERSION !== "unknown") {
    footerVersion.textContent = APP_VERSION;
    footerVersion.hidden = false;
}
// Topbar overflow-bar: when the header shrinks, low-priority buttons
// (theme/feedback/install) move into the kebab menu. Must run after
// initThemeToggle/initLangSwitcher - they bind handlers to the original
// buttons, and the clone in the overflow menu forwards the click to the
// original.
initTopbarOverflow();
// Notifications: wires up the bell button + toast container. Safe to call
// before any notify() - the store buffers entries and the UI catches up.
initNotifications();
// Connectivity tracking + the offline banner. initConnectivity seeds state and
// binds online/offline; initOfflineBanner subscribes and reflects it (the
// subscription fires immediately, so an offline launch shows the banner at once).
initConnectivity();
initOfflineBanner();
// Settings modal provides the gear icon in the header. Hidden when
// analytics is disabled in the build (nothing else to configure yet).
initSettingsModal();
initIngestOverlay();
initUnsupportedFormatsModal();
initNoRecordingsModal();
// Upload-warning must be initialized BEFORE initFileSources - file-sources
// binds click handlers to CTA buttons that call showUploadWarning; this
// init only attaches close listeners to the modal's own buttons.
initUploadWarningModal();
initSwitchLangModal();
initLazyGpsLoadModal();
initHotkeysModal();
// "View" dropdown - toggle chart/strip/mini-map. Reads visibility from localStorage
// at startup and applies it; hotkeys C / E / M bound here are global so they
// work without focusing the dropdown. Mini-map close-X is replaced by this menu.
initViewMenu({
    button: dom.viewMenuButton,
    popover: dom.viewMenuPopover,
    panels: {
        // Hide ONLY the canvas (not the whole .player-chart box), otherwise
        // the strip and ruler inside would also disappear when "unchecking the
        // chart". chart-axis-labels are tied to the canvas via :has() in CSS -
        // they hide by cascade. The ruler stays visible - the time-scale is
        // useful even without the speed chart. The .player-chart height is
        // recomputed via :has(...) in viewer.css.
        chart: dom.chartCanvas,
        strip: dom.chartInferredStripWrap,
        // We do NOT pass the map element - view-menu only stores the
        // preference and notifies subscribers. The only writer for
        // .mini-map.hidden is applyMapLayout in map.ts, subscribed via
        // subscribeViewPanels, which accounts for map-expanded / no-gps /
        // preference in one place.
        map: null,
    },
});
initExportMode();
initTopPanel({ onCompositionApply: applyComposition, resetZoom: resetVideoZoom });
initExportPanel({ onCompositionApply: applyComposition });
initExportTrimBar({ getTripCurrentTime, seekTripTime, seekThenPlay });
initTimelineRange();
initPlayerOverlays();
initPlayerCrop();
initPlayerBlur();
// A regroup that drops a blur zone (merge/split changed its file set) must also
// abort that zone's in-flight Follow pass, or the orphaned pass keeps holding
// the tracker worker's single-pass gate. Wired here (not a direct import in
// blur-regions-state) to keep that module out of blur-track's import graph.
setDroppedRegionPassCanceller(cancelTrackPass);
initFeedbackModal();
// CSP modal opens from landing safety wall and from FAQ Q3. Init reads
// #csp-source JSON and renders the pretty-printed header into #csp-full.
initCspModal();
// Hero-shot lightbox: landing right-column thumb -> full-size screenshot.
initLandingShot();
// Docked CTA: keeps the drop/open action reachable at any landing scroll depth.
initLandingDock();
// Wire the "turn the map on" guide before surfaceDegradedCapabilities() below
// may auto-open it on a recoverable WebGL gap.
initWebglEnableModal();
initSidebarResize();
initMobileDrawer();
// Onboarding tours: only wires live re-localization here; the tours themselves
// fire from their own seams (ingest done, trip open, export open).
initOnboarding();
initFileSources();
initSidebar({
    onPlayFrame: async (tripIdx, frameIdx) => {
        // Viewer init (map/chart/player) is lazy and async since T9 - it
        // lazy-loads maplibre-gl. exitLanding fired it already; awaiting the
        // memoized promise here guarantees the viewer is ready before playFrame
        // (resolves instantly if init already finished).
        await initTripUi();
        // If the trip has pending heavy-embedded-GPS, block with a
        // progress modal (+Cancel). playFrame starts only after it
        // resolves or the user cancels. Trips without pending GPS
        // resolve immediately, no delay. proceed=false means a NEWER
        // trip click superseded this one mid-load - starting playback
        // here would fire behind the newer session and restart the trip
        // under the user.
        // Mint the trip-open token BEFORE the awaited hydrateTrip: on a slow
        // backend hydration can take tens of seconds, during which the user may
        // click a different trip. A later click mints a newer token, so we bail
        // after hydrateTrip resolves instead of yanking the player to this
        // (superseded) trip.
        const openToken = takeTripOpenToken();
        // Filename-first path: read this trip's bytes (duration/codec/GPS) before
        // playback. No-op on the eager path, where every candidate is indexed.
        await hydrateTrip(tripIdx);
        if (!isCurrentTripOpen(openToken)) return;
        const proceed = await awaitLazyEmbeddedGpsForTrip(tripIdx);
        if (!proceed) return;
        // First-run onboarding: the player tour (and later the multichannel
        // tour) introduce the controls BEFORE the clip rolls. pickTripOpenTour
        // returns the tour to run, or null. When non-null we start playback
        // PAUSED (autoPlay=false) and resume on any tour exit (done/skip/later).
        const trip = state.trips[tripIdx];
        const tour = trip ? pickTripOpenTour(trip) : null;
        playFrame(tripIdx, frameIdx, undefined, /*autoPlay=*/ tour === null);
        if (tour) {
            runTripOpenTour(tour, () => void dom.player.play().catch(() => {}));
        } else if (!isMapAvailable()) {
            // The user just opened a trip and the map can't render (no WebGL).
            // Surface the WebGL guide now - contextual, not over the bare landing.
            // Skipped while a first-run tour is up (don't stack a modal on it); a
            // later trip-open with no tour catches it. Idempotent per page load.
            void surfaceMapUnavailable();
        }
    },
    onPlayTripEvent: async (tripIdx, eventIndex) => {
        // Same viewer-readiness await as onPlayFrame (lazy maplibre, T9).
        await initTripUi();
        // UX-08: lazy GPS load is needed here too - the event is not
        // accessible until the trip has records. Same supersession check
        // as onPlayFrame above: mint the token before hydrateTrip, bail if a
        // newer click superseded this one during hydration.
        const openToken = takeTripOpenToken();
        await hydrateTrip(tripIdx);
        if (!isCurrentTripOpen(openToken)) return;
        const proceed = await awaitLazyEmbeddedGpsForTrip(tripIdx);
        if (!proceed) return;
        playTripEvent(tripIdx, eventIndex);
    },
});

// Sort-controls and empty-state sync on sidebar DOM nodes (visible in
// landing mode via their own styles, but body.no-trips hides the sidebar
// entirely - safe no-op for the landing page).
syncSortControls();
syncEmptyState();

// Service worker for the offline PWA precache (app shell; see public/sw.js).
// Requires HTTPS or localhost. Registration is best-effort - if it fails or is
// disabled (incognito), the app still works fully online, just without the
// offline cache.
//
// BASE_URL ensures correct registration when deployed to a subdirectory
// (e.g. example.com/dashcamigo/); a hardcoded "/sw.js" would 404.
if ("serviceWorker" in navigator) {
    const swUrl = `${import.meta.env.BASE_URL || "/"}sw.js`;
    const swLog = createLogger("sw");
    // updateViaCache:"none" - the browser's SW update check must bypass the HTTP
    // cache for sw.js. Cloudflare serves /sw.js with max-age=14400 (its Browser
    // Cache TTL overrides our `_headers` max-age=0), so with the default
    // ("imports", script subject to HTTP cache) a freshly deployed SW is not
    // picked up for up to 4h. "none" makes the update check always revalidate,
    // so the new SW installs (pre-caching the new build) on the next load; it
    // then waits and takes over on the next full launch - see the update
    // handover rationale in public/sw.js.
    //
    // Registration is DEFERRED to window load + an idle slot: a fresh install
    // kicks off the multi-MB precache download, and started at module-eval it
    // competes with the landing render (and the user's first ingest) for
    // bandwidth on slow networks. An already-installed SW is unaffected - the
    // browser routes fetches through it before any register() call runs, so
    // offline boot does not depend on this timing; deferral only shifts WHEN a
    // new install/update check starts. The idle timeout keeps registration
    // guaranteed on busy pages (and bounds the e2e offline suite's
    // controller-ready gate); a pagehide before it fires just means the next
    // visit installs.
    const registerSw = (): void => {
        navigator.serviceWorker.register(swUrl, { updateViaCache: "none" }).then(
            (reg) => {
                // Log scope/state so "export not downloading" reports can quickly
                // confirm the SW is fine and dig elsewhere (incognito, CORS, etc.).
                // State is not fresh at registration time - read installing/waiting/active
                // by priority.
                const sw = reg.active ?? reg.waiting ?? reg.installing;
                swLog.info("registered", { scope: reg.scope, state: sw?.state });
                // Terminal outcome of an update install, for diagnostic reports:
                // "installed" with isUpdate = new version downloaded and waiting
                // for the next launch (so a report from an old build version is
                // expected, not a broken update path); "redundant" = the install
                // failed (e.g. precache refused to accept a hole in app code).
                reg.addEventListener("updatefound", () => {
                    const installing = reg.installing;
                    installing?.addEventListener("statechange", () => {
                        if (installing.state !== "installed" && installing.state !== "redundant") return;
                        swLog.info("update install", { state: installing.state, isUpdate: reg.active !== null });
                    });
                });
            },
            (err: unknown) => {
                swLog.warn("registration failed", err);
            },
        );
    };
    const scheduleSwRegistration = (): void => {
        if (typeof requestIdleCallback === "function") {
            requestIdleCallback(registerSw, { timeout: 3000 });
        } else {
            // Safari has no requestIdleCallback; one macrotask past load is enough
            // to stay off the render critical path.
            setTimeout(registerSw, 1000);
        }
    };
    if (document.readyState === "complete") {
        scheduleSwRegistration();
    } else {
        window.addEventListener("load", scheduleSwRegistration, { once: true });
    }

    // Persistent storage. The offline shell (and the SW registration itself)
    // live in this origin's quota-managed storage, which the browser may evict
    // under storage/memory pressure - on Android that can leave an installed app
    // unable to load offline at all (no cache AND no service worker) until the
    // next online visit re-registers and re-precaches. A persist() grant is the
    // ONLY documented exemption from that eviction; an installed PWA should get
    // it. We request it, and re-assert on focus/online because the install/
    // engagement signal that unlocks the grant can arrive after first paint.
    // The {already, granted} log line is the single diagnostic that tells an
    // "offline died after backgrounding" report whether the grant was the gap.
    const storageLog = createLogger("storage");
    let persistState: boolean | null = null; // null = not yet attempted
    const ensurePersistentStorage = async (): Promise<void> => {
        if (persistState === true || !navigator.storage?.persist) return;
        try {
            const already = (await navigator.storage.persisted?.()) ?? false;
            const granted = already || (await navigator.storage.persist());
            if (granted !== persistState) {
                storageLog.info("persistence", { already, granted });
                persistState = granted;
            }
        } catch (err) {
            storageLog.warn("persistence request failed", err);
        }
    };
    void ensurePersistentStorage();
    // Retry while still ungranted: a denied grant can flip once the WebAPK /
    // engagement signal settles. Once granted, ensurePersistentStorage no-ops.
    addEventListener("online", () => void ensurePersistentStorage());
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") void ensurePersistentStorage();
    });
}

// PWA install. Detects the strategy (Chromium / Safari mac / skip) and wires
// up beforeinstallprompt/appinstalled listeners. The #install-btn icon in
// the topbar is hidden from HTML; the module reveals it when the browser
// confirms the app is installable, or immediately for Safari macOS where
// the click opens the "install Chrome" guide.
initPwaInstall();

// Lang-suggestion banner. Shown when the URL has an explicit locale segment
// but navigator.language points at a different supported locale - the
// share-link scenario where a Russian user kicked /ru/cameras/70mai/ to an
// English friend. Dismissable forever via localStorage. No-op on the root
// stub (bootstrap already redirected) and on privacy.html.
initLangSuggestionBanner();

// T9 pulled the heavy viewer libs (maplibre ~1MB, chart) and the ingest worker
// chunks off the landing critical path - lazy on first use. That keeps the
// landing light, but "lazy on first use" must not become "make the user wait
// at the seam": on a slow connection the just-in-time fetch is visible right
// when the user drops a folder (worker chunks) or opens a trip (map/chart). So
// once the landing is interactive, warm the whole ingest -> view path in the
// background at idle priority. Vendor loaders are memoized and worker prewarm
// keeps the spawned slot, so the real ingest and first trip-open reuse warm
// chunks instead of starting a fresh download. Idle (not eager) so the
// landing's own first paint / LCP stays untouched - the warm-up only runs
// after the browser is done with the critical work.
//
// mediabunny is NOT in this list: the export subtree (app.ts -> {export-mode,
// player-overlays, export-panel} -> export-flow/export.js -> mediabunny)
// imports it statically, so it is already eager in this same bundle - nothing
// to prewarm.
function prefetchDeferredLibs(): void {
    const warm = (): void => {
        // Viewer libs (trip-open).
        void loadMaplibre().catch(() => {});
        void loadChart().catch(() => {});
        // Ingest path (drop folder): the four worker chunks the pipeline
        // spawns (classify, GPS extract, MP4 index, first-frame preview).
        // Each prewarm spawns one slot and keeps it for reuse. Guarded: a
        // synchronous throw in one prewarm (e.g. `new Worker` on a
        // half-broken engine the capability gate did not flag fatal) would
        // otherwise skip the rest AND escape warm() uncaught from the
        // rIC/timeout callback. Prewarm is best-effort - the real ingest
        // respawns on demand - so swallow with a log.
        try {
            prewarmIngest();
            prewarmGpsExtract();
            prewarmIndexer();
            prewarmPreview();
        } catch (err) {
            appLog.warn("deferred prewarm threw", { err: String(err) });
        }
    };
    const ric = (
        window as Window & {
            requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
        }
    ).requestIdleCallback;
    if (ric) {
        ric(warm, { timeout: 4000 });
    } else {
        // Safari < 17 has no requestIdleCallback - a short timeout keeps the
        // warm-up off the critical first paint without it.
        setTimeout(warm, 1500);
    }
}
// Skip eager worker prewarm on a fatal browser - `new Worker` would throw on a
// Worker-less engine and the gate already blocks all interaction.
if (!capabilityFatal) {
    prefetchDeferredLibs();
    // Proactive heads-up for user-visible degraded gaps (no map / no editor /
    // no H.264 decode). Notifications are initialized above; this fires once per
    // gap-set (persisted) so it does not nag every session.
    surfaceDegradedCapabilities();
}
