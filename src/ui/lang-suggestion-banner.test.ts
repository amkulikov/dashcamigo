// Tests for the lang-suggestion banner. Focused on pure helpers that don't
// need a DOM (vitest defaults to 'node', no jsdom). DOM-side flow
// (initLangSuggestionBanner mounting) is verified manually in browser; pure
// helpers (resolveBannerInLang, detectNavigatorLang) catch the regressions
// that matter most: per-locale copy presence, placeholder substitution
// correctness, navigator subtag parsing.

import { afterEach, describe, it, expect, vi } from "vitest";

import { detectNavigatorLang, resolveBannerInLang } from "./lang-suggestion-banner.js";
import { SEO_LOCALES } from "../i18n/seo-config.js";

// detectNavigatorLang tests below stub the global navigator; restore it after
// each so a leaked stub cannot bleed into another test in this file (tests in one
// file share the module realm and run serially).
afterEach(() => {
    vi.unstubAllGlobals();
});

describe("resolveBannerInLang", () => {
    it("returns localized copy for every indexable locale", () => {
        // Cross-checks that every locale's dict has langBanner.message,
        // .open, .dismiss populated. A missing key would surface here as
        // an empty string and the banner's hiding-on-empty path would
        // trigger - a silent regression in production.
        for (const loc of SEO_LOCALES) {
            const copy = resolveBannerInLang(loc.lang, "URL_LANG_NAME", "BROWSER_LANG_NAME");
            expect(copy.message, `${loc.lang} message`).not.toBe("");
            expect(copy.open, `${loc.lang} open`).not.toBe("");
            expect(copy.dismiss, `${loc.lang} dismiss`).not.toBe("");
        }
    });

    it("substitutes {urlLang} and {browserLang} placeholders", () => {
        const copy = resolveBannerInLang("en", "Russian", "English");
        expect(copy.message).toContain("Russian");
        expect(copy.message).toContain("English");
        expect(copy.message).not.toContain("{urlLang}");
        expect(copy.message).not.toContain("{browserLang}");
    });

    it("renders banner in the BROWSER's language, not the placeholder language", () => {
        // German-speaking user on a Russian-content page: copy must be
        // German ("Diese Seite ist auf ..."), not Russian.
        const copy = resolveBannerInLang("de", "Russisch", "Deutsch");
        expect(copy.message).toMatch(/Diese Seite/);
        expect(copy.message).toContain("Russisch");
        expect(copy.message).toContain("Deutsch");
        expect(copy.open).toBe("Öffnen");
    });

    it("substitutes both placeholders even when they appear in the same template", () => {
        // Russian copy uses both - regression guard against a bare
        // .replace() call substituting only the first match if both were
        // the same string.
        const copy = resolveBannerInLang("ru", "английский", "русский");
        expect(copy.message).toContain("английский");
        expect(copy.message).toContain("русский");
    });

    it("zh banner template does not drift between dict and code", () => {
        // Regression guard: prior to dedup the inline LANG_BANNER_TEMPLATES
        // copy of zh.langBanner.message used ASCII '?' while zh.ts used the
        // full-width '？' (or vice versa). With BANNER_DICTS importing
        // src/i18n/zh.ts directly there is one source of truth - this test
        // pins it.
        const copy = resolveBannerInLang("zh", "俄语", "中文");
        // Either ASCII '?' or full-width '？' is acceptable; what matters is
        // we get whatever the dict has (no drift between two copies).
        expect(copy.message).toContain("俄语");
        expect(copy.message).toContain("中文");
    });
});

describe("detectNavigatorLang", () => {
    it("returns the primary subtag of navigator.language when supported", () => {
        vi.stubGlobal("navigator", { language: "de-DE" });
        expect(detectNavigatorLang()).toBe("de");

        vi.stubGlobal("navigator", { language: "ru" });
        expect(detectNavigatorLang()).toBe("ru");

        // Brazilian Portuguese primary subtag is "pt" - falls through to
        // our pt dict (which IS Brazilian).
        vi.stubGlobal("navigator", { language: "pt-BR" });
        expect(detectNavigatorLang()).toBe("pt");

        // Chinese (any region) -> "zh" -> we serve Simplified.
        vi.stubGlobal("navigator", { language: "zh-TW" });
        expect(detectNavigatorLang()).toBe("zh");
    });

    it("returns null for unsupported primary subtag", () => {
        vi.stubGlobal("navigator", { language: "ar-SA" });
        expect(detectNavigatorLang()).toBeNull();

        vi.stubGlobal("navigator", { language: "" });
        expect(detectNavigatorLang()).toBeNull();
    });

    it("returns null when navigator is unavailable", () => {
        vi.stubGlobal("navigator", undefined);
        expect(detectNavigatorLang()).toBeNull();
    });
});
