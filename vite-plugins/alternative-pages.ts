// Competitor "alternative-to" landing pages. Each targets the navigational
// search demand of a named dashcam tool (RegistratorViewer, Dashcam Viewer,
// VLC) and offers dashcamigo as a free, in-browser alternative. Static HTML at
// /<lang>/alternatives/<slug>/ plus an /<lang>/alternatives/ hub - the same
// machinery as vendor-pages.ts (see that file's header for the prerender /
// dev-middleware / sitemap rationale), one concern per plugin.
//
// These are SEO landing pages: each targets the navigational search demand of a
// named dashcam tool and presents dashcamigo as a maintained, in-browser
// alternative. Tone is a fair, factual comparison, not a hit piece - every page
// carries a "when the other tool is still the better pick" callout, and every
// comparative claim is verified against public sources before it ships. False
// statements about a named competitor are a legal and SEO risk, so the bar is
// VERIFIED-only: stick to checkable product facts (supported platforms,
// last-updated year, feature presence) and do not make claims about individuals.
//
// English + Russian copy is hand-written inline below. The 10 community locales
// live in ./alternative-pages-content.ts (machine-translated, parity-enforced by
// assertAltLocaleParity) to keep this file readable - same split as
// vendor-pages.ts / vendor-community-faq.ts.
//
// Adding a competitor: append to ALTERNATIVES with en+ru locales, add the 10
// community translations to alternative-pages-content.ts, rebuild. Sitemap,
// hreflang, redirects, llms.txt and the dev middleware pick it up automatically.

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Plugin } from "vite";
import type { Lang } from "../src/i18n/index.js";
import {
    REPO_URL,
    SITE_ORIGIN,
    buildHreflangAlternatesMap,
    getDefaultSeoLocale,
    getIndexableSeoLocales,
    getSeoLocaleByLang,
} from "../src/i18n/seo-config.js";
import {
    COMMUNITY_ALT_CONTENT,
    COMMUNITY_ALT_INDEX,
    COMMUNITY_ALT_LABELS,
} from "./alternative-pages-content.js";
import { renderFeatureLinksHtml } from "./feature-links.js";
import { escapeAttr, escapeText, stringifyJsonLd } from "./html-utils.js";
import { renderHubCta } from "./hub-cta.js";
import type { SeoBuildOptions } from "./seo-prerender.js";
// Shared page chrome - one source, reused from vendor-pages.ts rather than
// duplicated (CLAUDE.md: abstractions against duplicates).
import {
    BRAND_ICON_SVG,
    NOINDEX_META,
    buildHreflangLinksHtml,
    buildOgLocaleAlternatesHtml,
    pathPrefixFor,
} from "./vendor-pages.js";

// Slugs of the competitor pages. Drives VendorContent-style discrimination and
// the dev/route matcher. Order = sitemap order + "other tools" cross-link order.
// Two clusters: dashcam viewers (registratorviewer/dashcam-viewer/vlc/
// navitel-dvr-player/camgeoplayer) and telemetry-overlay tools (telemetry-overlay/
// dashware/racerender) - the latter are a different category (overlay editors),
// framed as "free, in-browser, for dashcam footage" with the gauge-depth honestly
// conceded in the "when X is better" callout.
export type AltSlug =
    | "registratorviewer"
    | "dashcam-viewer"
    | "vlc"
    | "navitel-dvr-player"
    | "camgeoplayer"
    | "telemetry-overlay"
    | "dashware"
    | "racerender";

// A comparison-table cell. `mark` renders the ✓ / ✕ / ~ glyph (CSS
// .alt-yes/.alt-no/.alt-partial); `note` is the short localized text after it.
type CompareMark = "yes" | "no" | "partial";
interface CompareCell {
    mark: CompareMark;
    note: string;
}

// One comparison-table row: a localized dimension label, the dashcamigo cell and
// the competitor cell. Rows are authored per competitor so each page emphasizes
// the dimensions that actually differ (RegistratorViewer: maintenance/map;
// Dashcam Viewer: price/channels; VLC: telemetry-awareness).
interface CompareRow {
    dimension: string;
    us: CompareCell;
    them: CompareCell;
}

// Q/A pair, plain text - the template HTML-escapes on output.
interface FaqItem {
    q: string;
    a: string;
}

// Per-locale content for one competitor page. Genuinely different per competitor
// (the stories don't overlap), so community locales get a full translation, not
// a templated stub - see alternative-pages-content.ts.
export interface AltLocaleContent {
    title: string; // <title>, long form
    metaDescription: string; // target <=155 chars, hard cap ~200 - longer gets truncated in SERPs
    ogTitle: string; // target <=60 chars (hand-written en/ru hold it; translations may run longer)
    ogDescription: string; // ~150 chars
    h1: string;
    lead: string; // subtitle paragraph under h1
    cardHint: string; // one-line summary shown on the /alternatives/ hub card
    whatItIs: string; // honest description of the competitor (1-2 short paras)
    comparisonIntro: string; // one sentence before the table
    compareRows: CompareRow[];
    whenStayTitle: string; // "when <competitor> is still the better pick"
    whenStay: string;
    ctaPrimary: string;
    faq: FaqItem[];
}

// Static, locale-agnostic facts for one competitor.
export interface Competitor {
    slug: AltSlug;
    displayName: string;
    // Courtesy outbound link to the product's own site (rel=nofollow). For
    // RegistratorViewer the original domain is dead; we point at the community
    // preservation site that hosts the real info.
    officialUrl: string;
    // Hand-written en + ru. Community locales resolved from COMMUNITY_ALT_CONTENT.
    locales: Partial<Record<Lang, AltLocaleContent>>;
}

// dashcamigo's own capabilities are constant; we still phrase the "us" cell per
// competitor so the framing fits that page's story (e.g. vs VLC the GPS-map note
// stresses "the layer VLC lacks", vs Dashcam Viewer it stresses "keyless,
// no API key to expire"). Verified against CLAUDE.md - no overclaiming.
const ALTERNATIVES: Competitor[] = [
    {
        slug: "registratorviewer",
        displayName: "RegistratorViewer",
        officialUrl: "https://registrator-viewer.com/",
        locales: {
            en: {
                title: "RegistratorViewer alternative — free dashcam viewer in your browser | dashcamigo",
                metaDescription:
                    "A free, maintained RegistratorViewer alternative that runs in your browser on Windows, Mac, Linux and mobile — GPS map, speed chart, and a map with no API key to expire. No install.",
                ogTitle: "RegistratorViewer alternative — free, in your browser",
                ogDescription:
                    "RegistratorViewer is a great but long-unmaintained Windows viewer (last updated 2015) whose built-in map no longer works. dashcamigo is the maintained, cross-platform, in-browser alternative.",
                h1: "A free RegistratorViewer alternative that still gets updates — and a map that works",
                lead: "RegistratorViewer (also known as DATAKAM Player) was one of the best free dashcam viewers of its time — but it's had no updates in years, it's Windows-first, and its built-in Google map stopped working after Google ended free keyless access to its Maps API. dashcamigo picks up where it left off: a maintained, in-browser viewer with a synchronized GPS map, a speed and G-force chart, and a keyless map with no API key to expire.",
                cardHint: "Free, but unmaintained since 2015 — and its built-in map no longer works",
                whatItIs:
                    "RegistratorViewer (bundled as DATAKAM Player for DATAKAM cameras) is a free Windows viewer that was ahead of its time — lossless cut and stitch, continuous playback across files, a GPS track with speed and G-sensor graphs, frame capture with GPS in the photo's EXIF, and track export to GPX, KML and SRT. It still opens many recordings fine. The catch is longevity: development stopped in 2015, the original site is gone, and its built-in Google map broke when Google ended free keyless Maps API access — reviving it now takes a Windows registry tweak or an unofficial community build, and there's no official fix because the project is unmaintained and its source was never released.",
                comparisonIntro:
                    "RegistratorViewer is frozen in 2015. Here's how dashcamigo compares on the things that aged the worst — and the things that are simply even.",
                compareRows: [
                    { dimension: "Price", us: { mark: "yes", note: "Free" }, them: { mark: "yes", note: "Free" } },
                    {
                        dimension: "Runs on Mac, Linux & mobile",
                        us: { mark: "yes", note: "Any modern browser" },
                        them: { mark: "no", note: "Windows-first (a separate, limited Mac build exists)" },
                    },
                    {
                        dimension: "Still maintained",
                        us: { mark: "yes", note: "Actively developed" },
                        them: { mark: "no", note: "No updates since 2015" },
                    },
                    {
                        dimension: "Built-in map",
                        us: { mark: "yes", note: "Live, keyless — no API key to expire" },
                        them: { mark: "no", note: "Stopped working after Google's API change; needs a manual fix" },
                    },
                    {
                        dimension: "Speed & G-force chart",
                        us: { mark: "yes", note: "Yes" },
                        them: { mark: "yes", note: "Yes" },
                    },
                    {
                        dimension: "Trim & export",
                        us: { mark: "yes", note: "Trim + MP4 with GPS, plus .gpx" },
                        them: { mark: "yes", note: "Lossless cut + GPX/KML/SRT" },
                    },
                    {
                        dimension: "Nothing to install",
                        us: { mark: "yes", note: "Opens in the browser" },
                        them: { mark: "partial", note: "Portable .exe, no install" },
                    },
                ],
                whenStayTitle: "When RegistratorViewer is still worth keeping",
                whenStay:
                    "RegistratorViewer supports a long list of older and lesser-known cameras that dashcamigo doesn't parse yet, can losslessly stitch a whole folder of clips into a single file, repairs broken recordings, and runs fully offline as a desktop app. If you're on Windows, your camera is on its compatibility list, and you've already got its map working, it's still a capable tool. And if dashcamigo doesn't read your camera yet, send a sample to feedback@dashcamigo.app — we add formats from real recordings, and we want it to support every dashcam.",
                ctaPrimary: "Open your recordings",
                faq: [
                    {
                        q: "Is dashcamigo a drop-in replacement for RegistratorViewer?",
                        a: "For the core job — opening dashcam recordings with a GPS map, a speed and G-force chart, and trimming a clip — yes, and it runs in any modern browser with nothing to install. RegistratorViewer still has a wider legacy device list and a few specialist features (lossless multi-file stitch, broken-file repair); dashcamigo focuses on a maintained, cross-platform experience with a map that keeps working.",
                    },
                    {
                        q: "Why did RegistratorViewer's map stop working?",
                        a: "Its built-in route map rendered Google Maps through an embedded Internet Explorer view. When Google ended free keyless access to its Maps API the map began failing, and the site that hosted part of the map script went offline. With the project unmaintained and its source never released, there's no official fix — only manual registry edits or unofficial community builds. dashcamigo avoids the whole problem: its map is keyless MapLibre + OpenFreeMap, so there's no API key to expire.",
                    },
                    {
                        q: "Does dashcamigo work on Mac, Linux or my phone?",
                        a: "Yes. It runs in the browser, so Windows, macOS, Linux and mobile all work. RegistratorViewer is Windows-first; its Mac build is a separate, feature-limited app distributed mainly through third-party mirrors.",
                    },
                    {
                        q: "Will my recordings be uploaded anywhere?",
                        a: "No. Your browser reads the files directly from your device. dashcamigo has no server to send them to, so nothing is uploaded. You get the privacy of a desktop viewer without installing one.",
                    },
                    {
                        q: "Is dashcamigo free like RegistratorViewer?",
                        a: "Yes, completely free — no account, no paid tier, no trial limit.",
                    },
                ],
            },
            ru: {
                title: "Альтернатива RegistratorViewer — бесплатный плеер регистратора в браузере | dashcamigo",
                metaDescription:
                    "Бесплатная и живая альтернатива RegistratorViewer прямо в браузере — Windows, Mac, Linux, мобильный. Карта GPS, график скорости, и карта без ключей — истекать нечему. Без установки.",
                ogTitle: "Альтернатива RegistratorViewer — бесплатно, в браузере",
                ogDescription:
                    "RegistratorViewer — отличный, но давно не обновлявшийся плеер для Windows (последнее обновление в 2015), встроенная карта которого больше не работает. dashcamigo — живая кросс-платформенная альтернатива в браузере.",
                h1: "Бесплатная альтернатива RegistratorViewer, которую ещё обновляют — и с работающей картой",
                lead: "RegistratorViewer (он же DATAKAM Player) был одним из лучших бесплатных плееров для видеорегистраторов своего времени. Но он много лет не обновляется, ориентирован на Windows, а встроенная карта Google перестала работать после закрытия бесплатного доступа к Maps API без ключа. dashcamigo продолжает эту идею: современный плеер в браузере с синхронной картой GPS и графиком скорости и перегрузок. Карте не нужен API-ключ, поэтому истекать нечему.",
                cardHint: "Бесплатный, но не обновляется с 2015 — и встроенная карта больше не работает",
                whatItIs:
                    "RegistratorViewer (в варианте DATAKAM Player для камер DATAKAM) — бесплатный плеер для Windows, опережавший своё время: склейка и нарезка без перекодирования, непрерывное воспроизведение через границы файлов, GPS-трек с графиками скорости и G-сенсора, захват кадра с GPS в EXIF и экспорт трека в GPX, KML и SRT. Многие записи он открывает до сих пор. Проблема в долговечности: разработка остановилась в 2015-м, оригинальный сайт исчез, а встроенная карта Google сломалась, когда Google закрыл доступ к Maps API без ключа — оживить её теперь можно только правкой реестра Windows или неофициальной сборкой сообщества, и официального фикса нет: проект не поддерживается, а исходники так и не открыли.",
                comparisonIntro:
                    "RegistratorViewer застыл в 2015 году. Вот как dashcamigo выглядит на том, что состарилось хуже всего — и на том, где они просто наравне.",
                compareRows: [
                    { dimension: "Цена", us: { mark: "yes", note: "Бесплатно" }, them: { mark: "yes", note: "Бесплатно" } },
                    {
                        dimension: "Работает на Mac, Linux и мобильном",
                        us: { mark: "yes", note: "Любой современный браузер" },
                        them: { mark: "no", note: "Сначала Windows (есть отдельная урезанная Mac-сборка)" },
                    },
                    {
                        dimension: "Всё ещё поддерживается",
                        us: { mark: "yes", note: "Активно развивается" },
                        them: { mark: "no", note: "Без обновлений с 2015 года" },
                    },
                    {
                        dimension: "Встроенная карта",
                        us: { mark: "yes", note: "Живая, без ключей — истекать нечему" },
                        them: { mark: "no", note: "Перестала работать после смены API у Google; нужен ручной фикс" },
                    },
                    {
                        dimension: "График скорости и перегрузок",
                        us: { mark: "yes", note: "Да" },
                        them: { mark: "yes", note: "Да" },
                    },
                    {
                        dimension: "Обрезка и экспорт",
                        us: { mark: "yes", note: "Обрезка + MP4 с GPS и отдельный .gpx" },
                        them: { mark: "yes", note: "Нарезка без потерь + GPX/KML/SRT" },
                    },
                    {
                        dimension: "Ничего не нужно ставить",
                        us: { mark: "yes", note: "Открывается в браузере" },
                        them: { mark: "partial", note: "Портативный .exe, без установки" },
                    },
                ],
                whenStayTitle: "Когда RegistratorViewer всё ещё стоит держать под рукой",
                whenStay:
                    "RegistratorViewer поддерживает длинный список старых и малоизвестных камер, которые dashcamigo пока не разбирает, умеет склеивать всю папку клипов в один файл без перекодирования, чинит битые записи и работает полностью офлайн как десктоп-программа. Если ты на Windows, твоя камера есть в его списке совместимости и карта у тебя уже заведена — это всё ещё дельный инструмент. А если dashcamigo пока не читает твою камеру — пришли сэмпл на feedback@dashcamigo.app: мы добавляем форматы по реальным записям и хотим, чтобы он поддерживал любой регистратор.",
                ctaPrimary: "Открыть свои записи",
                faq: [
                    {
                        q: "dashcamigo — это полноценная замена RegistratorViewer?",
                        a: "Для основной задачи — открыть записи с картой GPS и графиком скорости и перегрузок, а затем вырезать фрагмент — да. Всё работает в любом современном браузере без установки. RegistratorViewer поддерживает больше старых устройств и умеет несколько особых вещей, например склеивать много файлов без потерь и восстанавливать повреждённые записи. dashcamigo делает ставку на современный плеер для разных платформ с исправно работающей картой.",
                    },
                    {
                        q: "Почему у RegistratorViewer перестала работать карта?",
                        a: "Встроенная карта маршрута рисовала Google Maps через вшитый движок Internet Explorer. Когда Google закрыл бесплатный доступ к Maps API без ключа, карта начала падать, а сайт, хостивший часть скрипта карты, ушёл в офлайн. Проект не поддерживается, исходники не открыли — официального фикса нет, только ручная правка реестра или неофициальные сборки. dashcamigo обходит проблему целиком: его карта — MapLibre + OpenFreeMap без ключей, так что и истекать нечему.",
                    },
                    {
                        q: "dashcamigo работает на Mac, Linux или телефоне?",
                        a: "Да. Он работает в браузере, поэтому Windows, macOS, Linux и мобильный — всё подходит. RegistratorViewer сначала про Windows; его Mac-сборка — отдельное урезанное приложение, которое раздают в основном через сторонние зеркала.",
                    },
                    {
                        q: "Мои записи куда-то загружаются?",
                        a: "Нет. Браузер читает файлы прямо с твоего устройства. У dashcamigo нет сервера для их загрузки, поэтому записи никуда не уходят. Та же конфиденциальность, что у программы на компьютере, только устанавливать ничего не нужно.",
                    },
                    {
                        q: "dashcamigo бесплатный, как RegistratorViewer?",
                        a: "Да, полностью бесплатный — без аккаунта, без платных тарифов и без ограничений пробной версии.",
                    },
                ],
            },
        },
    },
    {
        slug: "dashcam-viewer",
        displayName: "Dashcam Viewer",
        officialUrl: "https://dashcamviewer.com/",
        locales: {
            en: {
                title: "Dashcam Viewer alternative — free, no install, in your browser | dashcamigo",
                metaDescription:
                    "A free Dashcam Viewer alternative that runs in your browser — no license fee, no install. GPS map, speed chart and a three-camera grid. Nothing uploaded.",
                ogTitle: "Free Dashcam Viewer alternative — in your browser",
                ogDescription:
                    "Dashcam Viewer is a mature paid desktop app. dashcamigo is the free, no-install, in-browser alternative with a keyless map and a three-camera grid.",
                h1: "A free Dashcam Viewer alternative — in your browser, nothing to install",
                lead: "Dashcam Viewer by Earthshine is a polished, cross-brand desktop player — and a paid one, with a tightly limited free tier. dashcamigo does the everyday job for free, in your browser: open the SD card, see the trip on a GPS map with a speed and G-force chart, play front, rear and interior in sync, and trim a clip. No install, no license code, nothing uploaded.",
                cardHint: "Mature paid desktop app; we're the free browser one",
                whatItIs:
                    "Dashcam Viewer (and Dashcam Viewer Plus / Pro) by Earthshine Software is a mature, actively maintained desktop app for Windows and macOS that supports a very wide catalogue of dashcam models. It's a genuinely deep tool — synchronized video, a GPS map, and detailed plots for speed, distance, altitude, satellite count and more, with multi-format GPS export. It's a paid, one-time purchase with a tightly limited free tier; it installs natively and unlocks with a license code emailed after purchase.",
                comparisonIntro:
                    "Dashcam Viewer goes deeper on forensic detail. Here's where a free browser tool has the edge for everyday viewing.",
                compareRows: [
                    {
                        dimension: "Price",
                        us: { mark: "yes", note: "Free" },
                        them: { mark: "no", note: "Paid, one-time license (limited free tier)" },
                    },
                    {
                        dimension: "How you run it",
                        us: { mark: "yes", note: "In the browser — nothing to install" },
                        them: { mark: "no", note: "Install + emailed license code" },
                    },
                    {
                        dimension: "Platforms",
                        us: { mark: "yes", note: "Windows, Mac, Linux, mobile" },
                        them: { mark: "partial", note: "Windows & macOS desktop" },
                    },
                    {
                        dimension: "GPS map",
                        us: { mark: "yes", note: "Keyless — no API key to expire" },
                        them: { mark: "partial", note: "Online provider; Google Maps dropped, MapQuest default" },
                    },
                    {
                        dimension: "Cameras at once",
                        us: { mark: "yes", note: "Three-camera grid (front/rear/interior)" },
                        them: { mark: "partial", note: "Up to two cameras" },
                    },
                    {
                        dimension: "Cameras supported",
                        us: { mark: "partial", note: "70mai, Viofo, BlackVue, GoPro, Garmin, Vantrue, Thinkware + more" },
                        them: { mark: "yes", note: "Very wide catalogue" },
                    },
                    {
                        dimension: "Trim & export with GPS",
                        us: { mark: "yes", note: "Yes" },
                        them: { mark: "yes", note: "Yes" },
                    },
                    {
                        dimension: "Nothing uploaded",
                        us: { mark: "yes", note: "Local-only" },
                        them: { mark: "yes", note: "Local-only" },
                    },
                ],
                whenStayTitle: "When Dashcam Viewer is the better buy",
                whenStay:
                    "If you want the widest camera coverage, deep forensic detail — altitude, satellite count, HDOP, reverse-geocoded geotags — or a dedicated desktop app you can run offline without a browser, Dashcam Viewer earns its price. It's actively maintained and supports many brands dashcamigo doesn't yet. dashcamigo aims at the common case: free, instant, in the browser.",
                ctaPrimary: "Open your recordings",
                faq: [
                    {
                        q: "Is dashcamigo really free? What's the catch?",
                        a: "It's free with no paid tier and no account — there's no catch. Your browser reads the files directly from your device, and dashcamigo has no server to upload them to. We don't sell your footage or your data.",
                    },
                    {
                        q: "Can dashcamigo open the same cameras as Dashcam Viewer?",
                        a: "For many popular brands — 70mai, Viofo, BlackVue, GoPro, Garmin, Vantrue, Thinkware and more — yes. Dashcam Viewer supports a wider catalogue. If your camera writes standard MP4, MOV or MPEG-TS with embedded GPS, there's a good chance it just works; the supported-cameras page lists what's covered. If dashcamigo doesn't read your camera yet, send a sample to feedback@dashcamigo.app — we add formats from real recordings.",
                    },
                    {
                        q: "Does dashcamigo's map have the problem Dashcam Viewer had with Google Maps?",
                        a: "No. Dashcam Viewer had to drop Google Maps when Google changed its Maps API (it now defaults to MapQuest, with OpenStreetMap on the Pro tier). dashcamigo uses keyless MapLibre + OpenFreeMap, so there's no provider key to expire — the map just works.",
                    },
                    {
                        q: "Can it show front and rear (and interior) at the same time?",
                        a: "Yes — dashcamigo plays three cameras in a synchronized grid. Dashcam Viewer displays up to two cameras at once across all of its tiers.",
                    },
                    {
                        q: "Do I need to install anything or buy a license?",
                        a: "Neither. Open dashcamigo.app, drop your SD-card folder, and your trips appear. No installer, no license code, no PayPal.",
                    },
                ],
            },
            ru: {
                title: "Альтернатива Dashcam Viewer — бесплатно, без установки, в браузере | dashcamigo",
                metaDescription:
                    "Бесплатная альтернатива Dashcam Viewer в браузере — без лицензии и установки. Карта GPS, график скорости и сетка из трёх камер. Ничего не загружается.",
                ogTitle: "Бесплатная альтернатива Dashcam Viewer — в браузере",
                ogDescription:
                    "Dashcam Viewer — зрелая платная программа для компьютера. dashcamigo — бесплатная альтернатива в браузере без установки, с картой без ключей и сеткой из трёх камер.",
                h1: "Бесплатная альтернатива Dashcam Viewer — в браузере, без установки",
                lead: "Dashcam Viewer от Earthshine — хорошо сделанный платный плеер для компьютера, который поддерживает разные марки видеорегистраторов. Бесплатный режим сильно ограничен. dashcamigo решает повседневную задачу бесплатно и в браузере: открой SD-карту, посмотри поездку на карте GPS с графиком скорости и перегрузок, синхронно включи переднюю, заднюю и салонную камеры и вырежи нужный фрагмент. Без установки, лицензионного ключа и загрузки файлов на сервер.",
                cardHint: "Зрелое платное приложение; мы — бесплатно в браузере",
                whatItIs:
                    "Dashcam Viewer (и версии Plus / Pro) от Earthshine Software — зрелое, активно поддерживаемое десктопное приложение для Windows и macOS с очень широким каталогом моделей регистраторов. Это реально глубокий инструмент — синхронное видео, карта GPS и подробные графики скорости, дистанции, высоты, числа спутников и не только, плюс экспорт GPS в нескольких форматах. Покупка платная и разовая, с жёстко урезанным бесплатным режимом; ставится нативно и активируется ключом, который присылают на почту после покупки.",
                comparisonIntro:
                    "Dashcam Viewer глубже в криминалистических деталях. Вот где у бесплатного браузерного инструмента преимущество для повседневного просмотра.",
                compareRows: [
                    {
                        dimension: "Цена",
                        us: { mark: "yes", note: "Бесплатно" },
                        them: { mark: "no", note: "Платно, разовая лицензия (урезанный бесплатный режим)" },
                    },
                    {
                        dimension: "Как запускается",
                        us: { mark: "yes", note: "В браузере — ставить ничего не надо" },
                        them: { mark: "no", note: "Установка + ключ по почте" },
                    },
                    {
                        dimension: "Платформы",
                        us: { mark: "yes", note: "Windows, Mac, Linux, мобильный" },
                        them: { mark: "partial", note: "Десктоп Windows и macOS" },
                    },
                    {
                        dimension: "Карта GPS",
                        us: { mark: "yes", note: "Без ключей — истекать нечему" },
                        them: { mark: "partial", note: "Онлайн-провайдер; Google Maps убрали, по умолчанию MapQuest" },
                    },
                    {
                        dimension: "Камер одновременно",
                        us: { mark: "yes", note: "Три камеры в сетке (передняя, задняя и салонная)" },
                        them: { mark: "partial", note: "До двух камер" },
                    },
                    {
                        dimension: "Поддержка камер",
                        us: { mark: "partial", note: "70mai, Viofo, BlackVue, GoPro, Garmin, Vantrue, Thinkware и другие" },
                        them: { mark: "yes", note: "Очень широкий каталог" },
                    },
                    {
                        dimension: "Обрезка и экспорт с GPS",
                        us: { mark: "yes", note: "Да" },
                        them: { mark: "yes", note: "Да" },
                    },
                    {
                        dimension: "Ничего не загружается",
                        us: { mark: "yes", note: "Только локально" },
                        them: { mark: "yes", note: "Только локально" },
                    },
                ],
                whenStayTitle: "Когда Dashcam Viewer — лучшая покупка",
                whenStay:
                    "Если нужен самый широкий охват камер, глубокая криминалистика — высота, число спутников, HDOP, геометки с обратным геокодингом — или отдельное десктоп-приложение, которое работает офлайн без браузера, Dashcam Viewer отрабатывает свою цену. Его активно поддерживают, и он берёт много брендов, которых у dashcamigo пока нет. dashcamigo целится в массовый случай: бесплатно, сразу, в браузере.",
                ctaPrimary: "Открыть свои записи",
                faq: [
                    {
                        q: "dashcamigo правда бесплатный? В чём подвох?",
                        a: "Он бесплатный, без платных тарифов и аккаунта — подвоха нет. Браузер читает файлы прямо с твоего устройства, а у dashcamigo нет сервера для их загрузки. Мы не продаём твои записи и данные.",
                    },
                    {
                        q: "dashcamigo открывает те же камеры, что и Dashcam Viewer?",
                        a: "Для многих популярных брендов — 70mai, Viofo, BlackVue, GoPro, Garmin, Vantrue, Thinkware и других — да. У Dashcam Viewer каталог шире. Если твоя камера пишет стандартный MP4, MOV или MPEG-TS со встроенным GPS, есть хороший шанс, что всё заведётся; что поддерживается — смотри на странице камер. А если dashcamigo пока не читает твою камеру — пришли сэмпл на feedback@dashcamigo.app: мы добавляем форматы по реальным записям.",
                    },
                    {
                        q: "У карты dashcamigo есть та же проблема, что была у Dashcam Viewer с Google Maps?",
                        a: "Нет. Dashcam Viewer пришлось убрать Google Maps, когда Google поменял свой Maps API (теперь по умолчанию MapQuest, а OpenStreetMap — на тарифе Pro). dashcamigo использует MapLibre + OpenFreeMap без ключей, так что истекать нечему — карта просто работает.",
                    },
                    {
                        q: "Он покажет фронт и тыл (и салон) одновременно?",
                        a: "Да — dashcamigo синхронно показывает три камеры в одной сетке. Dashcam Viewer показывает до двух камер одновременно на всех тарифах.",
                    },
                    {
                        q: "Нужно что-то ставить или покупать лицензию?",
                        a: "Ни то ни другое. Открой dashcamigo.app, перетащи папку с SD-карты — поездки появятся. Без установщика, без ключа, без PayPal.",
                    },
                ],
            },
        },
    },
    {
        slug: "vlc",
        displayName: "VLC",
        officialUrl: "https://www.videolan.org/vlc/",
        locales: {
            en: {
                title: "View dashcam GPS that VLC can't show — free, in your browser | dashcamigo",
                metaDescription:
                    "VLC plays dashcam video but shows no GPS, speed or map. dashcamigo adds the GPS map, speed and G-force chart, plus a synchronized multi-camera view — free, in your browser.",
                ogTitle: "Dashcam GPS map for footage VLC can't read",
                ogDescription:
                    "VLC is a great universal player, but it has no dashcam GPS, map or speed overlay. dashcamigo reads the telemetry and shows it — free, in the browser.",
                h1: "VLC plays the video — dashcamigo adds the GPS map VLC can't show",
                lead: "VLC will happily open any dashcam file, but it stops at the picture: no GPS map, no speed or G-force, no front/rear sync. That telemetry is sitting inside your recordings — dashcamigo reads it and draws a live map and chart alongside the video, free and in your browser. Keep VLC for everything else; use dashcamigo when the footage needs its GPS.",
                cardHint: "A great universal player — but it shows no dashcam GPS",
                whatItIs:
                    "VLC, by the non-profit VideoLAN, is the universal media player — free, open-source, and able to play practically any video on practically any operating system, phones included. For dashcam clips that makes it a reliable way to just watch the picture. What it deliberately doesn't do is understand dashcam telemetry: it has no GPS map, no speed or G-force readout, it doesn't sync multiple cameras, and it won't group a card full of clips into a trip. The only way to get a location or speed stamp \"through\" VLC is to generate an external subtitle file with another tool first — a flat text overlay, not an interactive map.",
                comparisonIntro:
                    "VLC and dashcamigo aren't really rivals — VLC plays the video, dashcamigo adds the dashcam layer on top. Here's the split.",
                compareRows: [
                    {
                        dimension: "Plays the video",
                        us: { mark: "yes", note: "Yes" },
                        them: { mark: "yes", note: "Plays virtually any format" },
                    },
                    {
                        dimension: "GPS route on a map",
                        us: { mark: "yes", note: "Live, synchronized" },
                        them: { mark: "no", note: "No map" },
                    },
                    {
                        dimension: "Speed & G-force chart",
                        us: { mark: "yes", note: "Yes" },
                        them: { mark: "no", note: "No" },
                    },
                    {
                        dimension: "Reads embedded dashcam GPS",
                        us: { mark: "yes", note: "Automatically" },
                        them: { mark: "no", note: "Only via an external subtitle from another tool" },
                    },
                    {
                        dimension: "Front/rear/interior in sync",
                        us: { mark: "yes", note: "Three-camera grid" },
                        them: { mark: "no", note: "One stream at a time" },
                    },
                    {
                        dimension: "Groups clips into trips",
                        us: { mark: "yes", note: "Yes" },
                        them: { mark: "no", note: "Playlist only" },
                    },
                    {
                        dimension: "Trim & export a clip with GPS",
                        us: { mark: "yes", note: "Yes" },
                        them: { mark: "no", note: "No telemetry export" },
                    },
                    {
                        dimension: "Price",
                        us: { mark: "yes", note: "Free & open-source" },
                        them: { mark: "yes", note: "Free & open-source" },
                    },
                ],
                whenStayTitle: "Keep using VLC for",
                whenStay:
                    "VLC is the better tool whenever you just need to play a file: it's open-source, runs on every OS, and opens formats and codecs nothing else will. dashcamigo doesn't try to replace it as a general player — it's the dashcam-aware companion that reads the GPS, speed and G-force VLC ignores. Plenty of people use both: VLC to glance at a clip, dashcamigo to review a whole trip with its map.",
                ctaPrimary: "Open your recordings",
                faq: [
                    {
                        q: "Can VLC show my dashcam's GPS, speed or route?",
                        a: "No. VLC plays the video but has no built-in GPS map, speed gauge or telemetry overlay. The only workaround is to create a subtitle (.srt) file with separate software and overlay it as text — there's no interactive map. dashcamigo reads the embedded GPS directly and shows a live map and a speed/G-force chart synced to playback.",
                    },
                    {
                        q: "Do I have to stop using VLC?",
                        a: "Not at all — they do different jobs. VLC is the best universal player; dashcamigo is the dashcam-aware viewer. Use VLC for general playback and dashcamigo when you want the route, speed and synchronized cameras.",
                    },
                    {
                        q: "Is dashcamigo free and private like VLC?",
                        a: "Yes. dashcamigo is free, needs no account and is open-source under the AGPL-3.0. Your browser reads files directly from your device; there is no server to upload them to. VLC is also free, open-source and local, so they're equal on those points.",
                    },
                    {
                        q: "Which dashcams does dashcamigo read GPS from?",
                        a: "70mai, Viofo, BlackVue, GoPro, Garmin, Vantrue, Thinkware and more — anything that writes its GPS into the MP4, MOV or MPEG-TS in a format dashcamigo recognizes. VLC is brand-agnostic for playback but reads none of this telemetry.",
                    },
                    {
                        q: "Does it work in my browser without installing anything?",
                        a: "Yes — open dashcamigo.app and drop your SD-card folder. Nothing to install. VLC, by contrast, is an app you install (though it runs on nearly every platform).",
                    },
                ],
            },
            ru: {
                title: "Покажи GPS с регистратора, который не видит VLC — бесплатно, в браузере | dashcamigo",
                metaDescription:
                    "VLC проигрывает видео с регистратора, но не показывает GPS, скорость и карту. dashcamigo добавляет карту GPS, график скорости и перегрузок, а также синхронный просмотр нескольких камер — бесплатно и прямо в браузере.",
                ogTitle: "Карта GPS для записей, которые VLC не читает",
                ogDescription:
                    "VLC — отличный универсальный плеер, но в нём нет GPS, карты и оверлея скорости регистратора. dashcamigo читает телеметрию и показывает её — бесплатно, в браузере.",
                h1: "VLC проигрывает видео — dashcamigo добавляет карту GPS, которую VLC не покажет",
                lead: "VLC спокойно откроет любой файл с регистратора, но дальше картинки не идёт: ни карты GPS, ни скорости с G, ни синхронного фронта и тыла. А эта телеметрия лежит прямо внутри записей — dashcamigo читает её и рисует живую карту и график рядом с видео, бесплатно и в браузере. Оставь VLC для всего остального; включай dashcamigo, когда записи нужны вместе с их GPS.",
                cardHint: "Отличный универсальный плеер — но GPS регистратора не показывает",
                whatItIs:
                    "VLC от некоммерческой VideoLAN — универсальный медиаплеер: бесплатный, с открытым кодом, играет почти любое видео почти на любой системе, включая телефоны. Для клипов с регистратора это надёжный способ просто посмотреть картинку. Но телеметрию регистратора он не понимает: не показывает карту GPS, скорость и перегрузки, не синхронизирует несколько камер и не собирает папку клипов в одну поездку. Единственный способ добавить отметку координат или скорости через VLC — сначала создать внешний файл субтитров в другой программе. Это будет обычный текст поверх видео, а не интерактивная карта.",
                comparisonIntro:
                    "VLC и dashcamigo — не совсем соперники: VLC проигрывает видео, а dashcamigo добавляет сверху слой регистратора. Вот как делятся роли.",
                compareRows: [
                    {
                        dimension: "Проигрывает видео",
                        us: { mark: "yes", note: "Да" },
                        them: { mark: "yes", note: "Играет почти любой формат" },
                    },
                    {
                        dimension: "Маршрут GPS на карте",
                        us: { mark: "yes", note: "Живой, синхронно" },
                        them: { mark: "no", note: "Карты нет" },
                    },
                    {
                        dimension: "График скорости и перегрузок",
                        us: { mark: "yes", note: "Да" },
                        them: { mark: "no", note: "Нет" },
                    },
                    {
                        dimension: "Читает встроенный GPS регистратора",
                        us: { mark: "yes", note: "Автоматически" },
                        them: { mark: "no", note: "Только через внешние субтитры из другой программы" },
                    },
                    {
                        dimension: "Фронт/тыл/салон синхронно",
                        us: { mark: "yes", note: "Сетка из трёх камер" },
                        them: { mark: "no", note: "По одному потоку за раз" },
                    },
                    {
                        dimension: "Собирает клипы в поездки",
                        us: { mark: "yes", note: "Да" },
                        them: { mark: "no", note: "Только плейлист" },
                    },
                    {
                        dimension: "Обрезать и сохранить кусок с GPS",
                        us: { mark: "yes", note: "Да" },
                        them: { mark: "no", note: "Экспорт телеметрии не умеет" },
                    },
                    {
                        dimension: "Цена",
                        us: { mark: "yes", note: "Бесплатно и open-source" },
                        them: { mark: "yes", note: "Бесплатно и open-source" },
                    },
                ],
                whenStayTitle: "Оставь VLC для",
                whenStay:
                    "VLC лучше всегда, когда нужно просто проиграть файл: он с открытым кодом, работает на любой ОС и открывает форматы и кодеки, которые не возьмёт больше никто. dashcamigo не пытается заменить его как универсальный плеер — это дополнение, заточенное под регистратор, которое читает GPS, скорость и G, игнорируемые VLC. Многие пользуются обоими: VLC — глянуть клип, dashcamigo — разобрать всю поездку с картой.",
                ctaPrimary: "Открыть свои записи",
                faq: [
                    {
                        q: "VLC может показать GPS, скорость или маршрут с моего регистратора?",
                        a: "Нет. VLC проигрывает видео, но в нём нет встроенной карты GPS, спидометра или оверлея телеметрии. Единственный обходной путь — создать файл субтитров (.srt) отдельной программой и наложить его как текст; интерактивной карты не будет. dashcamigo читает встроенный GPS напрямую и показывает живую карту и график скорости/G синхронно с воспроизведением.",
                    },
                    {
                        q: "Мне придётся отказаться от VLC?",
                        a: "Вовсе нет — у них разные задачи. VLC — отличный универсальный плеер, а dashcamigo понимает записи видеорегистраторов. Используй VLC для обычного воспроизведения, а dashcamigo — когда нужны маршрут, скорость и несколько камер в синхронизации.",
                    },
                    {
                        q: "dashcamigo бесплатный и приватный, как VLC?",
                        a: "Да. dashcamigo бесплатный, не требует аккаунта и распространяется с открытым кодом по лицензии AGPL-3.0. Браузер читает файлы прямо с твоего устройства, а сервера для их загрузки нет. VLC тоже бесплатный, открытый и работает локально — в этом они наравне.",
                    },
                    {
                        q: "С каких регистраторов dashcamigo читает GPS?",
                        a: "70mai, Viofo, BlackVue, GoPro, Garmin, Vantrue, Thinkware и другие — всё, что пишет GPS внутрь MP4, MOV или MPEG-TS в формате, который dashcamigo распознаёт. VLC безразличен к бренду при воспроизведении, но этой телеметрии не читает вовсе.",
                    },
                    {
                        q: "Он работает в браузере без установки?",
                        a: "Да — открой dashcamigo.app и перетащи папку с SD-карты. Ставить ничего не надо. VLC, наоборот, — это приложение, которое надо установить (хотя оно работает почти на любой платформе).",
                    },
                ],
            },
        },
    },
    {
        slug: "navitel-dvr-player",
        displayName: "Navitel DVR Player",
        officialUrl: "https://navitel.com/en/downloads/navitel-dvr-player",
        locales: {
            en: {
                title: "Navitel DVR Player alternative — free, cross-platform, in your browser | dashcamigo",
                metaDescription:
                    "A free, cross-platform Navitel DVR Player alternative in your browser — Windows, Mac, Linux, mobile. Reads Navitel and many other dashcams, GPS map, no install.",
                ogTitle: "Free Navitel DVR Player alternative — in your browser",
                ogDescription:
                    "Navitel DVR Player is a free, Windows-only player built for Navitel cameras. dashcamigo is the cross-platform, in-browser alternative that reads many brands.",
                h1: "A free, cross-platform Navitel DVR Player alternative — in your browser",
                lead: "Navitel DVR Player is Navitel's own free desktop player — and a genuinely capable one, with a GPS map, speed and altitude graphs and multi-format track export. The catch is that it's Windows-only and built around Navitel's own cameras. dashcamigo does the everyday job in your browser on any device: open the SD card, see the trip on a keyless GPS map with a speed and G-force chart, play front, rear and interior in sync, and trim a clip — for Navitel cameras and many other brands alike. Nothing to install.",
                cardHint: "Free official player — but Windows-only and Navitel-first",
                whatItIs:
                    "Navitel DVR Player, by Navitel, is a free Windows desktop app for owners of Navitel dashcams. It's a solid tool: it plays MOV, AVI, MP4 and TS recordings, shows the route on a map with speed and altitude graphs, lets you click a point on the map to jump the video there, sorts recordings into rides, parking and events, cuts and saves fragments, exports the GPS track in five formats — NMEA, KML, CSV, GPX and PLT — and can even check firmware updates for Navitel cameras. Two honest limits for everyone else: it's Windows-only, and Navitel says it can't guarantee every feature works with non-Navitel recorders — its GPS map needs the camera's separate .NMEA track files copied alongside the video.",
                comparisonIntro:
                    "Both are free, and for a Navitel camera the official player goes deep. Here's where an in-browser, multi-vendor tool has the edge.",
                compareRows: [
                    { dimension: "Price", us: { mark: "yes", note: "Free" }, them: { mark: "yes", note: "Free" } },
                    {
                        dimension: "Runs on Mac, Linux & mobile",
                        us: { mark: "yes", note: "Any modern browser" },
                        them: { mark: "no", note: "Windows-only" },
                    },
                    {
                        dimension: "Nothing to install",
                        us: { mark: "yes", note: "Opens in the browser" },
                        them: { mark: "no", note: "Desktop install (Windows)" },
                    },
                    {
                        dimension: "Cameras it reads",
                        us: { mark: "yes", note: "Navitel, 70mai, Viofo, BlackVue, GoPro, Garmin, Vantrue, Thinkware + more" },
                        them: { mark: "partial", note: "Navitel-first; other brands not guaranteed" },
                    },
                    {
                        dimension: "Front/rear/interior at once",
                        us: { mark: "yes", note: "Three-camera grid" },
                        them: { mark: "partial", note: "Front + rear" },
                    },
                    {
                        dimension: "GPS track export formats",
                        us: { mark: "partial", note: "GPX + MP4 with GPS inside" },
                        them: { mark: "yes", note: "NMEA, KML, CSV, GPX, PLT" },
                    },
                    {
                        dimension: "Built-in map",
                        us: { mark: "yes", note: "Live, keyless — no API key to expire" },
                        them: { mark: "yes", note: "Built-in route map" },
                    },
                ],
                whenStayTitle: "When Navitel DVR Player is the better pick",
                whenStay:
                    "If you own a Navitel dashcam, the maker's own player is purpose-built for it: it checks and installs firmware updates for Navitel models, exports your track in five formats (NMEA, KML, CSV, GPX, PLT), shows speed and altitude graphs, and runs fully offline as a desktop app. dashcamigo reads Navitel GPS too — alongside 70mai, Viofo, BlackVue, GoPro, Garmin, Vantrue, Thinkware and more — but for a Navitel-only setup, the official tool goes deepest. And if dashcamigo doesn't read your camera yet, send a sample to feedback@dashcamigo.app — we add formats from real recordings.",
                ctaPrimary: "Open your recordings",
                faq: [
                    {
                        q: "Is dashcamigo a replacement for Navitel DVR Player?",
                        a: "For the everyday job — opening a trip with a GPS map, a speed and G-force chart, synchronized cameras and clip trimming — yes, free and in any browser, and it reads Navitel GPS too. For a Navitel-branded camera specifically, the official player goes deeper (firmware updates, five-format track export), so plenty of Navitel owners keep both.",
                    },
                    {
                        q: "Does dashcamigo read the GPS from my Navitel dashcam?",
                        a: "Yes — Navitel is among the supported formats. Drop the whole SD-card folder and it reads the track and draws it on the map, the same as it does for 70mai, Viofo, BlackVue, GoPro, Garmin, Vantrue, Thinkware and others.",
                    },
                    {
                        q: "Does dashcamigo work on Mac, Linux or my phone?",
                        a: "Yes. It runs in the browser, so Windows, macOS, Linux and mobile all work. Navitel DVR Player is Windows-only.",
                    },
                    {
                        q: "Do I need to install it or copy special files?",
                        a: "No install — open dashcamigo.app and drop the whole SD-card folder; it finds the video and the GPS automatically. Navitel DVR Player is a desktop app you install, and for the map it wants the video plus its separate .NMEA track file copied across.",
                    },
                    {
                        q: "Is dashcamigo free and private like Navitel DVR Player?",
                        a: "Yes — it's free and needs no account. Your browser reads files directly from your device, and there is no server to upload them to. Both tools are free; dashcamigo also skips the install.",
                    },
                ],
            },
            ru: {
                title: "Альтернатива Navitel DVR Player — бесплатно, кросс-платформенно, в браузере | dashcamigo",
                metaDescription:
                    "Бесплатная кросс-платформенная альтернатива Navitel DVR Player в браузере — Windows, Mac, Linux, мобильный. Читает Navitel и многие другие регистраторы, карта GPS, без установки.",
                ogTitle: "Бесплатная альтернатива Navitel DVR Player — в браузере",
                ogDescription:
                    "Navitel DVR Player — бесплатный плеер только под Windows, сделанный под камеры Navitel. dashcamigo — кросс-платформенная альтернатива в браузере, читающая много брендов.",
                h1: "Бесплатная кросс-платформенная альтернатива Navitel DVR Player — в браузере",
                lead: "Navitel DVR Player — хороший бесплатный плеер Navitel для компьютера: в нём есть карта GPS, графики скорости и высоты, а также экспорт маршрута в нескольких форматах. Но он работает только в Windows и рассчитан на камеры Navitel. dashcamigo решает повседневную задачу в браузере на любом устройстве: открой SD-карту, посмотри поездку на карте GPS с графиком скорости и перегрузок, синхронно включи переднюю, заднюю и салонную камеры и вырежи нужный фрагмент. Работает с Navitel и многими другими марками, устанавливать ничего не нужно.",
                cardHint: "Бесплатный официальный плеер — но только Windows и под Navitel",
                whatItIs:
                    "Navitel DVR Player от Navitel — бесплатное десктопное приложение для Windows для владельцев регистраторов Navitel. Инструмент крепкий: проигрывает записи MOV, AVI, MP4 и TS, показывает маршрут на карте с графиками скорости и высоты, по клику на точку маршрута перематывает видео к этому моменту, раскладывает записи на поездки, стоянки и события, режет и сохраняет фрагменты, экспортирует GPS-трек в пяти форматах — NMEA, KML, CSV, GPX и PLT — и умеет проверять прошивки камер Navitel. Два честных ограничения для всех остальных: он только под Windows, и Navitel сама пишет, что не гарантирует работу всех функций с чужими регистраторами — а его карте GPS нужны отдельные .NMEA-файлы трека, скопированные рядом с видео.",
                comparisonIntro:
                    "Оба бесплатны, и для камеры Navitel официальный плеер копает глубоко. Вот где у браузерного мультивендорного инструмента преимущество.",
                compareRows: [
                    { dimension: "Цена", us: { mark: "yes", note: "Бесплатно" }, them: { mark: "yes", note: "Бесплатно" } },
                    {
                        dimension: "Работает на Mac, Linux и мобильном",
                        us: { mark: "yes", note: "Любой современный браузер" },
                        them: { mark: "no", note: "Только Windows" },
                    },
                    {
                        dimension: "Ничего не нужно ставить",
                        us: { mark: "yes", note: "Открывается в браузере" },
                        them: { mark: "no", note: "Установка на десктоп (Windows)" },
                    },
                    {
                        dimension: "Какие камеры читает",
                        us: { mark: "yes", note: "Navitel, 70mai, Viofo, BlackVue, GoPro, Garmin, Vantrue, Thinkware и другие" },
                        them: { mark: "partial", note: "Сначала Navitel; чужие бренды без гарантии" },
                    },
                    {
                        dimension: "Фронт/тыл/салон одновременно",
                        us: { mark: "yes", note: "Сетка из трёх камер" },
                        them: { mark: "partial", note: "Фронт + тыл" },
                    },
                    {
                        dimension: "Форматы экспорта GPS-трека",
                        us: { mark: "partial", note: "GPX + MP4 с GPS внутри" },
                        them: { mark: "yes", note: "NMEA, KML, CSV, GPX, PLT" },
                    },
                    {
                        dimension: "Встроенная карта",
                        us: { mark: "yes", note: "Живая, без ключей — истекать нечему" },
                        them: { mark: "yes", note: "Встроенная карта маршрута" },
                    },
                ],
                whenStayTitle: "Когда Navitel DVR Player — лучший выбор",
                whenStay:
                    "Если у тебя камера Navitel, её родной плеер заточен именно под неё: проверяет и ставит прошивки для моделей Navitel, экспортирует трек в пяти форматах (NMEA, KML, CSV, GPX, PLT), показывает графики скорости и высоты и работает полностью офлайн как десктоп-программа. dashcamigo тоже читает GPS Navitel — наравне с 70mai, Viofo, BlackVue, GoPro, Garmin, Vantrue, Thinkware и другими — но для связки только из Navitel официальный инструмент копает глубже. А если dashcamigo пока не читает твою камеру — пришли сэмпл на feedback@dashcamigo.app: мы добавляем форматы по реальным записям.",
                ctaPrimary: "Открыть свои записи",
                faq: [
                    {
                        q: "dashcamigo — замена Navitel DVR Player?",
                        a: "Для повседневной задачи — открыть поездку с картой GPS, графиком скорости и перегрузок, синхронно посмотреть несколько камер и вырезать фрагмент — да. Всё бесплатно и работает в любом браузере, включая GPS из записей Navitel. Для камер Navitel официальный плеер умеет больше специальных вещей — например, обновлять прошивку и экспортировать маршрут в пяти форматах, — поэтому многие владельцы используют обе программы.",
                    },
                    {
                        q: "dashcamigo читает GPS с моей камеры Navitel?",
                        a: "Да — Navitel есть среди поддерживаемых форматов. Перетащи всю папку с SD-карты, и он прочитает трек и нарисует его на карте — так же, как для 70mai, Viofo, BlackVue, GoPro, Garmin, Vantrue, Thinkware и других.",
                    },
                    {
                        q: "dashcamigo работает на Mac, Linux или телефоне?",
                        a: "Да. Он работает в браузере, поэтому Windows, macOS, Linux и мобильный — всё подходит. Navitel DVR Player только под Windows.",
                    },
                    {
                        q: "Нужно его ставить или копировать особые файлы?",
                        a: "Без установки — открой dashcamigo.app и перетащи всю папку с SD-карты; он сам найдёт видео и GPS. Navitel DVR Player — это десктоп-приложение, которое надо установить, и для карты ему нужно скопировать видео вместе с отдельным .NMEA-файлом трека.",
                    },
                    {
                        q: "dashcamigo бесплатный и приватный, как Navitel DVR Player?",
                        a: "Да — он бесплатный и не требует аккаунта. Браузер читает файлы прямо с твоего устройства, а сервера для их загрузки нет. Обе программы бесплатны; dashcamigo вдобавок не нужно устанавливать.",
                    },
                ],
            },
        },
    },
    {
        slug: "camgeoplayer",
        displayName: "CamGeoPlayer",
        officialUrl: "https://yash.info/camgeoplayer/",
        locales: {
            en: {
                title: "CamGeoPlayer alternative — free, no download, in your browser | dashcamigo",
                metaDescription:
                    "A free CamGeoPlayer alternative that runs in your browser — no big download, no .NET. GPS map, speed chart, synchronized cameras and clip export. Nothing to install.",
                ogTitle: "Free CamGeoPlayer alternative — in your browser",
                ogDescription:
                    "CamGeoPlayer is a free indie Windows viewer that shows your dashcam GPS on a map. dashcamigo does that in the browser — plus a speed chart and clip export.",
                h1: "A free CamGeoPlayer alternative — in your browser, and it does more",
                lead: "CamGeoPlayer is a free little Windows app that reads the GPS in your dashcam videos and plots the route on a map — one developer's answer to paid viewers with trial limits. dashcamigo does the same in your browser, with nothing to download, and adds the parts CamGeoPlayer doesn't have: a speed and G-force chart, front/rear/interior in sync, trips grouped automatically, and clip export with the GPS kept inside. Same idea — read your GPS, show it on a map — taken further, and kept up to date.",
                cardHint: "Free indie Windows viewer; still an early beta",
                whatItIs:
                    "CamGeoPlayer is a free Windows app (needs .NET) by an independent developer, built after they found existing GPS viewers paid or clunky. You load a queue of videos and it plays them one after another, reading the GPS embedded in each and drawing the whole journey on an OpenStreetMap map with a marker that moves in sync — it uses ExifTool to pull the GPS and Leaflet for the map. There's no installer: you download a large zip, unzip it and run the .exe (some antivirus tools flag it, which the developer attributes to the browser engine and exiftool bundled inside). It's open about being early — the current build is an early beta, with no newer public release.",
                comparisonIntro:
                    "Both are free and both read your GPS onto a map. Here's what dashcamigo adds — and where it's simpler to run.",
                compareRows: [
                    { dimension: "Price", us: { mark: "yes", note: "Free" }, them: { mark: "yes", note: "Free" } },
                    {
                        dimension: "Runs on Mac, Linux & mobile",
                        us: { mark: "yes", note: "Any modern browser" },
                        them: { mark: "no", note: "Windows-only (needs .NET)" },
                    },
                    {
                        dimension: "Nothing to download or install",
                        us: { mark: "yes", note: "Opens in the browser" },
                        them: { mark: "partial", note: "Large zip, unzip and run" },
                    },
                    {
                        dimension: "Still updated",
                        us: { mark: "yes", note: "Actively developed" },
                        them: { mark: "no", note: "Still an early beta, no newer release" },
                    },
                    {
                        dimension: "GPS route on a map",
                        us: { mark: "yes", note: "Live, synchronized" },
                        them: { mark: "yes", note: "Leaflet + OpenStreetMap" },
                    },
                    {
                        dimension: "Speed & G-force chart",
                        us: { mark: "yes", note: "Yes" },
                        them: { mark: "no", note: "Map only" },
                    },
                    {
                        dimension: "Front/rear/interior in sync",
                        us: { mark: "yes", note: "Three-camera grid" },
                        them: { mark: "no", note: "Plays one video at a time" },
                    },
                    {
                        dimension: "Trim & export a clip with GPS",
                        us: { mark: "yes", note: "Yes" },
                        them: { mark: "no", note: "Viewer only" },
                    },
                ],
                whenStayTitle: "When CamGeoPlayer is a fine choice",
                whenStay:
                    "CamGeoPlayer is a likeable single-purpose tool: free, made by one developer scratching the same itch, and once it's unzipped it runs as a self-contained Windows app, fully offline. If you're on Windows, you just want your video with its route on a map, and you don't mind an app that's still an early beta, it does that one job simply. dashcamigo aims wider — cross-platform and mobile, a speed and G-force chart, synchronized cameras, automatic trip grouping and clip export — and it's actively maintained.",
                ctaPrimary: "Open your recordings",
                faq: [
                    {
                        q: "Is dashcamigo a free alternative to CamGeoPlayer?",
                        a: "Yes — both are free, but dashcamigo runs in any browser with nothing to download (no big zip, no .NET), and it adds a speed and G-force chart, front/rear/interior in sync, automatic trip grouping and clip export on top of the video-and-map view CamGeoPlayer offers.",
                    },
                    {
                        q: "Is CamGeoPlayer still being updated?",
                        a: "It's still an early beta with no newer public release — a free side project by a single developer, who was upfront that it's early software. dashcamigo is actively developed.",
                    },
                    {
                        q: "Will dashcamigo trigger an antivirus warning like CamGeoPlayer?",
                        a: "No. CamGeoPlayer's antivirus flags come from the browser engine and the exiftool program it bundles inside its zip; the developer explains those are the cause and that nothing harmful is happening. dashcamigo is just a web page — nothing to download, nothing to install, nothing to whitelist.",
                    },
                    {
                        q: "Does dashcamigo run on Mac or in the browser?",
                        a: "Yes — any modern browser on Windows, macOS, Linux and mobile. CamGeoPlayer is Windows-only and needs .NET.",
                    },
                    {
                        q: "Does dashcamigo read GPS off the video like CamGeoPlayer?",
                        a: "Yes — it reads the GPS embedded in common dashcam files automatically and draws a live map, then adds a speed and G-force chart synced to playback, a multi-camera view and clip export. CamGeoPlayer reads embedded GPS and shows it on an OpenStreetMap map with a moving marker; dashcamigo takes the same idea further.",
                    },
                ],
            },
            ru: {
                title: "Альтернатива CamGeoPlayer — бесплатно, без скачивания, в браузере | dashcamigo",
                metaDescription:
                    "Бесплатная альтернатива CamGeoPlayer в браузере — без большой загрузки и без .NET. Карта GPS, график скорости, синхронный просмотр камер и экспорт клипа. Ставить ничего не надо.",
                ogTitle: "Бесплатная альтернатива CamGeoPlayer — в браузере",
                ogDescription:
                    "CamGeoPlayer — бесплатный indie-вьюер под Windows, показывающий GPS регистратора на карте. dashcamigo делает это в браузере — плюс график скорости и экспорт клипа.",
                h1: "Бесплатная альтернатива CamGeoPlayer — в браузере, и умеет больше",
                lead: "CamGeoPlayer — небольшая бесплатная программа для Windows, которая читает GPS из видео с регистратора и рисует маршрут на карте. Её создал один разработчик как альтернативу платным плеерам с ограниченными пробными версиями. dashcamigo делает то же прямо в браузере и добавляет график скорости и перегрузок, синхронный просмотр передней, задней и салонной камер, автоматическую группировку записей в поездки и экспорт клипа с GPS внутри. Та же идея, только с большими возможностями и регулярными обновлениями.",
                cardHint: "Бесплатный indie-вьюер под Windows; всё ещё ранняя бета",
                whatItIs:
                    "CamGeoPlayer — бесплатная программа под Windows (нужен .NET) от независимого разработчика, который написал её, когда не нашёл бесплатного и удобного GPS-вьюера. Ты загружаешь очередь видео, и она проигрывает их одно за другим, читая встроенный в каждое GPS и рисуя весь маршрут на карте OpenStreetMap с маркером, который двигается синхронно — GPS она достаёт через ExifTool, а карту рисует на Leaflet. Установщика нет: качаешь большой zip, распаковываешь и запускаешь .exe (некоторые антивирусы на него ругаются, и разработчик объясняет это вшитыми внутрь браузерным движком и программой exiftool). Он честно говорит, что это ранняя версия: текущая сборка — ранняя бета, новее публичных сборок не выходило.",
                comparisonIntro:
                    "Оба бесплатны, и оба читают GPS на карту. Вот что dashcamigo добавляет — и где его проще запустить.",
                compareRows: [
                    { dimension: "Цена", us: { mark: "yes", note: "Бесплатно" }, them: { mark: "yes", note: "Бесплатно" } },
                    {
                        dimension: "Работает на Mac, Linux и мобильном",
                        us: { mark: "yes", note: "Любой современный браузер" },
                        them: { mark: "no", note: "Только Windows (нужен .NET)" },
                    },
                    {
                        dimension: "Ничего не качать и не ставить",
                        us: { mark: "yes", note: "Открывается в браузере" },
                        them: { mark: "partial", note: "Большой zip, распаковать и запустить" },
                    },
                    {
                        dimension: "Всё ещё обновляется",
                        us: { mark: "yes", note: "Активно развивается" },
                        them: { mark: "no", note: "Всё ещё ранняя бета, новее нет" },
                    },
                    {
                        dimension: "Маршрут GPS на карте",
                        us: { mark: "yes", note: "Живой, синхронно" },
                        them: { mark: "yes", note: "Leaflet + OpenStreetMap" },
                    },
                    {
                        dimension: "График скорости и перегрузок",
                        us: { mark: "yes", note: "Да" },
                        them: { mark: "no", note: "Только карта" },
                    },
                    {
                        dimension: "Фронт/тыл/салон синхронно",
                        us: { mark: "yes", note: "Сетка из трёх камер" },
                        them: { mark: "no", note: "Проигрывает по одному видео за раз" },
                    },
                    {
                        dimension: "Обрезать и сохранить кусок с GPS",
                        us: { mark: "yes", note: "Да" },
                        them: { mark: "no", note: "Только просмотр" },
                    },
                ],
                whenStayTitle: "Когда CamGeoPlayer — нормальный выбор",
                whenStay:
                    "CamGeoPlayer — приятный инструмент для одной задачи: он бесплатный, создан одним разработчиком и после распаковки работает как самостоятельная Windows-программа без интернета. Если у тебя Windows, нужен только маршрут рядом с видео и не смущает ранняя бета, программа справляется. dashcamigo умеет больше: работает на разных платформах и телефонах, показывает график скорости и перегрузок, синхронизирует камеры, сам группирует записи в поездки и экспортирует клипы. И его активно поддерживают.",
                ctaPrimary: "Открыть свои записи",
                faq: [
                    {
                        q: "dashcamigo — бесплатная альтернатива CamGeoPlayer?",
                        a: "Да. Обе программы бесплатны, но dashcamigo работает в любом браузере: не нужно скачивать большой архив или устанавливать .NET. Помимо видео и карты, он показывает график скорости и перегрузок, синхронизирует переднюю, заднюю и салонную камеры, сам группирует записи в поездки и экспортирует клипы.",
                    },
                    {
                        q: "CamGeoPlayer ещё обновляют?",
                        a: "Это всё ещё ранняя бета, новее публичных сборок не выходило — бесплатный сайд-проект одного разработчика, который честно предупредил, что это ранний софт. dashcamigo активно развивается.",
                    },
                    {
                        q: "dashcamigo вызовет предупреждение антивируса, как CamGeoPlayer?",
                        a: "Нет. Антивирус ругается на CamGeoPlayer из-за браузерного движка и программы exiftool, вшитых в его zip; разработчик объясняет, что причина в них и ничего вредного не происходит. dashcamigo — это просто веб-страница: ничего не качать, не ставить и не добавлять в исключения.",
                    },
                    {
                        q: "dashcamigo работает на Mac или в браузере?",
                        a: "Да — в любом современном браузере на Windows, macOS, Linux и мобильном. CamGeoPlayer только под Windows и требует .NET.",
                    },
                    {
                        q: "dashcamigo читает GPS из видео, как CamGeoPlayer?",
                        a: "Да. Он автоматически читает GPS из распространённых файлов видеорегистраторов и рисует живую карту, а ещё показывает синхронный график скорости и перегрузок, объединяет камеры и экспортирует клипы. CamGeoPlayer тоже читает встроенный GPS и показывает его на OpenStreetMap с движущимся маркером; dashcamigo развивает эту идею дальше.",
                    },
                ],
            },
        },
    },
    {
        slug: "telemetry-overlay",
        displayName: "Telemetry Overlay",
        officialUrl: "https://goprotelemetryextractor.com/telemetry-overlay-gps-video-sensors",
        locales: {
            en: {
                title: "Telemetry Overlay alternative — free dashcam GPS overlay in your browser | dashcamigo",
                metaDescription:
                    "A free, in-browser alternative to Telemetry Overlay for dashcam footage — reads your GPS off the card, shows a live map and burns a speed & mini-map overlay. No install, no license fee.",
                ogTitle: "Free Telemetry Overlay alternative for dashcam footage",
                ogDescription:
                    "Telemetry Overlay is a paid desktop overlay tool. For dashcam footage, dashcamigo reads the GPS and burns a speed/map overlay free, in your browser.",
                h1: "A free, in-browser alternative to Telemetry Overlay — for dashcam footage",
                lead: "Telemetry Overlay is a powerful, paid desktop tool for burning gauges onto action-cam video. If your footage is from a dashcam and you just want to see the route, speed and G-force — and maybe burn a simple speed-and-map overlay — dashcamigo does that free, in your browser, reading the GPS straight off the card. No license, no install. For deep gauge production, Telemetry Overlay is still the more capable tool.",
                cardHint: "Paid desktop overlay tool; we read dashcam GPS free in the browser",
                whatItIs:
                    "Telemetry Overlay (by Goprotelemetryextractor) is a paid desktop app for Windows, macOS and Linux that burns customizable speed, GPS and sensor gauges onto video and exports the result. It's action-camera-first — GoPro, DJI, Insta360, Garmin — with a deep gauge library and broad data-format support (GPX, FIT, NMEA and more), and an in-app map served by Mapbox. The full version is a paid, one-time purchase (with a watermarked trial); dashcam GPS is read through a generic extraction path that's off by default. It's a render-and-export tool, not an interactive viewer for scrubbing a card full of clips.",
                comparisonIntro:
                    "Telemetry Overlay goes deeper on gauges. Here's where a free browser tool has the edge for dashcam footage specifically.",
                compareRows: [
                    {
                        dimension: "Price",
                        us: { mark: "yes", note: "Free" },
                        them: { mark: "no", note: "Paid, one-time license (watermarked trial)" },
                    },
                    {
                        dimension: "How you run it",
                        us: { mark: "yes", note: "In the browser — nothing to install" },
                        them: { mark: "no", note: "Desktop install (Windows/Mac/Linux)" },
                    },
                    {
                        dimension: "Reads dashcam GPS off the card",
                        us: { mark: "yes", note: "Automatically" },
                        them: { mark: "partial", note: "Generic extraction, off by default" },
                    },
                    {
                        dimension: "Built-in map",
                        us: { mark: "yes", note: "Keyless live map" },
                        them: { mark: "partial", note: "Mapbox (keyed, paid-tier)" },
                    },
                    {
                        dimension: "Speed & GPS overlay + export",
                        us: { mark: "yes", note: "Speed, coordinates, mini-map" },
                        them: { mark: "yes", note: "Deep gauge library" },
                    },
                    {
                        dimension: "Gauge depth & extra sensors",
                        us: { mark: "partial", note: "Speed, GPS, G-force" },
                        them: { mark: "yes", note: "Hundreds of gauges, many sources" },
                    },
                ],
                whenStayTitle: "When Telemetry Overlay is the better tool",
                whenStay:
                    "Telemetry Overlay is the better tool when you want to produce a polished overlay video — it has a far deeper gauge library, supports action cameras (GoPro, DJI, Insta360) and many external data formats (GPX, FIT, NMEA), and exports broadcast-grade formats (ProRes, alpha PNG). dashcamigo's overlay is deliberately simple: speed, coordinates and a mini-map burned onto your dashcam clip. For action-cam gauge production, Telemetry Overlay (a paid, installed tool) is the right choice; for free, instant dashcam review and a basic overlay in the browser, dashcamigo fits.",
                ctaPrimary: "Open your recordings",
                faq: [
                    {
                        q: "Is dashcamigo a free replacement for Telemetry Overlay?",
                        a: "For dashcam footage, mostly: it reads the embedded GPS off the card, shows a live map and a speed/G-force chart, and can burn a speed, coordinates and mini-map overlay onto an exported clip — free, in the browser. It does not match Telemetry Overlay's deep gauge library, action-camera sources (GoPro/DJI/Insta360) or broadcast export formats. For a simple dashcam overlay it's a free alternative; for advanced gauge production, Telemetry Overlay is more capable.",
                    },
                    {
                        q: "Does Telemetry Overlay read dashcam GPS?",
                        a: "Yes, but through a generic extraction path that's off by default and must be enabled in Settings, with reliability varying by model. dashcamigo reads common dashcam GPS formats (70mai, Viofo, BlackVue, GoPro, Garmin, Vantrue, Thinkware and more) automatically when you drop the folder.",
                    },
                    {
                        q: "How much does Telemetry Overlay cost vs dashcamigo?",
                        a: "Telemetry Overlay's full version is a paid, one-time purchase (a watermarked trial is available). dashcamigo is free, with no account and no paid tier.",
                    },
                    {
                        q: "Can I use dashcamigo in the browser without installing anything?",
                        a: "Yes — open dashcamigo.app and drop your SD-card folder. Telemetry Overlay is a desktop app you install on Windows, macOS or Linux; it has no browser or mobile version.",
                    },
                    {
                        q: "Is the map free in dashcamigo?",
                        a: "Yes. dashcamigo's map is keyless MapLibre + OpenFreeMap, built in and free. Telemetry Overlay's in-app map and satellite imagery come from Mapbox, a keyed commercial provider, and map/GPS imagery is gated out of its free trial.",
                    },
                ],
            },
            ru: {
                title: "Альтернатива Telemetry Overlay — бесплатный GPS-оверлей для регистратора в браузере | dashcamigo",
                metaDescription:
                    "Бесплатная браузерная альтернатива Telemetry Overlay для записей регистратора — читает GPS прямо с карты, показывает живую карту и наносит оверлей скорости и мини-карты. Без установки, без лицензии.",
                ogTitle: "Бесплатная альтернатива Telemetry Overlay для регистратора",
                ogDescription:
                    "Telemetry Overlay — платная десктоп-программа для оверлеев. Для записей регистратора dashcamigo читает GPS и наносит оверлей скорости/карты бесплатно, в браузере.",
                h1: "Бесплатная браузерная альтернатива Telemetry Overlay — для записей регистратора",
                lead: "Telemetry Overlay — мощная платная программа для компьютера, которая добавляет показания датчиков на видео с экшн-камер. Если у тебя запись с видеорегистратора и нужно увидеть маршрут, скорость и перегрузки или добавить на видео скорость и карту, dashcamigo сделает это бесплатно прямо в браузере, прочитав GPS с карты памяти. Без лицензии и установки. Для сложной работы с данными датчиков Telemetry Overlay всё же мощнее.",
                cardHint: "Платная десктоп-программа оверлеев; мы читаем GPS регистратора бесплатно в браузере",
                whatItIs:
                    "Telemetry Overlay (от Goprotelemetryextractor) — платное десктоп-приложение для Windows, macOS и Linux, которое наносит настраиваемые датчики скорости, GPS и сенсоров на видео и экспортирует результат. Оно заточено под экшн-камеры — GoPro, DJI, Insta360, Garmin — с глубокой библиотекой датчиков и широкой поддержкой форматов данных (GPX, FIT, NMEA и др.) и встроенной картой от Mapbox. Полная версия — платная разовая покупка (с пробной версией и водяным знаком); GPS регистратора читается через общий путь извлечения, выключенный по умолчанию. Это инструмент рендера и экспорта, а не интерактивный плеер для пролистывания папки клипов.",
                comparisonIntro:
                    "Telemetry Overlay глубже по датчикам. Вот где у бесплатного браузерного инструмента преимущество именно для записей регистратора.",
                compareRows: [
                    {
                        dimension: "Цена",
                        us: { mark: "yes", note: "Бесплатно" },
                        them: { mark: "no", note: "Платно, разовая лицензия (пробник с водяным знаком)" },
                    },
                    {
                        dimension: "Как запускается",
                        us: { mark: "yes", note: "В браузере — ставить ничего не надо" },
                        them: { mark: "no", note: "Установка на десктоп (Windows/Mac/Linux)" },
                    },
                    {
                        dimension: "Читает GPS регистратора с карты",
                        us: { mark: "yes", note: "Автоматически" },
                        them: { mark: "partial", note: "Общий путь, выключен по умолчанию" },
                    },
                    {
                        dimension: "Встроенная карта",
                        us: { mark: "yes", note: "Живая, без ключей" },
                        them: { mark: "partial", note: "Mapbox (с ключом, платный тариф)" },
                    },
                    {
                        dimension: "Оверлей скорости/GPS + экспорт",
                        us: { mark: "yes", note: "Скорость, координаты, мини-карта" },
                        them: { mark: "yes", note: "Глубокая библиотека датчиков" },
                    },
                    {
                        dimension: "Глубина датчиков и сенсоров",
                        us: { mark: "partial", note: "Скорость, GPS, перегрузки" },
                        them: { mark: "yes", note: "Сотни датчиков, много источников" },
                    },
                ],
                whenStayTitle: "Когда Telemetry Overlay — лучший выбор",
                whenStay:
                    "Telemetry Overlay лучше, когда нужно собрать вылизанное видео с оверлеем: у него гораздо более глубокая библиотека датчиков, поддержка экшн-камер (GoPro, DJI, Insta360) и множества внешних форматов данных (GPX, FIT, NMEA), и экспорт в вещательные форматы (ProRes, alpha-PNG). Оверлей dashcamigo намеренно простой: скорость, координаты и мини-карта поверх клипа с регистратора. Для продакшна датчиков с экшн-камеры Telemetry Overlay (платный, устанавливаемый) — верный выбор; для бесплатного быстрого просмотра записей регистратора и простого оверлея в браузере подходит dashcamigo.",
                ctaPrimary: "Открыть свои записи",
                faq: [
                    {
                        q: "dashcamigo — это бесплатная замена Telemetry Overlay?",
                        a: "Для записей регистратора в основном да: он читает встроенный GPS с карты, показывает живую карту и график скорости/G и может нанести оверлей скорости, координат и мини-карты на экспортируемый клип — бесплатно, в браузере. Он не повторяет глубокую библиотеку датчиков Telemetry Overlay, источники с экшн-камер (GoPro/DJI/Insta360) и вещательные форматы экспорта. Для простого оверлея регистратора это бесплатная альтернатива; для продвинутого продакшна датчиков Telemetry Overlay мощнее.",
                    },
                    {
                        q: "Telemetry Overlay читает GPS регистратора?",
                        a: "Да, но через общий путь извлечения, который выключен по умолчанию и включается в настройках, с надёжностью, зависящей от модели. dashcamigo читает распространённые форматы GPS регистраторов (70mai, Viofo, BlackVue, GoPro, Garmin, Vantrue, Thinkware и др.) автоматически, как только перетащишь папку.",
                    },
                    {
                        q: "Сколько стоит Telemetry Overlay против dashcamigo?",
                        a: "Полная версия Telemetry Overlay — платная разовая покупка (есть пробник с водяным знаком). dashcamigo бесплатный, без аккаунта и без платных тарифов.",
                    },
                    {
                        q: "dashcamigo работает в браузере без установки?",
                        a: "Да — открой dashcamigo.app и перетащи папку с SD-карты. Telemetry Overlay — десктоп-приложение, которое ставится на Windows, macOS или Linux; браузерной и мобильной версии у него нет.",
                    },
                    {
                        q: "Карта в dashcamigo бесплатная?",
                        a: "Да. Карта dashcamigo — это MapLibre + OpenFreeMap без ключей, встроенная и бесплатная. Карта и спутниковые снимки Telemetry Overlay идут от Mapbox, платного провайдера с ключом, и в пробной версии карта/снимки недоступны.",
                    },
                ],
            },
        },
    },
    {
        slug: "dashware",
        displayName: "DashWare",
        officialUrl: "http://www.dashware.net/",
        locales: {
            en: {
                title: "DashWare alternative — free, maintained, in your browser | dashcamigo",
                metaDescription:
                    "DashWare is a free but abandoned (2017), Windows-only telemetry tool with no live map. dashcamigo is the maintained, in-browser alternative that reads dashcam GPS and shows a real map.",
                ogTitle: "DashWare alternative — maintained, in your browser",
                ogDescription:
                    "DashWare hasn't been updated since 2017, is Windows-only and has no live map. dashcamigo reads dashcam GPS and shows a real keyless map — free, in the browser.",
                h1: "A maintained, in-browser DashWare alternative — with a real map",
                lead: "DashWare was a popular free telemetry-overlay tool, but GoPro stopped updating it after 2017, it's Windows-only, and it never had a real in-app map — just a track line you'd layer over a manual map screenshot. dashcamigo is the maintained, in-browser alternative for dashcam footage: it reads the GPS off the card and shows a live, keyless map with a speed and G-force chart. For building custom gauge overlays, though, DashWare's editor is still a different kind of tool.",
                cardHint: "Free but abandoned (2017), Windows-only, no live map",
                whatItIs:
                    "DashWare, acquired by GoPro, is a free Windows telemetry-overlay editor: you bring a video plus a separate data log (GPS, heart-rate, RPM) and it burns a large library of customizable gauges onto the footage. Its gauge editor and broad data-logger support were its strength. But development stopped in 2017 — it's unmaintained, Windows-only (Mac needs a virtual machine), it doesn't read embedded GPS from consumer dashcams (the video is just a background layer), and it even fails to extract GPS from newer GoPro models. Its \"map\" is a 2D track line with no map tiles; DashWare's own FAQ tells you to screenshot Google or Bing and layer it manually.",
                comparisonIntro:
                    "DashWare and dashcamigo do different jobs, but for viewing dashcam footage with a map, here's how they line up.",
                compareRows: [
                    { dimension: "Price", us: { mark: "yes", note: "Free" }, them: { mark: "yes", note: "Free" } },
                    {
                        dimension: "Still maintained",
                        us: { mark: "yes", note: "Actively developed" },
                        them: { mark: "no", note: "Abandoned since 2017" },
                    },
                    {
                        dimension: "Runs on Mac, Linux & mobile",
                        us: { mark: "yes", note: "Any modern browser" },
                        them: { mark: "no", note: "Windows-only (Mac via a VM)" },
                    },
                    {
                        dimension: "How you run it",
                        us: { mark: "yes", note: "In the browser" },
                        them: { mark: "no", note: "Desktop install (.exe)" },
                    },
                    {
                        dimension: "Reads dashcam GPS off the card",
                        us: { mark: "yes", note: "Automatically" },
                        them: { mark: "no", note: "Needs a separate data file" },
                    },
                    {
                        dimension: "Live map",
                        us: { mark: "yes", note: "Keyless, built in" },
                        them: { mark: "no", note: "No live map — track line + manual screenshot" },
                    },
                    {
                        dimension: "Custom gauge overlays",
                        us: { mark: "partial", note: "Speed, GPS, mini-map" },
                        them: { mark: "yes", note: "Large gauge library + editor" },
                    },
                ],
                whenStayTitle: "When DashWare still makes sense",
                whenStay:
                    "DashWare's strength was its gauge editor and large library of customizable gauges for action-sports and racing creators, fed from data loggers (GPS, heart-rate, RPM, lap timers). If you have that kind of workflow, are on Windows, and don't mind unmaintained software, its overlay editor still does things dashcamigo doesn't. dashcamigo isn't a gauge-authoring tool — it's a maintained, in-browser dashcam viewer that reads embedded GPS and shows a real live map, which is exactly what DashWare never had.",
                ctaPrimary: "Open your recordings",
                faq: [
                    {
                        q: "Is DashWare still updated?",
                        a: "No. GoPro stopped updating DashWare back in 2017; it's effectively abandoned and even fails to read GPS from newer GoPro cameras. dashcamigo is actively developed.",
                    },
                    {
                        q: "Does dashcamigo do telemetry overlays like DashWare?",
                        a: "Partly. dashcamigo can burn a speed, coordinates and mini-map overlay onto an exported clip, but it doesn't have DashWare's large custom-gauge library or its gauge editor. It focuses on reading and showing dashcam GPS on a live map and chart, which DashWare can't do off a dashcam card.",
                    },
                    {
                        q: "Why does DashWare have no map?",
                        a: "By design — DashWare never embedded a live map (its FAQ cites map-API licensing cost) and only draws a 2D track line; to get a map background you have to screenshot Google or Bing and layer it manually. dashcamigo has a real, interactive, keyless map (MapLibre + OpenFreeMap) built in.",
                    },
                    {
                        q: "Does it run on Mac or in the browser?",
                        a: "dashcamigo runs in any modern browser on Windows, macOS, Linux and mobile. DashWare is Windows-only; on a Mac it needs a Windows virtual machine.",
                    },
                    {
                        q: "Will my footage be uploaded?",
                        a: "No. dashcamigo reads and decodes your files locally in the browser — nothing is uploaded. DashWare is also local; both keep your footage on your machine.",
                    },
                ],
            },
            ru: {
                title: "Альтернатива DashWare — бесплатно, живая, в браузере | dashcamigo",
                metaDescription:
                    "DashWare — бесплатная, но заброшенная (2017), только под Windows программа без живой карты. dashcamigo — живая браузерная альтернатива, которая читает GPS регистратора и показывает настоящую карту.",
                ogTitle: "Альтернатива DashWare — живая, в браузере",
                ogDescription:
                    "DashWare не обновляется с 2017, только под Windows и без живой карты. dashcamigo читает GPS регистратора и показывает настоящую карту без ключей — бесплатно, в браузере.",
                h1: "Живая браузерная альтернатива DashWare — с настоящей картой",
                lead: "DashWare была популярной бесплатной программой для наложения телеметрии на видео, но GoPro перестала обновлять её после 2017 года. Она работает только в Windows, а настоящей встроенной карты в ней не было — лишь линия маршрута поверх заранее сделанного снимка карты. dashcamigo — современная альтернатива для записей видеорегистратора: он работает в браузере, читает GPS с карты памяти и показывает живую карту без ключей вместе с графиком скорости и перегрузок. Для сложных авторских панелей с датчиками редактор DashWare всё же остаётся инструментом другого класса.",
                cardHint: "Бесплатна, но заброшена (2017), только Windows, без живой карты",
                whatItIs:
                    "DashWare, купленная GoPro, — бесплатный Windows-редактор оверлеев телеметрии: ты приносишь видео плюс отдельный лог данных (GPS, пульс, обороты), а она наносит на кадр большую библиотеку настраиваемых датчиков. Её редактор датчиков и широкая поддержка логгеров были сильной стороной. Но разработка остановилась в 2017-м — она не поддерживается, только под Windows (на Mac нужна виртуальная машина), не читает встроенный GPS бытовых регистраторов (видео для неё — просто фоновый слой), и даже у новых GoPro не вытягивает GPS. Её \"карта\" — это 2D-линия трека без тайлов; собственный FAQ DashWare советует сделать скриншот Google или Bing и подложить вручную.",
                comparisonIntro:
                    "DashWare и dashcamigo делают разную работу, но для просмотра записей регистратора с картой вот как они смотрятся рядом.",
                compareRows: [
                    { dimension: "Цена", us: { mark: "yes", note: "Бесплатно" }, them: { mark: "yes", note: "Бесплатно" } },
                    {
                        dimension: "Всё ещё поддерживается",
                        us: { mark: "yes", note: "Активно развивается" },
                        them: { mark: "no", note: "Заброшена с 2017" },
                    },
                    {
                        dimension: "Работает на Mac, Linux и мобильном",
                        us: { mark: "yes", note: "Любой современный браузер" },
                        them: { mark: "no", note: "Только Windows (Mac через ВМ)" },
                    },
                    {
                        dimension: "Как запускается",
                        us: { mark: "yes", note: "В браузере" },
                        them: { mark: "no", note: "Установка на десктоп (.exe)" },
                    },
                    {
                        dimension: "Читает GPS регистратора с карты",
                        us: { mark: "yes", note: "Автоматически" },
                        them: { mark: "no", note: "Нужен отдельный файл данных" },
                    },
                    {
                        dimension: "Живая карта",
                        us: { mark: "yes", note: "Без ключей, встроена" },
                        them: { mark: "no", note: "Живой карты нет — линия трека + ручной скриншот" },
                    },
                    {
                        dimension: "Кастомные оверлеи датчиков",
                        us: { mark: "partial", note: "Скорость, GPS, мини-карта" },
                        them: { mark: "yes", note: "Большая библиотека датчиков + редактор" },
                    },
                ],
                whenStayTitle: "Когда DashWare всё ещё имеет смысл",
                whenStay:
                    "Сила DashWare — редактор датчиков и большая библиотека настраиваемых датчиков для авторов экшн-спорта и гонок, питаемых от логгеров данных (GPS, пульс, обороты, лап-таймеры). Если у тебя такой пайплайн, ты на Windows и не смущает неподдерживаемый софт, её редактор оверлеев умеет то, чего нет в dashcamigo. dashcamigo — не инструмент для авторинга датчиков, это живой браузерный плеер регистратора, который читает встроенный GPS и показывает настоящую живую карту, чего у DashWare никогда не было.",
                ctaPrimary: "Открыть свои записи",
                faq: [
                    {
                        q: "DashWare ещё обновляют?",
                        a: "Нет. GoPro перестала обновлять DashWare ещё в 2017 году; она фактически заброшена и даже у новых GoPro не читает GPS. dashcamigo активно развивается.",
                    },
                    {
                        q: "dashcamigo делает оверлеи телеметрии, как DashWare?",
                        a: "Частично. dashcamigo может нанести оверлей скорости, координат и мини-карты на экспортируемый клип, но у него нет большой библиотеки кастомных датчиков DashWare и её редактора датчиков. Он сосредоточен на чтении и показе GPS регистратора на живой карте и графике, чего DashWare с карты регистратора не умеет.",
                    },
                    {
                        q: "Почему у DashWare нет карты?",
                        a: "Так задумано — DashWare никогда не встраивала живую карту (в её FAQ ссылаются на стоимость лицензии map-API) и рисует только 2D-линию трека; чтобы получить фон карты, нужно сделать скриншот Google или Bing и подложить вручную. У dashcamigo настоящая интерактивная карта без ключей (MapLibre + OpenFreeMap) встроена.",
                    },
                    {
                        q: "Работает на Mac или в браузере?",
                        a: "dashcamigo работает в любом современном браузере на Windows, macOS, Linux и мобильном. DashWare только под Windows; на Mac ей нужна виртуальная машина с Windows.",
                    },
                    {
                        q: "Моё видео загружается?",
                        a: "Нет. dashcamigo читает файлы прямо с твоего устройства — наружу ничего не уходит. DashWare тоже работает локально; обе программы оставляют видео на твоём компьютере.",
                    },
                ],
            },
        },
    },
    {
        slug: "racerender",
        displayName: "RaceRender",
        officialUrl: "https://racerender.com/",
        locales: {
            en: {
                title: "RaceRender alternative — free, no watermark, in your browser | dashcamigo",
                metaDescription:
                    "RaceRender's free tier stamps a logo and caps clips at 3 minutes. For dashcam footage, dashcamigo reads the GPS off the card and shows a live map free in the browser — no watermark, no install.",
                ogTitle: "Free RaceRender alternative for dashcam footage",
                ogDescription:
                    "RaceRender is a desktop motorsport overlay editor (free tier: logo + 3-min cap). For dashcam footage, dashcamigo reads the GPS and shows a live map free, in the browser.",
                h1: "A free, in-browser RaceRender alternative — for dashcam footage",
                lead: "RaceRender is a capable desktop tool for building motorsport telemetry videos — but its free edition stamps a logo and caps output at three minutes, removing that needs a paid license, and it usually expects a separate data-logger file. For dashcam footage, dashcamigo reads the GPS straight off the card and shows a live, keyless map with a speed and G-force chart, free and in your browser, with no watermark and no length cap. For deep race-overlay production, RaceRender goes further.",
                cardHint: "Desktop race-overlay editor; free tier has a logo + 3-min cap",
                whatItIs:
                    "RaceRender (by HP Tuners) is a desktop application for Windows and macOS that composes telemetry overlays — gauges, maps, multi-camera layouts — and renders a finished motorsport video. It's camera- and data-source-agnostic (GoPro, VIRB, Sony, plus CSV, VBO, NMEA, GPX, FIT logs) and is built for track-day and racing creators, usually paired with a logging app like TrackAddict or Harry's LapTimer. It's freemium with a paid, one-time license: the Free edition stamps a RaceRender logo and caps output at 3 minutes, and removing the logo entirely needs the paid edition. Its track map is a local line drawn from the data — there's no built-in interactive base map.",
                comparisonIntro:
                    "RaceRender is a race-overlay editor; dashcamigo is a dashcam viewer. For viewing dashcam footage with a map, here's the split.",
                compareRows: [
                    {
                        dimension: "Price",
                        us: { mark: "yes", note: "Free" },
                        them: { mark: "partial", note: "Free tier (logo + 3-min cap); paid one-time upgrade" },
                    },
                    {
                        dimension: "Watermark on free output",
                        us: { mark: "yes", note: "None" },
                        them: { mark: "no", note: "RaceRender logo (removed only in the paid edition)" },
                    },
                    {
                        dimension: "How you run it",
                        us: { mark: "yes", note: "In the browser" },
                        them: { mark: "no", note: "Desktop install (Windows/Mac)" },
                    },
                    {
                        dimension: "Runs on mobile",
                        us: { mark: "yes", note: "Yes" },
                        them: { mark: "no", note: "Desktop only" },
                    },
                    {
                        dimension: "Reads dashcam GPS off the card",
                        us: { mark: "yes", note: "Automatically" },
                        them: { mark: "partial", note: "Expects a separate data file" },
                    },
                    {
                        dimension: "Built-in interactive map",
                        us: { mark: "yes", note: "Keyless live map" },
                        them: { mark: "no", note: "Local track line, no base map" },
                    },
                    {
                        dimension: "Race-overlay production depth",
                        us: { mark: "partial", note: "Basic speed/GPS overlay" },
                        them: { mark: "yes", note: "Lap timing, multi-cam, 4K" },
                    },
                ],
                whenStayTitle: "When RaceRender is the better tool",
                whenStay:
                    "RaceRender is built for producing polished motorsport videos: lap and predictive timing, a custom gauge designer, multi-camera compositing, 360 video and up to 4K output go well beyond dashcamigo. If you're making a track-day or racing edit and have a data-logger file, it's the right tool (and the one-time license is modest). dashcamigo isn't a race-video editor — it's a free, in-browser dashcam viewer that auto-reads embedded GPS off the card and shows a live map, no install and no watermark.",
                ctaPrimary: "Open your recordings",
                faq: [
                    {
                        q: "Is dashcamigo a free RaceRender alternative?",
                        a: "For viewing dashcam footage with a map and a basic overlay, yes — and with no watermark or length cap, free, in the browser. For motorsport production (lap timing, multi-camera, custom gauges, 4K render), RaceRender is far more capable; dashcamigo doesn't try to match that.",
                    },
                    {
                        q: "Does RaceRender's free version add a watermark?",
                        a: "Yes — the Free edition stamps a RaceRender logo and caps output at 3 minutes; removing the logo entirely requires a paid edition. dashcamigo adds no watermark and has no length cap.",
                    },
                    {
                        q: "Can RaceRender read my dashcam's GPS directly?",
                        a: "It reads GPS embedded in some action-cam files, but for dashcams it generally expects a separate data-logger file rather than auto-extracting GPS off the card. dashcamigo reads common dashcam GPS formats automatically when you drop the folder.",
                    },
                    {
                        q: "Does dashcamigo need installing?",
                        a: "No — it runs in any modern browser on Windows, Mac, Linux and mobile. RaceRender is a desktop app for Windows and macOS, with no browser or mobile version.",
                    },
                    {
                        q: "Does RaceRender have a live map like dashcamigo?",
                        a: "RaceRender draws a track line locally from the GPS data, but it has no built-in interactive base map (any satellite background is a static image you supply). dashcamigo has a real interactive keyless map (MapLibre + OpenFreeMap) built in.",
                    },
                ],
            },
            ru: {
                title: "Альтернатива RaceRender — бесплатно, без водяного знака, в браузере | dashcamigo",
                metaDescription:
                    "У бесплатной версии RaceRender логотип и лимит 3 минуты. Для записей регистратора dashcamigo читает GPS с карты и показывает живую карту бесплатно в браузере — без водяного знака и установки.",
                ogTitle: "Бесплатная альтернатива RaceRender для регистратора",
                ogDescription:
                    "RaceRender — десктопный редактор гоночных оверлеев (бесплатно: логотип + лимит 3 мин). Для записей регистратора dashcamigo читает GPS и показывает живую карту бесплатно, в браузере.",
                h1: "Бесплатная браузерная альтернатива RaceRender — для записей регистратора",
                lead: "RaceRender — мощная программа для монтажа гоночных видео с телеметрией. В бесплатной версии на видео остаётся логотип и действует ограничение в три минуты; для снятия ограничений нужна платная лицензия, а данные обычно приходится загружать отдельным файлом. Для записей видеорегистратора dashcamigo читает GPS прямо с карты памяти и бесплатно показывает в браузере живую карту с графиком скорости и перегрузок — без водяного знака и ограничения по длине. Для профессионального монтажа гоночных видео RaceRender умеет больше.",
                cardHint: "Десктопный редактор гоночных оверлеев; у бесплатной версии логотип + лимит 3 мин",
                whatItIs:
                    "RaceRender (от HP Tuners) — десктопное приложение для Windows и macOS, которое собирает оверлеи телеметрии — датчики, карты, многокамерные раскладки — и рендерит готовое гоночное видео. Оно безразлично к камере и источнику данных (GoPro, VIRB, Sony, плюс логи CSV, VBO, NMEA, GPX, FIT) и сделано для авторов трек-дней и гонок, обычно в паре с приложением-логгером вроде TrackAddict или Harry's LapTimer. Модель freemium с платной разовой лицензией: у бесплатной версии стоит логотип RaceRender и лимит вывода в 3 минуты, а полное снятие логотипа требует платной версии. Его карта трека — локальная линия по данным, встроенной интерактивной карты нет.",
                comparisonIntro:
                    "RaceRender — редактор гоночных оверлеев; dashcamigo — плеер регистратора. Для просмотра записей регистратора с картой вот как делятся роли.",
                compareRows: [
                    {
                        dimension: "Цена",
                        us: { mark: "yes", note: "Бесплатно" },
                        them: { mark: "partial", note: "Бесплатный режим (логотип + лимит 3 мин); платное разовое обновление" },
                    },
                    {
                        dimension: "Водяной знак на бесплатном выводе",
                        us: { mark: "yes", note: "Нет" },
                        them: { mark: "no", note: "Логотип RaceRender (снимается только в платной версии)" },
                    },
                    {
                        dimension: "Как запускается",
                        us: { mark: "yes", note: "В браузере" },
                        them: { mark: "no", note: "Установка на десктоп (Windows/Mac)" },
                    },
                    {
                        dimension: "Работает на мобильном",
                        us: { mark: "yes", note: "Да" },
                        them: { mark: "no", note: "Только десктоп" },
                    },
                    {
                        dimension: "Читает GPS регистратора с карты",
                        us: { mark: "yes", note: "Автоматически" },
                        them: { mark: "partial", note: "Ждёт отдельный файл данных" },
                    },
                    {
                        dimension: "Встроенная интерактивная карта",
                        us: { mark: "yes", note: "Живая, без ключей" },
                        them: { mark: "no", note: "Локальная линия трека, без базовой карты" },
                    },
                    {
                        dimension: "Глубина гоночного продакшна",
                        us: { mark: "partial", note: "Простой оверлей скорости/GPS" },
                        them: { mark: "yes", note: "Лап-тайминг, многокамерность, 4K" },
                    },
                ],
                whenStayTitle: "Когда RaceRender — лучший инструмент",
                whenStay:
                    "RaceRender сделан, чтобы собирать вылизанные гоночные видео: лап-тайминг и предиктивный тайминг, конструктор датчиков, многокамерная компоновка, 360-видео и вывод до 4K выходят далеко за рамки dashcamigo. Если ты делаешь монтаж трек-дня или гонки и у тебя есть файл с логгера — это верный инструмент (и разовая лицензия скромная). dashcamigo — не редактор гоночного видео, это бесплатный браузерный плеер регистратора, который сам читает встроенный GPS с карты и показывает живую карту, без установки и без водяного знака.",
                ctaPrimary: "Открыть свои записи",
                faq: [
                    {
                        q: "dashcamigo — бесплатная альтернатива RaceRender?",
                        a: "Для просмотра записей регистратора с картой и простым оверлеем — да, причём без водяного знака и лимита длины, бесплатно, в браузере. Для гоночного продакшна (лап-тайминг, многокамерность, кастомные датчики, рендер в 4K) RaceRender гораздо мощнее; dashcamigo и не пытается это повторить.",
                    },
                    {
                        q: "У бесплатной версии RaceRender есть водяной знак?",
                        a: "Да — бесплатный режим ставит логотип RaceRender и ограничивает вывод 3 минутами; полное снятие логотипа требует платной версии. dashcamigo не добавляет водяной знак и не ограничивает длину.",
                    },
                    {
                        q: "RaceRender может читать GPS регистратора напрямую?",
                        a: "Он читает GPS, встроенный в некоторые файлы экшн-камер, но для регистраторов обычно ждёт отдельный файл с логгера, а не вытягивает GPS прямо с карты. dashcamigo читает распространённые форматы GPS регистраторов автоматически, как только перетащишь папку.",
                    },
                    {
                        q: "dashcamigo нужно ставить?",
                        a: "Нет — он работает в любом современном браузере на Windows, Mac, Linux и мобильном. RaceRender — десктоп-приложение для Windows и macOS, браузерной и мобильной версии нет.",
                    },
                    {
                        q: "У RaceRender есть живая карта, как у dashcamigo?",
                        a: "RaceRender рисует линию трека локально по данным GPS, но встроенной интерактивной базовой карты у него нет (любой спутниковый фон — это статичная картинка, которую подкладываешь сам). У dashcamigo настоящая интерактивная карта без ключей (MapLibre + OpenFreeMap) встроена.",
                    },
                ],
            },
        },
    },
];

// Per-locale chrome labels (section headings, breadcrumbs, etc.). {name} is
// substituted with the competitor displayName at render time. en + ru inline;
// the 10 community locales merge in from COMMUNITY_ALT_LABELS.
export interface AltSharedLabels {
    backToPlayer: string;
    breadcrumbHome: string;
    breadcrumbAlternatives: string;
    whatItIsHeading: string; // "What is {name}?"
    comparisonHeading: string; // "{name} vs dashcamigo"
    compareColUs: string; // header for the dashcamigo column
    officialSiteLabel: string; // outbound-link label
    howHeading: string;
    howSteps: [string, string, string];
    howSecondaryCta: string;
    faqHeading: string;
    otherToolsHeading: string;
    camerasLink: string; // link text to the /cameras/ hub
    footerPrivacy: string;
    footerTerms: string;
    footerHome: string;
}

const SHARED_LABELS: Partial<Record<Lang, AltSharedLabels>> = {
    en: {
        backToPlayer: "← Back to player",
        breadcrumbHome: "Home",
        breadcrumbAlternatives: "Alternatives",
        whatItIsHeading: "What is {name}?",
        comparisonHeading: "{name} vs dashcamigo",
        compareColUs: "dashcamigo",
        officialSiteLabel: "Official site ↗",
        howHeading: "Switching to dashcamigo",
        howSteps: [
            "Take the SD card out of the dashcam and plug it into your computer.",
            "Open dashcamigo.app in any modern browser.",
            "Drag the whole SD-card folder onto the page — it detects, groups and plays.",
        ],
        howSecondaryCta: "Try it now",
        faqHeading: "FAQ",
        otherToolsHeading: "Other tools dashcamigo replaces",
        camerasLink: "Supported cameras",
        footerPrivacy: "Privacy policy",
        footerTerms: "Terms of use",
        footerHome: "dashcamigo.app",
    },
    ru: {
        backToPlayer: "← К плееру",
        breadcrumbHome: "Главная",
        breadcrumbAlternatives: "Альтернативы",
        whatItIsHeading: "Что такое {name}?",
        comparisonHeading: "{name} против dashcamigo",
        compareColUs: "dashcamigo",
        officialSiteLabel: "Официальный сайт ↗",
        howHeading: "Переход на dashcamigo",
        howSteps: [
            "Достань SD-карту из регистратора и вставь в компьютер.",
            "Открой dashcamigo.app в любом современном браузере.",
            "Перетащи всю папку с SD-карты на страницу — она сама всё разберёт и проиграет.",
        ],
        howSecondaryCta: "Попробовать",
        faqHeading: "Частые вопросы",
        otherToolsHeading: "Другие программы, которые заменяет dashcamigo",
        camerasLink: "Поддерживаемые камеры",
        footerPrivacy: "Политика конфиденциальности",
        footerTerms: "Условия использования",
        footerHome: "dashcamigo.app",
    },
};

// Trademark / non-affiliation disclaimer shown in the footer of every
// alternative page. Competitor pages name third-party brands; this is the
// standard nominative-fair-use safeguard against an "implied affiliation"
// claim (it does not make a false claim about a competitor - that risk is
// handled by the VERIFIED-only content). Kept here (all 12 locales inline)
// rather than in the generated content file - it's one short string and
// must never silently fall back. NOT legal advice; wording is conservative.
const ALT_DISCLAIMER: Record<Lang, string> = {
    en: "All product names are trademarks of their respective owners. dashcamigo is independent and not affiliated with, endorsed by or sponsored by them.",
    ru: "Все названия продуктов — товарные знаки их владельцев. dashcamigo независим, не связан с ними, не одобрен и не спонсируется ими.",
    de: "Alle Produktnamen sind Marken ihrer jeweiligen Inhaber. dashcamigo ist unabhängig und steht in keiner Verbindung zu ihnen, wird von ihnen weder unterstützt noch gesponsert.",
    es: "Todos los nombres de productos son marcas comerciales de sus respectivos propietarios. dashcamigo es independiente y no está afiliado a ellos ni cuenta con su respaldo o patrocinio.",
    fr: "Tous les noms de produits sont des marques de leurs propriétaires respectifs. dashcamigo est indépendant et n'est ni affilié à eux, ni approuvé ou sponsorisé par eux.",
    ja: "すべての製品名は各所有者の商標です。dashcamigo は独立したサービスであり、これらと提携しておらず、推奨やスポンサーを受けてもいません。",
    ko: "모든 제품 이름은 해당 소유자의 상표입니다. dashcamigo는 독립적인 서비스이며 이들과 제휴하거나 보증·후원을 받지 않습니다.",
    pl: "Wszystkie nazwy produktów są znakami towarowymi ich właścicieli. dashcamigo jest niezależny i nie jest z nimi powiązany ani przez nich wspierany czy sponsorowany.",
    pt: "Todos os nomes de produtos são marcas registradas de seus respectivos proprietários. O dashcamigo é independente e não é afiliado a eles nem possui seu endosso ou patrocínio.",
    zh: "所有产品名称均为其各自所有者的商标。dashcamigo 是独立服务，与它们无关联，也未获得其认可或赞助。",
};

// /alternatives/ hub index copy.
export interface AltIndexLocale {
    title: string;
    metaDescription: string;
    ogTitle: string;
    ogDescription: string;
    h1: string;
    lead: string;
}

const INDEX_LOCALES: Partial<Record<Lang, AltIndexLocale>> = {
    en: {
        title: "Free alternatives to dashcam viewers — in your browser | dashcamigo",
        metaDescription:
            "dashcamigo is a free, in-browser alternative to popular dashcam tools like RegistratorViewer, Dashcam Viewer and VLC — GPS map, speed chart, no install.",
        ogTitle: "Free in-browser alternative to dashcam viewers",
        ogDescription:
            "See how dashcamigo compares to RegistratorViewer, Dashcam Viewer and VLC — free, in the browser, with a GPS map that has no API key to expire.",
        h1: "Free, in-browser alternatives to popular dashcam tools",
        lead: "Switching from another dashcam viewer? dashcamigo plays your recordings in the browser — free, nothing to install — with a synchronized GPS map, a speed and G-force chart, and multi-camera playback. Here's how it compares to the tools people use today.",
    },
    ru: {
        title: "Бесплатные альтернативы плеерам регистратора — в браузере | dashcamigo",
        metaDescription:
            "dashcamigo — бесплатная альтернатива популярным программам для регистратора: RegistratorViewer, Dashcam Viewer, VLC. Карта GPS, график скорости, без установки.",
        ogTitle: "Бесплатная альтернатива плеерам регистратора в браузере",
        ogDescription:
            "Сравни dashcamigo с RegistratorViewer, Dashcam Viewer и VLC — бесплатно, в браузере, с картой GPS без ключей — истекать нечему.",
        h1: "Бесплатные альтернативы популярным программам для регистратора",
        lead: "Переходишь с другого плеера для видеорегистратора? dashcamigo показывает записи прямо в браузере — бесплатно и без установки — вместе с синхронной картой GPS, графиком скорости и перегрузок и несколькими камерами. Вот как он выглядит рядом с популярными программами.",
    },
};

// ----- resolution helpers (hand-written en/ru, community fallback, then en) -----

function resolveAltContent(competitor: Competitor, lang: Lang): AltLocaleContent {
    const direct = competitor.locales[lang];
    if (direct) return direct;
    const community = COMMUNITY_ALT_CONTENT[competitor.slug]?.[lang];
    if (community) return community;
    // EN is the guaranteed baseline; falling back to it keeps a missing
    // translation from crashing the dev server (the build path is gated by
    // assertAltLocaleParity instead, which fails loudly).
    const en = competitor.locales.en;
    if (!en) throw new Error(`alternative-pages: competitor "${competitor.slug}" has no en content`);
    return en;
}

function resolveLabels(lang: Lang): AltSharedLabels {
    return SHARED_LABELS[lang] ?? COMMUNITY_ALT_LABELS[lang] ?? SHARED_LABELS.en!;
}

function resolveIndexLocale(lang: Lang): AltIndexLocale {
    return INDEX_LOCALES[lang] ?? COMMUNITY_ALT_INDEX[lang] ?? INDEX_LOCALES.en!;
}

// ----- rendering -----

const COMPARE_MARK_CLASS: Record<CompareMark, string> = {
    yes: "alt-yes",
    no: "alt-no",
    partial: "alt-partial",
};

function renderCompareCell(cell: CompareCell, columnClass: string): string {
    return `<td class="${columnClass}"><span class="${COMPARE_MARK_CLASS[cell.mark]}">${escapeText(cell.note)}</span></td>`;
}

function renderComparisonTable(content: AltLocaleContent, labels: AltSharedLabels, competitorName: string): string {
    const rows = content.compareRows
        .map(
            (row) => `<tr>
<th scope="row">${escapeText(row.dimension)}</th>
${renderCompareCell(row.us, "alt-col-us")}
${renderCompareCell(row.them, "alt-col-them")}
</tr>`,
        )
        .join("\n");
    return `<div class="alt-compare-wrap">
<table class="alt-compare">
<thead>
<tr>
<th scope="col"></th>
<th scope="col" class="alt-col-us">${escapeText(labels.compareColUs)}</th>
<th scope="col" class="alt-col-them">${escapeText(competitorName)}</th>
</tr>
</thead>
<tbody>
${rows}
</tbody>
</table>
</div>`;
}

function renderAlternativePage(competitor: Competitor, lang: Lang, options: SeoBuildOptions): string {
    const seoLocale = getSeoLocaleByLang(lang);
    if (!seoLocale) throw new Error(`alternative-pages: lang "${lang}" not in SEO_LOCALES`);

    const content = resolveAltContent(competitor, lang);
    const labels = resolveLabels(lang);
    const pathPrefix = pathPrefixFor(lang);
    const name = competitor.displayName;

    const localHome = `${pathPrefix}/`;
    const url = `${SITE_ORIGIN}${pathPrefix}/alternatives/${competitor.slug}/`;
    const homeUrl = `${SITE_ORIGIN}${pathPrefix}/`;
    const alternativesUrl = `${SITE_ORIGIN}${pathPrefix}/alternatives/`;
    const ctaHref = `${pathPrefix}/`;
    const otherTools = ALTERNATIVES.filter((c) => c.slug !== competitor.slug);
    const ogImageUrl = `${SITE_ORIGIN}/${seoLocale.ogImage}`;

    const hreflangBlock = buildHreflangLinksHtml(
        (loc) => `${SITE_ORIGIN}/${loc.urlSegment}/alternatives/${competitor.slug}/`,
    );
    const ogLocaleAlternatesBlock = buildOgLocaleAlternatesHtml(lang);

    const breadcrumb = {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        itemListElement: [
            { "@type": "ListItem", position: 1, name: labels.breadcrumbHome, item: homeUrl },
            { "@type": "ListItem", position: 2, name: labels.breadcrumbAlternatives, item: alternativesUrl },
            { "@type": "ListItem", position: 3, name, item: url },
        ],
    };

    const hasFaq = content.faq.length > 0;
    const faqJsonLd = hasFaq
        ? `<script type="application/ld+json">${stringifyJsonLd({
              "@context": "https://schema.org",
              "@type": "FAQPage",
              mainEntity: content.faq.map((item) => ({
                  "@type": "Question",
                  name: item.q,
                  acceptedAnswer: { "@type": "Answer", text: item.a },
              })),
          })}</script>`
        : "";

    const faqSectionHtml = hasFaq
        ? `<section class="vp-section">
<h2 class="vp-h2">${escapeText(labels.faqHeading)}</h2>
${content.faq
    .map(
        (item) => `<details class="vp-faq">
<summary>${escapeText(item.q)}</summary>
<p>${escapeText(item.a)}</p>
</details>`,
    )
    .join("\n")}
</section>`
        : "";

    return `<!doctype html>
<html lang="${lang}">
<head>
${options.noIndex ? NOINDEX_META : ""}
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark light">
<title>${escapeText(content.title)}</title>
<meta name="description" content="${escapeAttr(content.metaDescription)}">
<meta http-equiv="content-language" content="${seoLocale.contentLanguage}">
<link rel="canonical" href="${url}">
${hreflangBlock}
<meta property="og:type" content="website">
<meta property="og:url" content="${url}">
<meta property="og:site_name" content="dashcamigo">
<meta property="og:title" content="${escapeAttr(content.ogTitle)}">
<meta property="og:description" content="${escapeAttr(content.ogDescription)}">
<meta property="og:image" content="${ogImageUrl}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:type" content="image/png">
<meta property="og:locale" content="${seoLocale.ogLocale}">
${ogLocaleAlternatesBlock}
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeAttr(content.ogTitle)}">
<meta name="twitter:description" content="${escapeAttr(content.ogDescription)}">
<meta name="twitter:image" content="${ogImageUrl}">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="alternate icon" href="/favicon.ico" sizes="any">
<link rel="apple-touch-icon" href="/favicon-192.png">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="preload" href="/fonts/inter-400-latin.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/vendor-page.css">
<script type="application/ld+json">${stringifyJsonLd(breadcrumb)}</script>
${faqJsonLd}
</head>
<body>
<header class="vp-header">
<a href="${localHome}" class="vp-brand" aria-label="dashcamigo">
<span class="vp-brand-text">dashcamigo</span>
${BRAND_ICON_SVG}
</a>
<a href="${localHome}" class="vp-back">${escapeText(labels.backToPlayer)}</a>
</header>
<main class="vp-main">
<article>
<h1 class="vp-h1">${escapeText(content.h1)}</h1>
<p class="vp-lead">${escapeText(content.lead)}</p>
<a href="${ctaHref}" class="vp-cta">${escapeText(content.ctaPrimary)}</a>

<section class="vp-section">
<h2 class="vp-h2">${escapeText(labels.whatItIsHeading.replace("{name}", name))}</h2>
<p>${escapeText(content.whatItIs)}</p>
<p><a href="${escapeAttr(competitor.officialUrl)}" rel="nofollow noopener" target="_blank">${escapeText(labels.officialSiteLabel)}</a></p>
</section>

<section class="vp-section">
<h2 class="vp-h2">${escapeText(labels.comparisonHeading.replace("{name}", name))}</h2>
<p>${escapeText(content.comparisonIntro)}</p>
${renderComparisonTable(content, labels, name)}
<div class="alt-when">
<div class="alt-when-title">${escapeText(content.whenStayTitle)}</div>
<p>${escapeText(content.whenStay)}</p>
</div>
</section>

<section class="vp-section">
<h2 class="vp-h2">${escapeText(labels.howHeading)}</h2>
<ol class="vp-steps">
${labels.howSteps.map((step) => `<li>${escapeText(step)}</li>`).join("\n")}
</ol>
<a href="${ctaHref}" class="vp-cta vp-cta--secondary">${escapeText(labels.howSecondaryCta)}</a>
</section>

${faqSectionHtml}

${renderFeatureLinksHtml(lang, pathPrefix)}
</article>

<aside class="vp-other-vendors">
<h3 class="vp-h3">${escapeText(labels.otherToolsHeading)}</h3>
<ul>
${otherTools
    .map(
        (other) =>
            `<li><a href="${pathPrefix}/alternatives/${other.slug}/">${escapeText(other.displayName)}</a></li>`,
    )
    .join("\n")}
<li><a href="${pathPrefix}/cameras/">${escapeText(labels.camerasLink)}</a></li>
</ul>
</aside>
</main>

<footer class="vp-footer">
<p class="vp-disclaimer">${escapeText(ALT_DISCLAIMER[lang])}</p>
<div class="vp-footer-links">
<a href="/privacy">${escapeText(labels.footerPrivacy)}</a>
<span>·</span>
<a href="/terms">${escapeText(labels.footerTerms)}</a>
<span>·</span>
<a href="${homeUrl}">${escapeText(labels.footerHome)}</a>
<span>·</span>
<a href="${REPO_URL}">GitHub</a>
</div>
</footer>
</body>
</html>
`;
}

function renderAlternativesIndexPage(lang: Lang, options: SeoBuildOptions): string {
    const seoLocale = getSeoLocaleByLang(lang);
    if (!seoLocale) throw new Error(`alternative-pages: lang "${lang}" not in SEO_LOCALES`);

    const content = resolveIndexLocale(lang);
    const labels = resolveLabels(lang);
    const pathPrefix = pathPrefixFor(lang);
    const localHome = `${pathPrefix}/`;
    const url = `${SITE_ORIGIN}${pathPrefix}/alternatives/`;
    const homeUrl = `${SITE_ORIGIN}${pathPrefix}/`;
    const ogImageUrl = `${SITE_ORIGIN}/${seoLocale.ogImage}`;

    const hreflangBlock = buildHreflangLinksHtml((loc) => `${SITE_ORIGIN}/${loc.urlSegment}/alternatives/`);
    const ogLocaleAlternatesBlock = buildOgLocaleAlternatesHtml(lang);

    const breadcrumb = {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        itemListElement: [
            { "@type": "ListItem", position: 1, name: labels.breadcrumbHome, item: homeUrl },
            { "@type": "ListItem", position: 2, name: labels.breadcrumbAlternatives, item: url },
        ],
    };
    const collection = {
        "@context": "https://schema.org",
        "@type": "CollectionPage",
        name: content.h1,
        description: content.lead,
        url,
        inLanguage: seoLocale.contentLanguage,
        mainEntity: {
            "@type": "ItemList",
            numberOfItems: ALTERNATIVES.length,
            itemListElement: ALTERNATIVES.map((c, idx) => ({
                "@type": "ListItem",
                position: idx + 1,
                url: `${SITE_ORIGIN}${pathPrefix}/alternatives/${c.slug}/`,
                name: c.displayName,
            })),
        },
    };

    const cards = ALTERNATIVES.map((c) => {
        const cardHint = resolveAltContent(c, lang).cardHint;
        return `<li><a class="vp-vendor-card" href="${pathPrefix}/alternatives/${c.slug}/">
<span class="vp-vendor-card-name">${escapeText(c.displayName)}</span>
<span class="vp-vendor-card-hint">${escapeText(cardHint)}</span>
</a></li>`;
    }).join("\n");

    return `<!doctype html>
<html lang="${lang}">
<head>
${options.noIndex ? NOINDEX_META : ""}
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark light">
<title>${escapeText(content.title)}</title>
<meta name="description" content="${escapeAttr(content.metaDescription)}">
<meta http-equiv="content-language" content="${seoLocale.contentLanguage}">
<link rel="canonical" href="${url}">
${hreflangBlock}
<meta property="og:type" content="website">
<meta property="og:url" content="${url}">
<meta property="og:site_name" content="dashcamigo">
<meta property="og:title" content="${escapeAttr(content.ogTitle)}">
<meta property="og:description" content="${escapeAttr(content.ogDescription)}">
<meta property="og:image" content="${ogImageUrl}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:type" content="image/png">
<meta property="og:locale" content="${seoLocale.ogLocale}">
${ogLocaleAlternatesBlock}
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeAttr(content.ogTitle)}">
<meta name="twitter:description" content="${escapeAttr(content.ogDescription)}">
<meta name="twitter:image" content="${ogImageUrl}">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="alternate icon" href="/favicon.ico" sizes="any">
<link rel="apple-touch-icon" href="/favicon-192.png">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="preload" href="/fonts/inter-400-latin.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/vendor-page.css">
<script type="application/ld+json">${stringifyJsonLd(breadcrumb)}</script>
<script type="application/ld+json">${stringifyJsonLd(collection)}</script>
</head>
<body>
<header class="vp-header">
<a href="${localHome}" class="vp-brand" aria-label="dashcamigo">
<span class="vp-brand-text">dashcamigo</span>
${BRAND_ICON_SVG}
</a>
<a href="${localHome}" class="vp-back">${escapeText(labels.backToPlayer)}</a>
</header>
<main class="vp-main">
<article>
<h1 class="vp-h1">${escapeText(content.h1)}</h1>
<p class="vp-lead">${escapeText(content.lead)}</p>
<ul class="vp-vendor-grid">
${cards}
</ul>
<p class="vp-note"><a href="${pathPrefix}/cameras/">${escapeText(labels.camerasLink)} →</a></p>
${renderHubCta(lang, pathPrefix)}
</article>
</main>
<footer class="vp-footer">
<p class="vp-disclaimer">${escapeText(ALT_DISCLAIMER[lang])}</p>
<div class="vp-footer-links">
<a href="/privacy">${escapeText(labels.footerPrivacy)}</a>
<span>·</span>
<a href="/terms">${escapeText(labels.footerTerms)}</a>
<span>·</span>
<a href="${homeUrl}">${escapeText(labels.footerHome)}</a>
<span>·</span>
<a href="${REPO_URL}">GitHub</a>
</div>
</footer>
</body>
</html>
`;
}

// ----- build-time integrity asserts -----

// Fail the build if any indexable locale is missing its labels, index copy or a
// competitor's content. Without this, a forgotten translation would silently
// fall back to English under a localized canonical/hreflang - a duplicate-content
// SEO regression that no test would otherwise catch. Same spirit as
// assertCommunityFaqParity in vendor-pages.ts. Exported for a unit test.
export function assertAltLocaleParity(): void {
    const problems: string[] = [];
    for (const loc of getIndexableSeoLocales()) {
        const lang = loc.lang;
        if (!SHARED_LABELS[lang] && !COMMUNITY_ALT_LABELS[lang]) {
            problems.push(`labels: missing locale "${lang}"`);
        }
        if (!INDEX_LOCALES[lang] && !COMMUNITY_ALT_INDEX[lang]) {
            problems.push(`index: missing locale "${lang}"`);
        }
        for (const competitor of ALTERNATIVES) {
            const direct = competitor.locales[lang];
            const community = COMMUNITY_ALT_CONTENT[competitor.slug]?.[lang];
            if (!direct && !community) {
                problems.push(`${competitor.slug}: missing locale "${lang}"`);
                continue;
            }
            const resolved = direct ?? community;
            const enFaqLen = competitor.locales.en?.faq.length ?? 0;
            if (resolved && resolved.faq.length !== enFaqLen) {
                problems.push(
                    `${competitor.slug}/${lang}: ${resolved.faq.length} FAQ items, en source has ${enFaqLen}`,
                );
            }
            const enRowsLen = competitor.locales.en?.compareRows.length ?? 0;
            if (resolved && resolved.compareRows.length !== enRowsLen) {
                problems.push(
                    `${competitor.slug}/${lang}: ${resolved.compareRows.length} compare rows, en source has ${enRowsLen}`,
                );
            }
        }
    }
    if (problems.length > 0) {
        throw new Error(`alternative-pages: locale parity broken\n  ${problems.join("\n  ")}`);
    }
}

// ----- vite plugin -----

export function alternativePagesPlugin(options: SeoBuildOptions = {}): Plugin {
    // No apply restriction (the dev middleware below must run under `vite dev`),
    // so closeBundle needs a build guard: Vite's dev PluginContainer.close()
    // also invokes closeBundle, and without it a Ctrl-C of the dev server
    // would silently write alternative pages into dist/.
    let isBuild = false;
    return {
        name: "dashcamigo-alternative-pages",
        configResolved(config) {
            isBuild = config.command === "build";
        },
        closeBundle() {
            if (!isBuild) return;
            assertAltLocaleParity();
            const distDir = resolve(process.cwd(), "dist");
            for (const seoLocale of getIndexableSeoLocales()) {
                const lang = seoLocale.lang;
                const prefix = `${seoLocale.urlSegment}/`;
                const indexDir = resolve(distDir, `${prefix}alternatives`);
                mkdirSync(indexDir, { recursive: true });
                writeFileSync(resolve(indexDir, "index.html"), renderAlternativesIndexPage(lang, options));
                for (const competitor of ALTERNATIVES) {
                    const targetDir = resolve(distDir, `${prefix}alternatives/${competitor.slug}`);
                    mkdirSync(targetDir, { recursive: true });
                    writeFileSync(
                        resolve(targetDir, "index.html"),
                        renderAlternativePage(competitor, lang, options),
                    );
                }
            }
        },
        configureServer(server) {
            // Same dev middleware shape as vendor-pages: render /alternatives/*
            // on the fly so the URLs work under `npm run dev` instead of falling
            // through to the SPA index.html.
            server.middlewares.use((req, res, next) => {
                if (req.method !== "GET" && req.method !== "HEAD") return next();
                const rawUrl = req.url ?? "/";
                const pathOnly = rawUrl.split(/[?#]/, 1)[0] ?? "/";
                const result = matchAlternativeRoute(pathOnly);
                if (!result) return next();

                let body: string;
                try {
                    body =
                        result.kind === "index"
                            ? renderAlternativesIndexPage(result.lang, options)
                            : renderAlternativePage(result.competitor, result.lang, options);
                } catch (err) {
                    server.config.logger.error(
                        `[alternative-pages] failed to render ${pathOnly}: ${err instanceof Error ? err.message : String(err)}`,
                    );
                    return next();
                }

                res.statusCode = 200;
                res.setHeader("Content-Type", "text/html; charset=utf-8");
                res.setHeader("Cache-Control", "no-store");
                res.end(req.method === "HEAD" ? "" : body);
            });
        },
    };
}

// Result of matching a request path against the alternative-pages URL space.
export type AlternativeRouteMatch =
    | { kind: "index"; lang: Lang }
    | { kind: "competitor"; lang: Lang; competitor: Competitor };

export function matchAlternativeRoute(path: string): AlternativeRouteMatch | null {
    const segments = path.split("/").filter((s) => s.length > 0);
    if (segments.length === 0) return null;

    let lang: Lang = "en";
    let i = 0;
    const maybeLocale = getIndexableSeoLocales().find((l) => l.urlSegment === segments[0]);
    if (maybeLocale) {
        lang = maybeLocale.lang;
        i = 1;
    }

    if (segments[i] !== "alternatives") return null;
    i++;

    if (i === segments.length) {
        return { kind: "index", lang };
    }
    if (i === segments.length - 1) {
        const slug = segments[i];
        const competitor = ALTERNATIVES.find((c) => c.slug === slug);
        if (!competitor) return null;
        return { kind: "competitor", lang, competitor };
    }
    return null;
}

// ----- sitemap entries (consumed by seo-prerender.ts sitemapPlugin) -----

interface AltSitemapEntry {
    loc: string;
    changefreq: string;
    priority: string;
    alternates: Record<string, string>;
    xDefaultUrl: string;
    lastmod?: string;
}

// Sitemap entries for the /alternatives/ hub + each competitor page, per locale.
// Mirrors getVendorSitemapEntries: per-page alternates point at that page's own
// locale siblings, x-default at the English variant.
export function getAlternativeSitemapEntries(): AltSitemapEntry[] {
    const entries: AltSitemapEntry[] = [];
    const indexable = getIndexableSeoLocales();
    const defaultLang = getDefaultSeoLocale().lang;
    const defaultSegment = getDefaultSeoLocale().urlSegment;

    // Locale and competitor content shares monolithic source files. Their
    // mtimes cannot identify which URL changed, so omit lastmod rather than
    // publish a site-wide false freshness signal.

    const indexAlternates = buildHreflangAlternatesMap(
        (loc) => `${SITE_ORIGIN}/${loc.urlSegment}/alternatives/`,
    );
    const indexXDefault = `${SITE_ORIGIN}/${defaultSegment}/alternatives/`;
    for (const loc of indexable) {
        entries.push({
            loc: `${SITE_ORIGIN}/${loc.urlSegment}/alternatives/`,
            changefreq: "monthly",
            priority: loc.lang === defaultLang ? "0.8" : "0.7",
            alternates: indexAlternates,
            xDefaultUrl: indexXDefault,
        });
    }

    for (const competitor of ALTERNATIVES) {
        const compAlternates = buildHreflangAlternatesMap(
            (loc) => `${SITE_ORIGIN}/${loc.urlSegment}/alternatives/${competitor.slug}/`,
        );
        const compXDefault = `${SITE_ORIGIN}/${defaultSegment}/alternatives/${competitor.slug}/`;
        for (const loc of indexable) {
            entries.push({
                loc: `${SITE_ORIGIN}/${loc.urlSegment}/alternatives/${competitor.slug}/`,
                changefreq: "monthly",
                priority: loc.lang === defaultLang ? "0.7" : "0.6",
                alternates: compAlternates,
                xDefaultUrl: compXDefault,
            });
        }
    }
    return entries;
}

// Exported for the redirects / llms plugins and tests - the canonical competitor
// slug list, in render order.
export function getAlternativeSlugs(): AltSlug[] {
    return ALTERNATIVES.map((c) => c.slug);
}

// Slug + display name for each competitor page, in render order. Used by
// llms-txt.ts to list the "tools dashcamigo replaces" with their URLs.
export function getAlternativeListings(): Array<{ slug: AltSlug; displayName: string }> {
    return ALTERNATIVES.map((c) => ({ slug: c.slug, displayName: c.displayName }));
}
