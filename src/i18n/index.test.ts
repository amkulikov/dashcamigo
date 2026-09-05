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
// Only tests of the active language need a fresh module. detectInitialLang
// reads the current globals on every call.

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { DEV_DICTS } from "./dev-dicts.js";

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
    vi.stubGlobal("localStorage", makeMockStorage());
});

afterEach(() => {
    vi.unstubAllGlobals();
});

async function loadI18n() {
    vi.resetModules();
    return await import("./index.js");
}

describe("detectInitialLang", () => {
    let detectInitialLang: typeof import("./index.js").detectInitialLang;

    beforeAll(async () => {
        vi.stubGlobal("localStorage", makeMockStorage());
        ({ detectInitialLang } = await import("./index.js"));
    });

    it("uses localStorage when set to 'ru'", () => {
        localStorage.setItem("dashcamigo:lang", "ru");
        expect(detectInitialLang()).toBe("ru");
    });

    it("uses localStorage when set to 'en'", () => {
        localStorage.setItem("dashcamigo:lang", "en");
        expect(detectInitialLang()).toBe("en");
    });

    it("ignores invalid localStorage value and falls back to navigator", () => {
        localStorage.setItem("dashcamigo:lang", "klingon");
        vi.stubGlobal("navigator", { language: "ru-RU" });
        expect(detectInitialLang()).toBe("ru");
    });

    it("detects ru from navigator.language with ru- prefix", () => {
        vi.stubGlobal("navigator", { language: "ru-RU" });
        expect(detectInitialLang()).toBe("ru");
    });

    it("detects ru from navigator.language with ru-UA prefix", () => {
        vi.stubGlobal("navigator", { language: "ru-UA" });
        expect(detectInitialLang()).toBe("ru");
    });

    it("detects de from navigator.language with de-DE prefix", () => {
        vi.stubGlobal("navigator", { language: "de-DE" });
        expect(detectInitialLang()).toBe("de");
    });

    it("detects es from navigator.language with es-AR prefix", () => {
        vi.stubGlobal("navigator", { language: "es-AR" });
        expect(detectInitialLang()).toBe("es");
    });

    it("detects pt from navigator.language with pt-BR prefix", () => {
        vi.stubGlobal("navigator", { language: "pt-BR" });
        expect(detectInitialLang()).toBe("pt");
    });

    it("detects zh from navigator.language with zh-Hans-CN tag", () => {
        // zh-Hans-CN - first segment before "-" is "zh", even when the region
        // part contains script + region. Tests parsing robustness.
        vi.stubGlobal("navigator", { language: "zh-Hans-CN" });
        expect(detectInitialLang()).toBe("zh");
    });

    it("detects ja from navigator.language with ja-JP prefix", () => {
        vi.stubGlobal("navigator", { language: "ja-JP" });
        expect(detectInitialLang()).toBe("ja");
    });

    it("detects ko from navigator.language with ko-KR prefix", () => {
        vi.stubGlobal("navigator", { language: "ko-KR" });
        expect(detectInitialLang()).toBe("ko");
    });

    it("falls back to en for unsupported navigator language", () => {
        // Thai is not supported - should fall back to en, not guess.
        vi.stubGlobal("navigator", { language: "th-TH" });
        expect(detectInitialLang()).toBe("en");
    });

    it("falls back to en when navigator.language is empty", () => {
        vi.stubGlobal("navigator", { language: "" });
        expect(detectInitialLang()).toBe("en");
    });

    // URL-first detection. When we're on a prerendered locale page (/ru/,
    // /de/, ...), the URL must override localStorage / navigator - otherwise
    // a user landing from Google on /ru/ with stored="de" would see German
    // instead of the Russian content the page is canonicalized for.
    //
    // Path source: detectInitialLang reads location.pathname. In Node tests
    // we stub `location` directly; the helper guards with typeof checks.

    it("URL /ru/ beats localStorage='de'", () => {
        localStorage.setItem("dashcamigo:lang", "de");
        vi.stubGlobal("location", { pathname: "/ru/" });
        expect(detectInitialLang()).toBe("ru");
    });

    it("URL /de/cameras/70mai/ beats navigator='es-AR'", () => {
        vi.stubGlobal("navigator", { language: "es-AR" });
        vi.stubGlobal("location", { pathname: "/de/cameras/70mai/" });
        expect(detectInitialLang()).toBe("de");
    });

    it("URL / falls through to localStorage (no locale segment in URL)", () => {
        // Root path carries no locale signal - parseLangFromPath returns null
        // and detectInitialLang must continue to the localStorage check.
        localStorage.setItem("dashcamigo:lang", "ru");
        vi.stubGlobal("location", { pathname: "/" });
        expect(detectInitialLang()).toBe("ru");
    });

    it("URL /cameras/ (English implicit) falls through to localStorage", () => {
        // English vendor pages live at /cameras/* without a locale prefix.
        // The URL carries no explicit locale, so a returning user's stored
        // preference still wins.
        localStorage.setItem("dashcamigo:lang", "fr");
        vi.stubGlobal("location", { pathname: "/cameras/70mai/" });
        expect(detectInitialLang()).toBe("fr");
    });

    it("URL /unknown/ falls through to navigator (unknown segment = no signal)", () => {
        vi.stubGlobal("navigator", { language: "ja-JP" });
        vi.stubGlobal("location", { pathname: "/unknown-thing/" });
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
        expect(t("gpsLoad.progress", { done: 5, total: 12 })).toBe("5 из 12");
    });
});

describe("t() format-failure fallback", () => {
    // Regression: fmt.format() throws MissingValueError when a {param} key is
    // called without params. t() must swallow that (warn + raw template), not
    // let it escape and kill the calling render.
    it("returns the raw template for missing params and preserves the formatter for a later valid call", async () => {
        localStorage.setItem("dashcamigo:lang", "ru");
        const { t } = await loadI18n();
        expect(t("gpsLoad.progress")).toBe(DEV_DICTS.ru["gpsLoad.progress"]);
        expect(t("gpsLoad.progress", { done: 5, total: 12 })).toBe("5 из 12");
    });
});

describe("t() pluralization", () => {
    it("formats Russian plural boundaries and file counts", async () => {
        localStorage.setItem("dashcamigo:lang", "ru");
        const { t } = await loadI18n();
        for (const [n, expected] of [
            [1, "1 поездка"],
            [2, "2 поездки"],
            [5, "5 поездок"],
            [11, "11 поездок"],
            [21, "21 поездка"],
            [22, "22 поездки"],
        ] as const) {
            expect(t("plurals.trip", { n }), `Russian trips: n=${n}`).toBe(expected);
        }
        for (const [n, expected] of [
            [1, "1 файл"],
            [3, "3 файла"],
            [7, "7 файлов"],
        ] as const) {
            expect(t("plurals.file", { n }), `Russian files: n=${n}`).toBe(expected);
        }
    });

    it("formats English singular and plural counts, including zero", async () => {
        localStorage.setItem("dashcamigo:lang", "en");
        const { t } = await loadI18n();
        for (const [n, expected] of [
            [1, "1 trip"],
            [0, "0 trips"],
            [5, "5 trips"],
        ] as const) {
            expect(t("plurals.trip", { n }), `English trips: n=${n}`).toBe(expected);
        }
    });
});

describe("dictionary placeholders", () => {
    // Key parity is enforced by satisfies Record<I18nKey, string>. Values need
    // a runtime check: a renamed ICU argument still satisfies the key type.
    function placeholders(dict: Record<string, string>): Record<string, string[]> {
        const result: Record<string, string[]> = {};
        for (const [key, value] of Object.entries(dict)) {
            const names = new Set([...value.matchAll(/\{\s*([A-Za-z_]\w*)\s*[,}]/g)].map((match) => match[1]!));
            if (names.size) result[key] = [...names].sort();
        }
        return result;
    }

    const expected = placeholders(DEV_DICTS.en);
    it.each(Object.entries(DEV_DICTS).filter(([lang]) => lang !== "en"))(
        "keeps ICU argument names in %s aligned with English",
        (lang, dict) => {
            expect(placeholders(dict), `${lang} dictionary placeholders`).toEqual(expected);
        },
    );
});
