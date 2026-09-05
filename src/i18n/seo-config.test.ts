// SEO config sanity checks. Catches drift between the SEO config and the
// surrounding i18n / vite-plugins setup, and validates hreflang / URL
// invariants that are easy to miss when adding a locale.

import { describe, expect, it } from "vitest";

import { deDict } from "./de.js";
import { enDict } from "./en.js";
import { esDict } from "./es.js";
import { frDict } from "./fr.js";
import { jaDict } from "./ja.js";
import { koDict } from "./ko.js";
import { plDict } from "./pl.js";
import { ptDict } from "./pt.js";
import { ruDict } from "./ru.js";
import { SEO_LOCALES, buildLocaleUrl, getDefaultSeoLocale, getSeoLocaleByLang, getSeoLocaleByUrlSegment, parseLangFromPath } from "./seo-config.js";
import { zhDict } from "./zh.js";
import type { I18nKey, Lang } from "./index.js";

const DICTS: Record<Lang, Record<I18nKey, string>> = {
    de: deDict,
    en: enDict,
    es: esDict,
    fr: frDict,
    ja: jaDict,
    ko: koDict,
    pl: plDict,
    pt: ptDict,
    ru: ruDict,
    zh: zhDict,
};

describe("seo-config structure", () => {
    it("has English as the default locale at /en/", () => {
        // English is a regular locale at /en/, not the implicit default at /.
        // The default-locale concept still exists for hreflang x-default
        // targeting and OG-card fallback, but its URL is /en/.
        const en = getDefaultSeoLocale();
        expect(en.lang).toBe("en");
        expect(en.urlSegment).toBe("en");
    });

    it("includes exactly the Lang codes - drift between SEO_LOCALES and Lang causes build/runtime bugs", () => {
        const expected: Lang[] = ["de", "en", "es", "fr", "ja", "ko", "pl", "pt", "ru", "zh"];
        const actual = SEO_LOCALES.map((l) => l.lang).sort();
        expect(actual).toEqual(expected.sort());
    });

    it("urlSegment is unique per locale", () => {
        const segments = SEO_LOCALES.map((l) => l.urlSegment);
        const dedup = new Set(segments);
        expect(dedup.size).toBe(segments.length);
    });

    it("hreflang values follow BCP 47 (lowercase language + optional region or script subtag)", () => {
        for (const loc of SEO_LOCALES) {
            // Lang ("xx"), lang+region ("xx-YY", 2-3 uppercase letters) or
            // lang+script ("xx-Yyyy", 4-letter Title Case per BCP 47 - e.g.
            // zh-Hans, zh-Hant). We use script subtag for Chinese because the
            // variant distinction is script, not region (Simplified is used
            // across CN/SG/MY/diaspora, not just CN).
            expect(loc.hreflang).toMatch(/^[a-z]{2}(-([A-Z]{2,3}|[A-Z][a-z]{3}))?$/);
        }
    });

    it("ogLocale uses underscore form (xx_YY)", () => {
        for (const loc of SEO_LOCALES) {
            expect(loc.ogLocale).toMatch(/^[a-z]{2}_[A-Z]{2}$/);
        }
    });

    it("contentLanguage uses hyphen form matching ogLocale region", () => {
        for (const loc of SEO_LOCALES) {
            expect(loc.contentLanguage).toMatch(/^[a-z]{2}-[A-Z]{2}$/);
            expect(loc.contentLanguage.replace("-", "_")).toBe(loc.ogLocale);
        }
    });
});

describe("SEO-critical translations", () => {
    // These keys end up in <title>, <meta name="description">, og:title,
    // og:description, twitter:* and JSON-LD. If they're left as the English
    // fallback in a non-English dict, Google flags it as duplicate content
    // and won't rank the locale variant.
    const SEO_CRITICAL_KEYS: I18nKey[] = ["page.title", "meta.description"];

    it("every locale defines every SEO-critical key", () => {
        for (const [lang, dict] of Object.entries(DICTS) as Array<[Lang, Record<I18nKey, string>]>) {
            for (const key of SEO_CRITICAL_KEYS) {
                expect(dict[key], `${lang}/${key} must be defined`).toBeTruthy();
                expect(typeof dict[key]).toBe("string");
                expect(dict[key].length, `${lang}/${key} non-empty`).toBeGreaterThan(0);
            }
        }
    });

    it("non-English locales translate page.title (not literally equal to English)", () => {
        const enTitle = enDict["page.title"];
        for (const [lang, dict] of Object.entries(DICTS) as Array<[Lang, Record<I18nKey, string>]>) {
            if (lang === "en") continue;
            expect(dict["page.title"], `${lang} page.title must differ from EN`).not.toBe(enTitle);
        }
    });

    it("non-English locales translate meta.description (not literally equal to English)", () => {
        const enDesc = enDict["meta.description"];
        for (const [lang, dict] of Object.entries(DICTS) as Array<[Lang, Record<I18nKey, string>]>) {
            if (lang === "en") continue;
            expect(dict["meta.description"], `${lang} meta.description must differ from EN`).not.toBe(enDesc);
        }
    });
});

describe("parseLangFromPath", () => {
    it("returns null for root path (no locale signal in URL)", () => {
        // Root path carries no locale info - detectInitialLang must fall back
        // to localStorage / navigator. Returning the default here would mean
        // returning users with stored=ru on / would see English instead.
        expect(parseLangFromPath("/")).toBeNull();
    });

    it("returns null for empty path", () => {
        expect(parseLangFromPath("")).toBeNull();
    });

    it("returns null for path with only slashes", () => {
        // "//" splits into ["", ""], filtered to [] - same as root.
        expect(parseLangFromPath("//")).toBeNull();
    });

    it("recognizes top-level locale segments", () => {
        expect(parseLangFromPath("/ru/")).toBe("ru");
        expect(parseLangFromPath("/de/")).toBe("de");
        expect(parseLangFromPath("/zh/")).toBe("zh");
    });

    it("recognizes locale prefix on nested paths", () => {
        expect(parseLangFromPath("/de/cameras/70mai/")).toBe("de");
        expect(parseLangFromPath("/ja/cameras/")).toBe("ja");
    });

    it("returns null for legacy paths with no locale segment", () => {
        // Legacy English vendor URLs used to live at /cameras/...; they now
        // 301 to /en/cameras/... via _redirects. parseLangFromPath sees no
        // locale signal in the URL itself, so it reports null. (After the
        // 301 the user lands on /en/cameras/... which does parse as "en".)
        expect(parseLangFromPath("/cameras/")).toBeNull();
        expect(parseLangFromPath("/cameras/70mai/")).toBeNull();
        expect(parseLangFromPath("/privacy.html")).toBeNull();
    });

    it("recognizes English under /en/ like any other locale", () => {
        expect(parseLangFromPath("/en/")).toBe("en");
        expect(parseLangFromPath("/en/cameras/")).toBe("en");
        expect(parseLangFromPath("/en/cameras/70mai/")).toBe("en");
    });

    it("returns null for unknown first segment (would 404 in practice)", () => {
        expect(parseLangFromPath("/unknown-thing/")).toBeNull();
    });

    it("accepts path without leading slash", () => {
        // location.pathname always starts with "/" in browsers, but the
        // helper should not depend on that - "ru/" tokenizes to ["ru"].
        expect(parseLangFromPath("ru/")).toBe("ru");
    });
});

describe("buildLocaleUrl", () => {
    it("switches root → locale home", () => {
        expect(buildLocaleUrl("de", "/")).toBe("/de/");
        expect(buildLocaleUrl("ja", "/")).toBe("/ja/");
    });

    it("switches locale home → another locale home", () => {
        expect(buildLocaleUrl("de", "/ru/")).toBe("/de/");
        expect(buildLocaleUrl("ja", "/ko/")).toBe("/ja/");
    });

    it("switches between any two locales including English", () => {
        // English lives at /en/ like every other locale, not at the root /.
        expect(buildLocaleUrl("en", "/ru/")).toBe("/en/");
        expect(buildLocaleUrl("en", "/de/cameras/")).toBe("/en/cameras/");
        expect(buildLocaleUrl("en", "/")).toBe("/en/");
    });

    it("preserves nested path while swapping locale", () => {
        expect(buildLocaleUrl("de", "/ru/cameras/70mai/")).toBe("/de/cameras/70mai/");
        expect(buildLocaleUrl("ja", "/en/cameras/70mai/")).toBe("/ja/cameras/70mai/");
    });

    it("returns input unchanged for unknown target lang", () => {
        // @ts-expect-error - intentionally passing an invalid Lang.
        expect(buildLocaleUrl("xx", "/de/cameras/")).toBe("/de/cameras/");
    });

    it("preserves query string", () => {
        expect(buildLocaleUrl("de", "/ru/?vendor=70mai")).toBe("/de/?vendor=70mai");
        expect(buildLocaleUrl("en", "/de/cameras/?ref=google")).toBe("/en/cameras/?ref=google");
    });

    it("preserves fragment", () => {
        expect(buildLocaleUrl("de", "/ru/#section")).toBe("/de/#section");
        expect(buildLocaleUrl("ja", "/cameras/70mai/#faq")).toBe("/ja/cameras/70mai/#faq");
    });

    it("preserves both query and fragment", () => {
        expect(buildLocaleUrl("de", "/ru/?ref=g#top")).toBe("/de/?ref=g#top");
    });
});

describe("getSeoLocaleByLang / ByUrlSegment", () => {
    it("byLang returns the entry", () => {
        const ru = getSeoLocaleByLang("ru");
        expect(ru).toBeDefined();
        expect(ru?.urlSegment).toBe("ru");
        expect(ru?.ogLocale).toBe("ru_RU");
    });

    it("byUrlSegment finds every locale, including English", () => {
        expect(getSeoLocaleByUrlSegment("en")?.lang).toBe("en");
        expect(getSeoLocaleByUrlSegment("de")?.lang).toBe("de");
        expect(getSeoLocaleByUrlSegment("zh")?.lang).toBe("zh");
    });

    it('byUrlSegment("") returns undefined - root has no canonical locale', () => {
        // Empty segment means we're on the root stub URL "/" - that's a
        // language-neutral redirect page, not a locale. The bootstrap script
        // resolves which locale to send the user to (localStorage > navigator > en).
        expect(getSeoLocaleByUrlSegment("")).toBeUndefined();
    });

    it("byUrlSegment returns undefined for unknown segment", () => {
        expect(getSeoLocaleByUrlSegment("xx")).toBeUndefined();
    });
});
