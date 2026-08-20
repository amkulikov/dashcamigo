// Lock test: FAQPage JSON-LD must match the visible DOM literally.
//
// Google's FAQPage rich-snippet spec requires the question / answer text in
// JSON-LD to match the text the user sees on the page byte-for-byte. Any
// divergence is grounds for the snippet to be dropped or flagged as
// misleading content. The baseline FAQ JSON-LD in index.html is the literal
// English copy; this test verifies that for each answer the corresponding
// landing.faq.* dict fragments concatenate to the same string.
//
// The seo-prerender plugin re-derives the JSON-LD from these same dict keys
// at build time (see buildFaqJsonLd in vite-plugins/seo-prerender.ts), so
// keeping the dict in sync with the baseline guarantees the rendered output
// stays in sync for /ru/ too.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { enDict } from "./i18n/en.js";

const HTML_PATH = resolve(process.cwd(), "index.html");

interface FaqEntry {
    name: string;
    text: string;
}

function extractBaselineFaq(html: string): FaqEntry[] {
    const m = html.match(/<script\b[^>]*\bid="faq-jsonld"[^>]*>([\s\S]*?)<\/script>/i);
    if (!m?.[1]) throw new Error('<script id="faq-jsonld"> not found in index.html');
    const parsed = JSON.parse(m[1].trim()) as {
        mainEntity: Array<{ name: string; acceptedAnswer: { text: string } }>;
    };
    return parsed.mainEntity.map((q) => ({ name: q.name, text: q.acceptedAnswer.text }));
}

// Vendor brand list that the DOM weaves between i18n fragments for a2 and the
// hero-lead. Must stay in sync with index.html and with buildFaqJsonLd in
// vite-plugins/seo-prerender.ts.
const VENDOR_BRANDS_TAIL = "70mai, Viofo, BlackVue, GoPro, Garmin, Vantrue, Thinkware";

describe("faq-jsonld baseline parity", () => {
    const baseline = extractBaselineFaq(readFileSync(HTML_PATH, "utf-8"));

    it("has 11 questions", () => {
        expect(baseline).toHaveLength(11);
    });

    it.each([
        [0, "landing.faq.q1", "landing.faq.a1"],
        [1, "landing.faq.q9", "landing.faq.a9"],
        [3, "landing.faq.q3", "landing.faq.a3"],
        [4, "landing.faq.q4", "landing.faq.a4"],
        [5, "landing.faq.q5", "landing.faq.a5"],
        [6, "landing.faq.q11", "landing.faq.a11"],
        [7, "landing.faq.q6", "landing.faq.a6"],
        [8, "landing.faq.q10", "landing.faq.a10"],
        [9, "landing.faq.q7", "landing.faq.a7"],
    ] as const)("entry %i: %s / %s matches dict", (idx, qKey, aKey) => {
        const entry = baseline[idx];
        expect(entry, `missing baseline entry ${idx}`).toBeDefined();
        expect(entry?.name).toBe(enDict[qKey]);
        expect(entry?.text).toBe(enDict[aKey]);
    });

    it("entry 2 (q2) stitches vendor brands between dict fragments", () => {
        const entry = baseline[2];
        const expected = `${VENDOR_BRANDS_TAIL}${enDict["landing.faq.a2.after"]}`;
        expect(entry?.name).toBe(enDict["landing.faq.q2"]);
        expect(entry?.text).toBe(expected);
    });

    it("entry 10 (q8) stitches the /alternatives/ link label between dict fragments", () => {
        const entry = baseline[10];
        const expected = `${enDict["landing.faq.a8.before"]}${enDict["landing.faq.a8.link"]}${enDict["landing.faq.a8.after"]}`;
        expect(entry?.name).toBe(enDict["landing.faq.q8"]);
        expect(entry?.text).toBe(expected);
    });
});
