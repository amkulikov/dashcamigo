// Vendor landing pages for the top dashcam brands - every SUPPORTED_BRANDS
// entry with hasLandingPage=true (currently 70mai, Viofo, BlackVue, GoPro,
// Garmin, Vantrue, Thinkware; see supported-brands.ts for the source of
// truth). Each gets static HTML at /<lang>/cameras/<slug>/ for every
// indexable locale. Purpose: capture long-tail SERP traffic
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
// Vendor-specific facts combine public model lineups with recording behavior
// implemented by the app. Public copy stays focused on the visitor's job:
// open a folder, review the trip and export a clip. Parser evidence and fixture
// status belong in docs/gps-format-coverage.md, not on this SEO surface.
//
// JSON-LD per page: BreadcrumbList (Home > Cameras > <Vendor>). Model lists
// target the product families people search for; the copy keeps the honest
// user-facing boundary that video opens locally while GPS depends on the data
// stored by the camera.
//
// Adding a new vendor: append to VENDORS, fill the same locale fields,
// re-build. No other code change needed.

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Plugin } from "vite";
import type { Lang } from "../src/i18n/index.js";
import {
    REPO_URL,
    buildHreflangAlternatesMap,
    getDefaultSeoLocale,
    getHreflangCodes,
    getIndexableSeoLocales,
    getSeoLocaleByLang,
    type SeoLocale,
} from "../src/i18n/seo-config.js";
import {
    canonicalLocaleUrl,
    canonicalOriginForLocale,
    searchIndexingMeta,
} from "./deployment-profile.js";
import { escapeAttr, escapeText, stringifyJsonLd } from "./html-utils.js";
import { renderHubCta } from "./hub-cta.js";
import type { SeoBuildOptions } from "./seo-prerender.js";

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

import { renderFeatureLinksHtml } from "./feature-links.js";

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
    // Compatibility note under the models list.
    modelsCompat: string;
    // Intro paragraph for the "How <vendor> stores recordings" section.
    formatIntro: string;
}

// Vendor static facts (technical, no translation needed) + per-locale prose.
interface VendorContent {
    slug: VendorSlug;
    // Display name shown in titles, headings, breadcrumbs.
    displayName: string;
    // Search-relevant model families covered by this vendor page.
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
    // (native-quality copy). For the
    // other 8 indexable locales the renderer falls back to VENDOR_TEMPLATES
    // below - one generic localized template per language with displayName
    // substituted in.
    locales: Partial<Record<Lang, VendorLocaleContent>>;
}

// Vendor data. Order matches VENDOR_SLUGS - both define the sitemap order
// and the "Other supported brands" cross-link order on each page.
const VENDORS: VendorContent[] = [
    {
        slug: "70mai",
        displayName: "70mai",
        models: [
            "A810 / A810S",
            "A800 / A800S",
            "A510",
            "M500",
            "Omni / X200",
            "X800 / T800",
            "Pro / Pro Plus+",
        ],
        format: {
            container: "MP4",
            codec: "H.264",
            gpsStorage: "Embedded in the MP4 or stored in a GPSData*.txt log, depending on model",
            sdLayout: "/Normal/, /Event/, /Lapse/ (+ Front/Back/Interior subfolders on multi-channel models)",
            filenamePattern: "NO20240821-180010-000123.mp4",
        },
        locales: {
            en: {
                title: "70mai Dashcam Player — A810, A800S, A510, Omni | dashcamigo",
                metaDescription:
                    "Open 70mai A810, A800S, A510, M500, Omni and X800 recordings in your browser. GPS map, speed chart and synchronized cameras. No upload or install.",
                ogTitle: "70mai Player Online — A810, A800S, A510, Omni",
                ogDescription:
                    "Free online player for 70mai dashcam recordings. GPS map, speed chart and synchronized cameras. Works in any modern browser, nothing uploaded.",
                h1: "70mai Dashcam Player Online — play recordings in your browser",
                lead: "Open recordings from 70mai dashcams directly in your browser, on any PC or Mac — no Android emulator, no 70mai app. See the GPS route, speed and G-force chart, plus synchronized front, rear and cabin cameras. No upload, no account.",
                ctaPrimary: "Open 70mai recordings folder",
                modelsCompat: "Covers common current and recent 70mai recording layouts. Standard MP4 video opens locally; GPS and camera grouping depend on the metadata written by the model.",
                formatIntro:
                    "70mai cameras record MP4 video and, depending on the generation, keep GPS inside the video or in a GPSData*.txt log on the SD card. dashcamigo reads both layouts, groups front, rear and cabin files by time and shows the route when GPS is present.",
            },
            ru: {
                title: "Плеер 70mai — A810, A800S, A510, Omni | dashcamigo",
                metaDescription:
                    "Открывай записи 70mai A810, A800S, A510, M500, Omni и X800 в браузере. Карта GPS, график скорости и синхронные камеры. Без загрузки и установки.",
                ogTitle: "Плеер 70mai онлайн — A810, A800S, A510, Omni",
                ogDescription:
                    "Онлайн-плеер для записей с видеорегистратора 70mai. Карта GPS, график скорости и синхронный просмотр камер. Работает в любом современном браузере, ничего никуда не загружается.",
                h1: "Плеер 70mai онлайн — записи в браузере, без установки",
                lead: "Открывай записи с видеорегистраторов 70mai прямо в браузере на любом ПК или Mac — без Android-эмулятора и приложения 70mai. Смотри маршрут GPS, график скорости и перегрузок, а также переднюю, заднюю и салонную камеры в синхронизации. Без загрузки на сервер и аккаунта.",
                ctaPrimary: "Открыть папку с записями 70mai",
                modelsCompat: "Покрывает распространённые форматы актуальных и недавних моделей 70mai. Обычное MP4-видео открывается локально; GPS и группировка камер зависят от данных конкретной модели.",
                formatIntro:
                    "Регистраторы 70mai пишут MP4-видео, а GPS в зависимости от поколения хранят внутри файла или в логе GPSData*.txt на SD-карте. dashcamigo читает оба варианта, группирует фронт, тыл и салон по времени и показывает маршрут, когда GPS есть в записи.",
            },
        },
    },
    {
        slug: "viofo",
        displayName: "Viofo",
        models: [
            "A119 / A119 V3 / A119 Mini 2",
            "A129 Plus / Pro Duo",
            "A139 / A139 Pro",
            "A229 Plus / Pro",
            "A329 / A329S",
            "T130",
        ],
        format: {
            container: "MP4",
            codec: "H.264 / H.265",
            gpsStorage: "Embedded freeGPS blocks (Novatek chipset)",
            sdLayout: "/Movie/, /Movie_Parking/, /Photo/",
            filenamePattern: "2024_0821_180010_062F.MP4",
        },
        locales: {
            en: {
                title: "Viofo Dashcam Player — A119, A229, A329, T130 | dashcamigo",
                metaDescription:
                    "Open Viofo A119, A129, A139, A229, A329 and T130 recordings in your browser. GPS map, speed chart and multi-camera playback. No upload or install.",
                ogTitle: "Viofo Player Online — A119, A229, A329, T130",
                ogDescription:
                    "Free online player for Viofo dashcam recordings. GPS map, speed chart and synchronized cameras. Works in any modern browser, nothing uploaded.",
                h1: "Viofo Dashcam Player Online — play recordings in your browser",
                lead: "Open recordings from Viofo dashcams directly in your browser. See the synchronized GPS route, speed and G-force chart, plus front, rear and interior cameras together. Free, no upload, no install.",
                ctaPrimary: "Open Viofo recordings folder",
                modelsCompat: "Covers the common Viofo MP4 and TS recording layouts. Standard video opens locally; the GPS map and automatic camera sync depend on the data stored by the camera.",
                formatIntro:
                    "Viofo cameras record H.264 or H.265 video in MP4, with some models also offering TS mode. GPS is stored with the recording, while filename suffixes identify front, rear and interior channels. dashcamigo uses those details to assemble a trip and keep the cameras, map and charts in sync.",
            },
            ru: {
                title: "Плеер Viofo — A119, A229, A329, T130 | dashcamigo",
                metaDescription:
                    "Открывай записи Viofo A119, A129, A139, A229, A329 и T130 в браузере. Карта GPS, график скорости и несколько камер. Без загрузки и установки.",
                ogTitle: "Плеер Viofo онлайн — A119, A229, A329, T130",
                ogDescription:
                    "Онлайн-плеер для записей с видеорегистратора Viofo. Карта GPS, график скорости и синхронный просмотр камер. Работает в любом современном браузере.",
                h1: "Плеер Viofo онлайн — записи в браузере, без установки",
                lead: "Открывай записи с видеорегистраторов Viofo прямо в браузере. Смотри синхронный маршрут GPS, график скорости и перегрузок, а также переднюю, заднюю и салонную камеры одновременно. Бесплатно, без загрузки и установки.",
                ctaPrimary: "Открыть папку с записями Viofo",
                modelsCompat: "Покрывает распространённые форматы записей Viofo в MP4 и TS. Обычное видео открывается локально; карта GPS и синхронизация камер зависят от данных в записи.",
                formatIntro:
                    "Viofo пишет H.264 или H.265 в MP4, а некоторые модели умеют записывать и в TS. GPS хранится вместе с записью, а суффиксы имён обозначают фронтальную, заднюю и салонную камеры. dashcamigo по этим данным собирает поездку и синхронизирует камеры, карту и графики.",
            },
        },
    },
    {
        slug: "blackvue",
        displayName: "BlackVue",
        models: [
            "DR970X / DR970X Plus",
            "DR900X / DR900X Plus",
            "DR770X / DR770X Plus",
            "DR750X / DR750X Plus",
            "DR590X",
            "DR550 / DR650 (legacy)",
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
                title: "BlackVue Player — DR970X, DR900X, DR770X | dashcamigo",
                metaDescription:
                    "Open BlackVue DR970X, DR900X, DR770X, DR750X and legacy DR-series recordings in your browser. GPS map, speed chart and front/rear playback.",
                ogTitle: "BlackVue Player Online — DR970X, DR900X, DR770X",
                ogDescription:
                    "Free online player for BlackVue dashcam recordings. GPS map, speed chart, front+rear in sync. Works in any browser, no BlackVue Cloud account needed.",
                h1: "BlackVue Dashcam Player Online — play recordings in your browser",
                lead: "Open BlackVue DR-series recordings directly in your browser. See the synchronized GPS route, speed and G-force chart, plus front and rear cameras together. No BlackVue Viewer install or BlackVue Cloud account.",
                ctaPrimary: "Open BlackVue recordings folder",
                modelsCompat: "Covers modern BlackVue X-series recordings with embedded GPS and older DR-series layouts that keep GPS in matching sidecar files.",
                formatIntro:
                    "Modern BlackVue X-series cameras keep GPS inside the MP4, while older DR-series models use matching .gps and .3gf files. Their filenames carry the recording mode and camera channel. dashcamigo reads both generations and groups front and rear recordings by time.",
            },
            ru: {
                title: "Плеер BlackVue — DR970X, DR900X, DR770X | dashcamigo",
                metaDescription:
                    "Открывай записи BlackVue DR970X, DR900X, DR770X, DR750X и старых DR-серий в браузере. Карта GPS, график скорости и фронт с тылом.",
                ogTitle: "Плеер BlackVue онлайн — DR970X, DR900X, DR770X",
                ogDescription:
                    "Онлайн-плеер для записей с BlackVue. Карта GPS, график скорости, фронт+тыл синхронно. Работает в любом браузере, без аккаунта BlackVue Cloud.",
                h1: "Плеер BlackVue онлайн — записи в браузере, без BlackVue Viewer",
                lead: "Открывай записи BlackVue DR-серии прямо в браузере. Смотри синхронный маршрут GPS, график скорости и перегрузок, а также переднюю и заднюю камеры одновременно. Без BlackVue Viewer и аккаунта BlackVue Cloud.",
                ctaPrimary: "Открыть папку с записями BlackVue",
                modelsCompat: "Покрывает современные записи BlackVue X-серии со встроенным GPS и старые форматы DR-серии, где GPS лежит в парных служебных файлах.",
                formatIntro:
                    "Современные BlackVue X-серии хранят GPS внутри MP4, а старые DR-серии — в парных файлах .gps и .3gf. В имени записи зашиты режим и канал камеры. dashcamigo читает оба поколения и группирует фронт и тыл по времени.",
            },
        },
    },
    {
        slug: "gopro",
        displayName: "GoPro",
        models: [
            "HERO6 / HERO7 / HERO8",
            "HERO9 / HERO10 / HERO11",
            "HERO13 Black",
            "MAX",
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
                title: "GoPro GPS Video Player — HERO, MAX and GPMF | dashcamigo",
                metaDescription:
                    "Open GoPro HERO and MAX recordings with GPMF telemetry in your browser. GPS map, speed and G-force charts, trim and export. No upload or install.",
                ogTitle: "GoPro GPS Video Player — HERO, MAX and GPMF",
                ogDescription:
                    "Free online player for GoPro recordings with GPMF GPS. Map, speed and G-force chart from the gpmd track. Works in any modern browser.",
                h1: "GoPro GPS video player — open GPMF recordings in your browser",
                lead: "Open GoPro HERO and MAX recordings directly in your browser. The GPMF (gpmd) metadata track gives you GPS, speed, altitude and 3-axis acceleration — dashcamigo renders all of it on a synchronized map and chart.",
                ctaPrimary: "Open GoPro recordings folder",
                modelsCompat: "GoPro telemetry varies by generation and recording settings. Standard video opens locally; the map and charts appear when the file contains compatible GPMF GPS data.",
                formatIntro:
                    "GoPro stores camera telemetry in a GPMF metadata track inside the MP4. Depending on the model and settings, it can include GPS, speed, altitude and acceleration. dashcamigo reads that data locally and keeps the video, map and charts on the same timeline.",
            },
            ru: {
                title: "GPS-плеер GoPro — HERO, MAX и GPMF | dashcamigo",
                metaDescription:
                    "Открывай записи GoPro HERO и MAX с телеметрией GPMF в браузере. Карта GPS, скорость, перегрузки, обрезка и экспорт. Без загрузки и установки.",
                ogTitle: "GPS-плеер GoPro — HERO, MAX и GPMF",
                ogDescription:
                    "Онлайн-плеер для записей GoPro с GPMF GPS. Карта, скорость и перегрузки из данных gpmd. Работает в любом современном браузере.",
                h1: "Плеер GoPro онлайн — записи с GPMF прямо в браузере",
                lead: "Открывай записи GoPro HERO и MAX прямо в браузере. Из метатрека GPMF (gpmd) dashcamigo достаёт GPS, скорость, высоту и 3-осевой акселерометр — и рисует всё это на синхронной карте и графике.",
                ctaPrimary: "Открыть папку с записями GoPro",
                modelsCompat: "Состав телеметрии GoPro зависит от поколения и настроек записи. Обычное видео открывается локально; карта и графики появляются, когда в файле есть совместимые GPS-данные GPMF.",
                formatIntro:
                    "GoPro хранит телеметрию камеры в метатреке GPMF внутри MP4. В зависимости от модели и настроек там могут быть GPS, скорость, высота и ускорение. dashcamigo читает эти данные локально и держит видео, карту и графики на одной шкале времени.",
            },
        },
    },
    {
        slug: "garmin",
        displayName: "Garmin",
        models: [
            "Dash Cam X310 / X210 / X110",
            "Dash Cam Mini 3",
            "Dash Cam Live",
            "Dash Cam 67W / 57 / 47",
            "Dash Cam Mini 2",
            "Dash Cam Tandem",
        ],
        format: {
            container: "MP4",
            codec: "H.264",
            gpsStorage: "Embedded telemetry track (PNDM on compatible recordings)",
            sdLayout: "/Garmin/, /DCIM/",
            filenamePattern: "20240821-180010.mp4",
        },
        locales: {
            en: {
                title: "Garmin Dash Cam Player — X310, X210, Mini 3 | dashcamigo",
                metaDescription:
                    "Open Garmin Dash Cam X310, X210, X110, Mini 3, Live and recent recordings in your browser. Local playback, GPS map, speed chart and clip export.",
                ogTitle: "Garmin Dash Cam Player — X310, X210, Mini 3",
                ogDescription:
                    "Open Garmin Dash Cam recordings in your browser. Local playback, GPS map, speed chart and clip export without Garmin software.",
                h1: "Garmin Dash Cam player — open recordings in your browser",
                lead: "Open recordings from a Garmin Dash Cam directly from the SD card. Play video, review the route and speed when GPS is present, then trim and export a clip. No Garmin Drive or Garmin Express install, upload or account.",
                ctaPrimary: "Open Garmin recordings folder",
                modelsCompat: "Covers the current X-series and Mini 3 lineup plus common recent Garmin Dash Cam generations. Standard MP4 video opens locally; GPS availability depends on the telemetry stored in the recording.",
                formatIntro:
                    "Garmin Dash Cam records MP4 video and can store location and speed in an embedded telemetry track. dashcamigo reads the files locally, groups recordings into trips and uses compatible GPS data for the synchronized map and speed chart.",
            },
            ru: {
                title: "Плеер Garmin Dash Cam — X310, X210, Mini 3 | dashcamigo",
                metaDescription:
                    "Открывай записи Garmin Dash Cam X310, X210, X110, Mini 3, Live и недавних моделей в браузере. Карта GPS, скорость, обрезка и экспорт.",
                ogTitle: "Плеер Garmin Dash Cam — X310, X210, Mini 3",
                ogDescription:
                    "Открывай записи Garmin Dash Cam в браузере. Локальное воспроизведение, карта GPS, график скорости и экспорт без программ Garmin.",
                h1: "Плеер Garmin Dash Cam — записи прямо в браузере",
                lead: "Открывай записи Garmin Dash Cam прямо с SD-карты. Смотри видео, маршрут и скорость, когда в записи есть GPS, затем обрезай и экспортируй клип. Без Garmin Drive, Garmin Express, загрузки на сервер и аккаунта.",
                ctaPrimary: "Открыть папку с записями Garmin",
                modelsCompat: "Покрывает актуальную X-серию и Mini 3, а также распространённые недавние поколения Garmin Dash Cam. Обычное MP4-видео открывается локально; наличие GPS зависит от телеметрии в записи.",
                formatIntro:
                    "Garmin Dash Cam пишет MP4-видео и может хранить координаты и скорость во встроенном треке телеметрии. dashcamigo читает файлы локально, группирует записи в поездки и использует совместимые GPS-данные для синхронной карты и графика скорости.",
            },
        },
    },
    {
        slug: "vantrue",
        displayName: "Vantrue",
        models: [
            "N2 Pro / N2X",
            "N4 / N4 Pro",
            "N5 / N5 Pro",
            "E1 / E2 / E3",
            "S1 / S1 Pro",
            "X4S",
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
                title: "Vantrue Player & Editor — N4, N5, E3, N2X | dashcamigo",
                metaDescription:
                    "Open Vantrue N4, N5, E3, N2X, S1 and X4S recordings in your browser. GPS map, synchronized cameras, trim and export. No upload or install.",
                ogTitle: "Vantrue Player & Editor Online — N4, N5, E3, N2X",
                ogDescription:
                    "Free online player and editor for Vantrue dashcam recordings. GPS map, speed chart, trim and export. Works in any modern browser, nothing uploaded.",
                h1: "Vantrue Dashcam Player & Editor Online — play and trim in your browser",
                lead: "Open Vantrue recordings directly in your browser. See the synchronized GPS route, speed and G-force charts and camera channels, then trim and export without the Vantrue Cam app, uploads or an account.",
                ctaPrimary: "Open Vantrue recordings folder",
                modelsCompat:
                    "Covers common Vantrue recording layouts used across the N, E, S and X series. Models without GPS still play locally, just without a route on the map.",
                formatIntro:
                    "Vantrue cameras record H.264 or H.265 video in MP4 and commonly keep GPS inside the video file. Channel markers in the filenames distinguish front, rear and cabin views. dashcamigo uses them to group each drive and keep the cameras, map and charts together.",
            },
            ru: {
                title: "Плеер Vantrue — N4, N5, E3, N2X | dashcamigo",
                metaDescription:
                    "Открывай записи Vantrue N4, N5, E3, N2X, S1 и X4S в браузере. Карта GPS, синхронные камеры, обрезка и экспорт. Без загрузки и установки.",
                ogTitle: "Плеер Vantrue онлайн — N4, N5, E3, N2X",
                ogDescription:
                    "Онлайн-плеер и редактор для записей с Vantrue. Карта GPS, график скорости, обрезка и экспорт. Работает в любом современном браузере, ничего не загружается.",
                h1: "Плеер и редактор Vantrue онлайн — смотри и режь в браузере",
                lead: "Открывай записи Vantrue прямо в браузере. Смотри синхронный маршрут GPS, графики скорости и перегрузок и каналы камер, затем обрезай и экспортируй без Vantrue Cam, загрузки на сервер и аккаунта.",
                ctaPrimary: "Открыть папку с записями Vantrue",
                modelsCompat:
                    "Покрывает распространённые форматы Vantrue серий N, E, S и X. Модели без GPS тоже воспроизводятся локально — просто без маршрута на карте.",
                formatIntro:
                    "Vantrue пишет H.264 или H.265 в MP4 и обычно хранит GPS прямо внутри видео. Метки в именах файлов обозначают фронтальную, заднюю и салонную камеры. dashcamigo по ним собирает поездку и синхронизирует камеры, карту и графики.",
            },
        },
    },
    {
        slug: "thinkware",
        displayName: "Thinkware",
        models: [
            "F200 / F200 Pro",
            "F750 / F770 / F800 Pro",
            "F70 / F790",
            "Q800 Pro / Q1000",
            "U1000 / U3000",
            "X1000",
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
                title: "Thinkware Player — F800, Q1000, U3000 | dashcamigo",
                metaDescription:
                    "Open Thinkware F200, F800, Q800/Q1000, U1000/U3000 and X1000 recordings in your browser. GPS map, front/rear playback, trim and export.",
                ogTitle: "Thinkware Player Online — F800, Q1000, U3000",
                ogDescription:
                    "Free online player and editor for Thinkware dashcam recordings. GPS map, speed chart, trim and export. Works in any modern browser, nothing uploaded.",
                h1: "Thinkware Dashcam Player & Editor Online — play and trim in your browser",
                lead: "Open recordings from Thinkware dashcams directly in your browser. Synchronized GPS track, speed and G-force chart, front and rear playback, plus trim and export. No Thinkware Dashcam Viewer install, no upload, no account.",
                ctaPrimary: "Open Thinkware recordings folder",
                modelsCompat:
                    "Covers common Thinkware F, Q, U and X-series recording layouts. Models without GPS still play locally, just without a route on the map.",
                formatIntro:
                    "Thinkware cameras store GPS with the MP4 recording and use F/R filename markers for front and rear channels. Recordings are split into continuous, event, parking and manual folders. dashcamigo groups the matching files into one trip and applies the shared route to both views.",
            },
            ru: {
                title: "Плеер Thinkware — F800, Q1000, U3000 | dashcamigo",
                metaDescription:
                    "Открывай записи Thinkware F200, F800, Q800/Q1000, U1000/U3000 и X1000 в браузере. Карта GPS, фронт/тыл, обрезка и экспорт.",
                ogTitle: "Плеер Thinkware онлайн — F800, Q1000, U3000",
                ogDescription:
                    "Онлайн-плеер и редактор для записей с Thinkware. Карта GPS, график скорости, обрезка и экспорт. Работает в любом современном браузере, ничего не загружается.",
                h1: "Плеер и редактор Thinkware онлайн — смотри и режь в браузере",
                lead: "Открывай записи с видеорегистраторов Thinkware прямо в браузере. Смотри синхронный маршрут GPS, график скорости и перегрузок, а также переднюю и заднюю камеры. Обрезай и экспортируй без Thinkware Dashcam Viewer, загрузки на сервер и аккаунта.",
                ctaPrimary: "Открыть папку с записями Thinkware",
                modelsCompat:
                    "Покрывает распространённые форматы Thinkware серий F, Q, U и X. Модели без GPS тоже воспроизводятся локально — просто без маршрута на карте.",
                formatIntro:
                    "Thinkware хранит GPS вместе с MP4 и использует метки F/R в именах фронтальных и задних файлов. Записи разложены по папкам обычного, событийного, парковочного и ручного режимов. dashcamigo объединяет парные файлы в поездку и применяет общий маршрут к обеим камерам.",
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
        lead: "dashcamigo plays recordings from these brands directly in your browser. Pick yours for compatible model families and recording details. No install, upload or account.",
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
        lead: "dashcamigo воспроизводит записи этих марок прямо в браузере. Выбери свою — там совместимые семейства моделей и детали записей. Без установки, загрузки и аккаунта.",
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
        lead: "dashcamigo spielt Aufnahmen dieser Marken direkt im Browser ab. Wähle deine für kompatible Modellreihen und Aufnahmedetails. Keine Installation, kein Upload, kein Konto.",
        cardHintPrefix: "Format:",
    },
    es: {
        title: "Marcas de dashcam compatibles | dashcamigo",
        metaDescription:
            "Marcas compatibles con dashcamigo: 70mai, Viofo, BlackVue, GoPro, Garmin y más. Abre grabaciones en el navegador, sin instalar ni subir archivos.",
        ogTitle: "Marcas de dashcam compatibles — reproducir online",
        ogDescription:
            "Todas las marcas de dashcam compatibles con dashcamigo. Elige la tuya - abre las grabaciones directamente en el navegador.",
        h1: "Marcas de dashcam compatibles",
        lead: "dashcamigo reproduce grabaciones de estas marcas directamente en el navegador. Elige la tuya para ver familias de modelos compatibles y detalles de grabación. Sin instalar, subir archivos ni crear una cuenta.",
        cardHintPrefix: "Formato:",
    },
    fr: {
        title: "Marques de dashcam compatibles | dashcamigo",
        metaDescription:
            "Marques prises en charge par dashcamigo : 70mai, Viofo, BlackVue, GoPro, Garmin et plus. Lis les vidéos dans le navigateur, sans installation ni envoi.",
        ogTitle: "Marques de dashcam prises en charge — lecture en ligne",
        ogDescription:
            "Toutes les marques de dashcam prises en charge par dashcamigo. Choisis la tienne - ouvre les enregistrements directement dans le navigateur.",
        h1: "Marques de dashcam prises en charge",
        lead: "dashcamigo lit les enregistrements de ces marques directement dans le navigateur. Choisis la tienne pour voir les gammes compatibles et les détails d'enregistrement. Sans installation, téléversement ni compte.",
        cardHintPrefix: "Format :",
    },
    pl: {
        title: "Obsługiwane marki wideorejestratorów | dashcamigo",
        metaDescription:
            "Marki obsługiwane przez dashcamigo: 70mai, Viofo, BlackVue, GoPro, Garmin i inne. Otwórz nagrania w przeglądarce, bez instalacji i wysyłania.",
        ogTitle: "Obsługiwane marki wideorejestratorów — odtwarzanie online",
        ogDescription:
            "Wszystkie obsługiwane przez dashcamigo marki wideorejestratorów. Wybierz swoją - otwórz nagrania w przeglądarce, bez instalacji.",
        h1: "Obsługiwane marki wideorejestratorów",
        lead: "dashcamigo odtwarza nagrania z tych marek prosto w przeglądarce. Wybierz swoją, aby zobaczyć zgodne rodziny modeli i szczegóły nagrań. Bez instalacji, wysyłania plików i konta.",
        cardHintPrefix: "Format:",
    },
    pt: {
        title: "Marcas de dashcam compatíveis | dashcamigo",
        metaDescription:
            "Marcas suportadas pelo dashcamigo: 70mai, Viofo, BlackVue, GoPro, Garmin e outras. Abra as gravações no navegador, sem instalar nem enviar arquivos.",
        ogTitle: "Marcas de dashcam compatíveis — reproduzir online",
        ogDescription:
            "Todas as marcas de dashcam suportadas pelo dashcamigo. Escolha a sua - abra as gravações direto no navegador, sem instalação.",
        h1: "Marcas de dashcam compatíveis",
        lead: "O dashcamigo reproduz gravações dessas marcas direto no navegador. Escolha a sua para ver famílias de modelos compatíveis e detalhes das gravações. Sem instalação, upload ou conta.",
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
        lead: "dashcamigo 直接在浏览器中播放这些品牌的录像。选择品牌即可查看兼容的型号系列和录像详情。无需安装、上传或账号。",
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
        lead: "dashcamigo はこれらのブランドの録画をブラウザで直接再生します。ブランドを選ぶと、対応するモデルシリーズと録画の詳細を確認できます。インストール、アップロード、アカウント登録は不要です。",
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
        lead: "dashcamigo는 이 브랜드들의 녹화를 브라우저에서 바로 재생해요. 브랜드를 골라 호환되는 모델 제품군과 녹화 정보를 살펴보세요. 설치, 업로드, 가입이 필요 없어요.",
        cardHintPrefix: "형식:",
    },
};

// Shared section labels - per locale, NOT per vendor. {vendor} is substituted
// at template time with the displayName. Keeps vendor data lean - we don't
// repeat the same section headings for every vendor.
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
        modelsHeading: "Modèles {vendor} compatibles",
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
        modelsHeading: "対応する {vendor} モデル",
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
        modelsHeading: "지원되는 {vendor} 모델",
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
// the renderer substitutes with displayName. The page has title, meta, og:*,
// h1, lead, a model-family list,
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
        title: "{vendor} Video- und GPS-Player | dashcamigo",
        metaDescription:
            "Öffne {vendor}-Kameraaufnahmen im Browser. Mit GPS in der Aufnahme siehst du Route und Tempo-Diagramm. Kein Upload, keine Installation.",
        ogTitle: "{vendor} Video- und GPS-Player Online",
        ogDescription:
            "Lokaler Browser-Player für {vendor}-Aufnahmen. GPS-Karte, Tempo-Diagramm und Clip-Export, wenn die Aufnahme GPS enthält.",
        h1: "{vendor} Video- und GPS-Player — Aufnahmen im Browser",
        lead: "Öffne Aufzeichnungen deiner {vendor}-Kamera direkt im Browser. Enthält die Aufnahme GPS, zeigt dashcamigo Strecke, Geschwindigkeit und G-Kräfte und exportiert Clips. Kein {vendor}-App-Setup, kein Upload, kein Konto.",
        ctaPrimary: "{vendor}-Aufnahmen öffnen",
        modelsCompat:
            "Aufnahmeformate können je nach Modell und Firmware variieren. Standardvideo öffnet lokal; GPS und automatische Gruppierung hängen von den gespeicherten Kameradaten ab.",
        formatIntro:
            "Kameras von {vendor} nehmen {codec}-Video in {container}-Dateien auf. Die Aufnahmen folgen dem Namensschema {filename} und werden auf der SD-Karte in die Ordner {layout} einsortiert. Zieh den gesamten SD-Karten-Ordner auf die Seite — dashcamigo gruppiert die Dateien zu Fahrten und zeigt vorhandene GPS-Daten auf der Karte.",
    },
    es: {
        title: "Reproductor {vendor} | dashcamigo",
        metaDescription:
            "Abre grabaciones {vendor} en el navegador. Si incluyen GPS, verás la ruta y la velocidad. Sin subir archivos ni instalar.",
        ogTitle: "Reproductor {vendor} online",
        ogDescription:
            "Reproductor local para grabaciones {vendor}. Mapa GPS, velocidad y exportación de clips cuando la grabación incluye GPS.",
        h1: "Reproductor {vendor} online — grabaciones en el navegador",
        lead: "Abre las grabaciones de tu cámara {vendor} directamente en el navegador. Si incluyen GPS, dashcamigo muestra la ruta, la velocidad y la fuerza G, y permite exportar clips. Sin instalar la app de {vendor}, subir archivos ni crear una cuenta.",
        ctaPrimary: "Abrir grabaciones de {vendor}",
        modelsCompat:
            "El formato puede variar según el modelo y el firmware. El vídeo estándar se abre localmente; el GPS y la agrupación dependen de los datos guardados por la cámara.",
        formatIntro:
            "Las cámaras {vendor} graban vídeo {codec} en archivos {container}. Las grabaciones siguen el patrón de nombre {filename} y se ordenan en las carpetas {layout} de la tarjeta SD. Arrastra la carpeta entera a la página: dashcamigo agrupa los archivos en trayectos y muestra en el mapa los datos GPS disponibles.",
    },
    fr: {
        title: "Lecteur {vendor} | dashcamigo",
        metaDescription:
            "Ouvre les vidéos {vendor} dans le navigateur. Si elles contiennent un GPS, vois le trajet et la vitesse. Sans téléversement ni installation.",
        ogTitle: "Lecteur {vendor} en ligne",
        ogDescription:
            "Lecteur local pour les enregistrements {vendor}. Carte GPS, vitesse et export de clips lorsque la vidéo contient un GPS.",
        h1: "Lecteur {vendor} en ligne — enregistrements dans le navigateur",
        lead: "Ouvre les enregistrements de ta caméra {vendor} directement dans le navigateur. S'ils contiennent un GPS, dashcamigo affiche le trajet, la vitesse et la force G, puis exporte des clips. Sans installer l'app {vendor}, téléverser les fichiers ni créer un compte.",
        ctaPrimary: "Ouvrir les enregistrements {vendor}",
        modelsCompat:
            "Le format peut varier selon le modèle et le firmware. La vidéo standard s'ouvre localement ; le GPS et le regroupement dépendent des données enregistrées par la caméra.",
        formatIntro:
            "Les caméras {vendor} enregistrent de la vidéo {codec} dans des fichiers {container}. Les enregistrements suivent le modèle de nom {filename} et sont rangés dans les dossiers {layout} sur la carte SD. Glisse le dossier complet sur la page : dashcamigo regroupe les fichiers en trajets et affiche les données GPS disponibles sur la carte.",
    },
    pl: {
        title: "Odtwarzacz {vendor} | dashcamigo",
        metaDescription:
            "Otwórz nagrania {vendor} w przeglądarce. Jeśli zawierają GPS, zobaczysz trasę i prędkość. Bez wysyłania i instalacji.",
        ogTitle: "Odtwarzacz {vendor} online",
        ogDescription:
            "Lokalny odtwarzacz nagrań {vendor}. Mapa GPS, prędkość i eksport klipów, gdy nagranie zawiera GPS.",
        h1: "Odtwarzacz {vendor} online — nagrania w przeglądarce",
        lead: "Otwórz nagrania z kamery {vendor} prosto w przeglądarce. Jeśli zawierają GPS, dashcamigo pokaże trasę, prędkość i przeciążenia oraz pozwoli wyeksportować klip. Bez instalowania aplikacji {vendor}, wysyłania plików i konta.",
        ctaPrimary: "Otwórz nagrania {vendor}",
        modelsCompat:
            "Format może się różnić zależnie od modelu i firmware'u. Standardowe wideo otwiera się lokalnie; GPS i grupowanie zależą od danych zapisanych przez kamerę.",
        formatIntro:
            "Kamery {vendor} nagrywają obraz w kodeku {codec} do plików {container}. Nagrania mają nazwy według wzorca {filename} i są posortowane do folderów {layout} na karcie SD. Przeciągnij cały folder na stronę — dashcamigo pogrupuje pliki w przejazdy i pokaże dostępne dane GPS na mapie.",
    },
    pt: {
        title: "Player {vendor} | dashcamigo",
        metaDescription:
            "Abra gravações {vendor} no navegador. Se tiverem GPS, veja o trajeto e a velocidade. Sem upload ou instalação.",
        ogTitle: "Player {vendor} online",
        ogDescription:
            "Player local para gravações {vendor}. Mapa GPS, velocidade e exportação de clipes quando a gravação tem GPS.",
        h1: "Player {vendor} online — gravações no navegador",
        lead: "Abra as gravações da sua câmera {vendor} direto no navegador. Se tiverem GPS, o dashcamigo mostra o trajeto, a velocidade e a força G e exporta clipes. Sem instalar o app da {vendor}, fazer upload ou criar conta.",
        ctaPrimary: "Abrir gravações da {vendor}",
        modelsCompat:
            "O formato pode variar conforme o modelo e o firmware. O vídeo padrão abre localmente; GPS e agrupamento dependem dos dados gravados pela câmera.",
        formatIntro:
            "As câmeras da {vendor} gravam vídeo em {codec} dentro de arquivos {container}. As gravações seguem o padrão de nome {filename} e ficam organizadas nas pastas {layout} do cartão SD. Arraste a pasta inteira para a página — o dashcamigo agrupa os arquivos em viagens e mostra no mapa os dados GPS disponíveis.",
    },
    zh: {
        title: "{vendor} GPS 视频播放器 | dashcamigo",
        metaDescription:
            "在浏览器中打开 {vendor} 摄像机录像。如果录像包含 GPS，即可查看路线和速度。无需上传或安装。",
        ogTitle: "{vendor} 在线播放器",
        ogDescription:
            "本地播放 {vendor} 录像。录像包含 GPS 时，可查看地图、速度并导出片段。",
        h1: "{vendor} 在线播放器 — 录像在浏览器中播放",
        lead: "直接在浏览器中打开 {vendor} 摄像机录像。如果录像包含 GPS，dashcamigo 会显示路线、速度和 G 力，并可导出片段。无需安装 {vendor} 应用、上传文件或注册账号。",
        ctaPrimary: "打开 {vendor} 录像",
        modelsCompat:
            "录像格式可能因型号和固件而异。标准视频会在本地打开；GPS 和自动分组取决于摄像机保存的数据。",
        formatIntro:
            "{vendor} 摄像机以 {container} 文件录制 {codec} 视频。录像按 {filename} 命名规则命名，并在 SD 卡上归入 {layout} 文件夹。把整个文件夹拖到页面上，dashcamigo 会按行程分组文件，并在地图上显示可用的 GPS 数据。",
    },
    ja: {
        title: "{vendor} GPS動画プレーヤー | dashcamigo",
        metaDescription:
            "{vendor} カメラの録画をブラウザで再生。録画に GPS が含まれていれば、ルートと速度を表示します。アップロードもインストールも不要です。",
        ogTitle: "{vendor} オンラインプレーヤー",
        ogDescription:
            "{vendor} 録画をローカル再生。GPS が含まれていれば、地図、速度、クリップ書き出しを利用できます。",
        h1: "{vendor} オンラインプレーヤー — 録画をブラウザで再生",
        lead: "{vendor} カメラの録画をブラウザで直接開けます。録画に GPS が含まれていれば、dashcamigo がルート、速度、G フォースを表示し、クリップを書き出します。{vendor} 純正アプリのインストール、アップロード、アカウント登録は不要です。",
        ctaPrimary: "{vendor} の録画を開く",
        modelsCompat:
            "録画形式はモデルやファームウェアで異なる場合があります。標準動画はローカルで開き、GPS と自動グループ化はカメラが保存したデータに応じて利用できます。",
        formatIntro:
            "{vendor} のカメラは {codec} の映像を {container} ファイルで録画します。録画ファイルは {filename} という命名パターンに従い、SD カード上では {layout} のフォルダに振り分けられます。フォルダ全体をページにドラッグすると、dashcamigo が走行ごとにまとめ、利用できる GPS データを地図に表示します。",
    },
    ko: {
        title: "{vendor} GPS 영상 플레이어 | dashcamigo",
        metaDescription:
            "{vendor} 카메라 영상을 브라우저에서 재생하세요. 영상에 GPS가 있으면 경로와 속도를 보여줘요. 업로드나 설치가 필요 없어요.",
        ogTitle: "{vendor} 온라인 플레이어",
        ogDescription:
            "{vendor} 녹화를 로컬로 재생해요. GPS가 있으면 지도, 속도, 클립 내보내기를 사용할 수 있어요.",
        h1: "{vendor} 온라인 플레이어 — 브라우저에서 녹화 재생",
        lead: "{vendor} 카메라 영상을 브라우저에서 바로 열어보세요. 영상에 GPS가 있으면 dashcamigo가 경로, 속도, G-포스를 표시하고 클립을 내보내요. {vendor} 전용 앱 설치, 업로드, 회원가입이 필요 없어요.",
        ctaPrimary: "{vendor} 녹화 열기",
        modelsCompat:
            "녹화 형식은 모델과 펌웨어에 따라 달라질 수 있어요. 표준 영상은 로컬에서 열리며 GPS와 자동 그룹화는 카메라가 저장한 데이터에 따라 제공돼요.",
        formatIntro:
            "{vendor} 카메라는 {codec} 영상을 {container} 파일로 녹화해요. 녹화 파일은 {filename} 이름 규칙을 따르고, SD 카드의 {layout} 폴더로 정리돼요. 폴더 전체를 페이지로 드래그하면 dashcamigo가 주행별로 묶고 사용 가능한 GPS 데이터를 지도에 보여줘요.",
    },
};

// Resolve the per-locale vendor content. Returns the hand-written copy for
// en/ru when present, otherwise instantiates VENDOR_TEMPLATES[lang] with
// the vendor displayName substituted into {vendor} placeholders. Throws if
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
    };
    return templated;
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

// Build the static HTML for one vendor page. Inlines BreadcrumbList JSON-LD
// and one tight HTML body. Loads
// /vendor-page.css for styling. No JS app bundle.
function renderVendorPage(vendor: VendorContent, lang: Lang, options: SeoBuildOptions): string {
    const seoLocale = getSeoLocaleByLang(lang);
    if (!seoLocale) throw new Error(`vendor-pages: lang "${lang}" not in SEO_LOCALES`);

    const content = resolveVendorContent(vendor, lang);
    const labels = SHARED_LABELS[lang];
    const pathPrefix = pathPrefixFor(lang);

    const localHome = `${pathPrefix}/`;
    const url = canonicalLocaleUrl(seoLocale, `cameras/${vendor.slug}/`);
    const homeUrl = canonicalLocaleUrl(seoLocale);
    const camerasUrl = canonicalLocaleUrl(seoLocale, "cameras/");
    const ctaHref = `${pathPrefix}/?vendor=${vendor.slug}`;
    const otherVendors = VENDORS.filter((v) => v.slug !== vendor.slug);
    const ogImageUrl = `${canonicalOriginForLocale(seoLocale)}/${seoLocale.ogImage}`;

    const hreflangBlock = buildHreflangLinksHtml((loc) => {
        // Every locale has a non-empty urlSegment now - /en/, /de/, etc.
        return canonicalLocaleUrl(loc, `cameras/${vendor.slug}/`);
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

    const v = vendor.displayName;

    return `<!doctype html>
<html lang="${lang}">
<head>
${searchIndexingMeta(seoLocale, Boolean(options.noIndex))}
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

${renderFeatureLinksHtml(lang, pathPrefix)}
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

// Build the /cameras/ section index page. Hub for the 7 vendor pages, listing
// each as a card with displayName + 1-line format hint. Same chrome as vendor
// pages (header, footer, vendor-page.css). Loads no JS app bundle.
function renderCamerasIndexPage(lang: Lang, options: SeoBuildOptions): string {
    const seoLocale = getSeoLocaleByLang(lang);
    if (!seoLocale) throw new Error(`vendor-pages: lang "${lang}" not in SEO_LOCALES`);

    const content = INDEX_LOCALES[lang];
    const labels = SHARED_LABELS[lang];
    const pathPrefix = pathPrefixFor(lang);
    const localHome = `${pathPrefix}/`;
    const url = canonicalLocaleUrl(seoLocale, "cameras/");
    const homeUrl = canonicalLocaleUrl(seoLocale);
    const ogImageUrl = `${canonicalOriginForLocale(seoLocale)}/${seoLocale.ogImage}`;

    const hreflangBlock = buildHreflangLinksHtml((loc) => {
        return canonicalLocaleUrl(loc, "cameras/");
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
                url: canonicalLocaleUrl(seoLocale, `cameras/${v.slug}/`),
                name: v.displayName,
            })),
        },
    };

    return `<!doctype html>
<html lang="${lang}">
<head>
${searchIndexingMeta(seoLocale, Boolean(options.noIndex))}
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
    const defaultLocale = getDefaultSeoLocale();

    // Locale and vendor content shares monolithic source files. Their mtimes
    // cannot identify which URL changed, so omit lastmod rather than publish
    // a site-wide false freshness signal.

    // /cameras/ section index alternates: every locale's /cameras/ page.
    const indexAlternates = buildHreflangAlternatesMap((loc) => canonicalLocaleUrl(loc, "cameras/"));
    const indexXDefault = canonicalLocaleUrl(defaultLocale, "cameras/");
    for (const loc of indexable) {
        entries.push({
            loc: canonicalLocaleUrl(loc, "cameras/"),
            changefreq: "monthly",
            priority: loc.lang === defaultLang ? "0.8" : "0.7",
            alternates: indexAlternates,
            xDefaultUrl: indexXDefault,
        });
    }

    // Individual vendor pages: one entry per vendor × indexable locale
    // (7 vendors × 10 locales = 70 today). Each vendor has its own alternates
    // map (different from /cameras/ siblings).
    for (const vendor of VENDORS) {
        const vendorAlternates = buildHreflangAlternatesMap((loc) =>
            canonicalLocaleUrl(loc, `cameras/${vendor.slug}/`),
        );
        const vendorXDefault = canonicalLocaleUrl(defaultLocale, `cameras/${vendor.slug}/`);
        for (const loc of indexable) {
            entries.push({
                loc: canonicalLocaleUrl(loc, `cameras/${vendor.slug}/`),
                changefreq: "monthly",
                priority: loc.lang === defaultLang ? "0.7" : "0.6",
                alternates: vendorAlternates,
                xDefaultUrl: vendorXDefault,
            });
        }
    }
    return entries;
}
