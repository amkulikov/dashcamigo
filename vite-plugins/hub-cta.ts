// Shared CTA band for the section hub pages (/cameras/, /alternatives/).
// A hub otherwise dead-ends a search visitor: the only ways into the app are
// the small header back-link and the footer. Button copy reuses each locale's
// established "open your recordings" wording from the detail-page CTAs.
// Rendered by vendor-pages.ts and alternative-pages.ts; styles live in
// public/vendor-page.css (.vp-index-cta).

import type { Lang } from "../src/i18n/index.js";
import { escapeText } from "./html-utils.js";

interface HubCtaCopy {
    lead: string;
    button: string;
}

const HUB_CTA: Record<Lang, HubCtaCopy> = {
    en: {
        lead: "Try it with your own footage — free, right in your browser.",
        button: "Open your recordings",
    },
    ru: {
        lead: "Попробуй на своих записях — бесплатно, прямо в браузере.",
        button: "Открыть свои записи",
    },
    de: {
        lead: "Probier es mit deinen eigenen Aufnahmen — kostenlos, direkt im Browser.",
        button: "Deine Aufnahmen öffnen",
    },
    es: {
        lead: "Pruébalo con tus propias grabaciones — gratis, directamente en el navegador.",
        button: "Abre tus grabaciones",
    },
    fr: {
        lead: "Essayez avec vos propres enregistrements — gratuit, directement dans le navigateur.",
        button: "Ouvrir vos enregistrements",
    },
    pl: {
        lead: "Wypróbuj na własnych nagraniach — za darmo, prosto w przeglądarce.",
        button: "Otwórz swoje nagrania",
    },
    pt: {
        lead: "Experimente com suas próprias gravações — grátis, direto no navegador.",
        button: "Abra suas gravações",
    },
    zh: {
        lead: "用你自己的录像试试 — 免费，就在浏览器里。",
        button: "打开你的录像",
    },
    ja: {
        lead: "自分の録画で試してみてください — 無料、ブラウザだけで完結します。",
        button: "録画を開く",
    },
    ko: {
        lead: "내 녹화 영상으로 바로 써 보세요 — 무료, 브라우저에서 그대로.",
        button: "내 녹화 영상 열기",
    },
};

/** CTA band linking a hub page back to the app home at `${pathPrefix}/`. */
export function renderHubCta(lang: Lang, pathPrefix: string): string {
    const copy = HUB_CTA[lang];
    return `<div class="vp-index-cta">
<p>${escapeText(copy.lead)}</p>
<a href="${pathPrefix}/" class="vp-cta">${escapeText(copy.button)}</a>
</div>`;
}
