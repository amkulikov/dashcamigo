// PWA install flow. Topbar button #install-btn + one-shot toast #install-banner
// after a saved clip + #install-modal with a guide for browsers without a
// native install API.
//
// Strategies (see detectStrategy):
//   - already-installed - app is open as standalone PWA (or via legacy iOS
//     navigator.standalone). No CTA.
//   - skip - iOS/iPadOS Safari (the SD-card flow doesn't work there anyway),
//     Firefox (no install API on desktop, on Android the browser menu does
//     it), and unknown browsers. No CTA.
//   - chromium - Chrome/Edge/Brave/Opera/Yandex and friends. Wait for
//     beforeinstallprompt and call prompt() on click.
//   - safari-mac - Safari on macOS desktop. No install API, so the button
//     opens a modal that points the user to Chrome - chosen over the native
//     "Share -> Add to Dock" path because installing via Chrome gives a real
//     offline-capable PWA (our SW only works in Chromium).
//
// Analytics funnel:
//   pwa_cta_shown (header or toast) -> pwa_cta_clicked -> either
//   pwa_prompt_outcome (native dialog) or pwa_guide_shown (modal).
//   pwa_installed fires from window.appinstalled - even if the user installed
//   through the address bar bypassing our button.

import { t } from "../i18n/index.js";
import { createLogger } from "../log.js";
import { buildLucideIcon, SVG_NS } from "./icons.js";
import { activateModal, deactivateModal, wireBackdropDismiss } from "./modal-helper.js";

const log = createLogger("pwa-install");

// BeforeInstallPromptEvent is missing from lib.dom (non-standard). Extend the
// global so TS does not complain about addEventListener("beforeinstallprompt").
interface BeforeInstallPromptEvent extends Event {
    readonly platforms: ReadonlyArray<string>;
    readonly userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
    prompt(): Promise<void>;
}

declare global {
    interface WindowEventMap {
        beforeinstallprompt: BeforeInstallPromptEvent;
        appinstalled: Event;
    }
}

// navigator.getInstalledRelatedApps - non-standard, in Chrome/Edge. Returns
// the list of related installed apps (PWA + UWP + Android) that this site
// claims kinship with via manifest's related_applications. For self-PWA
// detection we look for an entry with platform === "webapp".
type RelatedApp = { platform: string; id?: string; url?: string; version?: string };
type NavWithRelatedApps = Navigator & { getInstalledRelatedApps?: () => Promise<RelatedApp[]> };

// Single source of truth for this module's localStorage keys.
const STORAGE_TOAST_SHOWN = "dashcamigo:pwa:toast:shown";
const STORAGE_TOAST_DISMISSED_AT = "dashcamigo:pwa:toast:dismissedAt";
// Cross-window installed signal. Set when ANY of:
//   - the current load is itself in standalone display-mode,
//   - the appinstalled event fires,
//   - navigator.getInstalledRelatedApps returns our PWA.
// Read on every init. Lets a browser-tab page on the same origin know that
// the PWA exists in a parallel window. Required because:
//   - getInstalledRelatedApps doesn't work on localhost (HTTPS-only) and
//     mismatches when related_applications uses prod URLs in dev,
//   - Chrome still fires beforeinstallprompt in browser tabs even when the
//     PWA is installed for the same origin in another window.
// Wiped by Danger zone reset (which clears all localStorage), preserved by
// the lighter "Clear offline cache" action.
//
// The signal is sticky on purpose, but there is no 'appuninstalled' web event
// to clear it after the user removes the PWA. So we also clear it whenever an
// authoritative source says we're NOT installed: a fired beforeinstallprompt
// (only fires when installable, i.e. not installed) or a getInstalledRelatedApps
// negative on browsers that have the API. Without that, an install->uninstall
// cycle leaves the button hidden until the user wipes site data. See
// clearInstalledSignal() and its callers.
const STORAGE_INSTALLED_SIGNAL = "dashcamigo:pwa:installed";

// After an explicit dismiss, suppress the toast for 30 days. The topbar
// button is always available, so the toast is just a one-shot reminder.
const TOAST_DISMISS_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;

type InstallStrategy = "skip" | "already-installed" | "chromium" | "safari-mac";

// Module state. Reset on every full page reload.
let strategy: InstallStrategy = "skip";
let deferredPrompt: BeforeInstallPromptEvent | null = null;

// Cached promise from navigator.getInstalledRelatedApps. The query is
// fired once at init; both initialization (sync strategy override) and
// the post-export toast path await this same promise so they never race
// with the OS-level installation check.
let relatedAppsCheckPromise: Promise<boolean> | null = null;
// Synchronous mirror of the above promise's resolved value. Used by
// show-functions that must run on a click handler without awaiting.
// Stays `false` until the promise resolves; if installation is detected
// later, init's .then() flips the strategy and hides any visible UI.
let installedAccordingToOS = false;

// One-time flag so the header CTA attention pulse plays only on the first
// reveal, not on every re-show after a transient hide.
let headerCtaTracked = false;

// --- Detection ---

function matchesDisplayMode(mode: string): boolean {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia(`(display-mode: ${mode})`).matches;
}

function isStandalone(): boolean {
    if (matchesDisplayMode("standalone")) return true;
    if (matchesDisplayMode("window-controls-overlay")) return true;
    if (matchesDisplayMode("fullscreen")) return true;
    // Legacy iOS Safari flag for "Add to Home Screen" PWAs.
    const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone;
    return iosStandalone === true;
}

function isIOSorIPadOS(): boolean {
    const ua = navigator.userAgent;
    if (/iPhone|iPad|iPod/.test(ua)) return true;
    // iPadOS 13+ sends a Desktop UA that looks like macOS Safari by default.
    // Distinguish by touch points - Mac has 0, iPad usually >= 1.
    if (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1) return true;
    return false;
}

function isFirefox(): boolean {
    return /Firefox/.test(navigator.userAgent);
}

function isSafariMac(): boolean {
    if (isIOSorIPadOS()) return false;
    const ua = navigator.userAgent;
    // Every Chromium UA includes "Safari" for historical reasons - the
    // distinguishing markers are Chromium/Edge/Opera tokens.
    return /Safari/.test(ua) && !/Chrome|Chromium|Edg\/|OPR\//.test(ua);
}

function isChromium(): boolean {
    if (isFirefox()) return false;
    // UA Client Hints are a reliable Chromium-only signal.
    const uad = (
        navigator as Navigator & {
            userAgentData?: { brands: ReadonlyArray<{ brand: string }> };
        }
    ).userAgentData;
    if (uad?.brands) {
        return uad.brands.some((b) => /Chromium|Google Chrome|Microsoft Edge|Brave|Opera|Yandex/i.test(b.brand));
    }
    // UA string fallback. Edg/ - Chromium Edge, OPR/ - Opera, YaBrowser - Yandex.
    return /Chrome|Chromium|Edg\/|OPR\/|YaBrowser/.test(navigator.userAgent);
}

function detectStrategy(): InstallStrategy {
    if (isStandalone()) return "already-installed";
    if (isIOSorIPadOS()) return "skip";
    if (isFirefox()) return "skip";
    if (isSafariMac()) return "safari-mac";
    if (isChromium()) return "chromium";
    return "skip";
}

/**
 * Once-per-session query against navigator.getInstalledRelatedApps. Resolves
 * with `true` if the OS reports our PWA as installed. The returned promise
 * is memoized - subsequent callers (init override + toast gate) share it
 * and don't trigger a second IPC.
 *
 * Chrome/Edge only (Android 84+, Desktop 140+). On browsers without the
 * API, resolves to `false` immediately. Errors are logged and swallowed -
 * we never want this defensive check to break the install flow.
 */
function checkInstalledRelatedAppsOnce(): Promise<boolean> {
    if (relatedAppsCheckPromise) return relatedAppsCheckPromise;
    const nav = navigator as NavWithRelatedApps;
    if (typeof nav.getInstalledRelatedApps !== "function") {
        relatedAppsCheckPromise = Promise.resolve(false);
        return relatedAppsCheckPromise;
    }
    relatedAppsCheckPromise = nav
        .getInstalledRelatedApps()
        .then((apps) => {
            const found = apps.some((a) => a.platform === "webapp");
            if (found) log.info("getInstalledRelatedApps reports we are installed", { apps });
            return found;
        })
        .catch((err: unknown) => {
            log.warn("getInstalledRelatedApps failed", err);
            return false;
        });
    return relatedAppsCheckPromise;
}

/** Stores the "this origin has an installed PWA somewhere" flag. */
function setInstalledSignal(): void {
    try {
        localStorage.setItem(STORAGE_INSTALLED_SIGNAL, "1");
    } catch {
        // private mode - signal won't survive reload, but matchMedia will
        // still cover the in-window case.
    }
}

/** Reads the cross-window installed signal. */
function hasInstalledSignal(): boolean {
    try {
        return localStorage.getItem(STORAGE_INSTALLED_SIGNAL) === "1";
    } catch {
        return false;
    }
}

/**
 * Drops the stale installed signal after an uninstall. Called only from
 * authoritative "not installed" sources (beforeinstallprompt / OS negative),
 * never speculatively - the whole point of the signal is to survive a reload.
 */
function clearInstalledSignal(): void {
    try {
        localStorage.removeItem(STORAGE_INSTALLED_SIGNAL);
    } catch {
        // private mode - nothing was persisted anyway.
    }
}

/** True if getInstalledRelatedApps exists in this browser (Chrome/Edge only). */
function hasRelatedAppsApi(): boolean {
    return typeof (navigator as NavWithRelatedApps).getInstalledRelatedApps === "function";
}

/**
 * Reveals the topbar button for the current strategy after a stale signal was
 * cleared mid-session. showInstallBtn() still guards against any remaining
 * install signal, so this is a no-op when we're genuinely installed.
 */
function revealInstallCta(): void {
    if (strategy === "safari-mac") showInstallBtn();
    else if (strategy === "chromium" && deferredPrompt) showInstallBtn();
}

/**
 * Synchronous "is the app already installed?" combining all three local
 * signals. Used by show-functions to suppress the install CTA and by
 * handleInstallClick to swap the action. Does NOT include the async
 * getInstalledRelatedApps result - callers that can await get it
 * separately via checkInstalledRelatedAppsOnce().
 */
function isLikelyInstalled(): boolean {
    return isStandalone() || installedAccordingToOS || hasInstalledSignal();
}

// --- DOM helpers ---

function $btn(id: string): HTMLButtonElement | null {
    return document.getElementById(id) as HTMLButtonElement | null;
}

function getInstallBtn(): HTMLButtonElement | null {
    return $btn("install-btn");
}

function getBanner(): HTMLElement | null {
    return document.getElementById("install-banner");
}

function getModal(): HTMLElement | null {
    return document.getElementById("install-modal");
}

// --- Show / hide ---

function showInstallBtn(): void {
    // Last-ditch sync guard against Chrome firing beforeinstallprompt in
    // browser tabs while the PWA is already installed for the same origin
    // elsewhere. isLikelyInstalled() folds all three sync signals.
    if (isLikelyInstalled()) {
        log.warn("showInstallBtn suppressed: detected as installed");
        return;
    }
    const btn = getInstallBtn();
    if (!btn) return;
    const firstReveal = btn.hidden;
    btn.hidden = false;
    // Pulse the button briefly the FIRST time it appears in this session,
    // so the user notices the new affordance in the topbar. CSS handles
    // the animation; we just toggle the class and remove it after the
    // animation finishes (3 iterations * 1.4s = ~4.2s).
    if (firstReveal && !headerCtaTracked) {
        btn.classList.add("install-btn-pulse");
        setTimeout(() => btn.classList.remove("install-btn-pulse"), 4500);
    }
    if (!headerCtaTracked) {
        headerCtaTracked = true;
    }
}

function hideInstallBtn(): void {
    const btn = getInstallBtn();
    if (btn) btn.hidden = true;
}

function hideBanner(): void {
    const banner = getBanner();
    if (banner) banner.hidden = true;
}

function closeGuideModal(): void {
    const modal = getModal();
    if (!modal) return;
    modal.hidden = true;
    deactivateModal(modal);
}

/** Shared post-show a11y wiring for the install modal (guide / already-
 *  installed both reuse the same DOM). */
function activateInstallModal(modal: HTMLElement): void {
    activateModal(modal, {
        onClose: closeGuideModal,
        initialFocus: document.getElementById("install-modal-close"),
    });
}

// --- Click handlers ---

async function handleInstallClick(): Promise<void> {
    // At-click detection. The button may have surfaced before our install
    // signals fired (Chrome quirk firing beforeinstallprompt in browser tab
    // even when the PWA is installed for the same origin; localhost where
    // getInstalledRelatedApps refuses to work). When that happens, swap the
    // action: instead of triggering a prompt that won't work, point the
    // user at where the installed app actually lives.
    if (isLikelyInstalled() || (await checkInstalledRelatedAppsOnce())) {
        log.info("install click on already-installed app, showing launch hint");
        openAlreadyInstalledModal();
        return;
    }

    // Chromium with a captured beforeinstallprompt - fire the native dialog.
    if (strategy === "chromium" && deferredPrompt) {
        try {
            await deferredPrompt.prompt();
            const { outcome } = await deferredPrompt.userChoice;
            log.info("native install prompt outcome", { outcome });
            // Chrome does not redeliver the same event - drop it.
            deferredPrompt = null;
            if (outcome === "accepted") {
                // appinstalled will hide everything, but on dismiss we also
                // hide the header button - no further install path exists.
                hideInstallBtn();
            }
        } catch (err) {
            // prompt() rejects silently in Chrome when the PWA is already
            // installed for this scope - the event lingered from before
            // install and the browser refuses to surface the dialog. Without
            // this fallback the user clicks and nothing visible happens.
            // Switch to the launch-hint modal so the user sees something.
            //
            // The signal is persisted ONLY for InvalidStateError - that's
            // the specific code Chrome throws for the "already installed"
            // case. Generic failures (transient API issues, future error
            // types) don't poison detection for future sessions.
            log.warn("native install prompt failed", err);
            deferredPrompt = null;
            if (err instanceof DOMException && err.name === "InvalidStateError") {
                setInstalledSignal();
            }
            openAlreadyInstalledModal();
        }
        return;
    }

    // No deferredPrompt (safari-mac, or chromium before the event arrived) -
    // open the guide modal instead.
    openGuideModal();
}

function openGuideModal(): void {
    const modal = getModal();
    const body = document.getElementById("install-modal-body");
    const title = document.getElementById("install-modal-title");
    if (!modal || !body) return;

    // Full re-render of the body - which guide depends on strategy. The
    // title also resets to the "install" wording in case openAlreadyInstalled
    // had previously swapped it.
    body.replaceChildren();
    if (title) title.textContent = t("pwa.guide.title");
    if (strategy === "safari-mac") {
        body.append(...renderSafariMacGuide());
    } else if (strategy === "chromium") {
        body.append(...renderChromiumGuide());
    } else {
        // Other strategies have no guide content - leave the modal closed.
        return;
    }
    modal.hidden = false;
    activateInstallModal(modal);
}

/**
 * Modal shown when the user clicks the install button but detection at-click
 * says the PWA is already installed. Reuses the same #install-modal DOM as
 * the install guide; we just swap title and body content. No JS API exists
 * to launch an installed PWA from a browser tab, so the body is a textual
 * pointer to where the installed app actually lives.
 */
function openAlreadyInstalledModal(): void {
    const modal = getModal();
    const body = document.getElementById("install-modal-body");
    const title = document.getElementById("install-modal-title");
    if (!modal || !body) return;

    body.replaceChildren();
    if (title) title.textContent = t("pwa.installed.title");

    const intro = document.createElement("p");
    intro.className = "install-modal-intro";
    intro.textContent = t("pwa.installed.body");
    body.appendChild(intro);

    // Chromium-only hint about the address-bar "Open in app" icon. On
    // Safari/Firefox no such button exists, so we omit it there.
    if (isChromium()) {
        const hint = document.createElement("p");
        hint.className = "install-modal-intro";
        hint.textContent = t("pwa.installed.chromiumHint");
        body.appendChild(hint);
    }

    modal.hidden = false;
    activateInstallModal(modal);
}

function renderSafariMacGuide(): HTMLElement[] {
    const intro = document.createElement("p");
    intro.className = "install-modal-intro";
    intro.textContent = t("pwa.guide.safariMac.intro");

    const ol = document.createElement("ol");
    ol.className = "install-modal-steps";
    for (const key of [
        "pwa.guide.safariMac.step1",
        "pwa.guide.safariMac.step2",
        "pwa.guide.safariMac.step3",
    ] as const) {
        const li = document.createElement("li");
        li.textContent = t(key);
        ol.appendChild(li);
    }

    const ctaWrap = document.createElement("div");
    ctaWrap.className = "install-modal-cta-wrap";
    const cta = document.createElement("a");
    cta.className = "dc-btn dc-btn--primary";
    cta.href = "https://www.google.com/chrome/";
    cta.target = "_blank";
    cta.rel = "noopener noreferrer";
    cta.textContent = t("pwa.guide.safariMac.cta");
    ctaWrap.appendChild(cta);

    return [intro, ol, ctaWrap];
}

function renderChromiumGuide(): HTMLElement[] {
    const intro = document.createElement("p");
    intro.className = "install-modal-intro";
    intro.textContent = t("pwa.guide.chromium.intro");

    const ol = document.createElement("ol");
    ol.className = "install-modal-steps";

    // Step 1 ends with an inline copy of the actual install glyph - same
    // monitor-with-down-arrow icon Chrome renders in the address bar.
    // Helps the user recognize the shape they should look for.
    const step1 = document.createElement("li");
    step1.append(t("pwa.guide.chromium.step1"), " ", buildInstallGlyph());
    ol.appendChild(step1);

    const step2 = document.createElement("li");
    step2.textContent = t("pwa.guide.chromium.step2");
    ol.appendChild(step2);

    return [intro, ol];
}

/**
 * Inline SVG copy of the Lucide monitor-down icon - the same glyph our
 * topbar #install-btn uses and a visual stand-in for Chrome's address-bar
 * install icon. Wrapped in a chip-style span so it reads as a clickable
 * artifact, not body text.
 */
function buildInstallGlyph(): HTMLSpanElement {
    const wrap = document.createElement("span");
    wrap.className = "install-modal-inline-glyph";
    wrap.setAttribute("aria-hidden", "true");
    // monitor-down: arrow paths from the shared builder + the monitor base rect.
    const svg = buildLucideIcon(["M12 13V3", "m8 9 4 4 4-4"]);
    const rect = document.createElementNS(SVG_NS, "rect");
    rect.setAttribute("x", "2");
    rect.setAttribute("y", "15");
    rect.setAttribute("width", "20");
    rect.setAttribute("height", "6");
    rect.setAttribute("rx", "2");
    svg.appendChild(rect);
    wrap.appendChild(svg);
    return wrap;
}

// --- Toast ---

function shouldShowToast(): boolean {
    if (strategy !== "chromium" && strategy !== "safari-mac") return false;
    try {
        // Already shown in a previous session - do not re-pester. The user
        // still has the topbar button if they want to install.
        if (localStorage.getItem(STORAGE_TOAST_SHOWN) === "1") return false;
        // If a dismissedAt timestamp exists - respect the cooldown. SHOWN is
        // always set together with the toast display, so this check is
        // defensive future-proofing.
        const at = Number(localStorage.getItem(STORAGE_TOAST_DISMISSED_AT));
        if (at && Date.now() - at < TOAST_DISMISS_COOLDOWN_MS) return false;
        return true;
    } catch {
        return false;
    }
}

function showToast(): void {
    // Mirror of the showInstallBtn guard.
    if (isLikelyInstalled()) {
        log.warn("showToast suppressed: detected as installed");
        return;
    }
    const banner = getBanner();
    if (!banner) return;
    banner.hidden = false;
    try {
        localStorage.setItem(STORAGE_TOAST_SHOWN, "1");
    } catch {
        // private mode - the toast fired in this session, retry next time.
    }
}

/**
 * Shows the install toast if the strategy allows it, the user hasn't seen
 * it before, AND the OS doesn't report the PWA as already installed.
 * Idempotent. Called after leaving a successfully completed export.
 */
export async function maybeShowPostExportToast(): Promise<void> {
    // Authoritative OS-level check. The synchronous strategy may say
    // "chromium" (browser tab) while the OS knows we're installed elsewhere
    // - in that case the user has already taken the action, no need to
    // re-pester. Awaiting here adds a few ms on browsers that have the API,
    // and resolves immediately on browsers without it.
    if (await checkInstalledRelatedAppsOnce()) return;
    if (!shouldShowToast()) return;
    const banner = getBanner();
    if (!banner) return;

    showToast();
}

// --- Init ---

/**
 * Initializes the PWA install module. Called exactly once from app.ts.
 * Detects the strategy from browser/display-mode, wires up listeners, and -
 * for safari-mac - reveals the topbar button immediately. For chromium the
 * button appears later, once the browser fires beforeinstallprompt.
 */
export function initPwaInstall(): void {
    strategy = detectStrategy();

    // If this load is itself a standalone PWA, we are literally running inside
    // the installed app: persist the signal for future browser-tab loads and
    // stop - no install CTA makes sense here. This is the only "certain"
    // installed state; a leftover localStorage signal is NOT (the app may have
    // been uninstalled since), so it must not force an early return - otherwise
    // an install->uninstall cycle hides the button forever (no appuninstalled
    // event to clear the signal). The isLikelyInstalled() guards inside
    // showInstallBtn/showToast suppress proactive CTA while a signal lingers;
    // the authoritative-negative paths below clear it.
    if (strategy === "already-installed") {
        setInstalledSignal();
        log.info("strategy detected", { strategy });
        return;
    }
    log.info("strategy detected", { strategy, installedSignal: hasInstalledSignal() });

    // Fire the OS-level installation check in the background and reconcile both
    // directions. Authoritative on Chrome/Edge 140+ desktop and Android 84+.
    const relatedAppsApiPresent = hasRelatedAppsApi();
    void checkInstalledRelatedAppsOnce().then((installed) => {
        if (installed) {
            // Confirmed installed (this tab or another window). Persist the
            // signal so future loads short-circuit, and drop any visible CTA.
            installedAccordingToOS = true;
            strategy = "already-installed";
            setInstalledSignal();
            hideInstallBtn();
            hideBanner();
            closeGuideModal();
            return;
        }
        // OS says not installed. If a signal lingers, the PWA was uninstalled
        // (or the signal was set in error): clear it so the CTA is no longer
        // suppressed, and re-reveal it. Guarded by relatedAppsApiPresent - a
        // bare false from a browser without the API means "unknown", not "not
        // installed", and must not wipe the cross-window signal.
        if (relatedAppsApiPresent && hasInstalledSignal()) {
            log.info("OS reports not installed but a stale installed-signal exists; clearing it");
            clearInstalledSignal();
            installedAccordingToOS = false;
            revealInstallCta();
        }
    });

    if (strategy === "skip") {
        return;
    }

    // Topbar button.
    getInstallBtn()?.addEventListener("click", () => {
        void handleInstallClick();
    });

    // Toast buttons.
    $btn("install-banner-install")?.addEventListener("click", () => {
        void handleInstallClick();
        hideBanner();
    });
    $btn("install-banner-dismiss")?.addEventListener("click", () => {
        hideBanner();
        try {
            localStorage.setItem(STORAGE_TOAST_DISMISSED_AT, String(Date.now()));
        } catch {
            // private mode - dismiss will not survive a reload; the toast is
            // already closed in the current session.
        }
    });

    // Modal close: Close button, backdrop click, Escape.
    $btn("install-modal-close")?.addEventListener("click", closeGuideModal);
    const guideModal = getModal();
    if (guideModal) wireBackdropDismiss(guideModal, closeGuideModal, { cardSelector: ".export-modal-card" });
    // Escape is handled centrally by the modal manager (activateInstallModal).

    // Safari macOS - no install API, but we can show the guide. Reveal the
    // topbar button immediately so the user has an entry point.
    if (strategy === "safari-mac") {
        showInstallBtn();
    }

    // Chromium - wait for the event. preventDefault() is mandatory, otherwise
    // Chrome will show its own mini-banner on mobile and steal the UX.
    window.addEventListener("beforeinstallprompt", (ev) => {
        ev.preventDefault();
        deferredPrompt = ev;
        log.debug("beforeinstallprompt captured", { platforms: ev.platforms });
        // The event fires only when the app is installable - i.e. NOT installed
        // (desktop + WebAPK Android). So a lingering installed-signal is stale
        // (install->uninstall cycle); drop it before showInstallBtn(), whose
        // isLikelyInstalled() guard would otherwise keep the button hidden.
        if (hasInstalledSignal()) {
            log.info("beforeinstallprompt fired with a stale installed-signal; clearing it");
            clearInstalledSignal();
        }
        installedAccordingToOS = false;
        showInstallBtn();
    });

    // Install completed - regardless of who triggered it. Hide everything
    // and persist the cross-window signal so future tab loads short-circuit.
    window.addEventListener("appinstalled", () => {
        log.info("pwa appinstalled");
        setInstalledSignal();
        deferredPrompt = null;
        hideInstallBtn();
        hideBanner();
        closeGuideModal();
    });

    // Display-mode can flip mid-session (e.g. user toggled fullscreen, or the
    // browser switched the window into standalone after install). When that
    // happens, drop any visible install UI immediately. We listen on both
    // standalone and WCO since either signals "the user is inside the
    // installed app right now".
    for (const mode of ["standalone", "window-controls-overlay"]) {
        window.matchMedia?.(`(display-mode: ${mode})`).addEventListener("change", (ev) => {
            if (!ev.matches) return;
            log.info("display-mode changed to installed", { mode });
            hideInstallBtn();
            hideBanner();
            closeGuideModal();
        });
    }
}
