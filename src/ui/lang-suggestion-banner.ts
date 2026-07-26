// Lang-suggestion banner. Shown when the URL carries an explicit locale
// segment (e.g. /ru/) but navigator.language points at a different supported
// locale. The typical case: a Russian user shared /ru/cameras/70mai/ with an
// English friend - the friend's browser is in English, but the page is in
// Russian. We don't auto-redirect (URL is share-safe - the receiver must
// see the same page the sender saw); instead a one-click banner offers the
// English-equivalent URL with a clear "Open" button.
//
// Decision matrix:
//
//   URL lang      navigator      action
//   ----------    -----------    -----------------------------------------
//   /ru/...       ru-RU          no banner (match)
//   /ru/...       en-US          banner: "This page is in Russian. Open in English?"
//   /ru/...       de-DE          banner: "...Open in German?" (in German copy)
//   /ru/...       xx (unknown)   no banner (no destination locale to suggest)
//   /             ru-RU          no banner (root is a redirect stub; bootstrap
//                                already takes the user to /ru/)
//   /privacy.html ru-RU          no banner (privacy.html has its own switcher)
//
// Dismissal is session-scoped only: X-button and click-outside both just
// remove the banner for the current page view. The trigger set is narrow
// enough (share-link with cross-language navigator) that a permanent-dismiss
// flag mostly served as a footgun - a user who closed the banner once would
// silently lose it forever, including in scenarios where it would have been
// genuinely useful. If the situation recurs on a different page, the banner
// re-evaluates and shows again; the cost of showing it twice is far lower
// than the cost of suppressing it forever after one stray click.

import { createLogger } from "../log.js";
import { type Lang, persistLangChoice } from "../i18n/index.js";
import { BANNER_COPY } from "../i18n/banner-copy.js";
import { SEO_LOCALES, buildLocaleUrl, parseLangFromPath } from "../i18n/seo-config.js";

// The banner shows its offer in the BROWSER's locale, not the page's active
// locale, so it cannot go through t() (which resolves against the page locale).
// A prerendered page carries only the active locale's dictionary, so BANNER_COPY
// holds the banner's 4 strings for every locale - kept in sync with the
// dictionaries by banner-copy.test.ts.

const log = createLogger("lang-banner");

// Cache of valid Lang codes from SEO_LOCALES for O(1) membership check.
const SUPPORTED_LANGS: ReadonlySet<Lang> = new Set(SEO_LOCALES.map((l) => l.lang));

function isSupportedLang(code: string): code is Lang {
    return (SUPPORTED_LANGS as ReadonlySet<string>).has(code);
}

// Detect the navigator's primary language as a 2-letter subtag. Returns null
// if navigator is unavailable (SSR / Node env) or if the primary subtag is
// not in our supported set.
function detectNavigatorLang(): Lang | null {
    if (typeof navigator === "undefined") return null;
    const raw = navigator.language || "";
    const prefix = raw.toLowerCase().split("-", 1)[0];
    if (prefix && isSupportedLang(prefix)) return prefix;
    return null;
}

// Localized display name of a language in the rendering locale's tongue.
// Uses Intl.DisplayNames - widely available since Chrome 81 / Safari 14.1 /
// Firefox 86. If the API is missing or the locale is unknown, falls back to
// the ISO code itself (graceful degradation - "This page is in ru. Open in en?"
// is ugly but informative).
function localizedLangName(langToName: Lang, inLocale: Lang): string {
    try {
        if (typeof Intl === "undefined" || !("DisplayNames" in Intl)) return langToName;
        const dn = new Intl.DisplayNames([inLocale], { type: "language" });
        const name = dn.of(langToName);
        return name ?? langToName;
    } catch {
        return langToName;
    }
}

// Build the banner DOM. Returns the root element, ready to be appended to
// the body. Caller wires the dismiss button and "Open" link's href before
// mounting.
function buildBanner(
    message: string,
    openLabel: string,
    openHref: string,
    dismissLabel: string,
    regionLabel: string,
    onAccept: () => void,
    onDismiss: () => void,
): HTMLElement {
    const root = document.createElement("div");
    root.className = "lang-banner";
    root.id = "lang-banner";
    root.setAttribute("role", "region");
    // Localized in the BROWSER's language (like the banner body) - the receiver
    // may not read the URL locale. Falls back to English if the key is empty.
    root.setAttribute("aria-label", regionLabel || "language suggestion");

    const text = document.createElement("div");
    text.className = "lang-banner-text";
    text.textContent = message;
    root.appendChild(text);

    const actions = document.createElement("div");
    actions.className = "lang-banner-actions";

    // "Open" is an actual <a> link, not a button - it's a navigation. Right-
    // click "Open in new tab" then works, and the URL is visible on hover.
    // The click handler also persists the choice so a future visit to /
    // (root stub) honors the user's explicit pick. Right-click "Open in new
    // tab" doesn't fire click in most browsers, so the storage write skips
    // in that path - acceptable: the user explicitly wanted two tabs, not
    // a permanent switch.
    const open = document.createElement("a");
    open.className = "dc-btn dc-btn--primary";
    open.href = openHref;
    open.textContent = openLabel;
    open.addEventListener("click", () => {
        onAccept();
    });
    actions.appendChild(open);

    const dismiss = document.createElement("button");
    dismiss.type = "button";
    dismiss.className = "lang-banner-dismiss";
    dismiss.setAttribute("aria-label", dismissLabel);
    dismiss.title = dismissLabel;
    // Lucide x icon - same style as other topbar icons (size 14, stroke 2).
    dismiss.innerHTML =
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';
    // onDismiss is supplied by the caller because the full teardown (detach the
    // outside-click listener + the langChange subscription) lives in the
    // caller's scope; this button must do more than remove the node.
    dismiss.addEventListener("click", onDismiss);
    actions.appendChild(dismiss);

    root.appendChild(actions);
    return root;
}

interface BannerCopy {
    message: string;
    open: string;
    dismiss: string;
    regionLabel: string;
}

/**
 * Resolves banner copy for a target language, with ICU-style placeholder
 * substitution. Pinned to a specific lang via direct dictionary lookup -
 * we cannot use t() because t() resolves against getCurrentLang() (which
 * equals the URL's lang on a /<lang>/ page), and the banner needs strings
 * in the BROWSER's lang. Single source of truth: src/i18n/<lang>.ts dicts.
 *
 * langBanner.* templates use only `{urlLang}` / `{browserLang}` placeholders
 * with no plurals - simple string replace is sufficient, no need to spin up
 * an IntlMessageFormat instance (the project's runtime IntlMessageFormat
 * cache lives in i18n/index.ts and is keyed by currentLang; polluting it
 * with browser-lang templates would leak memory in long-lived tabs).
 *
 * Exported for tests.
 */
export function resolveBannerInLang(browserLang: Lang, urlLangName: string, browserLangName: string): BannerCopy {
    const copy = BANNER_COPY[browserLang];
    const message = copy.message.replace("{urlLang}", urlLangName).replace("{browserLang}", browserLangName);
    return {
        message,
        open: copy.open,
        dismiss: copy.dismiss,
        regionLabel: copy.regionLabel,
    };
}

/**
 * Initializes the lang-suggestion banner. Called from app.ts once at startup
 * after applyStaticI18n() is done.
 *
 * No-op when:
 *  - URL doesn't carry a locale segment (root stub or privacy.html).
 *  - navigator.language matches the URL locale (user already on their lang).
 *  - navigator.language isn't a supported locale (no destination to suggest).
 */
export function initLangSuggestionBanner(): void {
    if (typeof document === "undefined") return;

    const urlLang = parseLangFromPath(location.pathname);
    if (urlLang === null) {
        // Root stub (the bootstrap script already redirects) or a standalone
        // doc page (handled by doc-lang.js own switcher). No banner.
        return;
    }

    const browserLang = detectNavigatorLang();
    if (browserLang === null) return;
    if (browserLang === urlLang) return;

    // Localized language names in the BROWSER's language. The receiver
    // reading the banner has their browser set to browserLang, so naming
    // the URL's language in browserLang ("Russian", "Russisch", "Русский")
    // is what they can read.
    const urlLangName = localizedLangName(urlLang, browserLang);
    const browserLangName = localizedLangName(browserLang, browserLang);

    const copy = resolveBannerInLang(browserLang, urlLangName, browserLangName);
    if (!copy.message) {
        log.warn("missing langBanner translation, hiding banner", { browserLang });
        return;
    }

    // Where the receiver lands when they click "Open" - same page on their
    // own language. buildLocaleUrl handles the locale-segment swap, including
    // query and hash preservation.
    const openHref = buildLocaleUrl(browserLang, location.pathname + location.search + location.hash);

    const banner = buildBanner(
        copy.message,
        copy.open,
        openHref,
        copy.dismiss,
        copy.regionLabel,
        () => {
            // Accepting the suggestion is an explicit lang choice and should be
            // sticky across visits, same as picking from the topbar switcher.
            // Without this, /<root> reload after the redirect re-applies the
            // stale localStorage value and bounces the user back to the URL's
            // locale on the next visit.
            persistLangChoice(browserLang);
        },
        // Dismiss (X): session-only close, same effect as click-outside.
        // closeBanner is a hoisted declaration below, so referencing it here is
        // safe (invoked only on a later click).
        () => closeBanner(),
    );

    // Anchor under the topbar lang-toggle so the visual relation to the
    // language switcher is explicit (popover-style). Falls back to body if
    // the topbar isn't on the page (e.g. an embedded preview during tests).
    // .lang-wrap has position:relative, the banner uses position:absolute -
    // see lang-banner.css.
    const langToggle = document.getElementById("lang-toggle");
    const anchor = langToggle?.parentElement;
    if (anchor?.classList.contains("lang-wrap")) {
        anchor.appendChild(banner);
    } else {
        document.body.appendChild(banner);
    }

    // Single teardown for every dismissal path (outside-click, explicit X) - detaches
    // the node AND the global outside-click listener; detaching only the node leaks
    // the listener as a closure over the detached node. Function declarations so the
    // mutual references between closeBanner and onOutsideClick resolve regardless of
    // order.
    function closeBanner(): void {
        banner.remove();
        document.removeEventListener("click", onOutsideClick);
    }
    // Click outside the banner closes it for this page view. Excludes the
    // whole .lang-wrap so opening the lang menu and picking from it while
    // the banner is up reads as "user is engaging with the language UI",
    // not "user wants to dismiss the suggestion". Next page load
    // re-evaluates from scratch.
    function onOutsideClick(ev: MouseEvent): void {
        const target = ev.target;
        if (!(target instanceof Node)) return;
        if (banner.contains(target)) return;
        if (anchor?.contains(target)) return;
        closeBanner();
    }

    // Defer attaching so the same click that mounted the banner (if any)
    // doesn't immediately close it. The init runs on DOMContentLoaded, so
    // there's no opening click in practice, but the deferral is cheap.
    setTimeout(() => {
        document.addEventListener("click", onOutsideClick);
    }, 0);

    log.debug("lang-suggestion banner shown", { urlLang, browserLang });
}

// Re-export for tests that want to drive helpers without touching the DOM.
export { detectNavigatorLang };
