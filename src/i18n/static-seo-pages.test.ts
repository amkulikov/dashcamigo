import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const STATIC_PAGES = ["public/privacy.html", "public/terms.html", "public/add-my-camera.html"];

describe("static SEO page home links", () => {
    for (const file of STATIC_PAGES) {
        it(`${file} links each translation directly to its locale home`, () => {
            const html = readFileSync(file, "utf-8");
            const articles = [...html.matchAll(/<article data-lang="([a-z]+)"[^>]*>([\s\S]*?)<\/article>/g)];

            expect(articles.length).toBeGreaterThan(0);
            expect(html).not.toContain('href="/"');
            for (const [, lang, article] of articles) {
                const homeLinks = [...article!.matchAll(/href="\/(?:[a-z]+)\/"/g)].map((match) => match[0]);
                expect(homeLinks.length, `${file} ${lang} has a locale-home link`).toBeGreaterThan(0);
                expect(new Set(homeLinks), `${file} ${lang} links stay in the article locale`).toEqual(new Set([`href="/${lang}/"`]));
            }
        });
    }
});
