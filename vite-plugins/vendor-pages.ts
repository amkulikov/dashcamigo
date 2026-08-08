// Vendor landing pages for the top dashcam brands - every SUPPORTED_BRANDS
// entry with hasLandingPage=true (currently 70mai, Viofo, BlackVue, GoPro,
// Garmin, Vantrue, Thinkware; see supported-brands.ts for the source of
// truth). Each gets a static HTML at /cameras/<slug>/ (en) and
// /ru/cameras/<slug>/ (ru). Purpose: capture long-tail SERP traffic
// like "70mai player online", "blackvue dashcam viewer" etc., where the
// main /, /ru/ landing pages have to fight on the generic "dashcam player"
// term with no brand specificity.
//
// Each page is a lightweight content document (~5-10KB HTML, no JS app
// bundle, no map / chart / player) - the goal is fast TTFB / LCP on first
// crawler visit and a clean Core Web Vitals score. Clicking the CTA takes
// the user to / (or /ru/) where the full app loads. The shared brand
// styles live in public/vendor-page.css.
//
// Vendor-specific facts (models, format, SD layout) come from the parser
// docstrings in src/parsers/vendors/<vendor>.ts - that's the actual source
// of truth for what we have observed in real samples. Models listed in
// addition to confirmed-tested ones are based on public vendor lineup info
// (manufacturer pages, dashcamtalk forum threads).
//
// JSON-LD per page: BreadcrumbList (Home > Cameras > <Vendor>) and a
// vendor-specific FAQPage. Google still renders the breadcrumb rich result
// (improves SERP appearance / CTR). The FAQ rich result was retired - no
// Google SERP widget since 2026-05 - so the FAQPage schema stays only for
// Bing / Yandex / Naver + AI-grounding + the on-page FAQ, not for a Google
// snippet. Do not add FAQ copy expecting a Google FAQ widget.
//
// Adding a new vendor: append to VENDORS, fill the same locale fields,
// re-build. No other code change needed.

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Plugin } from "vite";
import type { Lang } from "../src/i18n/index.js";
import {
    REPO_URL,
    SITE_ORIGIN,
    buildHreflangAlternatesMap,
    getDefaultSeoLocale,
    getHreflangCodes,
    getIndexableSeoLocales,
    getSeoLocaleByLang,
    type SeoLocale,
} from "../src/i18n/seo-config.js";
import { maxGitMtimeIso } from "./git-mtime.js";
import { escapeAttr, escapeText, stringifyJsonLd } from "./html-utils.js";
import { renderHubCta } from "./hub-cta.js";
import type { SeoBuildOptions } from "./seo-prerender.js";

// Source files that contribute to every vendor page's HTML. Shared across
// all locale × vendor combinations - VENDOR_SHARED_SOURCES is the constant
// part, per-call we add the locale dict + (optionally) the vendor-specific
// source if vendors ever move out of this single file. lastmod for the
// /cameras/<slug>/ pages = max git mtime of the shared sources + dict.
const VENDOR_SHARED_SOURCES = [
    "vite-plugins/vendor-pages.ts",
    // Community-locale FAQ translations embedded into the rendered pages
    // (COMMUNITY_FAQ) - an FAQ edit must bump <lastmod> for vendor pages.
    "vite-plugins/vendor-community-faq.ts",
    "vite-plugins/supported-brands.ts",
    "src/i18n/seo-config.ts",
    // Same reasoning as in seo-prerender.ts HOMEPAGE_SHARED_SOURCES:
    // html-utils is the escaping layer that produces the final HTML, so
    // its mtime is part of "when did this URL's content change".
    "vite-plugins/html-utils.ts",
];

// HTML snippet inserted right after <head> open when SeoBuildOptions.noIndex
// is set. Keeps the directive ahead of <title> so crawlers see it during
// the first parsing pass.
// Exported so the sibling alternative-pages plugin reuses the same chrome
// instead of growing a second copy (see also BRAND_ICON_SVG, pathPrefixFor,
// buildHreflangLinksHtml, buildOgLocaleAlternatesHtml below).
export const NOINDEX_META = '<meta name="robots" content="noindex, nofollow">';

// Brand-mark camera icon, single source for vendor pages. Mirrors the SVG
// embedded inline in index.html (.dc-mark) - design system has no shared
// icon registry, so the same SVG lives in two places. If the brand mark
// changes (logo update, color tweak), update BOTH this constant AND the
// .dc-mark inline SVG in index.html.
export const BRAND_ICON_SVG = `<svg class="vp-brand-icon" viewBox="0 0 32 32" fill="none" aria-hidden="true">
<rect x="3" y="7" width="26" height="20" rx="3" fill="currentColor"/>
<rect x="14" y="4" width="4" height="3" rx="0.6" fill="currentColor"/>
<circle cx="16" cy="17" r="7" fill="#FF9000"/>
<circle cx="16" cy="17" r="4" fill="#000"/>
<circle cx="14" cy="15" r="1.4" fill="rgba(255,255,255,0.5)"/>
</svg>`;

// VendorSlug + SUPPORTED_BRANDS live in supported-brands.ts as the single
// SEO inventory. We use the slug type here as the discriminator on
// VendorContent and the getLandingBrands() list to cross-check that every
// landing brand has a matching VendorContent block (assertVendorListsAligned).
import { getLandingBrands, type VendorSlug } from "./supported-brands.js";

// Machine-translated FAQ for the 8 community locales (en/ru carry theirs
// inline in VENDORS below). Kept in a separate module - ~350 translated items
// would double this file's length. Parity is enforced by
// assertCommunityFaqParity().
import { COMMUNITY_FAQ } from "./vendor-community-faq.js";

// Vendor-specific FAQ entry. Question/answer plain text - no markup, the
// template HTML-escapes them on output.
interface FaqItem {
    q: string;
    a: string;
}

// Per-locale content for one vendor.
interface VendorLocaleContent {
    // <title> - long form, ≤70 chars ideally.
    title: string;
    // <meta name="description"> - ≤155 chars.
    metaDescription: string;
    // Short OG title (≤60 chars), separate from meta to fit unfurl cards.
    ogTitle: string;
    // OG description ~150 chars - punchier than meta description.
    ogDescription: string;
    // <h1> on the page.
    h1: string;
    // Subtitle paragraph under h1, 1-2 sentences.
    lead: string;
    // Primary CTA button text ("Open recordings folder").
    ctaPrimary: string;
    // Footnote under the models list ("and most other 70mai cameras").
    modelsCompat: string;
    // Intro paragraph for the "How <vendor> stores recordings" section.
    formatIntro: string;
    // Vendor-specific FAQ. 3-5 items each.
    faq: FaqItem[];
}

// Vendor static facts (technical, no translation needed) + per-locale prose.
interface VendorContent {
    slug: VendorSlug;
    // Display name shown in titles, headings, breadcrumbs.
    displayName: string;
    // Confirmed-tested + vendor-published model list. Plain text strings.
    models: string[];
    // Technical facts for the format section. Plain strings, locale-agnostic
    // (container/codec names don't translate).
    format: {
        container: string; // "MP4", "MPEG-TS"
        codec: string; // "H.264 / H.265"
        gpsStorage: string; // short label, e.g. "Embedded 'mkbx' box"
        sdLayout: string; // "/Normal/, /Event/, /Parking/"
        filenamePattern: string; // example filename
    };
    // Hand-written per-locale content. Currently populated for en + ru
    // (verified native-quality copy with vendor-specific FAQ). For the
    // other 8 indexable locales the renderer falls back to VENDOR_TEMPLATES
    // below - one generic localized template per language with displayName
    // substituted in. Community-locale FAQ comes from COMMUNITY_FAQ
    // (vendor-community-faq.ts) - machine-translated from the en source,
    // count parity enforced by assertCommunityFaqParity().
    locales: Partial<Record<Lang, VendorLocaleContent>>;
}

// Vendor data. Order matches VENDOR_SLUGS - both define the sitemap order
// and the "Other supported brands" cross-link order on each page.
const VENDORS: VendorContent[] = [
    {
        slug: "70mai",
        displayName: "70mai",
        models: [
            "X800",
            "A800",
            "A800S",
            "A810",
            "A510",
            "A500S (Pro Plus+)",
            "A500",
            "M500",
            "M800",
            "M310",
            "S500",
            "T800",
            "X1000 / X1000S",
            "Omni 4G",
            "Pro / Pro Lite / Pro Plus",
        ],
        format: {
            container: "MP4",
            codec: "H.264",
            gpsStorage: "Embedded in the MP4 (4K and Pro models) or GPSData*.txt CSV log (older $V02 models)",
            sdLayout: "/Normal/, /Event/, /Lapse/ (+ Front/Back/Interior subfolders on multi-channel models)",
            filenamePattern: "NO20240821-180010-000123.mp4",
        },
        locales: {
            en: {
                title: "70mai Dashcam Player & Viewer — X800, A800S, A810, T800 | dashcamigo",
                metaDescription:
                    "Free online 70mai dashcam player. Open X800, A800S, A810, T800 and other 70mai recordings in your browser. GPS map, speed chart, multi-channel playback. No upload, no install.",
                ogTitle: "70mai Dashcam Player Online — X800, A800S, A810, T800",
                ogDescription:
                    "Free online player for 70mai dashcam recordings. GPS map, speed chart, multi-channel. Works in any modern browser, nothing uploaded.",
                h1: "70mai Dashcam Player Online — play recordings in your browser",
                lead: "Open recordings from 70mai dashcams directly in your browser, on any PC or Mac — no Android emulator, no 70mai app. Synchronized GPS track, speed and G-force chart, multi-channel front/rear/cabin playback. No upload, no account.",
                ctaPrimary: "Open 70mai recordings folder",
                modelsCompat: "and most other 70mai cameras — the 4K models embed GPS in the video, the 2019–2021 Pro / Pro Lite / Pro Plus generation writes its own embedded GPS box, and older models keep a GPSData*.txt log ($V02). dashcamigo reads all three. If yours isn't recognized, send a sample to feedback@dashcamigo.app and we'll add it; we add formats from real recordings.",
                formatIntro:
                    "70mai stores GPS a few different ways: newer 4K models (A810, A800S, M500) embed it directly in the MP4, the 2019–2021 Pro / Pro Lite / Pro Plus generation writes its own embedded GPS box, and older models keep a separate GPSData*.txt CSV log on the SD card ($V02 format). dashcamigo reads all three, matches each GPS point to its video and draws the route automatically — drop the whole SD-card folder and the map appears.",
                faq: [
                    {
                        q: "Which 70mai models work in dashcamigo?",
                        a: "These 70mai models work: X800, A800/A800S/A810, A500/A500S, M500/M800/M310, S500, T800, X1000/X1000S, Omni 4G, plus the 2019–2021 Pro / Pro Lite / Pro Plus generation. The 4K models embed GPS in the video, the Pro generation writes its own embedded GPS box, and older ones keep a GPSData*.txt log ($V02) — dashcamigo reads all three. Multi-channel models (S500, A810, T800) play front, rear and cabin together. If your 70mai isn't recognized, send a sample to feedback@dashcamigo.app and we'll add it; we add formats from real recordings.",
                    },
                    {
                        q: "Do I need to install the 70mai app?",
                        a: "No. dashcamigo runs entirely in your browser. Plug the SD card into your computer, drop the folder onto dashcamigo.app, and your trips appear with map and chart — no install of 70mai's own software needed.",
                    },
                    {
                        q: "Will my 70mai recordings be uploaded anywhere?",
                        a: "No. There is no backend. Your browser reads the files locally with the File System Access API and decodes them with WebCodecs. Nothing leaves your device.",
                    },
                    {
                        q: "Can dashcamigo handle multi-channel 70mai cameras (S500, A810, T800)?",
                        a: "Yes. 70mai multi-channel models write to subfolders like Normal/Front/, Normal/Back/, Normal/Interior/. dashcamigo detects this layout, groups files into trips and plays all channels in sync. Click any channel to make it the main view, or keep them side-by-side.",
                    },
                    {
                        q: "Can I export a trimmed clip from a 70mai trip?",
                        a: "Yes. Drag-select a range on the speed chart, then Export. dashcamigo saves an MP4 with the GPS track embedded (GPMF format inside the file). You can also export the route as a separate .gpx file alongside.",
                    },
                    {
                        q: "Do I need an Android emulator like BlueStacks or LDPlayer to view 70mai files on a PC?",
                        a: "No. 70mai has no desktop player, so guides for opening 70mai files on a PC often point to Android emulators like BlueStacks, LDPlayer or MEmu. Those only run the 70mai mobile app, which talks to the camera over Wi-Fi — it can't open the MP4 files already on your SD card. dashcamigo opens those files directly in the browser: plug the card in, drop the folder, and the trip plays with map and chart. No emulator, no app, no account.",
                    },
                ],
            },
            ru: {
                title: "Плеер 70mai — просмотр записей X800, A800S, A810, T800 | dashcamigo",
                metaDescription:
                    "Бесплатный онлайн-плеер 70mai. Открой записи X800, A800S, A810, T800 и других моделей прямо в браузере. Карта GPS, график скорости, многоканальный просмотр. Без загрузки и установки.",
                ogTitle: "Плеер 70mai онлайн — X800, A800S, A810, T800",
                ogDescription:
                    "Онлайн-плеер для записей с видеорегистратора 70mai. Карта GPS, график скорости, многоканалка. Работает в любом современном браузере, ничего никуда не загружается.",
                h1: "Плеер 70mai онлайн — записи в браузере, без установки",
                lead: "Открывай записи с видеорегистраторов 70mai прямо в браузере, на любом ПК или Mac — без Android-эмулятора, без приложения 70mai. Синхронный GPS-трек на карте, график скорости и G-нагрузки, проигрывание фронта/тыла/салона одновременно. Без загрузки на сервер, без аккаунта.",
                ctaPrimary: "Открыть папку с записями 70mai",
                modelsCompat: "и большинство других 70mai — 4K-модели вшивают GPS прямо в видео, поколение Pro / Pro Lite / Pro Plus 2019–2021 годов кладёт GPS в собственный встроенный бокс, а модели постарше ведут отдельный лог GPSData*.txt ($V02). dashcamigo читает все три варианта. Если твою камеру не распознало — пришли запись на feedback@dashcamigo.app, форматы мы добавляем по реальным файлам.",
                formatIntro:
                    "70mai хранит GPS по-разному: новые 4K-модели (A810, A800S, M500) вшивают его прямо в MP4, поколение Pro / Pro Lite / Pro Plus 2019–2021 годов пишет GPS в собственный встроенный бокс, а модели постарше ведут отдельный текстовый CSV-лог GPSData*.txt на SD-карте (формат $V02). dashcamigo читает все три, связывает каждую GPS-точку с её видео и сам рисует маршрут — просто кинь всю папку SD-карты целиком.",
                faq: [
                    {
                        q: "Какие модели 70mai работают в dashcamigo?",
                        a: "Работают эти 70mai: X800, A800/A800S/A810, A500/A500S, M500/M800/M310, S500, T800, X1000/X1000S, Omni 4G, плюс поколение Pro / Pro Lite / Pro Plus 2019–2021 годов. 4K-модели вшивают GPS в видео, Pro-поколение пишет его в собственный встроенный бокс, а модели постарше ведут лог GPSData*.txt ($V02) — dashcamigo читает все три. Многоканалки (S500, A810, T800) играют фронт+тыл+салон одновременно. Если твою 70mai не распознало — пришли запись на feedback@dashcamigo.app, форматы мы добавляем по реальным файлам.",
                    },
                    {
                        q: "Нужно ли ставить приложение 70mai?",
                        a: "Нет. dashcamigo работает полностью в браузере. Вставь SD-карту в компьютер, перетащи папку на dashcamigo.app — поездки появятся с картой и графиком, программу 70mai ставить не надо.",
                    },
                    {
                        q: "Куда уходит видео?",
                        a: "Никуда. Сервера нет. Браузер читает файлы локально через File System Access API и декодирует через WebCodecs. Никаких загрузок наружу.",
                    },
                    {
                        q: "Поддерживаются ли многоканальные модели 70mai (S500, A810, T800)?",
                        a: "Да. Многоканальные 70mai пишут в подпапки Normal/Front/, Normal/Back/, Normal/Interior/. dashcamigo распознаёт эту раскладку, собирает файлы в поездки и проигрывает все каналы синхронно. Кликни любой канал — он станет главным, или оставь все рядом.",
                    },
                    {
                        q: "Можно ли вырезать кусок из поездки 70mai?",
                        a: "Да. Выдели диапазон на графике скорости и нажми Export. dashcamigo сохранит MP4 с GPS внутри (формат GPMF). Можно дополнительно сохранить маршрут отдельным .gpx-файлом.",
                    },
                    {
                        q: "Нужен ли Android-эмулятор вроде BlueStacks или LDPlayer, чтобы смотреть файлы 70mai на ПК?",
                        a: "Нет. У 70mai нет десктопного плеера, поэтому советы открыть файлы 70mai на ПК часто ведут к Android-эмуляторам вроде BlueStacks, LDPlayer или MEmu. Но они запускают только мобильное приложение 70mai, которое общается с камерой по Wi-Fi — открыть MP4-файлы, уже лежащие на SD-карте, оно не может. dashcamigo открывает эти файлы прямо в браузере: вставь карту, перетащи папку — поездка играет с картой и графиком. Без эмулятора, без приложения, без аккаунта.",
                    },
                ],
            },
        },
    },
    {
        slug: "viofo",
        displayName: "Viofo",
        models: ["A119 / A119 V3", "A129 Plus Duo", "A129 Pro Duo", "A139", "A139 Pro", "A229 Pro / Plus / Duo", "T130", "WM1"],
        format: {
            container: "MP4",
            codec: "H.264 / H.265",
            gpsStorage: "Embedded freeGPS blocks (Novatek chipset)",
            sdLayout: "/Movie/, /Movie_Parking/, /Photo/",
            filenamePattern: "2024_0821_180010_062F.MP4",
        },
        locales: {
            en: {
                title: "Viofo Dashcam Player & Viewer — A119, A129, A139, A229 | dashcamigo",
                metaDescription:
                    "Free online Viofo dashcam player. Open A119, A129 Plus Duo, A129 Pro, A139, A229 Pro and T130 recordings in your browser. GPS map, speed chart, no upload, no install.",
                ogTitle: "Viofo Dashcam Player Online — A119, A129, A139, A229",
                ogDescription:
                    "Free online player for Viofo dashcam recordings. GPS map, speed chart, multi-channel. Works in any modern browser, nothing uploaded.",
                h1: "Viofo Dashcam Player Online — play recordings in your browser",
                lead: "Open recordings from Viofo dashcams directly in your browser. Synchronized GPS, speed and G-force chart, multi-channel front/rear/interior playback. Free, no upload, no install.",
                ctaPrimary: "Open Viofo recordings folder",
                modelsCompat: "and most other Viofo models built on the Novatek chipset family (the same parser also handles Vantrue, Akaso, Azdome, Kenwood and Nextbase 512GW).",
                formatIntro:
                    "Viofo cameras (Novatek chipset) write H.264 or H.265 MP4 with GPS embedded as binary freeGPS blocks inside the video file — no separate log file. The filename pattern YYYY_MMDD_HHMMSS_NNN<P?><F|R|I>.MP4 encodes the date, sequence number, parking flag and channel (Front / Rear / Interior). dashcamigo recognizes the pattern, scans the file for the freeGPS structure and renders the route automatically.",
                faq: [
                    {
                        q: "Which Viofo models work in dashcamigo?",
                        a: "Viofo cameras using the standard Novatek freeGPS format work out of the box: A119/A119 V3, A129 Plus Duo, A129 Pro Duo, A139, A139 Pro, A229 Pro/Plus/Duo, T130, WM1. The underlying parser also covers other Novatek-chipset brands (Vantrue, Akaso, Azdome, Kenwood, Nextbase 512GW), so files from a Viofo and a Vantrue camera in the same folder will both load.",
                    },
                    {
                        q: "Do I need Viofo's own app or PC viewer?",
                        a: "No. dashcamigo plays Viofo recordings without any vendor software. Plug the SD card into your computer, drop the folder onto dashcamigo.app — trips appear with map and chart in seconds.",
                    },
                    {
                        q: "Will Viofo recordings be uploaded?",
                        a: "No. There is no backend. The browser reads files locally and decodes them with WebCodecs. Nothing leaves your device.",
                    },
                    {
                        q: "Does dashcamigo handle Viofo dual-channel (A129/A229) cameras?",
                        a: "Yes. The channel suffix (F = front, R = rear, I = interior) in the Viofo filename pattern tells dashcamigo which file is which. Files from the same moment in time are grouped into one trip and play in sync. Click any channel to make it the main view.",
                    },
                    {
                        q: "Can I trim a clip from a Viofo recording?",
                        a: "Yes. Drag a range on the speed chart, click Export, and dashcamigo writes an MP4 with the GPS track embedded as GPMF metadata. The original H.264/H.265 video is stream-copied (no re-encoding) when possible, so export is fast and quality-lossless.",
                    },
                    {
                        q: "Is there a Viofo player for PC or Mac?",
                        a: "Viofo ships its own desktop player (VIOFO Player, for Windows and Mac) and it covers single-file playback with a GPS map. dashcamigo is the no-install route: open dashcamigo.app in your browser on Windows, macOS, Linux or ChromeOS, drop the whole SD-card folder, and every trip plays on one timeline — front and rear in sync, speed and G-force chart, trim and export included.",
                    },
                ],
            },
            ru: {
                title: "Плеер Viofo — просмотр записей A119, A129, A139, A229 | dashcamigo",
                metaDescription:
                    "Бесплатный онлайн-плеер Viofo. Открой записи A119, A129 Plus Duo, A129 Pro, A139, A229 Pro и T130 прямо в браузере. Карта GPS, график скорости, без загрузки и установки.",
                ogTitle: "Плеер Viofo онлайн — A119, A129, A139, A229",
                ogDescription:
                    "Онлайн-плеер для записей с видеорегистратора Viofo. Карта GPS, график скорости, многоканалка. Работает в любом современном браузере.",
                h1: "Плеер Viofo онлайн — записи в браузере, без установки",
                lead: "Открывай записи с видеорегистраторов Viofo прямо в браузере. Синхронный GPS, график скорости и G-нагрузки, проигрывание фронта/тыла/салона одновременно. Бесплатно, без загрузки, без установки.",
                ctaPrimary: "Открыть папку с записями Viofo",
                modelsCompat: "и большинство других моделей Viofo на чипе Novatek (тот же парсер берёт также Vantrue, Akaso, Azdome, Kenwood и Nextbase 512GW).",
                formatIntro:
                    "Viofo (чип Novatek) пишет H.264 или H.265 в MP4, GPS вшит прямо в видеофайл бинарными блоками freeGPS — отдельного лога нет. В имени файла YYYY_MMDD_HHMMSS_NNN<P?><F|R|I>.MP4 закодированы дата, последовательность, флаг парковки и канал (Front/Rear/Interior). dashcamigo узнаёт паттерн, сканирует файл на freeGPS-структуру и сразу рисует маршрут.",
                faq: [
                    {
                        q: "Какие модели Viofo работают?",
                        a: "Viofo со стандартным форматом freeGPS на Novatek: A119/A119 V3, A129 Plus Duo, A129 Pro Duo, A139, A139 Pro, A229 Pro/Plus/Duo, T130, WM1. Тот же парсер закрывает и другие Novatek-бренды (Vantrue, Akaso, Azdome, Kenwood, Nextbase 512GW) — записи Viofo и Vantrue в одной папке откроются одновременно.",
                    },
                    {
                        q: "Нужно ли ставить приложение Viofo?",
                        a: "Нет. dashcamigo играет записи Viofo без программы вендора. Вставил SD-карту, перетащил папку — поездки появились с картой и графиком за секунды.",
                    },
                    {
                        q: "Куда уходит видео?",
                        a: "Никуда. Сервера нет. Браузер читает файлы локально и декодирует через WebCodecs. Никаких загрузок наружу.",
                    },
                    {
                        q: "Поддерживаются ли двухканальные Viofo (A129/A229)?",
                        a: "Да. Суффикс канала в имени файла (F = фронт, R = тыл, I = салон) говорит dashcamigo, какой файл какой. Файлы за одно и то же время группируются в одну поездку и играют синхронно. Кликни любой канал — он станет главным.",
                    },
                    {
                        q: "Можно ли вырезать кусок из записи Viofo?",
                        a: "Да. Выдели диапазон на графике скорости, нажми Export — dashcamigo сохранит MP4 с GPS внутри (формат GPMF). Когда возможно, исходное H.264/H.265 stream-copy'ится без перекодирования — экспорт быстрый и без потери качества.",
                    },
                    {
                        q: "Есть ли плеер Viofo для ПК или Mac?",
                        a: "У Viofo есть свой десктопный плеер (VIOFO Player для Windows и Mac) — он умеет проигрывать отдельные файлы с картой GPS. dashcamigo — вариант без установки: открой dashcamigo.app в браузере на Windows, macOS, Linux или ChromeOS, перетащи всю папку SD-карты — и каждая поездка играет на одном таймлайне: фронт и тыл синхронно, график скорости и G-нагрузки, обрезка и экспорт в комплекте.",
                    },
                ],
            },
        },
    },
    {
        slug: "blackvue",
        displayName: "BlackVue",
        models: [
            "DR900X / DR900X Plus / DR900X-2CH Plus",
            "DR970X / DR970X Plus",
            "DR750X / DR750X Plus",
            "DR770X / DR770X Plus",
            "DR590X-1CH / DR590X-2CH",
            "DR650 / DR550 / DR500 / DR450 (legacy, via .gps sidecar)",
        ],
        format: {
            container: "MP4",
            codec: "H.264 / H.265",
            gpsStorage: "NMEA inside custom 'free' box (newer X-series) or .gps sidecar (legacy)",
            sdLayout: "/BlackVue/Record/, /BlackVue/Event/, /BlackVue/Parking/, /BlackVue/Manual/",
            filenamePattern: "20240821_180010_NF.mp4 (Normal Front)",
        },
        locales: {
            en: {
                title: "BlackVue Dashcam Player & Viewer — DR900X, DR970X, DR750X | dashcamigo",
                metaDescription:
                    "Free online BlackVue dashcam player. Open DR900X, DR970X, DR750X, DR770X and DR590X recordings in your browser. GPS map, speed chart, front/rear playback. No cloud upload.",
                ogTitle: "BlackVue Player Online — DR900X, DR970X, DR750X",
                ogDescription:
                    "Free online player for BlackVue dashcam recordings. GPS map, speed chart, front+rear in sync. Works in any browser, no BlackVue Cloud account needed.",
                h1: "BlackVue Dashcam Player Online — play recordings in your browser",
                lead: "Open BlackVue DR-series recordings directly in your browser. Synchronized GPS, speed and G-force chart, dual-channel front+rear playback. No BlackVue Viewer install, no BlackVue Cloud account.",
                ctaPrimary: "Open BlackVue recordings folder",
                modelsCompat: "and most other BlackVue DR-series cameras. Modern X-series (DR900X, DR970X, DR750X, DR770X, DR590X) store GPS inside the MP4; the legacy DR450/500/550/650 line uses a separate .gps sidecar file — both work.",
                formatIntro:
                    "Newer BlackVue X-series cameras (DR900X+, DR970X, etc.) store GPS as NMEA text inside a custom 'free' box of the MP4 — same format the older models used for the separate .gps sidecar. Filenames follow YYYYMMDD_HHMMSS_<Mode><Channel>.mp4, where Mode = N/E/P/M (Normal/Event/Parking/Manual) and Channel = F/R/I (Front/Rear/Interior). dashcamigo reads both the embedded and sidecar variants automatically.",
                faq: [
                    {
                        q: "Which BlackVue models work in dashcamigo?",
                        a: "All BlackVue DR-series cameras: modern X-series with embedded GPS (DR900X, DR900X Plus, DR970X / DR970X Plus, DR750X, DR770X, DR590X) and legacy models with .gps sidecar files (DR450, DR500, DR550, DR650). The parser also reads the 3-axis accelerometer track from the .3gf sidecar where present.",
                    },
                    {
                        q: "Do I need BlackVue Viewer or a BlackVue Cloud account?",
                        a: "No. dashcamigo plays BlackVue recordings without any BlackVue software or account. Plug the SD card into your computer, drop the BlackVue folder onto dashcamigo.app — trips appear with map and chart, fully offline.",
                    },
                    {
                        q: "Will my BlackVue recordings be uploaded to a server?",
                        a: "No. There is no backend at all. The browser reads files locally with the File System Access API. Nothing leaves your device — unlike BlackVue Cloud, which routes through their servers.",
                    },
                    {
                        q: "Does dashcamigo show both front and rear BlackVue cameras?",
                        a: "Yes. BlackVue dual-channel models write the same timestamp to a front (F) and rear (R) file. dashcamigo groups them into one trip and plays both in sync. Click either channel to make it the main view, or keep them side by side.",
                    },
                    {
                        q: "Can I export a clip from a BlackVue trip?",
                        a: "Yes. Drag a range on the speed chart, click Export, and dashcamigo writes an MP4 with the GPS embedded as GPMF metadata. The original H.264/H.265 stream is copied without re-encoding when possible — fast and lossless.",
                    },
                ],
            },
            ru: {
                title: "Плеер BlackVue — просмотр записей DR900X, DR970X, DR750X | dashcamigo",
                metaDescription:
                    "Бесплатный онлайн-плеер BlackVue. Открой записи DR900X, DR970X, DR750X, DR770X и DR590X в браузере. Карта GPS, график скорости, фронт+тыл. Без BlackVue Cloud.",
                ogTitle: "Плеер BlackVue онлайн — DR900X, DR970X, DR750X",
                ogDescription:
                    "Онлайн-плеер для записей с BlackVue. Карта GPS, график скорости, фронт+тыл синхронно. Работает в любом браузере, без аккаунта BlackVue Cloud.",
                h1: "Плеер BlackVue онлайн — записи в браузере, без BlackVue Viewer",
                lead: "Открывай записи BlackVue DR-серии прямо в браузере. Синхронный GPS, график скорости и G-нагрузки, фронт+тыл одновременно. Без BlackVue Viewer, без аккаунта BlackVue Cloud.",
                ctaPrimary: "Открыть папку с записями BlackVue",
                modelsCompat: "и большинство других BlackVue DR-серии. Современные X-серии (DR900X, DR970X, DR750X, DR770X, DR590X) хранят GPS прямо в MP4; старые DR450/500/550/650 пишут отдельный .gps-файл — оба варианта работают.",
                formatIntro:
                    "Новые BlackVue X-серии (DR900X+, DR970X и т.д.) хранят GPS как NMEA-текст в кастомном боксе 'free' внутри MP4 — тот же формат, что использовался в старых моделях для отдельного файла .gps. Имена файлов: YYYYMMDD_HHMMSS_<Mode><Channel>.mp4, где Mode = N/E/P/M (Normal/Event/Parking/Manual), Channel = F/R/I (фронт/тыл/салон). dashcamigo автоматически читает оба варианта.",
                faq: [
                    {
                        q: "Какие BlackVue работают?",
                        a: "Вся серия DR: современные X с вшитым GPS (DR900X, DR900X Plus, DR970X/Plus, DR750X, DR770X, DR590X) и старые с отдельным .gps (DR450, DR500, DR550, DR650). Парсер также читает акселерометр из .3gf, если он есть.",
                    },
                    {
                        q: "Нужен ли BlackVue Viewer или аккаунт BlackVue Cloud?",
                        a: "Нет. dashcamigo играет записи BlackVue без программы и без аккаунта. Вставил SD-карту, перетащил папку BlackVue — поездки появились с картой, всё локально.",
                    },
                    {
                        q: "Уйдут ли мои записи на сервер?",
                        a: "Нет. Сервера нет вообще. Браузер читает файлы локально через File System Access API. В отличие от BlackVue Cloud (который гонит трафик через их серверы), тут наружу не уходит ничего.",
                    },
                    {
                        q: "Показывает ли dashcamigo фронт и тыл BlackVue вместе?",
                        a: "Да. Двухканальные BlackVue пишут одинаковый timestamp в файл фронта (F) и тыла (R). dashcamigo собирает их в одну поездку и играет синхронно. Кликни любой — он станет главным, или оставь рядом.",
                    },
                    {
                        q: "Можно ли вырезать кусок?",
                        a: "Да. Выдели диапазон на графике, нажми Export — dashcamigo сохранит MP4 с GPS внутри (GPMF). Когда можно, видео stream-copy'ится без перекодирования — быстро и без потери.",
                    },
                ],
            },
        },
    },
    {
        slug: "gopro",
        displayName: "GoPro",
        models: [
            "HERO13 Black (GPS9)",
            "HERO11 Black (GPS9)",
            "HERO10 Black (GPS5)",
            "HERO9 Black (GPS5)",
            "HERO8 Black (GPS5)",
            "HERO7 Black / Silver (GPS5)",
            "HERO6 Black (GPS5)",
            "HERO5 Black (GPS5)",
            "MAX (GPS5)",
        ],
        format: {
            container: "MP4",
            codec: "H.264 / H.265",
            gpsStorage: "GPMF metadata track (gpmd)",
            sdLayout: "/DCIM/100GOPRO/",
            filenamePattern: "GH010001.MP4",
        },
        locales: {
            en: {
                title: "GoPro Dashcam Player — HERO11, HERO10, HERO9 GPMF | dashcamigo",
                metaDescription:
                    "Free online GoPro player. Open HERO5–HERO13 and MAX recordings with GPMF telemetry in your browser. GPS map, speed and G-force chart from the gpmd track. No upload.",
                ogTitle: "GoPro Player Online — HERO5–HERO13 GPMF telemetry",
                ogDescription:
                    "Free online player for GoPro recordings with GPMF GPS. Map, speed and G-force chart from the gpmd track. Works in any modern browser.",
                h1: "GoPro Dashcam Player Online — play GPMF recordings in your browser",
                lead: "Open GoPro HERO and MAX recordings directly in your browser. The GPMF (gpmd) metadata track gives you GPS, speed, altitude and 3-axis acceleration — dashcamigo renders all of it on a synchronized map and chart.",
                ctaPrimary: "Open GoPro recordings folder",
                modelsCompat: "and other GoPro models that write the GPMF metadata track (gpmd). HERO12 Black has no built-in GPS — files play, but without a track. HERO11/13 use the newer GPS9 format, HERO5-10 and MAX use GPS5; dashcamigo handles both transparently.",
                formatIntro:
                    "GoPro stores telemetry in a standardized binary format called GPMF, sitting inside the MP4 as a metadata track with handler 'meta' and codec 'gpmd'. Each sample carries GPS coordinates, speed, altitude and 3-axis accelerometer values, sampled multiple times per second. HERO11 and HERO13 use the newer GPS9 layout (lat/lon/alt/speed3d/speed2d/days/secs/dop/fix); older HERO5–HERO10 and MAX use GPS5. dashcamigo reads both.",
                faq: [
                    {
                        q: "Which GoPro models work?",
                        a: "Any GoPro with a GPMF gpmd track: HERO5, HERO6, HERO7 Black/Silver, HERO8, HERO9, HERO10, HERO11, HERO13, MAX. HERO12 Black has no built-in GPS, so its files play but without a route. The Session and Fusion lines also work where they wrote gpmd.",
                    },
                    {
                        q: "What does GPMF give me besides GPS coordinates?",
                        a: "GPMF includes GPS coordinates, altitude, ground speed, and 3-axis accelerometer data sampled multiple times per second. dashcamigo uses GPS for the map track, derives the speed chart from it, and uses the accelerometer for the G-force / event-marker line on the chart.",
                    },
                    {
                        q: "Does dashcamigo handle 360 GoPro MAX recordings?",
                        a: "MAX recordings with the gpmd telemetry track open and play. The video is shown as the source MP4 — dashcamigo does not currently un-fisheye or reproject 360 footage, so use Quik or another 360 reframing tool first if you want a flat output.",
                    },
                    {
                        q: "Are my GoPro recordings uploaded to a server?",
                        a: "No. There is no backend. The browser reads files locally with the File System Access API. Nothing leaves your device.",
                    },
                    {
                        q: "Can I export a trimmed clip with GoPro GPS inside?",
                        a: "Yes. Drag a range on the speed chart and Export. dashcamigo writes a new MP4 with a fresh GPMF track in the exported range — readable by GoPro Quik, Telemetry Overlay, ffmpeg/gpmf-parser and other GPMF-aware tools.",
                    },
                ],
            },
            ru: {
                title: "Плеер GoPro — HERO11, HERO10, HERO9 GPMF | dashcamigo",
                metaDescription:
                    "Бесплатный онлайн-плеер GoPro. Открой записи HERO5–HERO13 и MAX с GPMF-телеметрией в браузере. Карта GPS, графики скорости и G по треку gpmd. Без загрузки.",
                ogTitle: "Плеер GoPro онлайн — HERO5–HERO13 GPMF",
                ogDescription:
                    "Онлайн-плеер для записей GoPro с GPMF GPS. Карта, скорость и G-нагрузка по треку gpmd. Работает в любом современном браузере.",
                h1: "Плеер GoPro онлайн — записи с GPMF прямо в браузере",
                lead: "Открывай записи GoPro HERO и MAX прямо в браузере. Из метатрека GPMF (gpmd) dashcamigo достаёт GPS, скорость, высоту и 3-осевой акселерометр — и рисует всё это на синхронной карте и графике.",
                ctaPrimary: "Открыть папку с записями GoPro",
                modelsCompat: "и другие GoPro с метатреком GPMF (gpmd). У HERO12 Black встроенного GPS нет — файлы играют, но без трека. HERO11/13 пишут в новом формате GPS9, HERO5–10 и MAX — в GPS5; dashcamigo читает оба.",
                formatIntro:
                    "GoPro хранит телеметрию в стандартном бинарном формате GPMF — отдельный метатрек внутри MP4 с handler 'meta' и кодеком 'gpmd'. Каждый sample содержит GPS-координаты, скорость, высоту и 3-осевой акселерометр, замеры — несколько раз в секунду. HERO11 и HERO13 используют новый layout GPS9, более старые HERO5–10 и MAX — GPS5. dashcamigo читает оба формата.",
                faq: [
                    {
                        q: "Какие GoPro работают?",
                        a: "Любые GoPro с треком GPMF gpmd: HERO5, HERO6, HERO7 Black/Silver, HERO8, HERO9, HERO10, HERO11, HERO13, MAX. У HERO12 Black встроенного GPS нет — играет, но без трека. Session и Fusion тоже работают там, где они писали gpmd.",
                    },
                    {
                        q: "Что даёт GPMF кроме GPS?",
                        a: "GPMF содержит GPS-координаты, высоту, скорость по земле и 3-осевой акселерометр, замеры несколько раз в секунду. dashcamigo рисует карту по GPS, считает график скорости и использует акселерометр для линии G-нагрузки и автоматических меток событий.",
                    },
                    {
                        q: "Поддерживается ли GoPro MAX (360)?",
                        a: "Записи MAX с треком gpmd открываются и играют. Видео показывается как исходный MP4 — dashcamigo пока не разворачивает 360-проекцию, так что для плоского результата сначала пропусти видео через Quik или другой 360-reframing-инструмент.",
                    },
                    {
                        q: "Куда уходят мои записи?",
                        a: "Никуда. Сервера нет. Браузер читает файлы локально через File System Access API. Наружу ничего не уходит.",
                    },
                    {
                        q: "Можно ли вырезать кусок с GoPro GPS внутри?",
                        a: "Да. Выдели диапазон на графике, нажми Export — dashcamigo собирает новый MP4 с обрезанным GPMF-треком внутри. Читается в GoPro Quik, Telemetry Overlay, ffmpeg/gpmf-parser и других GPMF-совместимых тулзах.",
                    },
                ],
            },
        },
    },
    {
        slug: "garmin",
        displayName: "Garmin",
        models: [
            "Dash Cam 67W",
            "Dash Cam 66W",
            "Dash Cam 57 / 47",
            "Dash Cam Mini 2",
            "Dash Cam Mini 3",
            "Dash Cam Live",
            "Dash Cam Tandem",
            "Dash Cam X-series",
        ],
        format: {
            container: "MP4",
            codec: "H.264",
            gpsStorage: "PNDM 20-byte binary struct in subtitle/text/meta track",
            sdLayout: "/Garmin/, /DCIM/",
            filenamePattern: "20240821-180010.mp4",
        },
        locales: {
            en: {
                title: "Garmin Dash Cam Player & Viewer — 67W, 57, Mini 2/3 | dashcamigo",
                metaDescription:
                    "Free online Garmin Dash Cam player. Open 67W, 57, 47, Mini 2/3, Live and Tandem recordings in your browser. GPS map, speed chart from the PNDM track. No upload, no install.",
                ogTitle: "Garmin Dash Cam Player Online — 67W, 57, Mini 2/3, Live",
                ogDescription:
                    "Free online player for Garmin Dash Cam recordings. GPS map, speed chart, no Garmin Express, no install.",
                h1: "Garmin Dash Cam Player Online — play recordings in your browser",
                lead: "Open Garmin Dash Cam recordings directly in your browser. GPS, speed and acceleration are extracted from the PNDM telemetry track and rendered on a synchronized map and chart.",
                ctaPrimary: "Open Garmin recordings folder",
                modelsCompat: "and other Garmin Dash Cam models that write the PNDM telemetry track (most current and recent-generation models).",
                formatIntro:
                    "Garmin Dash Cam stores GPS as a 20-byte PNDM binary struct in a subtitle / text / meta track inside the MP4 — not the GPMF format GoPro uses. Each sample carries fixed-point latitude, longitude and speed (mph internally; dashcamigo converts to m/s). Filenames follow the generic YYYYMMDD-HHMMSS.mp4 pattern, so file detection is content-based: dashcamigo probes the first sample of likely tracks for the PNDM magic and identifies the file from there.",
                faq: [
                    {
                        q: "Which Garmin Dash Cam models work?",
                        a: "Current Garmin Dash Cams that write the PNDM telemetry track: 67W, 66W, 57, 47, Mini 2, Mini 3, Live, Tandem, X-series. The parser detects PNDM by probing the first subtitle/text/meta sample — model identification doesn't depend on filename.",
                    },
                    {
                        q: "Do I need Garmin Express or Garmin Drive on my computer?",
                        a: "No. dashcamigo plays Garmin Dash Cam recordings without any Garmin software. Plug the SD card into your computer, drop the folder onto dashcamigo.app — trips appear with map and chart.",
                    },
                    {
                        q: "Will my Garmin recordings be uploaded?",
                        a: "No. There is no backend. The browser reads files locally and decodes them with WebCodecs. Nothing leaves your device.",
                    },
                    {
                        q: "Does dashcamigo show the Garmin Tandem cabin camera too?",
                        a: "Yes. Garmin Tandem writes two MP4 files per moment (road-facing and cabin-facing). dashcamigo groups them into one trip and plays both in sync. Click either channel to make it the main view.",
                    },
                    {
                        q: "Can I export a Garmin clip with GPS inside?",
                        a: "Yes. Drag a range on the speed chart, click Export — dashcamigo writes an MP4 with the GPS embedded as a fresh GPMF track (the standard format readable by Quik, Telemetry Overlay, ffmpeg). PNDM-to-GPMF conversion happens automatically on export.",
                    },
                ],
            },
            ru: {
                title: "Плеер Garmin Dash Cam — 67W, 57, Mini 2/3 | dashcamigo",
                metaDescription:
                    "Бесплатный онлайн-плеер Garmin Dash Cam. Открой записи 67W, 57, 47, Mini 2/3, Live и Tandem в браузере. Карта GPS, график скорости из трека PNDM.",
                ogTitle: "Плеер Garmin Dash Cam онлайн — 67W, 57, Mini 2/3, Live",
                ogDescription:
                    "Онлайн-плеер для записей Garmin Dash Cam. Карта GPS, график скорости. Без Garmin Express, без установки.",
                h1: "Плеер Garmin Dash Cam онлайн — записи в браузере",
                lead: "Открывай записи Garmin Dash Cam прямо в браузере. GPS, скорость и ускорение dashcamigo достаёт из трека телеметрии PNDM и рисует на синхронной карте и графике.",
                ctaPrimary: "Открыть папку с записями Garmin",
                modelsCompat: "и другие модели Garmin Dash Cam с треком телеметрии PNDM (большинство текущих и недавних поколений).",
                formatIntro:
                    "Garmin Dash Cam хранит GPS в виде 20-байтной бинарной структуры PNDM в субтитровом/текстовом/мета-треке внутри MP4 — это не GPMF (как у GoPro), а свой формат. Каждый sample содержит координаты с фиксированной точкой и скорость (внутри в милях в час, dashcamigo конвертирует в м/с). Имена файлов в общем формате YYYYMMDD-HHMMSS.mp4 — поэтому распознавание идёт по содержимому: dashcamigo читает первый sample подходящих треков и ищет magic PNDM.",
                faq: [
                    {
                        q: "Какие Garmin Dash Cam работают?",
                        a: "Текущие Garmin Dash Cam с треком PNDM: 67W, 66W, 57, 47, Mini 2, Mini 3, Live, Tandem, X-серия. Парсер определяет PNDM по содержимому, не по имени — так что модель опознаётся независимо от названия файла.",
                    },
                    {
                        q: "Нужен ли Garmin Express или Garmin Drive?",
                        a: "Нет. dashcamigo играет записи Garmin Dash Cam без программ вендора. Вставил SD-карту, перетащил папку — поездки появились с картой и графиком.",
                    },
                    {
                        q: "Куда уходят записи?",
                        a: "Никуда. Сервера нет. Браузер читает файлы локально и декодирует через WebCodecs. Наружу ничего не уходит.",
                    },
                    {
                        q: "Показывает ли dashcamigo салонную камеру Garmin Tandem?",
                        a: "Да. Garmin Tandem пишет два MP4 на один момент (дорога и салон). dashcamigo собирает их в одну поездку и играет синхронно. Кликни любой канал — он станет главным.",
                    },
                    {
                        q: "Можно ли вырезать кусок с GPS внутри?",
                        a: "Да. Выдели диапазон на графике, нажми Export — dashcamigo сохранит MP4 со свежим GPMF-треком внутри (стандартный формат, читается в Quik, Telemetry Overlay, ffmpeg). Конвертация PNDM → GPMF происходит на экспорте автоматически.",
                    },
                ],
            },
        },
    },
    {
        slug: "vantrue",
        displayName: "Vantrue",
        models: [
            "N1 Pro",
            "N2 Pro",
            "N2X",
            "N4",
            "N5 / N5 Pro",
            "E1",
            "E3",
            "E330",
            "S1 / S1 Pro",
            "X4S",
            "Sonnet 3",
        ],
        format: {
            container: "MP4",
            codec: "H.264 / H.265",
            gpsStorage: "Embedded freeGPS blocks (Novatek chipset, NMEA-style payload)",
            sdLayout: "/Normal/, /Event/, /Parking/ (front/rear/interior split on multi-channel models)",
            filenamePattern: "20240821_180010_0001_N_A.MP4",
        },
        locales: {
            en: {
                title: "Vantrue Dashcam Player & Editor — N4, N5, E3, X4S | dashcamigo",
                metaDescription:
                    "Free online Vantrue dashcam player and editor. Open N4, N5, E3, E330, S1, X4S and N2 recordings in your browser. GPS map, speed chart, trim and export. No upload, no install.",
                ogTitle: "Vantrue Player & Editor Online — N4, N5, E3, X4S",
                ogDescription:
                    "Free online player and editor for Vantrue dashcam recordings. GPS map, speed chart, trim and export. Works in any modern browser, nothing uploaded.",
                h1: "Vantrue Dashcam Player & Editor Online — play and trim in your browser",
                lead: "Open recordings from Vantrue dashcams directly in your browser. Synchronized GPS track, speed and G-force chart, multi-channel front/rear/cabin playback, plus trim and export. No Vantrue Cam app, no upload, no account.",
                ctaPrimary: "Open Vantrue recordings folder",
                modelsCompat:
                    "and most other Vantrue models built on the Novatek chipset family, which embed GPS as freeGPS blocks inside the MP4 (the same parser also handles Viofo, Akaso, Azdome, Kenwood and Nextbase 512GW).",
                formatIntro:
                    "Vantrue cameras (Novatek chipset) write H.264 or H.265 MP4 with GPS embedded directly inside the video file as freeGPS blocks — no separate log file. On most models the GPS payload is NMEA-style text inside that block. dashcamigo scans the file for the freeGPS structure, reads the route and renders it on the map automatically — drop the whole SD-card folder and the trip appears.",
                faq: [
                    {
                        q: "Which Vantrue models work in dashcamigo?",
                        a: "Vantrue cameras that embed GPS as Novatek freeGPS blocks work out of the box: N1 Pro, N2 Pro, N2X, N4, N5 / N5 Pro, E1, E3, E330, S1 / S1 Pro, X4S, Sonnet 3 and others. Models without the GPS module, or with the GPS antenna unplugged, still play — just without a route on the map.",
                    },
                    {
                        q: "Do I need the Vantrue Cam app or a desktop viewer?",
                        a: "No. dashcamigo plays Vantrue recordings without any Vantrue software or account. Plug the SD card into your computer, drop the folder onto dashcamigo.app — trips appear with map and chart in seconds. The Vantrue Cam app is for Wi-Fi access from a phone; for SD-card files on a PC or Mac, dashcamigo is a free alternative.",
                    },
                    {
                        q: "Will my Vantrue recordings be uploaded?",
                        a: "No. There is no backend. The browser reads files locally with the File System Access API and decodes them with WebCodecs. Nothing leaves your device.",
                    },
                    {
                        q: "Does dashcamigo handle dual- and three-channel Vantrue cameras (N4, N5, Sonnet 3)?",
                        a: "Yes. Vantrue multi-channel models write a front, rear and (on three-channel models) cabin file for the same moment. dashcamigo groups them into one trip and plays all channels in sync. Click any channel to make it the main view, or keep them side by side.",
                    },
                    {
                        q: "Can I trim and export a clip from a Vantrue recording?",
                        a: "Yes. Drag a range on the speed chart, click Export, and dashcamigo writes an MP4 with the GPS track embedded as GPMF metadata. The original H.264/H.265 video is stream-copied (no re-encoding) when possible, so export is fast and quality-lossless. You can also burn speed, coordinates and a mini-map onto the frame, or export the route as a separate .gpx.",
                    },
                ],
            },
            ru: {
                title: "Плеер и редактор Vantrue — N4, N5, E3, X4S | dashcamigo",
                metaDescription:
                    "Бесплатный онлайн-плеер и редактор Vantrue. Открой записи N4, N5, E3, E330, S1, X4S и N2 в браузере. Карта GPS, график скорости, обрезка и экспорт. Без загрузки и установки.",
                ogTitle: "Плеер и редактор Vantrue онлайн — N4, N5, E3, X4S",
                ogDescription:
                    "Онлайн-плеер и редактор для записей с Vantrue. Карта GPS, график скорости, обрезка и экспорт. Работает в любом современном браузере, ничего не загружается.",
                h1: "Плеер и редактор Vantrue онлайн — смотри и режь в браузере",
                lead: "Открывай записи с видеорегистраторов Vantrue прямо в браузере. Синхронный GPS-трек, график скорости и G-нагрузки, проигрывание фронта/тыла/салона, плюс обрезка и экспорт. Без приложения Vantrue Cam, без загрузки на сервер, без аккаунта.",
                ctaPrimary: "Открыть папку с записями Vantrue",
                modelsCompat:
                    "и большинство других моделей Vantrue на чипе Novatek, которые пишут GPS блоками freeGPS прямо в MP4 (тот же парсер берёт также Viofo, Akaso, Azdome, Kenwood и Nextbase 512GW).",
                formatIntro:
                    "Vantrue (чип Novatek) пишет H.264 или H.265 в MP4, GPS вшит прямо в видеофайл блоками freeGPS — отдельного лога нет. На большинстве моделей внутри блока лежит GPS в виде NMEA-текста. dashcamigo сканирует файл на структуру freeGPS, читает маршрут и сразу рисует его на карте — просто кинь всю папку SD-карты целиком.",
                faq: [
                    {
                        q: "Какие модели Vantrue работают в dashcamigo?",
                        a: "Vantrue, которые пишут GPS блоками freeGPS на Novatek: N1 Pro, N2 Pro, N2X, N4, N5 / N5 Pro, E1, E3, E330, S1 / S1 Pro, X4S, Sonnet 3 и другие. Модели без GPS-модуля или с отключённой антенной тоже играют — просто без маршрута на карте.",
                    },
                    {
                        q: "Нужно ли приложение Vantrue Cam или программа для ПК?",
                        a: "Нет. dashcamigo играет записи Vantrue без программ и аккаунта вендора. Вставь SD-карту в компьютер, перетащи папку на dashcamigo.app — поездки появятся с картой и графиком за секунды. Приложение Vantrue Cam нужно для доступа к камере по Wi-Fi; для файлов с SD-карты на ПК или Mac dashcamigo — бесплатная альтернатива.",
                    },
                    {
                        q: "Куда уходит видео?",
                        a: "Никуда. Сервера нет. Браузер читает файлы локально через File System Access API и декодирует через WebCodecs. Наружу ничего не уходит.",
                    },
                    {
                        q: "Поддерживаются ли двух- и трёхканальные Vantrue (N4, N5, Sonnet 3)?",
                        a: "Да. Многоканальные Vantrue пишут на один момент файл фронта, тыла и (на трёхканальных) салона. dashcamigo собирает их в одну поездку и проигрывает все каналы синхронно. Кликни любой канал — он станет главным, или оставь все рядом.",
                    },
                    {
                        q: "Можно ли вырезать и экспортировать кусок из записи Vantrue?",
                        a: "Да. Выдели диапазон на графике скорости, нажми Export — dashcamigo сохранит MP4 с GPS внутри (формат GPMF). Когда возможно, исходное H.264/H.265 stream-copy'ится без перекодирования — экспорт быстрый и без потери качества. Можно также наложить на кадр скорость, координаты и мини-карту или сохранить маршрут отдельным .gpx.",
                    },
                ],
            },
        },
    },
    {
        slug: "thinkware",
        displayName: "Thinkware",
        models: [
            "F200 / F200 Pro",
            "F750",
            "F770",
            "F800 / F800 Pro",
            "Q800 Pro",
            "U1000",
            "X1000",
            "F70",
        ],
        format: {
            container: "MP4",
            codec: "H.264 / H.265",
            gpsStorage: "NMEA-RMC sentences in a subtitle (sbtl) track",
            sdLayout: "/cont_rec/, /evt_rec/, /park_rec/, /manual_rec/",
            filenamePattern: "REC_20210101_120000_F.mp4",
        },
        locales: {
            en: {
                title: "Thinkware Dashcam Player & Editor — F800, Q800, U1000 | dashcamigo",
                metaDescription:
                    "Free online Thinkware dashcam player and editor. Open F800, F770, Q800 Pro, U1000 and X1000 recordings in your browser. GPS map, speed chart, trim and export. No upload, no install.",
                ogTitle: "Thinkware Player & Editor Online — F800, Q800, U1000",
                ogDescription:
                    "Free online player and editor for Thinkware dashcam recordings. GPS map, speed chart, trim and export. Works in any modern browser, nothing uploaded.",
                h1: "Thinkware Dashcam Player & Editor Online — play and trim in your browser",
                lead: "Open recordings from Thinkware dashcams directly in your browser. Synchronized GPS track, speed and G-force chart, front and rear playback, plus trim and export. No Thinkware Dashcam Viewer install, no upload, no account.",
                ctaPrimary: "Open Thinkware recordings folder",
                modelsCompat:
                    "and most other Thinkware F-series and newer models that write GPS as NMEA sentences into a subtitle track of the MP4.",
                formatIntro:
                    "Thinkware F-series cameras (F200, F750, F770, F800 and newer) store GPS as NMEA-RMC sentences inside a subtitle (sbtl) track of the MP4 — not a separate log file. Filenames follow REC_YYYYMMDD_HHMMSS_<F|R>.mp4, where F is the front and R the rear channel, and recordings are sorted into cont_rec / evt_rec / park_rec folders by mode. dashcamigo reads the subtitle NMEA track, joins it with the video and draws the route automatically.",
                faq: [
                    {
                        q: "Which Thinkware models work in dashcamigo?",
                        a: "Thinkware cameras that write the NMEA subtitle track work out of the box: F200 / F200 Pro, F750, F770, F800 / F800 Pro, Q800 Pro, U1000, X1000, F70 and others. Models recording without GPS, or with the GPS antenna detached, still play — just without a route on the map.",
                    },
                    {
                        q: "Do I need Thinkware Dashcam Viewer or the Thinkware Cloud app?",
                        a: "No. dashcamigo plays Thinkware recordings without any Thinkware software or account. Plug the SD card into your computer, drop the folder onto dashcamigo.app — trips appear with map and chart. The Thinkware Cloud and Dashcam Viewer apps route through Thinkware; dashcamigo is a free, fully-offline alternative for SD-card files.",
                    },
                    {
                        q: "Will my Thinkware recordings be uploaded?",
                        a: "No. There is no backend. The browser reads files locally with the File System Access API and decodes them with WebCodecs. Nothing leaves your device.",
                    },
                    {
                        q: "Does dashcamigo show both front and rear Thinkware cameras?",
                        a: "Yes. Thinkware dual-channel models write a front (F) and rear (R) file for the same moment. dashcamigo groups them into one trip and plays both in sync. Click either channel to make it the main view, or keep them side by side.",
                    },
                    {
                        q: "Can I trim and export a clip from a Thinkware recording?",
                        a: "Yes. Drag a range on the speed chart, click Export, and dashcamigo writes an MP4 with the GPS track embedded as GPMF metadata. The original H.264/H.265 video is stream-copied (no re-encoding) when possible. You can also burn speed, coordinates and a mini-map onto the frame, or export the route as a separate .gpx.",
                    },
                ],
            },
            ru: {
                title: "Плеер и редактор Thinkware — F800, Q800, U1000 | dashcamigo",
                metaDescription:
                    "Бесплатный онлайн-плеер и редактор Thinkware. Открой записи F800, F770, Q800 Pro, U1000 и X1000 в браузере. Карта GPS, график скорости, обрезка и экспорт. Без загрузки и установки.",
                ogTitle: "Плеер и редактор Thinkware онлайн — F800, Q800, U1000",
                ogDescription:
                    "Онлайн-плеер и редактор для записей с Thinkware. Карта GPS, график скорости, обрезка и экспорт. Работает в любом современном браузере, ничего не загружается.",
                h1: "Плеер и редактор Thinkware онлайн — смотри и режь в браузере",
                lead: "Открывай записи с видеорегистраторов Thinkware прямо в браузере. Синхронный GPS-трек, график скорости и G-нагрузки, проигрывание фронта и тыла, плюс обрезка и экспорт. Без программы Thinkware Dashcam Viewer, без загрузки на сервер, без аккаунта.",
                ctaPrimary: "Открыть папку с записями Thinkware",
                modelsCompat:
                    "и большинство других моделей Thinkware F-серии и новее, которые пишут GPS NMEA-строками в субтитровый трек MP4.",
                formatIntro:
                    "Thinkware F-серии (F200, F750, F770, F800 и новее) хранят GPS как NMEA-RMC-строки в субтитровом (sbtl) треке MP4 — отдельного лога нет. Имена файлов: REC_YYYYMMDD_HHMMSS_<F|R>.mp4, где F — фронт, R — тыл, а записи разложены по папкам cont_rec / evt_rec / park_rec по режиму. dashcamigo читает NMEA из субтитрового трека, связывает с видео и сразу рисует маршрут.",
                faq: [
                    {
                        q: "Какие модели Thinkware работают в dashcamigo?",
                        a: "Thinkware, которые пишут NMEA в субтитровый трек: F200 / F200 Pro, F750, F770, F800 / F800 Pro, Q800 Pro, U1000, X1000, F70 и другие. Модели без GPS или с отключённой антенной тоже играют — просто без маршрута на карте.",
                    },
                    {
                        q: "Нужна ли программа Thinkware Dashcam Viewer или приложение Thinkware Cloud?",
                        a: "Нет. dashcamigo играет записи Thinkware без программ и аккаунта вендора. Вставь SD-карту, перетащи папку на dashcamigo.app — поездки появятся с картой и графиком. Приложения Thinkware Cloud и Dashcam Viewer гонят данные через Thinkware; dashcamigo — бесплатная и полностью офлайновая альтернатива для файлов с SD-карты.",
                    },
                    {
                        q: "Куда уходит видео?",
                        a: "Никуда. Сервера нет. Браузер читает файлы локально через File System Access API и декодирует через WebCodecs. Наружу ничего не уходит.",
                    },
                    {
                        q: "Показывает ли dashcamigo фронт и тыл Thinkware вместе?",
                        a: "Да. Двухканальные Thinkware пишут на один момент файл фронта (F) и тыла (R). dashcamigo собирает их в одну поездку и проигрывает синхронно. Кликни любой канал — он станет главным, или оставь рядом.",
                    },
                    {
                        q: "Можно ли вырезать и экспортировать кусок из записи Thinkware?",
                        a: "Да. Выдели диапазон на графике скорости, нажми Export — dashcamigo сохранит MP4 с GPS внутри (формат GPMF). Когда возможно, исходное H.264/H.265 stream-copy'ится без перекодирования. Можно также наложить на кадр скорость, координаты и мини-карту или сохранить маршрут отдельным .gpx.",
                    },
                ],
            },
        },
    },
];

// Index page copy. /cameras/ is a section landing - lists every vendor
// page with short blurbs. Exists primarily to make the BreadcrumbList
// item URL on each vendor page (Home > Cameras > Vendor) resolve to 200
// instead of a SPA-fallback - Google's rich-results test rejects breadcrumbs
// whose middle item is a soft-404. The page also captures broader queries
// like "supported dashcam brands player" by its own right.
interface IndexLocale {
    title: string;
    metaDescription: string;
    ogTitle: string;
    ogDescription: string;
    h1: string;
    lead: string;
    cardHintPrefix: string;
}

const INDEX_LOCALES: Record<Lang, IndexLocale> = {
    en: {
        title: "Supported dashcam brands | dashcamigo",
        metaDescription:
            "All dashcam brands supported by dashcamigo - 70mai, Viofo, BlackVue, GoPro, Garmin and more. Open recordings in your browser, no install, no upload.",
        ogTitle: "Supported dashcam brands — play recordings online",
        ogDescription:
            "All dashcam brands supported by dashcamigo. Pick yours - open recordings in your browser, no install needed.",
        h1: "Supported dashcam brands",
        lead: "dashcamigo plays recordings from these brands directly in your browser. Pick yours for the deep dive on supported models, file format and FAQ. No install, no upload, no account.",
        cardHintPrefix: "Format:",
    },
    ru: {
        title: "Поддерживаемые регистраторы | dashcamigo",
        metaDescription:
            "Все регистраторы, которые поддерживает dashcamigo - 70mai, Viofo, BlackVue, GoPro, Garmin и другие. Открой записи в браузере, без установки и без загрузки.",
        ogTitle: "Поддерживаемые регистраторы — записи в браузере",
        ogDescription:
            "Все регистраторы, которые поддерживает dashcamigo. Выбери свой и проваливайся в детали — записи в браузере, без установки.",
        h1: "Поддерживаемые регистраторы",
        lead: "dashcamigo воспроизводит записи этих марок прямо в браузере. Выбери свою — там подробности про модели, формат файлов и частые вопросы. Без установки, без загрузки, без аккаунта.",
        cardHintPrefix: "Формат:",
    },
    de: {
        title: "Unterstützte Dashcam-Marken | dashcamigo",
        metaDescription:
            "Alle Dashcam-Marken, die dashcamigo unterstützt - 70mai, Viofo, BlackVue, GoPro, Garmin und mehr. Aufnahmen im Browser öffnen, keine Installation, kein Upload.",
        ogTitle: "Unterstützte Dashcam-Marken — Aufnahmen online abspielen",
        ogDescription:
            "Alle von dashcamigo unterstützten Dashcam-Marken. Wähle deine - Aufnahmen direkt im Browser, ohne Installation.",
        h1: "Unterstützte Dashcam-Marken",
        lead: "dashcamigo spielt Aufnahmen dieser Marken direkt im Browser ab. Wähle deine für Details zu unterstützten Modellen, Dateiformat und FAQ. Keine Installation, kein Upload, kein Konto.",
        cardHintPrefix: "Format:",
    },
    es: {
        title: "Marcas de dashcam compatibles | dashcamigo",
        metaDescription:
            "Todas las marcas de dashcam compatibles con dashcamigo - 70mai, Viofo, BlackVue, GoPro, Garmin y más. Abre las grabaciones en tu navegador, sin instalar nada, sin subir archivos.",
        ogTitle: "Marcas de dashcam compatibles — reproducir online",
        ogDescription:
            "Todas las marcas de dashcam compatibles con dashcamigo. Elige la tuya - abre las grabaciones directamente en el navegador.",
        h1: "Marcas de dashcam compatibles",
        lead: "dashcamigo reproduce grabaciones de estas marcas directamente en el navegador. Elige la tuya para ver modelos compatibles, formato de archivo y preguntas frecuentes. Sin instalar, sin subir, sin cuenta.",
        cardHintPrefix: "Formato:",
    },
    fr: {
        title: "Marques de dashcam compatibles | dashcamigo",
        metaDescription:
            "Toutes les marques de dashcam prises en charge par dashcamigo - 70mai, Viofo, BlackVue, GoPro, Garmin et plus. Ouvre les enregistrements dans ton navigateur, sans installation, sans téléversement.",
        ogTitle: "Marques de dashcam prises en charge — lecture en ligne",
        ogDescription:
            "Toutes les marques de dashcam prises en charge par dashcamigo. Choisis la tienne - ouvre les enregistrements directement dans le navigateur.",
        h1: "Marques de dashcam prises en charge",
        lead: "dashcamigo lit les enregistrements de ces marques directement dans le navigateur. Choisis la tienne pour les détails sur les modèles, le format et la FAQ. Sans installation, sans téléversement, sans compte.",
        cardHintPrefix: "Format :",
    },
    pl: {
        title: "Obsługiwane marki wideorejestratorów | dashcamigo",
        metaDescription:
            "Wszystkie marki wideorejestratorów obsługiwane przez dashcamigo - 70mai, Viofo, BlackVue, GoPro, Garmin i inne. Otwórz nagrania w przeglądarce, bez instalacji i wysyłania plików.",
        ogTitle: "Obsługiwane marki wideorejestratorów — odtwarzanie online",
        ogDescription:
            "Wszystkie obsługiwane przez dashcamigo marki wideorejestratorów. Wybierz swoją - otwórz nagrania w przeglądarce, bez instalacji.",
        h1: "Obsługiwane marki wideorejestratorów",
        lead: "dashcamigo odtwarza nagrania z tych marek prosto w przeglądarce. Wybierz swoją - tam szczegóły o obsługiwanych modelach, formacie plików i FAQ. Bez instalacji, bez wysyłania plików, bez konta.",
        cardHintPrefix: "Format:",
    },
    pt: {
        title: "Marcas de dashcam compatíveis | dashcamigo",
        metaDescription:
            "Todas as marcas de dashcam suportadas pelo dashcamigo - 70mai, Viofo, BlackVue, GoPro, Garmin e outras. Abra as gravações no seu navegador, sem instalar nada, sem fazer upload.",
        ogTitle: "Marcas de dashcam compatíveis — reproduzir online",
        ogDescription:
            "Todas as marcas de dashcam suportadas pelo dashcamigo. Escolha a sua - abra as gravações direto no navegador, sem instalação.",
        h1: "Marcas de dashcam compatíveis",
        lead: "O dashcamigo reproduz gravações dessas marcas direto no navegador. Escolha a sua para detalhes sobre modelos suportados, formato dos arquivos e FAQ. Sem instalação, sem upload, sem conta.",
        cardHintPrefix: "Formato:",
    },
    zh: {
        title: "支持的行车记录仪品牌 | dashcamigo",
        metaDescription:
            "dashcamigo 支持的所有行车记录仪品牌 — 70mai、Viofo、BlackVue、GoPro、Garmin 及更多。直接在浏览器中打开录像，无需安装，无需上传。",
        ogTitle: "支持的行车记录仪品牌 — 在线播放",
        ogDescription:
            "dashcamigo 支持的所有行车记录仪品牌。选择你的品牌 — 直接在浏览器中打开录像，无需安装。",
        h1: "支持的行车记录仪品牌",
        lead: "dashcamigo 直接在浏览器中播放这些品牌的录像。选择你的品牌，查看支持的型号、文件格式和常见问题。无需安装，无需上传，无需账号。",
        cardHintPrefix: "格式:",
    },
    ja: {
        title: "対応ドライブレコーダーブランド | dashcamigo",
        metaDescription:
            "dashcamigo が対応している全ドライブレコーダーブランド - 70mai、Viofo、BlackVue、GoPro、Garmin など。録画ファイルをブラウザでそのまま再生、インストールもアップロードも不要です。",
        ogTitle: "対応ドライブレコーダーブランド — オンライン再生",
        ogDescription:
            "dashcamigo が対応している全ブランド。あなたのブランドを選んで、録画ファイルをブラウザでそのまま再生。インストール不要。",
        h1: "対応ドライブレコーダーブランド",
        lead: "dashcamigo はこれらのブランドの録画をブラウザで直接再生します。あなたのブランドを選んで、対応モデル、ファイル形式、FAQ をご覧ください。インストール、アップロード、アカウント登録、すべて不要。",
        cardHintPrefix: "形式:",
    },
    ko: {
        title: "지원되는 블랙박스 브랜드 | dashcamigo",
        metaDescription:
            "dashcamigo가 지원하는 모든 블랙박스 브랜드 - 70mai, Viofo, BlackVue, GoPro, Garmin 등. 녹화 파일을 브라우저에서 바로 열 수 있어요. 설치 없이, 업로드 없이.",
        ogTitle: "지원되는 블랙박스 브랜드 — 온라인 재생",
        ogDescription:
            "dashcamigo가 지원하는 모든 블랙박스 브랜드. 본인의 브랜드를 선택해서 녹화를 브라우저에서 바로 재생하세요.",
        h1: "지원되는 블랙박스 브랜드",
        lead: "dashcamigo는 이 브랜드들의 녹화를 브라우저에서 바로 재생해요. 본인의 브랜드를 골라서 지원 모델, 파일 형식, 자주 묻는 질문을 확인하세요. 설치, 업로드, 가입 모두 필요 없어요.",
        cardHintPrefix: "형식:",
    },
};

// Shared section labels - per locale, NOT per vendor. {vendor} is substituted
// at template time with the displayName. Keeps vendor data lean - we don't
// repeat "FAQ" or "Supported {vendor} models" headings 5 times.
const SHARED_LABELS: Record<Lang, SharedLabels> = {
    en: {
        backToPlayer: "← Back to player",
        breadcrumbHome: "Home",
        breadcrumbCameras: "Cameras",
        modelsHeading: "Supported {vendor} models",
        formatHeading: "How {vendor} stores recordings",
        formatFactsHeading: "Format facts",
        formatLabelContainer: "Container",
        formatLabelCodec: "Video codec",
        formatLabelGps: "GPS storage",
        formatLabelLayout: "Folder layout on SD",
        formatLabelFilename: "Filename pattern",
        howHeading: "Playing {vendor} recordings in dashcamigo",
        howSteps: [
            "Take the SD card out of the dashcam, plug it into your computer.",
            "Open dashcamigo.app in any modern browser.",
            "Drag the whole SD-card folder onto the page — it'll detect, group and play.",
        ],
        howSecondaryCta: "Try it now",
        faqHeading: "FAQ",
        otherVendorsHeading: "Other supported brands",
        footerPrivacy: "Privacy policy",
        footerTerms: "Terms of use",
        footerHome: "dashcamigo.app",
        notListedText: "Don't see your camera? We add support from real recordings — yours is probably next.",
        notListedCta: "Add your dashcam",
    },
    ru: {
        backToPlayer: "← К плееру",
        breadcrumbHome: "Главная",
        breadcrumbCameras: "Регистраторы",
        modelsHeading: "Поддерживаемые модели {vendor}",
        formatHeading: "Как {vendor} хранит записи",
        formatFactsHeading: "Технические факты",
        formatLabelContainer: "Контейнер",
        formatLabelCodec: "Кодек видео",
        formatLabelGps: "Где GPS",
        formatLabelLayout: "Раскладка на SD",
        formatLabelFilename: "Шаблон имени файла",
        howHeading: "Как открыть записи {vendor} в dashcamigo",
        howSteps: [
            "Достань SD-карту из регистратора, вставь в компьютер.",
            "Открой dashcamigo.app в любом современном браузере.",
            "Перетащи всю папку с SD-карты на страницу — она сама всё разберёт и проиграет.",
        ],
        howSecondaryCta: "Попробовать",
        faqHeading: "Частые вопросы",
        otherVendorsHeading: "Другие поддерживаемые бренды",
        footerPrivacy: "Политика конфиденциальности",
        footerTerms: "Условия использования",
        footerHome: "dashcamigo.app",
        notListedText: "Не нашёл свой регистратор? Мы добавляем поддержку по реальным записям — твой, скорее всего, следующий.",
        notListedCta: "Добавить свой регистратор",
    },
    de: {
        backToPlayer: "← Zurück zum Player",
        breadcrumbHome: "Start",
        breadcrumbCameras: "Kameras",
        modelsHeading: "Unterstützte {vendor}-Modelle",
        formatHeading: "Wie {vendor} Aufnahmen speichert",
        formatFactsHeading: "Format-Fakten",
        formatLabelContainer: "Container",
        formatLabelCodec: "Video-Codec",
        formatLabelGps: "GPS-Speicherung",
        formatLabelLayout: "Ordnerstruktur auf SD",
        formatLabelFilename: "Dateinamenschema",
        howHeading: "{vendor}-Aufnahmen in dashcamigo abspielen",
        howSteps: [
            "Nimm die SD-Karte aus der Dashcam und stecke sie in deinen Computer.",
            "Öffne dashcamigo.app in einem modernen Browser.",
            "Ziehe den gesamten SD-Karten-Ordner auf die Seite — sie erkennt, gruppiert und spielt ab.",
        ],
        howSecondaryCta: "Jetzt ausprobieren",
        faqHeading: "FAQ",
        otherVendorsHeading: "Weitere unterstützte Marken",
        footerPrivacy: "Datenschutzerklärung",
        footerTerms: "Nutzungsbedingungen",
        footerHome: "dashcamigo.app",
        notListedText: "Deine Dashcam nicht dabei? Wir fügen Unterstützung aus echten Aufnahmen hinzu — deine ist wahrscheinlich als Nächste dran.",
        notListedCta: "Deine Dashcam hinzufügen",
    },
    es: {
        backToPlayer: "← Volver al reproductor",
        breadcrumbHome: "Inicio",
        breadcrumbCameras: "Cámaras",
        modelsHeading: "Modelos {vendor} compatibles",
        formatHeading: "Cómo {vendor} guarda las grabaciones",
        formatFactsHeading: "Datos del formato",
        formatLabelContainer: "Contenedor",
        formatLabelCodec: "Códec de vídeo",
        formatLabelGps: "Almacenamiento GPS",
        formatLabelLayout: "Estructura en la SD",
        formatLabelFilename: "Patrón de nombre de archivo",
        howHeading: "Reproducir grabaciones de {vendor} en dashcamigo",
        howSteps: [
            "Saca la tarjeta SD de la dashcam y conéctala al ordenador.",
            "Abre dashcamigo.app en cualquier navegador moderno.",
            "Arrastra toda la carpeta de la SD a la página — detecta, agrupa y reproduce.",
        ],
        howSecondaryCta: "Pruébalo ya",
        faqHeading: "Preguntas frecuentes",
        otherVendorsHeading: "Otras marcas compatibles",
        footerPrivacy: "Política de privacidad",
        footerTerms: "Términos de uso",
        footerHome: "dashcamigo.app",
        notListedText: "¿No ves tu cámara? Añadimos compatibilidad a partir de grabaciones reales — la tuya seguramente es la próxima.",
        notListedCta: "Añade tu cámara de coche",
    },
    fr: {
        backToPlayer: "← Retour au lecteur",
        breadcrumbHome: "Accueil",
        breadcrumbCameras: "Caméras",
        modelsHeading: "Modèles {vendor} pris en charge",
        formatHeading: "Comment {vendor} stocke les enregistrements",
        formatFactsHeading: "Détails du format",
        formatLabelContainer: "Conteneur",
        formatLabelCodec: "Codec vidéo",
        formatLabelGps: "Stockage GPS",
        formatLabelLayout: "Structure des dossiers sur la SD",
        formatLabelFilename: "Modèle de nom de fichier",
        howHeading: "Lire les enregistrements {vendor} dans dashcamigo",
        howSteps: [
            "Sors la carte SD de la dashcam et branche-la sur ton ordinateur.",
            "Ouvre dashcamigo.app dans n'importe quel navigateur moderne.",
            "Glisse tout le dossier de la carte SD sur la page — elle détecte, regroupe et lit.",
        ],
        howSecondaryCta: "Essayer maintenant",
        faqHeading: "FAQ",
        otherVendorsHeading: "Autres marques prises en charge",
        footerPrivacy: "Politique de confidentialité",
        footerTerms: "Conditions d'utilisation",
        footerHome: "dashcamigo.app",
        notListedText: "Tu ne vois pas ta dashcam ? On ajoute la prise en charge à partir de vrais enregistrements — la tienne est sûrement la prochaine.",
        notListedCta: "Ajouter ta dashcam",
    },
    pl: {
        backToPlayer: "← Wróć do odtwarzacza",
        breadcrumbHome: "Start",
        breadcrumbCameras: "Kamery",
        modelsHeading: "Obsługiwane modele {vendor}",
        formatHeading: "Jak {vendor} zapisuje nagrania",
        formatFactsHeading: "Informacje o formacie",
        formatLabelContainer: "Kontener",
        formatLabelCodec: "Kodek wideo",
        formatLabelGps: "Zapis GPS",
        formatLabelLayout: "Struktura folderów na SD",
        formatLabelFilename: "Wzorzec nazwy pliku",
        howHeading: "Odtwarzanie nagrań {vendor} w dashcamigo",
        howSteps: [
            "Wyjmij kartę SD z wideorejestratora i podłącz do komputera.",
            "Otwórz dashcamigo.app w dowolnej nowoczesnej przeglądarce.",
            "Przeciągnij cały folder karty SD na stronę — sama wykryje, pogrupuje i odtworzy.",
        ],
        howSecondaryCta: "Wypróbuj teraz",
        faqHeading: "Częste pytania",
        otherVendorsHeading: "Inne obsługiwane marki",
        footerPrivacy: "Polityka prywatności",
        footerTerms: "Warunki korzystania",
        footerHome: "dashcamigo.app",
        notListedText: "Nie widzisz swojego wideorejestratora? Wsparcie dodajemy na podstawie prawdziwych nagrań — twój pewnie będzie następny.",
        notListedCta: "Dodaj swój wideorejestrator",
    },
    pt: {
        backToPlayer: "← Voltar ao player",
        breadcrumbHome: "Início",
        breadcrumbCameras: "Câmeras",
        modelsHeading: "Modelos {vendor} compatíveis",
        formatHeading: "Como a {vendor} armazena as gravações",
        formatFactsHeading: "Dados do formato",
        formatLabelContainer: "Contêiner",
        formatLabelCodec: "Codec de vídeo",
        formatLabelGps: "Armazenamento do GPS",
        formatLabelLayout: "Estrutura na SD",
        formatLabelFilename: "Padrão de nome de arquivo",
        howHeading: "Reproduzir gravações da {vendor} no dashcamigo",
        howSteps: [
            "Tire o cartão SD da dashcam e conecte ao computador.",
            "Abra o dashcamigo.app em qualquer navegador moderno.",
            "Arraste a pasta inteira do cartão SD para a página — ela detecta, agrupa e reproduz.",
        ],
        howSecondaryCta: "Experimente agora",
        faqHeading: "Perguntas frequentes",
        otherVendorsHeading: "Outras marcas compatíveis",
        footerPrivacy: "Política de privacidade",
        footerTerms: "Termos de uso",
        footerHome: "dashcamigo.app",
        notListedText: "Não encontrou sua câmera? Adicionamos suporte a partir de gravações reais — a sua provavelmente é a próxima.",
        notListedCta: "Adicione sua dashcam",
    },
    zh: {
        backToPlayer: "← 返回播放器",
        breadcrumbHome: "首页",
        breadcrumbCameras: "记录仪",
        modelsHeading: "支持的 {vendor} 型号",
        formatHeading: "{vendor} 如何存储录像",
        formatFactsHeading: "格式信息",
        formatLabelContainer: "容器",
        formatLabelCodec: "视频编码",
        formatLabelGps: "GPS 存储",
        formatLabelLayout: "SD 卡目录结构",
        formatLabelFilename: "文件名规则",
        howHeading: "在 dashcamigo 中播放 {vendor} 录像",
        howSteps: [
            "把 SD 卡从记录仪取出，插入电脑。",
            "在任意现代浏览器中打开 dashcamigo.app。",
            "把整个 SD 卡文件夹拖到页面上 — 自动识别、分组并播放。",
        ],
        howSecondaryCta: "立即试用",
        faqHeading: "常见问题",
        otherVendorsHeading: "其他支持的品牌",
        footerPrivacy: "隐私政策",
        footerTerms: "使用条款",
        footerHome: "dashcamigo.app",
        notListedText: "没看到你的行车记录仪？我们会根据真实录像添加支持 — 下一个说不定就是你的。",
        notListedCta: "添加你的行车记录仪",
    },
    ja: {
        backToPlayer: "← プレーヤーに戻る",
        breadcrumbHome: "ホーム",
        breadcrumbCameras: "ドラレコ",
        modelsHeading: "対応 {vendor} モデル",
        formatHeading: "{vendor} の録画保存方式",
        formatFactsHeading: "フォーマット情報",
        formatLabelContainer: "コンテナ",
        formatLabelCodec: "映像コーデック",
        formatLabelGps: "GPS 保存形式",
        formatLabelLayout: "SD カードのフォルダ構成",
        formatLabelFilename: "ファイル名パターン",
        howHeading: "{vendor} の録画を dashcamigo で再生する",
        howSteps: [
            "ドライブレコーダーから SD カードを取り出してパソコンに接続します。",
            "モダンブラウザで dashcamigo.app を開きます。",
            "SD カードのフォルダ全体をページにドラッグすると、自動で認識・グループ化して再生されます。",
        ],
        howSecondaryCta: "今すぐ試す",
        faqHeading: "よくある質問",
        otherVendorsHeading: "対応している他のブランド",
        footerPrivacy: "プライバシーポリシー",
        footerTerms: "利用規約",
        footerHome: "dashcamigo.app",
        notListedText: "お使いのカメラが見当たりませんか？実際の録画をもとに対応を追加しています — 次はあなたの機種かもしれません。",
        notListedCta: "ドライブレコーダーを追加",
    },
    ko: {
        backToPlayer: "← 플레이어로 돌아가기",
        breadcrumbHome: "홈",
        breadcrumbCameras: "블랙박스",
        modelsHeading: "지원하는 {vendor} 모델",
        formatHeading: "{vendor}는 녹화를 어떻게 저장하나요",
        formatFactsHeading: "포맷 정보",
        formatLabelContainer: "컨테이너",
        formatLabelCodec: "비디오 코덱",
        formatLabelGps: "GPS 저장 방식",
        formatLabelLayout: "SD 카드 폴더 구조",
        formatLabelFilename: "파일명 패턴",
        howHeading: "dashcamigo에서 {vendor} 녹화 재생하기",
        howSteps: [
            "블랙박스에서 SD 카드를 빼서 컴퓨터에 연결하세요.",
            "최신 브라우저에서 dashcamigo.app을 여세요.",
            "SD 카드 폴더 전체를 페이지로 끌어다 놓으면 — 자동으로 인식·그룹화하고 재생해요.",
        ],
        howSecondaryCta: "지금 사용해보기",
        faqHeading: "자주 묻는 질문",
        otherVendorsHeading: "지원하는 다른 브랜드",
        footerPrivacy: "개인정보 처리방침",
        footerTerms: "이용약관",
        footerHome: "dashcamigo.app",
        notListedText: "찾는 블랙박스가 없나요? 실제 녹화로 지원을 넓혀가요 — 다음 차례는 아마 그 블랙박스일 거예요.",
        notListedCta: "내 블랙박스 추가하기",
    },
};

interface SharedLabels {
    backToPlayer: string;
    breadcrumbHome: string;
    breadcrumbCameras: string;
    modelsHeading: string;
    formatHeading: string;
    formatFactsHeading: string;
    formatLabelContainer: string;
    formatLabelCodec: string;
    formatLabelGps: string;
    formatLabelLayout: string;
    formatLabelFilename: string;
    howHeading: string;
    howSteps: [string, string, string];
    howSecondaryCta: string;
    faqHeading: string;
    otherVendorsHeading: string;
    // "Not listed?" invitation into /add-my-camera - a coverage gap is a reason
    // to get in touch, never a dead end (voice.md).
    notListedText: string;
    notListedCta: string;
    footerPrivacy: string;
    footerTerms: string;
    footerHome: string;
}

// Generic, vendor-agnostic templates for the 8 community locales that don't
// have hand-written vendor-specific copy. Each template has {vendor} placeholders
// the renderer substitutes with displayName. The page produced is shorter than
// the en/ru pages (no vendor-specific FAQ - that would be 5 × 8 = 40 near-
// identical templated FAQs, which the Helpful Content Update treats as thin).
// Instead the community page has: title, meta, og:*, h1, lead, models list,
// format facts (vendor-agnostic technical strings) and the standard "how to use"
// steps from SHARED_LABELS.
interface VendorTemplate {
    title: string;
    metaDescription: string;
    ogTitle: string;
    ogDescription: string;
    h1: string;
    lead: string;
    ctaPrimary: string;
    modelsCompat: string;
    formatIntro: string;
}

const VENDOR_TEMPLATES: Partial<Record<Lang, VendorTemplate>> = {
    de: {
        title: "{vendor} Dashcam-Player & Viewer | dashcamigo",
        metaDescription:
            "Kostenloser Online-Player für {vendor}-Dashcam-Aufnahmen. Öffne deine Aufzeichnungen direkt im Browser. GPS-Karte, Geschwindigkeitsdiagramm, Multikanal-Wiedergabe. Kein Upload, keine Installation.",
        ogTitle: "{vendor} Dashcam-Player Online",
        ogDescription:
            "Kostenloser Online-Player für {vendor}-Aufnahmen. GPS-Karte, Geschwindigkeitsdiagramm. Funktioniert in jedem modernen Browser.",
        h1: "{vendor} Dashcam-Player Online — Aufnahmen im Browser",
        lead: "Öffne Aufzeichnungen deiner {vendor}-Dashcam direkt im Browser. Synchronisierte GPS-Strecke, Geschwindigkeits- und G-Kraft-Diagramm, Mehrkanal-Wiedergabe (vorn, hinten, Innenraum). Kein {vendor}-App-Setup, kein Upload, kein Konto.",
        ctaPrimary: "{vendor}-Aufnahmen öffnen",
        modelsCompat:
            "und die meisten anderen aktuellen {vendor}-Modelle, die ein Standard-Aufzeichnungsformat verwenden. Die vollständige Liste der unterstützten Formate findest du auf der Hauptseite.",
        formatIntro:
            "{vendor}-Dashcams nehmen {codec}-Video in {container}-Dateien auf. Die Aufnahmen folgen dem Namensschema {filename} und werden auf der SD-Karte in die Ordner {layout} einsortiert. dashcamigo erkennt das automatisch, gruppiert die Dateien zu Fahrten und zeichnet die GPS-Strecke auf der Karte — zieh einfach den gesamten SD-Karten-Ordner auf die Seite.",
    },
    es: {
        title: "Reproductor {vendor} | dashcamigo",
        metaDescription:
            "Reproductor online gratis para grabaciones de dashcam {vendor}. Abre las grabaciones directamente en el navegador. Mapa GPS, gráfico de velocidad, multicanal. Sin subidas, sin instalar.",
        ogTitle: "Reproductor {vendor} online",
        ogDescription:
            "Reproductor online gratis para grabaciones de {vendor}. Mapa GPS, gráfico de velocidad. Funciona en cualquier navegador moderno.",
        h1: "Reproductor {vendor} online — grabaciones en el navegador",
        lead: "Abre las grabaciones de tu dashcam {vendor} directamente en el navegador. Ruta GPS sincronizada, gráfico de velocidad y fuerza G, reproducción multicanal (frontal, trasera, interior). Sin instalar la app de {vendor}, sin subir nada, sin cuenta.",
        ctaPrimary: "Abrir grabaciones de {vendor}",
        modelsCompat:
            "y la mayoría de modelos {vendor} actuales que usan un formato de grabación estándar. La lista completa de formatos compatibles está en la página principal.",
        formatIntro:
            "Las dashcams {vendor} graban vídeo {codec} en archivos {container}. Las grabaciones siguen el patrón de nombre {filename} y se ordenan en las carpetas {layout} de la tarjeta SD. dashcamigo lo detecta automáticamente, agrupa los archivos en trayectos y dibuja la ruta GPS en el mapa: solo tienes que arrastrar la carpeta entera de la tarjeta SD a la página.",
    },
    fr: {
        title: "Lecteur {vendor} | dashcamigo",
        metaDescription:
            "Lecteur en ligne gratuit pour les enregistrements de dashcam {vendor}. Ouvre tes enregistrements directement dans le navigateur. Carte GPS, graphique de vitesse, multicanal. Sans téléversement, sans installation.",
        ogTitle: "Lecteur {vendor} en ligne",
        ogDescription:
            "Lecteur en ligne gratuit pour les enregistrements {vendor}. Carte GPS, graphique de vitesse. Fonctionne dans n'importe quel navigateur moderne.",
        h1: "Lecteur {vendor} en ligne — enregistrements dans le navigateur",
        lead: "Ouvre les enregistrements de ta dashcam {vendor} directement dans le navigateur. Trace GPS synchronisée, graphique de vitesse et force G, lecture multicanal (avant, arrière, habitacle). Pas d'installation de l'app {vendor}, pas de téléversement, pas de compte.",
        ctaPrimary: "Ouvrir les enregistrements {vendor}",
        modelsCompat:
            "et la plupart des autres modèles {vendor} récents qui utilisent un format d'enregistrement standard. La liste complète des formats pris en charge est sur la page principale.",
        formatIntro:
            "Les dashcams {vendor} enregistrent de la vidéo {codec} dans des fichiers {container}. Les enregistrements suivent le modèle de nom {filename} et sont rangés dans les dossiers {layout} sur la carte SD. dashcamigo détecte tout cela automatiquement, regroupe les fichiers en trajets et trace l'itinéraire GPS sur la carte — il te suffit de glisser le dossier complet de la carte SD sur la page.",
    },
    pl: {
        title: "Odtwarzacz {vendor} | dashcamigo",
        metaDescription:
            "Darmowy odtwarzacz online dla nagrań z wideorejestratora {vendor}. Otwórz nagrania prosto w przeglądarce. Mapa GPS, wykres prędkości, multikanał. Bez wysyłania plików, bez instalacji.",
        ogTitle: "Odtwarzacz {vendor} online",
        ogDescription:
            "Darmowy odtwarzacz online dla nagrań {vendor}. Mapa GPS, wykres prędkości. Działa w każdej nowoczesnej przeglądarce.",
        h1: "Odtwarzacz {vendor} online — nagrania w przeglądarce",
        lead: "Otwórz nagrania ze swojego wideorejestratora {vendor} prosto w przeglądarce. Synchronizowana trasa GPS, wykres prędkości i przeciążeń, odtwarzanie wielokanałowe (przód, tył, kabina). Bez instalowania aplikacji {vendor}, bez wysyłania plików, bez konta.",
        ctaPrimary: "Otwórz nagrania {vendor}",
        modelsCompat:
            "i większość innych aktualnych modeli {vendor}, które używają standardowego formatu nagrywania. Pełną listę obsługiwanych formatów znajdziesz na stronie głównej.",
        formatIntro:
            "Wideorejestratory {vendor} nagrywają obraz w kodeku {codec} do plików {container}. Nagrania mają nazwy według wzorca {filename} i są posortowane do folderów {layout} na karcie SD. dashcamigo wykrywa to automatycznie, grupuje pliki w przejazdy i rysuje trasę GPS na mapie — wystarczy przeciągnąć cały folder karty SD na stronę.",
    },
    pt: {
        title: "Player {vendor} | dashcamigo",
        metaDescription:
            "Player online gratuito para gravações da dashcam {vendor}. Abra as gravações direto no navegador. Mapa GPS, gráfico de velocidade, multicanal. Sem upload, sem instalação.",
        ogTitle: "Player {vendor} online",
        ogDescription:
            "Player online gratuito para gravações da {vendor}. Mapa GPS, gráfico de velocidade. Funciona em qualquer navegador moderno.",
        h1: "Player {vendor} online — gravações no navegador",
        lead: "Abra as gravações da sua dashcam {vendor} direto no navegador. Trajeto GPS sincronizado, gráfico de velocidade e força G, reprodução multicanal (frente, traseira, interior). Sem instalar o app da {vendor}, sem upload, sem conta.",
        ctaPrimary: "Abrir gravações da {vendor}",
        modelsCompat:
            "e a maioria dos outros modelos atuais da {vendor} que usam um formato de gravação padrão. A lista completa de formatos suportados está na página principal.",
        formatIntro:
            "As dashcams da {vendor} gravam vídeo em {codec} dentro de arquivos {container}. As gravações seguem o padrão de nome {filename} e ficam organizadas nas pastas {layout} do cartão SD. O dashcamigo detecta tudo isso automaticamente, agrupa os arquivos em viagens e desenha o trajeto GPS no mapa — basta arrastar a pasta inteira do cartão SD para a página.",
    },
    zh: {
        title: "{vendor} 行车记录仪播放器 | dashcamigo",
        metaDescription:
            "免费在线 {vendor} 行车记录仪录像播放器。直接在浏览器中打开录像。GPS 地图、速度图表、多通道播放。无需上传，无需安装。",
        ogTitle: "{vendor} 在线播放器",
        ogDescription:
            "免费在线 {vendor} 录像播放器。GPS 地图、速度图表。可在任意现代浏览器中使用。",
        h1: "{vendor} 在线播放器 — 录像在浏览器中播放",
        lead: "直接在浏览器中打开 {vendor} 行车记录仪的录像。GPS 轨迹同步、速度与 G 力图表、多通道播放（前、后、车内）。无需安装 {vendor} 应用，无需上传，无需账号。",
        ctaPrimary: "打开 {vendor} 录像",
        modelsCompat:
            "以及使用标准录像格式的大多数其他在产 {vendor} 型号。支持格式的完整列表请见主页。",
        formatIntro:
            "{vendor} 行车记录仪以 {container} 文件录制 {codec} 视频。录像按 {filename} 命名规则命名，并在 SD 卡上归入 {layout} 文件夹。dashcamigo 会自动识别这些文件，将它们分组为行程，并在地图上绘制 GPS 路线 — 只需把整个 SD 卡文件夹拖到页面上即可。",
    },
    ja: {
        title: "{vendor} ドラレコプレーヤー | dashcamigo",
        metaDescription:
            "{vendor} ドライブレコーダーの録画用無料オンラインプレーヤー。録画をブラウザでそのまま再生。GPS マップ、速度グラフ、マルチチャンネル対応。アップロードもインストールも不要です。",
        ogTitle: "{vendor} オンラインプレーヤー",
        ogDescription:
            "{vendor} 録画用の無料オンラインプレーヤー。GPS マップ、速度グラフ。モダンブラウザならどれでも動きます。",
        h1: "{vendor} オンラインプレーヤー — 録画をブラウザで再生",
        lead: "{vendor} ドライブレコーダーの録画をブラウザで直接開けます。GPS トラックの同期表示、速度・G フォースグラフ、マルチチャンネル再生（前、後、車内）。{vendor} 純正アプリのインストールもアップロードもアカウント登録も不要。",
        ctaPrimary: "{vendor} の録画を開く",
        modelsCompat:
            "および標準的な録画フォーマットを使用するその他の現行 {vendor} モデルの多くに対応しています。サポート対象フォーマットの完全な一覧はトップページにあります。",
        formatIntro:
            "{vendor} のドライブレコーダーは {codec} の映像を {container} ファイルで録画します。録画ファイルは {filename} という命名パターンに従い、SD カード上では {layout} のフォルダに振り分けられます。dashcamigo はこれを自動で識別し、ファイルを走行ごとにまとめてマップ上に GPS 経路を描画します。SD カードのフォルダ全体をページにドラッグするだけです。",
    },
    ko: {
        title: "{vendor} 블랙박스 플레이어 | dashcamigo",
        metaDescription:
            "{vendor} 블랙박스 녹화용 무료 온라인 플레이어. 녹화 파일을 브라우저에서 바로 열기. GPS 지도, 속도 그래프, 멀티 채널 재생. 업로드 없음, 설치 없음.",
        ogTitle: "{vendor} 온라인 플레이어",
        ogDescription:
            "{vendor} 녹화용 무료 온라인 플레이어. GPS 지도, 속도 그래프. 최신 브라우저면 어디서나 동작해요.",
        h1: "{vendor} 온라인 플레이어 — 브라우저에서 녹화 재생",
        lead: "{vendor} 블랙박스의 녹화를 브라우저에서 바로 열어보세요. 동기화된 GPS 트랙, 속도와 G-포스 그래프, 멀티 채널 재생(전방, 후방, 실내). {vendor} 전용 앱 설치, 업로드, 회원가입 모두 필요 없어요.",
        ctaPrimary: "{vendor} 녹화 열기",
        modelsCompat:
            "그리고 표준 녹화 포맷을 사용하는 다른 최신 {vendor} 모델 대부분이 동작해요. 지원되는 포맷 전체 목록은 메인 페이지에 있어요.",
        formatIntro:
            "{vendor} 블랙박스는 {codec} 영상을 {container} 파일로 녹화해요. 녹화 파일은 {filename} 이름 규칙을 따르고, SD 카드의 {layout} 폴더로 정리돼요. dashcamigo는 이걸 자동으로 인식해서 파일을 주행별로 묶고 지도에 GPS 경로를 그려줘요 — SD 카드 폴더 전체를 페이지로 드래그하기만 하면 돼요.",
    },
};

// SERP-visible head copy a template cannot express: model numbers in the
// <title> and local search idiom in the lead. Hand-written per vendor for the
// community locales whose templated pages already rank; the page body (CTA,
// models note, format section, FAQ) stays on VENDOR_TEMPLATES / COMMUNITY_FAQ.
// Values are final strings - no {vendor} substitution runs over them.
type VendorHeadCopy = Pick<
    VendorLocaleContent,
    "title" | "metaDescription" | "ogTitle" | "ogDescription" | "h1" | "lead"
>;

const VENDOR_HEAD_OVERRIDES: Partial<Record<Lang, Partial<Record<VendorSlug, VendorHeadCopy>>>> = {
    de: {
        "70mai": {
            title: "70mai Dashcam-Player & Viewer — X800, A800S, A810, T800 | dashcamigo",
            metaDescription:
                "Kostenloser Online-Player für 70mai: X800, A800S, A810, T800 im Browser. GPS-Karte, Geschwindigkeitsdiagramm, Mehrkanal. Kein Upload, keine Installation.",
            ogTitle: "70mai Dashcam-Player online — X800, A800S, A810, T800",
            ogDescription:
                "Kostenloser Online-Player für 70mai-Aufnahmen. GPS-Karte, Geschwindigkeitsdiagramm, Mehrkanal. Läuft in jedem modernen Browser, nichts wird hochgeladen.",
            h1: "70mai Dashcam-Player online — Aufnahmen im Browser abspielen",
            lead: "Öffne Aufnahmen deiner 70mai-Dashcam direkt im Browser, auf jedem PC oder Mac — ohne Android-Emulator, ohne 70mai-App. Synchronisierte GPS-Strecke, Geschwindigkeits- und G-Kraft-Diagramm, Mehrkanal-Wiedergabe (vorn, hinten, Innenraum). Kein Upload, kein Konto.",
        },
        viofo: {
            title: "Viofo Dashcam-Player & Viewer — A119, A129, A139, A229 | dashcamigo",
            metaDescription:
                "Kostenloser Online-Player für Viofo: A119, A129, A139, A229 im Browser. GPS-Karte, Geschwindigkeitsdiagramm, Front + Heck synchron. Kein Upload, keine Installation.",
            ogTitle: "Viofo Dashcam-Player online — A119, A129, A139, A229",
            ogDescription:
                "Kostenloser Online-Player für Viofo-Aufnahmen. GPS-Karte, Geschwindigkeitsdiagramm, Mehrkanal. Läuft in jedem modernen Browser, nichts wird hochgeladen.",
            h1: "Viofo Dashcam-Player online — Aufnahmen im Browser abspielen",
            lead: "Öffne Aufnahmen deiner Viofo-Dashcam direkt im Browser — auf Windows, Mac und Linux, ohne Desktop-Player. Synchronisierte GPS-Strecke, Geschwindigkeits- und G-Kraft-Diagramm, Mehrkanal-Wiedergabe (vorn, hinten, Innenraum). Kostenlos, ohne Upload, ohne Konto.",
        },
        blackvue: {
            title: "BlackVue Dashcam-Player & Viewer — DR900X, DR970X, DR750X | dashcamigo",
            metaDescription:
                "Kostenloser Online-Player für BlackVue: DR900X, DR970X, DR750X im Browser. GPS-Karte, Geschwindigkeitsdiagramm, Front + Heck synchron. Ohne BlackVue Cloud.",
            ogTitle: "BlackVue Player online — DR900X, DR970X, DR750X",
            ogDescription:
                "Kostenloser Online-Player für BlackVue-Aufnahmen. GPS-Karte, Geschwindigkeitsdiagramm, Front + Heck synchron. Kein BlackVue-Cloud-Konto nötig.",
            h1: "BlackVue Dashcam-Player online — Aufnahmen im Browser abspielen",
            lead: "Öffne Aufnahmen der BlackVue DR-Serie direkt im Browser. Synchronisierte GPS-Strecke, Geschwindigkeits- und G-Kraft-Diagramm, Front und Heck gleichzeitig. Ohne BlackVue-Viewer-Installation, ohne BlackVue-Cloud-Konto.",
        },
        gopro: {
            title: "GoPro Dashcam-Player — HERO11, HERO10, HERO9 GPMF | dashcamigo",
            metaDescription:
                "Kostenloser Online-Player für GoPro: HERO5–HERO13 und MAX mit GPMF-Telemetrie im Browser. GPS-Karte, Geschwindigkeits- und G-Kraft-Diagramm. Kein Upload.",
            ogTitle: "GoPro Player online — HERO5–HERO13 GPMF-Telemetrie",
            ogDescription:
                "Kostenloser Online-Player für GoPro-Aufnahmen mit GPMF-GPS. Karte, Geschwindigkeits- und G-Kraft-Diagramm aus dem gpmd-Track. Läuft in jedem modernen Browser.",
            h1: "GoPro als Dashcam — GPMF-Aufnahmen im Browser abspielen",
            lead: "Öffne GoPro-HERO- und MAX-Aufnahmen direkt im Browser. Der GPMF-Metadaten-Track (gpmd) liefert GPS, Geschwindigkeit, Höhe und 3-Achsen-Beschleunigung — dashcamigo zeigt alles auf synchronisierter Karte und Diagramm.",
        },
        garmin: {
            title: "Garmin Dash Cam Player & Viewer — 67W, 57, Mini 2/3 | dashcamigo",
            metaDescription:
                "Kostenloser Online-Player für Garmin Dash Cam: 67W, 57, 47, Mini 2/3, Live im Browser. GPS-Karte und Geschwindigkeitsdiagramm aus dem PNDM-Track. Kein Upload.",
            ogTitle: "Garmin Dash Cam Player online — 67W, 57, Mini 2/3",
            ogDescription:
                "Kostenloser Online-Player für Garmin-Dash-Cam-Aufnahmen. GPS-Karte, Geschwindigkeitsdiagramm. Ohne Garmin Express, ohne Installation.",
            h1: "Garmin Dash Cam Player online — Aufnahmen im Browser abspielen",
            lead: "Öffne Garmin-Dash-Cam-Aufnahmen direkt im Browser — ohne Garmin Express. GPS, Geschwindigkeit und Beschleunigung kommen aus dem PNDM-Telemetrie-Track und landen synchron auf Karte und Diagramm.",
        },
        vantrue: {
            title: "Vantrue Dashcam-Player & Editor — N4, N5, E3, X4S | dashcamigo",
            metaDescription:
                "Kostenloser Player & Editor für Vantrue: N4, N5, E3, X4S im Browser. GPS-Karte, Geschwindigkeitsdiagramm, Schneiden und Export. Kein Upload, keine Installation.",
            ogTitle: "Vantrue Player & Editor online — N4, N5, E3, X4S",
            ogDescription:
                "Kostenloser Online-Player und -Editor für Vantrue-Aufnahmen. GPS-Karte, Geschwindigkeitsdiagramm, Schneiden und Export. Nichts wird hochgeladen.",
            h1: "Vantrue Dashcam-Player & Editor online — abspielen und schneiden im Browser",
            lead: "Öffne Aufnahmen deiner Vantrue-Dashcam direkt im Browser. Synchronisierte GPS-Strecke, Geschwindigkeits- und G-Kraft-Diagramm, Mehrkanal-Wiedergabe (vorn, hinten, Innenraum), dazu Schneiden und Export. Ohne Vantrue-App, ohne Upload, ohne Konto.",
        },
        thinkware: {
            title: "Thinkware Dashcam-Player & Editor — F800, Q800, U1000 | dashcamigo",
            metaDescription:
                "Kostenloser Player & Editor für Thinkware: F800, F770, Q800 Pro, U1000 im Browser. GPS-Karte, Geschwindigkeitsdiagramm, Schneiden und Export. Kein Upload.",
            ogTitle: "Thinkware Player & Editor online — F800, Q800, U1000",
            ogDescription:
                "Kostenloser Online-Player und -Editor für Thinkware-Aufnahmen. GPS-Karte, Geschwindigkeitsdiagramm, Schneiden und Export. Läuft in jedem modernen Browser.",
            h1: "Thinkware Dashcam-Player & Editor online — abspielen und schneiden im Browser",
            lead: "Öffne Aufnahmen deiner Thinkware-Dashcam direkt im Browser. Synchronisierte GPS-Strecke, Geschwindigkeits- und G-Kraft-Diagramm, Front- und Heck-Wiedergabe, dazu Schneiden und Export. Ohne Thinkware Dashcam Viewer, ohne Upload, ohne Konto.",
        },
    },
    pl: {
        "70mai": {
            title: "Odtwarzacz 70mai online — X800, A800S, A810, T800 | dashcamigo",
            metaDescription:
                "Darmowy odtwarzacz online do 70mai: X800, A800S, A810, T800 w przeglądarce. Mapa GPS, wykres prędkości, wiele kamer naraz. Bez wysyłania plików, bez instalacji.",
            ogTitle: "Odtwarzacz 70mai online — X800, A800S, A810, T800",
            ogDescription:
                "Darmowy odtwarzacz online nagrań 70mai. Mapa GPS, wykres prędkości, wiele kamer naraz. Działa w każdej nowoczesnej przeglądarce.",
            h1: "Odtwarzacz 70mai online — nagrania wideorejestratora w przeglądarce",
            lead: "Otwórz nagrania z wideorejestratora 70mai prosto w przeglądarce, na każdym PC i Macu — bez emulatora Androida, bez aplikacji 70mai. Zsynchronizowana trasa GPS, wykres prędkości i przeciążeń, odtwarzanie przód/tył/kabina jednocześnie. Bez wysyłania plików, bez konta.",
        },
        viofo: {
            title: "Odtwarzacz Viofo online — A119, A129, A139, A229 | dashcamigo",
            metaDescription:
                "Darmowy odtwarzacz online do Viofo: A119, A129, A139, A229 w przeglądarce. Mapa GPS, wykres prędkości, przód i tył synchronicznie. Bez wysyłania plików.",
            ogTitle: "Odtwarzacz Viofo online — A119, A129, A139, A229",
            ogDescription:
                "Darmowy odtwarzacz online nagrań Viofo. Mapa GPS, wykres prędkości, wiele kamer naraz. Działa w każdej nowoczesnej przeglądarce.",
            h1: "Odtwarzacz Viofo online — nagrania wideorejestratora w przeglądarce",
            lead: "Otwórz nagrania z wideorejestratora Viofo prosto w przeglądarce — na Windows, Macu i Linuksie, bez desktopowego playera. Zsynchronizowana trasa GPS, wykres prędkości i przeciążeń, odtwarzanie przód/tył/kabina jednocześnie. Za darmo, bez wysyłania plików, bez konta.",
        },
        blackvue: {
            title: "Odtwarzacz BlackVue online — DR900X, DR970X, DR750X | dashcamigo",
            metaDescription:
                "Darmowy odtwarzacz online do BlackVue: DR900X, DR970X, DR750X w przeglądarce. Mapa GPS, wykres prędkości, przód i tył synchronicznie. Bez chmury BlackVue.",
            ogTitle: "Odtwarzacz BlackVue online — DR900X, DR970X, DR750X",
            ogDescription:
                "Darmowy odtwarzacz online nagrań BlackVue. Mapa GPS, wykres prędkości, przód + tył synchronicznie. Bez konta BlackVue Cloud.",
            h1: "Odtwarzacz BlackVue online — nagrania kamery samochodowej w przeglądarce",
            lead: "Otwórz nagrania kamery samochodowej BlackVue serii DR prosto w przeglądarce. Zsynchronizowana trasa GPS, wykres prędkości i przeciążeń, przód i tył jednocześnie. Bez instalowania BlackVue Viewera, bez konta BlackVue Cloud.",
        },
        gopro: {
            title: "Odtwarzacz GoPro online — HERO11, HERO10, HERO9 GPMF | dashcamigo",
            metaDescription:
                "Darmowy odtwarzacz online do GoPro: HERO5–HERO13 i MAX z telemetrią GPMF w przeglądarce. Mapa GPS, wykres prędkości i przeciążeń. Bez wysyłania plików.",
            ogTitle: "Odtwarzacz GoPro online — telemetria GPMF HERO5–HERO13",
            ogDescription:
                "Darmowy odtwarzacz online nagrań GoPro z GPS (GPMF). Mapa, wykres prędkości i przeciążeń. Działa w każdej nowoczesnej przeglądarce.",
            h1: "Odtwarzacz GoPro online — nagrania GPMF w przeglądarce",
            lead: "Otwórz nagrania GoPro HERO i MAX prosto w przeglądarce. Ścieżka metadanych GPMF (gpmd) daje GPS, prędkość, wysokość i przyspieszenie w 3 osiach — dashcamigo rysuje wszystko na zsynchronizowanej mapie i wykresie.",
        },
        garmin: {
            title: "Odtwarzacz wideorejestratora Garmin — 67W, 57, Mini 2/3 | dashcamigo",
            metaDescription:
                "Darmowy odtwarzacz online do Garmin Dash Cam: 67W, 57, 47, Mini 2/3, Live w przeglądarce. Mapa GPS i wykres prędkości ze ścieżki PNDM. Bez wysyłania plików.",
            ogTitle: "Odtwarzacz Garmin Dash Cam online — 67W, 57, Mini 2/3",
            ogDescription:
                "Darmowy odtwarzacz online nagrań Garmin Dash Cam. Mapa GPS, wykres prędkości. Bez Garmin Express, bez instalacji.",
            h1: "Odtwarzacz Garmin Dash Cam online — nagrania wideorejestratora w przeglądarce",
            lead: "Otwórz nagrania z wideorejestratora Garmin Dash Cam prosto w przeglądarce — bez Garmin Express. GPS, prędkość i przyspieszenie pochodzą ze ścieżki telemetrii PNDM i trafiają na zsynchronizowaną mapę i wykres.",
        },
        vantrue: {
            title: "Odtwarzacz i edytor Vantrue — N4, N5, E3, X4S | dashcamigo",
            metaDescription:
                "Darmowy odtwarzacz i edytor online do Vantrue: N4, N5, E3, X4S w przeglądarce. Mapa GPS, wykres prędkości, przycinanie i eksport. Bez wysyłania plików.",
            ogTitle: "Odtwarzacz i edytor Vantrue online — N4, N5, E3, X4S",
            ogDescription:
                "Darmowy odtwarzacz i edytor online nagrań Vantrue. Mapa GPS, wykres prędkości, przycinanie i eksport. Nic nie jest wysyłane.",
            h1: "Odtwarzacz i edytor Vantrue online — odtwarzaj i przycinaj w przeglądarce",
            lead: "Otwórz nagrania z wideorejestratora Vantrue prosto w przeglądarce. Zsynchronizowana trasa GPS, wykres prędkości i przeciążeń, odtwarzanie przód/tył/kabina, do tego przycinanie i eksport. Bez aplikacji Vantrue, bez wysyłania plików, bez konta.",
        },
        thinkware: {
            title: "Odtwarzacz i edytor Thinkware — F800, Q800, U1000 | dashcamigo",
            metaDescription:
                "Darmowy odtwarzacz i edytor online do Thinkware: F800, Q800 Pro, U1000 w przeglądarce. Mapa GPS, wykres prędkości, przycinanie i eksport. Bez wysyłania plików.",
            ogTitle: "Odtwarzacz i edytor Thinkware — F800, Q800, U1000",
            ogDescription:
                "Darmowy odtwarzacz i edytor online nagrań Thinkware. Mapa GPS, wykres prędkości, przycinanie i eksport. Działa w każdej nowoczesnej przeglądarce.",
            h1: "Odtwarzacz i edytor Thinkware online — odtwarzaj i przycinaj w przeglądarce",
            lead: "Otwórz nagrania z wideorejestratora Thinkware prosto w przeglądarce. Zsynchronizowana trasa GPS, wykres prędkości i przeciążeń, odtwarzanie przodu i tyłu, do tego przycinanie i eksport. Bez instalowania Thinkware Dashcam Viewera, bez wysyłania plików, bez konta.",
        },
    },
};

// Resolve the per-locale vendor content. Returns the hand-written copy for
// en/ru when present, otherwise instantiates VENDOR_TEMPLATES[lang] with
// the vendor displayName substituted into {vendor} placeholders, then lays
// any VENDOR_HEAD_OVERRIDES on top. Throws if
// neither source is available - that means SEO_LOCALES has a locale that we
// can't render, a build-time bug we want to surface loudly.
function resolveVendorContent(vendor: VendorContent, lang: Lang): VendorLocaleContent {
    const direct = vendor.locales[lang];
    if (direct) return direct;
    const template = VENDOR_TEMPLATES[lang];
    if (!template) {
        throw new Error(`vendor-pages: no localized content or template for lang="${lang}" vendor="${vendor.slug}"`);
    }
    const v = vendor.displayName;
    // formatIntro weaves the vendor's actual format facts into the prose so each
    // vendor's community page differs materially, not just by brand name
    // (anti-doorway). filename/layout are injected prose-cleaned: their trailing
    // English parenthetical (e.g. "(Normal Front)", "(+ Front/Back/...)") is
    // stripped so it doesn't sit untranslated inside a German/Japanese sentence -
    // the full annotated value still shows in the format-facts <dl>.
    const proseSafe = (s: string): string => s.replace(/\s*\([^)]*\)\s*$/, "").trim();
    const sub = (s: string): string =>
        s
            .replaceAll("{vendor}", v)
            .replaceAll("{codec}", vendor.format.codec)
            .replaceAll("{container}", vendor.format.container)
            .replaceAll("{filename}", proseSafe(vendor.format.filenamePattern))
            .replaceAll("{layout}", proseSafe(vendor.format.sdLayout));
    const templated: VendorLocaleContent = {
        title: sub(template.title),
        metaDescription: sub(template.metaDescription),
        ogTitle: sub(template.ogTitle),
        ogDescription: sub(template.ogDescription),
        h1: sub(template.h1),
        lead: sub(template.lead),
        ctaPrimary: sub(template.ctaPrimary),
        modelsCompat: sub(template.modelsCompat),
        formatIntro: sub(template.formatIntro),
        // Community locales: vendor-specific FAQ translated from the en source
        // (COMMUNITY_FAQ). Genuinely different per vendor (Viofo's Novatek
        // freeGPS Q&A is not GoPro's GPMF Q&A), so this is translated-unique
        // content, not the thin templated FAQ the Helpful Content Update
        // penalizes. Empty array only if a locale is somehow unmapped (the
        // build-time assertCommunityFaqParity guards against that).
        faq: COMMUNITY_FAQ[vendor.slug]?.[lang] ?? [],
    };
    const headOverride = VENDOR_HEAD_OVERRIDES[lang]?.[vendor.slug];
    return headOverride ? { ...templated, ...headOverride } : templated;
}

// Path segment for the locale's URL prefix. "/<segment>" for every locale
// since the / root migration (English moved from "" to "en"). Centralized
// so all url-building stays consistent with seo-config.ts.
export function pathPrefixFor(lang: Lang): string {
    const loc = getSeoLocaleByLang(lang);
    if (!loc) throw new Error(`vendor-pages: lang "${lang}" not in SEO_LOCALES`);
    if (loc.urlSegment === "") {
        throw new Error(
            `vendor-pages: locale "${lang}" has empty urlSegment - every locale must live under /<segment>/`,
        );
    }
    return `/${loc.urlSegment}`;
}

// Build the full hreflang link block for a given page (homepage of the
// /cameras/ section or a specific vendor page). makeUrl is called once per
// indexable locale to produce that locale's URL for THIS page. x-default
// for sub-pages (not the site root) targets the English variant of the same
// page - there is no page-specific neutral landing.
export function buildHreflangLinksHtml(makeUrl: (loc: SeoLocale) => string): string {
    const indexable = getIndexableSeoLocales();
    const defaultLocale = getDefaultSeoLocale();
    const lines = indexable.flatMap((loc) =>
        getHreflangCodes(loc).map(
            (code) => `<link rel="alternate" hreflang="${code}" href="${makeUrl(loc)}">`,
        ),
    );
    lines.push(`<link rel="alternate" hreflang="x-default" href="${makeUrl(defaultLocale)}">`);
    return lines.join("\n");
}

// og:locale:alternate meta tags for every locale OTHER than the page's own
// (Facebook / OG spec says og:locale lists self, og:locale:alternate lists
// the others).
export function buildOgLocaleAlternatesHtml(selfLang: Lang): string {
    return getIndexableSeoLocales()
        .filter((loc) => loc.lang !== selfLang)
        .map((loc) => `<meta property="og:locale:alternate" content="${loc.ogLocale}">`)
        .join("\n");
}

// Build the static HTML for one vendor page. Inlines two JSON-LD blobs
// (BreadcrumbList, FAQPage if non-empty) and one tight HTML body. Loads
// /vendor-page.css for styling. No JS app bundle.
function renderVendorPage(vendor: VendorContent, lang: Lang, options: SeoBuildOptions): string {
    const seoLocale = getSeoLocaleByLang(lang);
    if (!seoLocale) throw new Error(`vendor-pages: lang "${lang}" not in SEO_LOCALES`);

    const content = resolveVendorContent(vendor, lang);
    const labels = SHARED_LABELS[lang];
    const pathPrefix = pathPrefixFor(lang);

    const localHome = `${pathPrefix}/`;
    const url = `${SITE_ORIGIN}${pathPrefix}/cameras/${vendor.slug}/`;
    const homeUrl = `${SITE_ORIGIN}${pathPrefix}/`;
    const camerasUrl = `${SITE_ORIGIN}${pathPrefix}/cameras/`;
    const ctaHref = `${pathPrefix}/?vendor=${vendor.slug}`;
    const otherVendors = VENDORS.filter((v) => v.slug !== vendor.slug);
    const ogImageUrl = `${SITE_ORIGIN}/${seoLocale.ogImage}`;

    const hreflangBlock = buildHreflangLinksHtml((loc) => {
        // Every locale has a non-empty urlSegment now - /en/, /de/, etc.
        return `${SITE_ORIGIN}/${loc.urlSegment}/cameras/${vendor.slug}/`;
    });
    const ogLocaleAlternatesBlock = buildOgLocaleAlternatesHtml(lang);

    const breadcrumb = {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        itemListElement: [
            { "@type": "ListItem", position: 1, name: labels.breadcrumbHome, item: homeUrl },
            { "@type": "ListItem", position: 2, name: labels.breadcrumbCameras, item: camerasUrl },
            { "@type": "ListItem", position: 3, name: vendor.displayName, item: url },
        ],
    };

    // FAQPage JSON-LD only when there are vendor-specific Q&A pairs (i.e.
    // en/ru pages). Community locales emit no FAQ section and no FAQPage
    // schema - the page is shorter on purpose to avoid thin templated FAQs.
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

    const v = vendor.displayName;

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
<h2 class="vp-h2">${escapeText(labels.modelsHeading.replace("{vendor}", v))}</h2>
<ul class="vp-models">
${vendor.models.map((m) => `<li>${escapeText(m)}</li>`).join("\n")}
</ul>
<p class="vp-note">${escapeText(content.modelsCompat)}</p>
</section>

<section class="vp-section">
<h2 class="vp-h2">${escapeText(labels.formatHeading.replace("{vendor}", v))}</h2>
<p>${escapeText(content.formatIntro)}</p>
<dl class="vp-facts">
<dt>${escapeText(labels.formatLabelContainer)}</dt><dd>${escapeText(vendor.format.container)}</dd>
<dt>${escapeText(labels.formatLabelCodec)}</dt><dd>${escapeText(vendor.format.codec)}</dd>
<dt>${escapeText(labels.formatLabelGps)}</dt><dd>${escapeText(vendor.format.gpsStorage)}</dd>
<dt>${escapeText(labels.formatLabelLayout)}</dt><dd><code>${escapeText(vendor.format.sdLayout)}</code></dd>
<dt>${escapeText(labels.formatLabelFilename)}</dt><dd><code>${escapeText(vendor.format.filenamePattern)}</code></dd>
</dl>
</section>

<section class="vp-section">
<h2 class="vp-h2">${escapeText(labels.howHeading.replace("{vendor}", v))}</h2>
<ol class="vp-steps">
${labels.howSteps.map((step) => `<li>${escapeText(step)}</li>`).join("\n")}
</ol>
<a href="${ctaHref}" class="vp-cta vp-cta--secondary">${escapeText(labels.howSecondaryCta)}</a>
</section>

${faqSectionHtml}
</article>

<aside class="vp-other-vendors">
<h3 class="vp-h3">${escapeText(labels.otherVendorsHeading)}</h3>
<ul>
${otherVendors
    .map(
        (other) => `<li><a href="${pathPrefix}/cameras/${other.slug}/">${escapeText(other.displayName)}</a></li>`,
    )
    .join("\n")}
</ul>
<p class="vp-not-listed">${escapeText(labels.notListedText)} <a href="/add-my-camera">${escapeText(labels.notListedCta)}</a></p>
</aside>
</main>

<footer class="vp-footer">
<a href="/privacy">${escapeText(labels.footerPrivacy)}</a>
<span>·</span>
<a href="/terms">${escapeText(labels.footerTerms)}</a>
<span>·</span>
<a href="${homeUrl}">${escapeText(labels.footerHome)}</a>
<span>·</span>
<a href="${REPO_URL}">GitHub</a>
</footer>
</body>
</html>
`;
}

// Build the /cameras/ section index page. Hub for the 5 vendor pages, listing
// each as a card with displayName + 1-line format hint. Same chrome as vendor
// pages (header, footer, vendor-page.css). Loads no JS app bundle.
function renderCamerasIndexPage(lang: Lang, options: SeoBuildOptions): string {
    const seoLocale = getSeoLocaleByLang(lang);
    if (!seoLocale) throw new Error(`vendor-pages: lang "${lang}" not in SEO_LOCALES`);

    const content = INDEX_LOCALES[lang];
    const labels = SHARED_LABELS[lang];
    const pathPrefix = pathPrefixFor(lang);
    const localHome = `${pathPrefix}/`;
    const url = `${SITE_ORIGIN}${pathPrefix}/cameras/`;
    const homeUrl = `${SITE_ORIGIN}${pathPrefix}/`;
    const ogImageUrl = `${SITE_ORIGIN}/${seoLocale.ogImage}`;

    const hreflangBlock = buildHreflangLinksHtml((loc) => {
        return `${SITE_ORIGIN}/${loc.urlSegment}/cameras/`;
    });
    const ogLocaleAlternatesBlock = buildOgLocaleAlternatesHtml(lang);

    const breadcrumb = {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        itemListElement: [
            { "@type": "ListItem", position: 1, name: labels.breadcrumbHome, item: homeUrl },
            { "@type": "ListItem", position: 2, name: labels.breadcrumbCameras, item: url },
        ],
    };
    // CollectionPage with ItemList - tells Google this is a hub listing of
    // related sub-pages, which can promote sitelinks under the main result.
    const collection = {
        "@context": "https://schema.org",
        "@type": "CollectionPage",
        name: content.h1,
        description: content.lead,
        url,
        inLanguage: seoLocale.contentLanguage,
        mainEntity: {
            "@type": "ItemList",
            numberOfItems: VENDORS.length,
            itemListElement: VENDORS.map((v, idx) => ({
                "@type": "ListItem",
                position: idx + 1,
                url: `${SITE_ORIGIN}${pathPrefix}/cameras/${v.slug}/`,
                name: v.displayName,
            })),
        },
    };

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
${VENDORS.map(
    (v) => `<li><a class="vp-vendor-card" href="${pathPrefix}/cameras/${v.slug}/">
<span class="vp-vendor-card-name">${escapeText(v.displayName)}</span>
<span class="vp-vendor-card-hint">${escapeText(content.cardHintPrefix)} ${escapeText(v.format.container)} · ${escapeText(v.format.gpsStorage)}</span>
</a></li>`,
).join("\n")}
</ul>
<p class="vp-not-listed">${escapeText(labels.notListedText)} <a href="/add-my-camera">${escapeText(labels.notListedCta)}</a></p>
${renderHubCta(lang, pathPrefix)}
</article>
</main>
<footer class="vp-footer">
<a href="/privacy">${escapeText(labels.footerPrivacy)}</a>
<span>·</span>
<a href="/terms">${escapeText(labels.footerTerms)}</a>
<span>·</span>
<a href="${homeUrl}">${escapeText(labels.footerHome)}</a>
<span>·</span>
<a href="${REPO_URL}">GitHub</a>
</footer>
</body>
</html>
`;
}

// Fail the build if SUPPORTED_BRANDS and VENDORS have drifted - every brand
// with hasLandingPage=true must have a matching VendorContent block here,
// and every VendorContent block must correspond to a landing brand. Without
// this check, a mismatched entry would silently produce JSON-LD that
// promises a vendor page that doesn't exist, or a vendor page with no
// SUPPORTED_BRANDS metadata.
function assertVendorListsAligned(): void {
    // Late import to avoid pulling supported-brands into the module-init path
    // (this function is only called from the build closeBundle hook).
    const landingSlugs = new Set(getLandingBrands().map((b) => b.slug));
    const vendorSlugs = new Set(VENDORS.map((v) => v.slug));
    const missingVendors: string[] = [];
    for (const slug of landingSlugs) {
        if (!vendorSlugs.has(slug)) missingVendors.push(slug);
    }
    const extraVendors: string[] = [];
    for (const slug of vendorSlugs) {
        if (!landingSlugs.has(slug)) extraVendors.push(slug);
    }
    if (missingVendors.length > 0 || extraVendors.length > 0) {
        const lines: string[] = [
            "vendor-pages: SUPPORTED_BRANDS and VENDORS are out of sync",
        ];
        if (missingVendors.length > 0) {
            lines.push(
                `  in SUPPORTED_BRANDS but missing in VENDORS: ${missingVendors.join(", ")}`,
            );
        }
        if (extraVendors.length > 0) {
            lines.push(
                `  in VENDORS but missing in SUPPORTED_BRANDS: ${extraVendors.join(", ")}`,
            );
        }
        throw new Error(lines.join("\n"));
    }
}

// Fail the build if a community locale is missing its translated FAQ or the
// item count drifted from the en source. A community vendor page that shipped
// with a short or absent FAQ is exactly the thin-content regression this check
// guards against, so make it loud rather than silent. Exported for a unit test.
// Cannot detect a stale wording (en FAQ reworded but translation not) - that is
// flagged in vendor-community-faq.ts as a regenerate-on-change responsibility.
export function assertCommunityFaqParity(): void {
    const problems: string[] = [];
    for (const vendor of VENDORS) {
        const enFaq = vendor.locales.en?.faq;
        if (!enFaq) {
            problems.push(`${vendor.slug}: no en FAQ to use as the parity baseline`);
            continue;
        }
        for (const loc of getIndexableSeoLocales()) {
            const lang = loc.lang;
            // Hand-written locales (en, ru) carry their FAQ inline in VENDORS.
            if (vendor.locales[lang]) continue;
            const translated = COMMUNITY_FAQ[vendor.slug]?.[lang];
            if (!translated) {
                problems.push(`${vendor.slug}/${lang}: missing COMMUNITY_FAQ translation`);
                continue;
            }
            if (translated.length !== enFaq.length) {
                problems.push(
                    `${vendor.slug}/${lang}: ${translated.length} FAQ items, en source has ${enFaq.length}`,
                );
            }
        }
    }
    if (problems.length > 0) {
        throw new Error(`vendor-pages: COMMUNITY_FAQ parity broken\n  ${problems.join("\n  ")}`);
    }
}

export function vendorPagesPlugin(options: SeoBuildOptions = {}): Plugin {
    // No apply restriction - we both render to disk during build and serve
    // the same pages from a dev middleware so /cameras/<vendor>/ doesn't
    // fall through to the SPA index.html in `npm run dev`. That makes the
    // build guard below necessary: Vite's dev PluginContainer.close() also
    // invokes closeBundle, and without it a Ctrl-C of the dev server would
    // silently write vendor pages into dist/.
    let isBuild = false;
    return {
        name: "dashcamigo-vendor-pages",
        configResolved(config) {
            isBuild = config.command === "build";
        },
        closeBundle() {
            if (!isBuild) return;
            assertVendorListsAligned();
            assertCommunityFaqParity();
            const distDir = resolve(process.cwd(), "dist");
            for (const seoLocale of getIndexableSeoLocales()) {
                const lang = seoLocale.lang;
                // Every locale has a non-empty urlSegment now - /en/cameras/,
                // /de/cameras/, etc. The legacy /cameras/* paths (without a
                // locale prefix) are 301-redirected at the edge via _redirects.
                const prefix = `${seoLocale.urlSegment}/`;
                // /cameras/ section index - hub for vendor pages, makes the
                // middle breadcrumb item resolve to 200.
                const indexDir = resolve(distDir, `${prefix}cameras`);
                mkdirSync(indexDir, { recursive: true });
                writeFileSync(resolve(indexDir, "index.html"), renderCamerasIndexPage(lang, options));
                // Per-vendor pages under that index.
                for (const vendor of VENDORS) {
                    const targetDir = resolve(distDir, `${prefix}cameras/${vendor.slug}`);
                    mkdirSync(targetDir, { recursive: true });
                    writeFileSync(resolve(targetDir, "index.html"), renderVendorPage(vendor, lang, options));
                }
            }
        },
        configureServer(server) {
            // Dev middleware: render vendor pages on the fly so the same URLs
            // that work in production also work under `npm run dev`. Without
            // this, /cameras/70mai/ falls through to the SPA index.html and
            // the user sees the landing page instead of the vendor page.
            //
            // We render plain static HTML (no vite-client / HMR injection
            // because vendor pages don't run the app bundle). If the user
            // edits a translation in vendor-pages.ts, vite restart picks it up.
            server.middlewares.use((req, res, next) => {
                if (req.method !== "GET" && req.method !== "HEAD") return next();
                const rawUrl = req.url ?? "/";
                const pathOnly = rawUrl.split(/[?#]/, 1)[0] ?? "/";
                const result = matchVendorRoute(pathOnly);
                if (!result) return next();

                let body: string;
                try {
                    body = result.kind === "index"
                        ? renderCamerasIndexPage(result.lang, options)
                        : renderVendorPage(result.vendor, result.lang, options);
                } catch (err) {
                    // Don't crash the dev server on a render error - log and
                    // fall through to SPA fallback so the user can fix it.
                    server.config.logger.error(
                        `[vendor-pages] failed to render ${pathOnly}: ${err instanceof Error ? err.message : String(err)}`,
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

// Result of matching a request path against the vendor-pages URL space.
// "index" → /cameras/ section index for that locale.
// "vendor" → /cameras/<slug>/ page for a specific vendor.
// Exported for tests; the dev middleware uses it internally.
export type VendorRouteMatch =
    | { kind: "index"; lang: Lang }
    | { kind: "vendor"; lang: Lang; vendor: VendorContent };

export function matchVendorRoute(path: string): VendorRouteMatch | null {
    // Tokenize. /cameras/70mai/ → ["cameras", "70mai"];
    // /de/cameras/ → ["de", "cameras"]; /de/cameras/70mai/ → ["de", "cameras", "70mai"].
    const segments = path.split("/").filter((s) => s.length > 0);
    if (segments.length === 0) return null;

    // Optional leading locale segment. If the first segment matches a known
    // locale URL prefix, consume it; otherwise assume default (en) and start
    // matching from segment 0.
    let lang: Lang = "en";
    let i = 0;
    const maybeLocale = getIndexableSeoLocales().find((l) => l.urlSegment === segments[0]);
    if (maybeLocale) {
        lang = maybeLocale.lang;
        i = 1;
    }

    // The next segment must be "cameras". Otherwise it's not our URL space.
    if (segments[i] !== "cameras") return null;
    i++;

    if (i === segments.length) {
        // /<lang>/cameras/ or /cameras/ - section index.
        return { kind: "index", lang };
    }
    if (i === segments.length - 1) {
        // /<lang>/cameras/<slug>/ - vendor page. Find the vendor by slug.
        const slug = segments[i];
        const vendor = VENDORS.find((v) => v.slug === slug);
        if (!vendor) return null;
        return { kind: "vendor", lang, vendor };
    }
    // Deeper path - not part of vendor-pages URL space.
    return null;
}

interface VendorSitemapEntry {
    loc: string;
    changefreq: string;
    priority: string;
    alternates: Record<string, string>;
    // Required because the sitemap builder enforces an explicit x-default
    // for any entry with alternates. For sub-pages we use the English variant
    // (no page-specific neutral landing exists for /cameras/ or vendor pages).
    xDefaultUrl: string;
    // Mirrors SitemapEntry.lastmod in seo-prerender.ts - git mtime of the
    // source files that produce this URL. Omitted (undefined) when the
    // file isn't git-tracked, so the sitemap builder skips <lastmod>
    // rather than emitting a fake one.
    lastmod?: string;
}

// Sitemap entries for the vendor pages. Exported so the SEO sitemap plugin
// can include them next to the homepage entries. Each entry's alternates
// point at the LOCALE-SPECIFIC siblings of THAT specific page (so a vendor
// page's translation set is its own per-locale siblings, not site roots).
// x-default for sub-pages targets the English variant - no separate neutral
// landing exists for these paths.
export function getVendorSitemapEntries(): VendorSitemapEntry[] {
    const entries: VendorSitemapEntry[] = [];
    const indexable = getIndexableSeoLocales();
    const defaultLang = getDefaultSeoLocale().lang;
    const defaultSegment = getDefaultSeoLocale().urlSegment;

    // lastmod is shared by every vendor URL: ALL page content (en/ru copy in
    // VENDORS, community FAQ, chrome, escaping) lives in VENDOR_SHARED_SOURCES.
    // The app dictionaries (src/i18n/<lang>.ts) deliberately do NOT contribute -
    // vendor pages render nothing from them (only `type Lang` is imported), so
    // an app-translation PR must not bump these URLs' <lastmod>.
    const sharedLastmod = maxGitMtimeIso(VENDOR_SHARED_SOURCES) ?? undefined;

    // /cameras/ section index alternates: every locale's /cameras/ page.
    const indexAlternates = buildHreflangAlternatesMap(
        (loc) => `${SITE_ORIGIN}/${loc.urlSegment}/cameras/`,
    );
    const indexXDefault = `${SITE_ORIGIN}/${defaultSegment}/cameras/`;
    for (const loc of indexable) {
        entries.push({
            loc: `${SITE_ORIGIN}/${loc.urlSegment}/cameras/`,
            changefreq: "monthly",
            priority: loc.lang === defaultLang ? "0.8" : "0.7",
            alternates: indexAlternates,
            xDefaultUrl: indexXDefault,
            lastmod: sharedLastmod,
        });
    }

    // Individual vendor pages: one entry per vendor × indexable locale
    // (7 vendors × 10 locales = 70 today). Each vendor has its own alternates
    // map (different from /cameras/ siblings). lastmod is the same across all
    // vendors today: vendor content lives inside vendor-pages.ts itself
    // (VENDORS array) plus vendor-community-faq.ts, so any vendor-content
    // change touches a shared source and bumps every vendor at once. If
    // vendor content ever splits into per-vendor files (e.g.
    // vite-plugins/vendor-content/70mai.ts), pass that path here too.
    for (const vendor of VENDORS) {
        const vendorAlternates = buildHreflangAlternatesMap(
            (loc) => `${SITE_ORIGIN}/${loc.urlSegment}/cameras/${vendor.slug}/`,
        );
        const vendorXDefault = `${SITE_ORIGIN}/${defaultSegment}/cameras/${vendor.slug}/`;
        for (const loc of indexable) {
            entries.push({
                loc: `${SITE_ORIGIN}/${loc.urlSegment}/cameras/${vendor.slug}/`,
                changefreq: "monthly",
                priority: loc.lang === defaultLang ? "0.7" : "0.6",
                alternates: vendorAlternates,
                xDefaultUrl: vendorXDefault,
                lastmod: sharedLastmod,
            });
        }
    }
    return entries;
}

