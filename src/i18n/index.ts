// i18n helper. Thin wrapper around IntlMessageFormat (CLDR plural / select).
//
// Contract:
//  - Language is fixed for the page lifetime. It is detected once at module
//    load (detectInitialLang) and CANNOT change at runtime: switching language
//    is a full navigation to the prerendered /<lang>/ page (see lang-switcher).
//  - Only ONE dictionary is present on a given page - the active locale's. The
//    prerender BAKES it into the HTML as a JSON data island (<script
//    type="application/json" id="dc-i18n">, see vite-plugins/seo-prerender.ts).
//    The runtime reads that island synchronously at startup, so t() stays fully
//    synchronous and no dictionary JS ships in the bundle. Because the app only
//    ever runs on a prerendered /<lang>/ page (the root "/" is a redirect stub
//    with no app bundle), the island's locale always equals detectInitialLang()
//    (URL wins) - the two cannot disagree.
//  - In `vite dev` there is no prerender, so the island is empty; the DEV branch
//    below imports all 10 dictionaries instead (dev bundle size is irrelevant,
//    and that branch is tree-shaken from production via import.meta.env.DEV).
//  - t(key, params?) returns the localized string. Compiled IntlMessageFormats
//    are cached by key - the parse happens once, later .format() calls are fast.
//  - applyStaticI18n() fills static DOM nodes tagged with [data-i18n] /
//    [data-i18n-attr]. Idempotent; called once at startup as a safety net for
//    the rare case where the prerendered static text needs re-swapping.

import { IntlMessageFormat } from "intl-messageformat";

import { createLogger } from "../log.js";
import { DEV_DICTS } from "./dev-dicts.js";
import type { I18nKey } from "./keys.js";
import { parseLangFromPath } from "./seo-config.js";

const log = createLogger("i18n");

export type Lang = "ru" | "en" | "de" | "es" | "pt" | "fr" | "pl" | "zh" | "ja" | "ko";
export type { I18nKey } from "./keys.js";

const STORAGE_KEY = "dashcamigo:lang";

// The DOM id of the JSON data island the prerender writes the active locale's
// dictionary into. Kept in sync with vite-plugins/seo-prerender.ts and the
// placeholder <script> in index.html.
const I18N_ISLAND_ID = "dc-i18n";

/**
 * Reads the active locale's dictionary from the prerendered JSON data island.
 * Production path: the prerender baked it in, matching the page's locale. The
 * island is <script type="application/json"> (data, not executable - no CSP
 * script-src hash needed); its text is JSON produced by JSON.stringify, so
 * JSON.parse reverses the "<" -> "\\u003c" escaping the prerender applied to
 * keep a "</script>" inside a value from breaking out of the tag.
 *
 * Throws if the island is missing or empty - a build/deploy invariant, not a
 * recoverable state: without a dictionary the UI cannot render text at all, so
 * failing loudly (into the uncaught-error hook + Sentry) beats a silently
 * blank UI.
 */
function readI18nIsland(): Record<I18nKey, string> {
    const el = document.getElementById(I18N_ISLAND_ID);
    const json = el?.textContent;
    if (!json) throw new Error("i18n data island missing or empty");
    return JSON.parse(json) as Record<I18nKey, string>;
}

/**
 * Supported languages for the UI switcher. Endonyms (native names) let the
 * user choose a language in that language, regardless of the current locale.
 *
 * To add a language: add an entry here + a new dictionary + a DEV_DICTS entry
 * + extend the Lang type + add an entry to LOCALES + add it to the prerender's
 * DICTS map (vite-plugins/seo-prerender.ts). Compile-time
 * `satisfies Record<I18nKey, ...>` checks in each dictionary guarantee all keys
 * are present before merge, and `Record<Lang, ...>` on DEV_DICTS/LOCALES forces
 * the dictionary + locale to exist.
 *
 * Order: by endonym in Unicode order. This gives Latin-script languages
 * (Deutsch..Português), then Cyrillic (Русский), then CJK (中文, 日本語,
 * 한국어). No "primary" languages pinned to the top - a privileged order
 * looks arbitrary to users who come for their own language, not ours.
 */
export const LANGS: ReadonlyArray<{ code: Lang; endonym: string }> = [
    { code: "de", endonym: "Deutsch" },
    { code: "en", endonym: "English" },
    { code: "es", endonym: "Español" },
    { code: "fr", endonym: "Français" },
    { code: "pl", endonym: "Polski" },
    { code: "pt", endonym: "Português" },
    { code: "ru", endonym: "Русский" },
    { code: "zh", endonym: "中文" },
    { code: "ja", endonym: "日本語" },
    { code: "ko", endonym: "한국어" },
];

// Compile-time guard: every Lang must have a LANGS entry. Without this, adding
// a Lang to the union (which the Record<Lang,...> checks force into a dictionary
// + LOCALES) would silently leave LANGS short - the switcher menu would omit the
// locale and detectInitialLang's localStorage/navigator fallback (isKnownLang <-
// LANGS) would reject it, falling back to en. This makes the "drift fails to
// compile" invariant true for LANGS too.
type _LangsCoverAllLangs = Lang extends (typeof LANGS)[number]["code"] ? true : never;
const _langsExhaustive: _LangsCoverAllLangs = true;
void _langsExhaustive;

/**
 * BCP47 locales for Intl.DateTimeFormat / Intl.NumberFormat. Regions are
 * intentional: for dates they affect order (dd/mm vs mm/dd); for Portuguese
 * pt-BR vs pt-PT differ significantly; for Chinese they determine simplified
 * vs traditional script. Without a region browsers may produce different
 * defaults.
 */
const LOCALES: Record<Lang, string> = {
    ru: "ru-RU",
    en: "en-US",
    de: "de-DE",
    es: "es-ES",
    pt: "pt-BR",
    fr: "fr-FR",
    pl: "pl-PL",
    zh: "zh-CN",
    ja: "ja-JP",
    ko: "ko-KR",
};

// Cache of compiled templates, keyed by I18nKey. IntlMessageFormat parses the
// template once; subsequent .format() calls are fast - the cache saves CPU on
// hot paths (sidebar, metrics, popup). The active language never changes at
// runtime, so the key needs no lang prefix.
const formatterCache = new Map<string, IntlMessageFormat>();

// Keys that already produced a format-failure warning. Mirrors the warn-once
// policy of the parse-failure path in t(): a broken call site on a hot path
// must not flood the ring buffer with identical warnings.
const formatWarnedKeys = new Set<string>();

/**
 * Set of known language codes for O(1) lookup. Populated from LANGS so that
 * adding a new language does not require touching this function.
 */
const KNOWN_CODES: ReadonlySet<Lang> = new Set(LANGS.map((l) => l.code));

function isKnownLang(code: string): code is Lang {
    return (KNOWN_CODES as ReadonlySet<string>).has(code);
}

/**
 * Detects the language on first load. Priority:
 *  1. URL segment (parseLangFromPath) - the highest-priority signal on a
 *     prerendered SEO page. A user landing on /ru/ from a Google result
 *     must see Russian regardless of any stored preference. localStorage
 *     overriding URL would mean: canonical URL and visible content diverge -
 *     bad UX and bad SEO. parseLangFromPath returns null when the first
 *     path segment is not a known locale - the root redirect stub "/",
 *     standalone pages like /privacy, unknown segments - and detection
 *     falls through to the next signal.
 *  2. localStorage[dashcamigo:lang] - user's choice from a previous session.
 *     This is the NORMAL path on the root stub "/": the URL carries no
 *     locale segment there, so the stored preference decides the language.
 *  3. navigator.language - two-letter prefix ("de-DE" → "de"); if the prefix
 *     is not in the supported list, falls back to "en".
 *
 * The result is fixed for the page lifetime (activeLang below). setLang no
 * longer exists - a language change is a navigation to /<lang>/, which reloads
 * and re-runs this detection with the URL segment now winning.
 */
export function detectInitialLang(): Lang {
    if (typeof location !== "undefined") {
        const fromUrl = parseLangFromPath(location.pathname);
        if (fromUrl !== null) return fromUrl;
    }
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored !== null && isKnownLang(stored)) return stored;
    } catch {
        // localStorage may be disabled (private mode) - ignore.
    }
    const navLang = (typeof navigator !== "undefined" ? navigator.language : "") || "";
    const prefix = navLang.toLowerCase().split("-", 1)[0] ?? "";
    if (isKnownLang(prefix)) return prefix;
    return "en";
}

/**
 * The active language for this page. Fixed at module load; returned by every
 * t() and getDateLocale() call.
 */
export function getCurrentLang(): Lang {
    return activeLang;
}

/**
 * Persists the language choice to localStorage. Called on the navigate path
 * (lang-switcher, lang-suggestion banner) so the next visit to the root stub
 * "/" (which carries no locale segment) picks the same locale, and so the
 * prerendered HTML for the right language is served on first paint.
 */
export function persistLangChoice(lang: Lang): void {
    try {
        localStorage.setItem(STORAGE_KEY, lang);
    } catch {
        // localStorage unavailable (private mode) - the choice does not
        // survive across sessions, but the imminent navigation still
        // delivers the user to the right URL for the current session.
    }
}

/**
 * Locale string for Intl.DateTimeFormat / Intl.NumberFormat. See the
 * comment on LOCALES for region selection rationale.
 */
export function getDateLocale(): string {
    return LOCALES[activeLang];
}

/**
 * Returns the localized string for a key, with optional parameter
 * substitution. The ICU template is compiled on first call and cached.
 *
 * If the template has a syntax error (malformed ICU), falls back to the
 * raw dictionary string. This is a runtime safety net; the compile-time
 * Record<I18nKey, string> already prevents missing keys.
 */
export function t(key: I18nKey, params?: Record<string, string | number | boolean | Date>): string {
    const dict = getActiveDict();
    let fmt = formatterCache.get(key);
    if (!fmt) {
        const raw = dict[key];
        try {
            // Treat angle brackets in translated copy as text. Templates never
            // use IntlMessageFormat's XML-tag placeholders.
            fmt = new IntlMessageFormat(raw, activeLang, undefined, { ignoreTag: true });
        } catch (err) {
            // Template is broken - warn ONCE, then cache a passthrough so later
            // t() calls skip the re-parse and re-warn. A broken key on a hot
            // path (metrics ~4-15 Hz) would otherwise flood the ~500-entry ring
            // buffer and evict the entries useful for a bug report. Params are
            // not substituted in the raw fallback, but that beats a UI exception.
            log.warn("template parse failed", { key, err: err instanceof Error ? err.message : String(err) });
            fmt = { format: () => raw } as unknown as IntlMessageFormat;
        }
        formatterCache.set(key, fmt);
    }
    // format() throws when the caller omits or mistypes a parameter the
    // template needs (MissingValueError on a {param} key called without
    // params). That is a call-site bug, but it must not escape t() and kill
    // the calling render - warn once per key and fall back to the raw
    // template, same policy as the parse-failure path above. The cached
    // formatter is NOT replaced: a later call with correct params still
    // formats normally.
    let out: unknown;
    try {
        out = fmt.format(params ?? {});
    } catch (err) {
        if (!formatWarnedKeys.has(key)) {
            formatWarnedKeys.add(key);
            log.warn("template format failed", { key, err: err instanceof Error ? err.message : String(err) });
        }
        return dict[key];
    }
    // IntlMessageFormat can return an array (for custom types with XML tags) -
    // our templates do not use that, but guard the contract anyway.
    if (typeof out === "string") return out;
    if (Array.isArray(out)) return out.join("");
    return String(out);
}

/**
 * Applies translations to static DOM nodes:
 *   - [data-i18n="key"] - sets textContent.
 *   - [data-i18n-attr="title:key,aria-label:other.key"] - sets the listed
 *     attributes. Format: "attr:key" pairs separated by commas without spaces.
 *
 * Idempotent - repeated calls overwrite with the same values.
 * Called from app.ts once immediately after first paint.
 */
export function applyStaticI18n(root: ParentNode = document): void {
    // textContent, not innerHTML - so stray HTML in a translation string
    // cannot become an XSS vector. All strings are plain text.
    for (const el of root.querySelectorAll<HTMLElement>("[data-i18n]")) {
        const key = el.dataset.i18n;
        if (!key) continue;
        if (!isI18nKey(key)) {
            log.warn("unknown i18n key on element", { key, tag: el.tagName });
            continue;
        }
        el.textContent = t(key);
    }
    // Attribute translations. Format: "title:topbar.trips,aria-label:topbar.trips".
    for (const el of root.querySelectorAll<HTMLElement>("[data-i18n-attr]")) {
        const spec = el.dataset.i18nAttr;
        if (!spec) continue;
        for (const pair of spec.split(",")) {
            const [attr, key] = pair.split(":").map((s) => s.trim());
            if (!attr || !key) continue;
            if (!isI18nKey(key)) {
                log.warn("unknown i18n key in data-i18n-attr", { key, attr, tag: el.tagName });
                continue;
            }
            el.setAttribute(attr, t(key));
        }
    }
}

/**
 * Runtime check that a string is a valid I18nKey. Used in applyStaticI18n:
 * HTML attributes are not typed, so a typo in data-i18n is not caught by
 * the compiler. Checks against the active dictionary - all locales share the
 * same key set (enforced by `satisfies Record<I18nKey, string>`).
 */
function isI18nKey(s: string): s is I18nKey {
    return s in getActiveDict();
}

// activeLang is detected from the URL (which, on a prerendered /<lang>/ page,
// always wins). Safe at module eval even in a Worker: detectInitialLang only
// touches location / localStorage / navigator (all guarded), never `document`.
const activeLang: Lang = detectInitialLang();

// The active dictionary, loaded LAZILY on first use - NOT at module eval.
// Reading the baked island touches `document`, which does not exist in a Worker.
// Workers pull this module in transitively (via shared helpers) but never call
// t()/isI18nKey, so they never trigger the read; a non-lazy read here would
// crash worker startup with "document is not defined". In production the dict
// comes from the baked JSON island (matching the page's locale); in `vite dev`
// (no prerender) the DEV branch picks from the all-dictionaries dev map, which
// is tree-shaken out of production builds.
let activeDictCache: Record<I18nKey, string> | null = null;
function getActiveDict(): Record<I18nKey, string> {
    if (activeDictCache === null) {
        activeDictCache = import.meta.env.DEV ? DEV_DICTS[activeLang] : readI18nIsland();
    }
    return activeDictCache;
}
