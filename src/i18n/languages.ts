import type { Lang } from "./index.js";

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
