// Copy for the lang-suggestion banner, in ALL locales.
//
// The banner shows its offer in the SUGGESTED (navigator) language, which
// differs from the page's active locale (e.g. on /ru/ with an English browser
// it reads "This page is in Russian. Open in English?"). A prerendered page
// carries ONLY the active locale's dictionary (baked into the HTML data island,
// see i18n/index.ts), so the banner cannot resolve other locales through t().
// It needs this small standalone set instead.
//
// The per-locale dictionaries (langBanner.* keys) remain the source of truth.
// This map duplicates just those 4 keys × 10 locales (~1 KB) so the banner does
// NOT pull all 10 full dictionaries into the bundle (which would defeat the
// baked-island optimization). banner-copy.test.ts asserts every value here
// equals the dictionary's, so any drift fails the test.

import type { Lang } from "./index.js";

export interface BannerCopyEntry {
    /** Body text with {urlLang} / {browserLang} placeholders. */
    message: string;
    /** "Open" button label. */
    open: string;
    /** Dismiss (X) button aria-label / title. */
    dismiss: string;
    /** aria-label of the banner region. */
    regionLabel: string;
}

export const BANNER_COPY: Record<Lang, BannerCopyEntry> = {
    de: {
        message: "Diese Seite ist auf {urlLang}. Auf {browserLang} öffnen?",
        open: "Öffnen",
        dismiss: "Schließen",
        regionLabel: "Sprachvorschlag",
    },
    en: {
        message: "This page is in {urlLang}. Open in {browserLang}?",
        open: "Open",
        dismiss: "Dismiss",
        regionLabel: "language suggestion",
    },
    es: {
        message: "Idioma de la página: {urlLang}. ¿Cambiar a {browserLang}?",
        open: "Abrir",
        dismiss: "Cerrar",
        regionLabel: "sugerencia de idioma",
    },
    fr: {
        message: "Cette page est en {urlLang}. Ouvrir en {browserLang} ?",
        open: "Ouvrir",
        dismiss: "Fermer",
        regionLabel: "suggestion de langue",
    },
    ja: {
        message: "このページは{urlLang}です。{browserLang}で開きますか？",
        open: "開く",
        dismiss: "閉じる",
        regionLabel: "言語の提案",
    },
    ko: {
        message: "페이지 언어: {urlLang}. {browserLang}(으)로 열까요?",
        open: "열기",
        dismiss: "닫기",
        regionLabel: "언어 제안",
    },
    pl: {
        message: "Język strony: {urlLang}. Przełączyć na {browserLang}?",
        open: "Otwórz",
        dismiss: "Zamknij",
        regionLabel: "sugestia języka",
    },
    pt: {
        message: "Esta página está em {urlLang}. Abrir em {browserLang}?",
        open: "Abrir",
        dismiss: "Fechar",
        regionLabel: "sugestão de idioma",
    },
    ru: {
        message: "Язык страницы: {urlLang}. Переключить на {browserLang}?",
        open: "Открыть",
        dismiss: "Закрыть",
        regionLabel: "предложение сменить язык",
    },
    zh: {
        message: "页面语言：{urlLang}。切换到{browserLang}？",
        open: "切换",
        dismiss: "关闭",
        regionLabel: "语言建议",
    },
};
