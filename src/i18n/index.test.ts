// Tests for the i18n helper. Covers:
//  - detectInitialLang: localStorage > navigator.language > en fallback.
//  - t() and plurals for Russian/English with boundary numbers.
//  - template application with parameter substitution.
//
// Environment: vitest defaults to `node`. localStorage and navigator are not
// part of Node, so they are stubbed via vi.stubGlobal in each test. This gives
// full state control without pulling in a DOM emulator (happy-dom/jsdom) for
// just two globals.
//
// getCurrentLang() stores the language in a module-level variable (once per
// load), so switching languages between tests requires resetModules() - that
// gives a fresh module instance on import.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Minimal in-memory Storage. Only the methods our code reads (getItem/setItem)
// + removeItem for test cleanup. Full Storage interface (length/key/clear) is
// not needed.
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
        clear: () => {
            data.clear();
        },
        key: (i: number) => Array.from(data.keys())[i] ?? null,
        get length() {
            return data.size;
        },
    };
}

beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal("localStorage", makeMockStorage());
});

afterEach(() => {
    vi.unstubAllGlobals();
});

async function loadI18n() {
    return await import("./index.js");
}

describe("detectInitialLang", () => {
    it("uses localStorage when set to 'ru'", async () => {
        localStorage.setItem("dashcamigo:lang", "ru");
        const { detectInitialLang } = await loadI18n();
        expect(detectInitialLang()).toBe("ru");
    });

    it("uses localStorage when set to 'en'", async () => {
        localStorage.setItem("dashcamigo:lang", "en");
        const { detectInitialLang } = await loadI18n();
        expect(detectInitialLang()).toBe("en");
    });

    it("ignores invalid localStorage value and falls back to navigator", async () => {
        localStorage.setItem("dashcamigo:lang", "klingon");
        vi.stubGlobal("navigator", { language: "ru-RU" });
        const { detectInitialLang } = await loadI18n();
        expect(detectInitialLang()).toBe("ru");
    });

    it("detects ru from navigator.language with ru- prefix", async () => {
        vi.stubGlobal("navigator", { language: "ru-RU" });
        const { detectInitialLang } = await loadI18n();
        expect(detectInitialLang()).toBe("ru");
    });

    it("detects ru from navigator.language with ru-UA prefix", async () => {
        vi.stubGlobal("navigator", { language: "ru-UA" });
        const { detectInitialLang } = await loadI18n();
        expect(detectInitialLang()).toBe("ru");
    });

    it("detects de from navigator.language with de-DE prefix", async () => {
        vi.stubGlobal("navigator", { language: "de-DE" });
        const { detectInitialLang } = await loadI18n();
        expect(detectInitialLang()).toBe("de");
    });

    it("detects es from navigator.language with es-AR prefix", async () => {
        vi.stubGlobal("navigator", { language: "es-AR" });
        const { detectInitialLang } = await loadI18n();
        expect(detectInitialLang()).toBe("es");
    });

    it("detects pt from navigator.language with pt-BR prefix", async () => {
        vi.stubGlobal("navigator", { language: "pt-BR" });
        const { detectInitialLang } = await loadI18n();
        expect(detectInitialLang()).toBe("pt");
    });

    it("detects zh from navigator.language with zh-Hans-CN tag", async () => {
        // zh-Hans-CN - first segment before "-" is "zh", even when the region
        // part contains script + region. Tests parsing robustness.
        vi.stubGlobal("navigator", { language: "zh-Hans-CN" });
        const { detectInitialLang } = await loadI18n();
        expect(detectInitialLang()).toBe("zh");
    });

    it("detects ja from navigator.language with ja-JP prefix", async () => {
        vi.stubGlobal("navigator", { language: "ja-JP" });
        const { detectInitialLang } = await loadI18n();
        expect(detectInitialLang()).toBe("ja");
    });

    it("detects ko from navigator.language with ko-KR prefix", async () => {
        vi.stubGlobal("navigator", { language: "ko-KR" });
        const { detectInitialLang } = await loadI18n();
        expect(detectInitialLang()).toBe("ko");
    });

    it("falls back to en for unsupported navigator language", async () => {
        // Thai is not supported - should fall back to en, not guess.
        vi.stubGlobal("navigator", { language: "th-TH" });
        const { detectInitialLang } = await loadI18n();
        expect(detectInitialLang()).toBe("en");
    });

    it("falls back to en when navigator.language is empty", async () => {
        vi.stubGlobal("navigator", { language: "" });
        const { detectInitialLang } = await loadI18n();
        expect(detectInitialLang()).toBe("en");
    });

    // URL-first detection. When we're on a prerendered locale page (/ru/,
    // /de/, ...), the URL must override localStorage / navigator - otherwise
    // a user landing from Google on /ru/ with stored="de" would see German
    // instead of the Russian content the page is canonicalized for.
    //
    // Path source: detectInitialLang reads location.pathname. In Node tests
    // we stub `location` directly; the helper guards with typeof checks.

    it("URL /ru/ beats localStorage='de'", async () => {
        localStorage.setItem("dashcamigo:lang", "de");
        vi.stubGlobal("location", { pathname: "/ru/" });
        const { detectInitialLang } = await loadI18n();
        expect(detectInitialLang()).toBe("ru");
    });

    it("URL /de/cameras/70mai/ beats navigator='es-AR'", async () => {
        vi.stubGlobal("navigator", { language: "es-AR" });
        vi.stubGlobal("location", { pathname: "/de/cameras/70mai/" });
        const { detectInitialLang } = await loadI18n();
        expect(detectInitialLang()).toBe("de");
    });

    it("URL / falls through to localStorage (no locale segment in URL)", async () => {
        // Root path carries no locale signal - parseLangFromPath returns null
        // and detectInitialLang must continue to the localStorage check.
        localStorage.setItem("dashcamigo:lang", "ru");
        vi.stubGlobal("location", { pathname: "/" });
        const { detectInitialLang } = await loadI18n();
        expect(detectInitialLang()).toBe("ru");
    });

    it("URL /cameras/ (English implicit) falls through to localStorage", async () => {
        // English vendor pages live at /cameras/* without a locale prefix.
        // The URL carries no explicit locale, so a returning user's stored
        // preference still wins.
        localStorage.setItem("dashcamigo:lang", "fr");
        vi.stubGlobal("location", { pathname: "/cameras/70mai/" });
        const { detectInitialLang } = await loadI18n();
        expect(detectInitialLang()).toBe("fr");
    });

    it("URL /unknown/ falls through to navigator (unknown segment = no signal)", async () => {
        vi.stubGlobal("navigator", { language: "ja-JP" });
        vi.stubGlobal("location", { pathname: "/unknown-thing/" });
        const { detectInitialLang } = await loadI18n();
        expect(detectInitialLang()).toBe("ja");
    });
});

describe("getDateLocale", () => {
    it("returns ru-RU for russian", async () => {
        localStorage.setItem("dashcamigo:lang", "ru");
        const { getDateLocale } = await loadI18n();
        expect(getDateLocale()).toBe("ru-RU");
    });

    it("returns en-US for english", async () => {
        localStorage.setItem("dashcamigo:lang", "en");
        const { getDateLocale } = await loadI18n();
        expect(getDateLocale()).toBe("en-US");
    });

    it("returns pt-BR for portuguese (brazilian variant)", async () => {
        localStorage.setItem("dashcamigo:lang", "pt");
        const { getDateLocale } = await loadI18n();
        expect(getDateLocale()).toBe("pt-BR");
    });

    it("returns zh-CN for chinese (simplified)", async () => {
        localStorage.setItem("dashcamigo:lang", "zh");
        const { getDateLocale } = await loadI18n();
        expect(getDateLocale()).toBe("zh-CN");
    });

    it("returns ja-JP for japanese", async () => {
        localStorage.setItem("dashcamigo:lang", "ja");
        const { getDateLocale } = await loadI18n();
        expect(getDateLocale()).toBe("ja-JP");
    });

    it("returns ko-KR for korean", async () => {
        localStorage.setItem("dashcamigo:lang", "ko");
        const { getDateLocale } = await loadI18n();
        expect(getDateLocale()).toBe("ko-KR");
    });
});

describe("t() basic substitution", () => {
    it("returns plain string without params", async () => {
        localStorage.setItem("dashcamigo:lang", "ru");
        const { t } = await loadI18n();
        expect(t("buckets.today")).toBe("Сегодня");
    });

    it("returns english string when lang=en", async () => {
        localStorage.setItem("dashcamigo:lang", "en");
        const { t } = await loadI18n();
        expect(t("buckets.today")).toBe("Today");
    });

    it("substitutes placeholders", async () => {
        localStorage.setItem("dashcamigo:lang", "ru");
        const { t } = await loadI18n();
        expect(t("ingestOverlay.stage.indexing", { done: 5, total: 12 })).toBe("Индексирую видео: 5 / 12");
    });
});

describe("t() format-failure fallback", () => {
    // Regression: fmt.format() throws MissingValueError when a {param} key is
    // called without params. t() must swallow that (warn + raw template), not
    // let it escape and kill the calling render.
    it("returns the raw template and does not throw when a {param} key is called without params", async () => {
        localStorage.setItem("dashcamigo:lang", "ru");
        const { t } = await loadI18n();
        const { ruDict } = await import("./ru.js");
        let out = "";
        expect(() => {
            out = t("ingestOverlay.stage.indexing");
        }).not.toThrow();
        expect(out).toBe(ruDict["ingestOverlay.stage.indexing"]);
    });

    it("does not poison the cached formatter - a later call with correct params still formats", async () => {
        localStorage.setItem("dashcamigo:lang", "ru");
        const { t } = await loadI18n();
        t("ingestOverlay.stage.indexing"); // missing params - falls back to raw
        expect(t("ingestOverlay.stage.indexing", { done: 5, total: 12 })).toBe("Индексирую видео: 5 / 12");
    });
});

describe("t() russian pluralization (CLDR rules)", () => {
    it("n=1 → one form", async () => {
        localStorage.setItem("dashcamigo:lang", "ru");
        const { t } = await loadI18n();
        expect(t("plurals.trip", { n: 1 })).toBe("1 поездка");
    });

    it("n=2 → few form", async () => {
        localStorage.setItem("dashcamigo:lang", "ru");
        const { t } = await loadI18n();
        expect(t("plurals.trip", { n: 2 })).toBe("2 поездки");
    });

    it("n=5 → many/other form", async () => {
        localStorage.setItem("dashcamigo:lang", "ru");
        const { t } = await loadI18n();
        expect(t("plurals.trip", { n: 5 })).toBe("5 поездок");
    });

    it("n=11 → many (special case 11-14)", async () => {
        localStorage.setItem("dashcamigo:lang", "ru");
        const { t } = await loadI18n();
        // 11/12/13/14 - many ("11 поездок"), not one ("11 поездка")
        expect(t("plurals.trip", { n: 11 })).toBe("11 поездок");
    });

    it("n=21 → one form (21 ends with 1, not 11-14)", async () => {
        localStorage.setItem("dashcamigo:lang", "ru");
        const { t } = await loadI18n();
        expect(t("plurals.trip", { n: 21 })).toBe("21 поездка");
    });

    it("n=22 → few form (22 ends with 2)", async () => {
        localStorage.setItem("dashcamigo:lang", "ru");
        const { t } = await loadI18n();
        expect(t("plurals.trip", { n: 22 })).toBe("22 поездки");
    });

    it("file plural also works", async () => {
        localStorage.setItem("dashcamigo:lang", "ru");
        const { t } = await loadI18n();
        expect(t("plurals.file", { n: 1 })).toBe("1 файл");
        expect(t("plurals.file", { n: 3 })).toBe("3 файла");
        expect(t("plurals.file", { n: 7 })).toBe("7 файлов");
    });
});

describe("t() english pluralization", () => {
    it("n=1 → singular", async () => {
        localStorage.setItem("dashcamigo:lang", "en");
        const { t } = await loadI18n();
        expect(t("plurals.trip", { n: 1 })).toBe("1 trip");
    });

    it("n=0 → plural (English: 0 is plural)", async () => {
        localStorage.setItem("dashcamigo:lang", "en");
        const { t } = await loadI18n();
        expect(t("plurals.trip", { n: 0 })).toBe("0 trips");
    });

    it("n=5 → plural", async () => {
        localStorage.setItem("dashcamigo:lang", "en");
        const { t } = await loadI18n();
        expect(t("plurals.trip", { n: 5 })).toBe("5 trips");
    });
});

describe("dictionary parity", () => {
    // satisfies Record<I18nKey, string> in each dictionary already gives a
    // compile-time guarantee that keys match the union. This test checks the
    // same invariant at runtime - to catch accidental divergence faster,
    // before building.
    it("all language dictionaries have identical key sets", async () => {
        const { ruDict } = await import("./ru.js");
        const { enDict } = await import("./en.js");
        const { deDict } = await import("./de.js");
        const { esDict } = await import("./es.js");
        const { ptDict } = await import("./pt.js");
        const { frDict } = await import("./fr.js");
        const { plDict } = await import("./pl.js");
        const { zhDict } = await import("./zh.js");
        const { jaDict } = await import("./ja.js");
        const { koDict } = await import("./ko.js");
        const ruKeys = Object.keys(ruDict).sort();
        for (const [name, dict] of [
            ["en", enDict],
            ["de", deDict],
            ["es", esDict],
            ["pt", ptDict],
            ["fr", frDict],
            ["pl", plDict],
            ["zh", zhDict],
            ["ja", jaDict],
            ["ko", koDict],
        ] as const) {
            const keys = Object.keys(dict).sort();
            expect(keys, `dictionary ${name} key set diverges from ru`).toEqual(ruKeys);
        }
    });

    // Catches translator drift where a placeholder is renamed - {done}/{total}
    // in en becomes {count} in some locale. satisfies Record<I18nKey, string>
    // would still pass; runtime t() would emit a literal "{count}" because the
    // caller passes done/total values, not count.
    it("placeholder names match across dictionaries for every key", async () => {
        const { ruDict } = await import("./ru.js");
        const { enDict } = await import("./en.js");
        const { deDict } = await import("./de.js");
        const { esDict } = await import("./es.js");
        const { ptDict } = await import("./pt.js");
        const { frDict } = await import("./fr.js");
        const { plDict } = await import("./pl.js");
        const { zhDict } = await import("./zh.js");
        const { jaDict } = await import("./ja.js");
        const { koDict } = await import("./ko.js");

        // Capture ICU argument names: {name}, {name, plural, ...}, {name, select, ...}.
        // Excludes the `#` shorthand inside plural branches (no name to compare).
        function placeholderSet(s: string): Set<string> {
            const out = new Set<string>();
            const re = /\{\s*([A-Za-z_]\w*)\s*[,}]/g;
            for (;;) {
                const m = re.exec(s);
                if (m === null) break;
                out.add(m[1]!);
            }
            return out;
        }

        const refDict = ruDict;
        for (const [name, dict] of [
            ["en", enDict],
            ["de", deDict],
            ["es", esDict],
            ["pt", ptDict],
            ["fr", frDict],
            ["pl", plDict],
            ["zh", zhDict],
            ["ja", jaDict],
            ["ko", koDict],
        ] as const) {
            for (const key of Object.keys(refDict) as (keyof typeof refDict)[]) {
                const refPh = placeholderSet(refDict[key]);
                const dictPh = placeholderSet((dict as Record<string, string>)[key] ?? "");
                expect(
                    [...dictPh].sort(),
                    `${name}.${key}: placeholders diverge from ru (${[...refPh].sort().join(",")})`,
                ).toEqual([...refPh].sort());
            }
        }
    });
});
