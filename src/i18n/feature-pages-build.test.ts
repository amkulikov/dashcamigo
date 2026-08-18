// Tests for the use-case feature pages build surface: sitemap entries
// (complete hreflang graph, trailing slashes, same slug across locales), the
// dev/route matcher, and locale parity. Mirrors alternative-pages-build.test.ts.

import { describe, expect, it } from "vitest";

import { assertFeatureLocaleParity, getFeatureListings, getFeatureSitemapEntries, matchFeatureRoute } from "../../vite-plugins/feature-pages.js";
import { getHreflangCodes, getIndexableSeoLocales } from "./seo-config.js";

describe("feature sitemap entries", () => {
    const entries = getFeatureSitemapEntries();
    const indexable = getIndexableSeoLocales();
    const slugCount = getFeatureListings().length;

    it("omits lastmod when per-URL source history is unavailable", () => {
        expect(entries.every((entry) => entry.lastmod === undefined)).toBe(true);
    });

    it("includes every feature page × every indexable locale", () => {
        expect(entries.length).toBe(slugCount * indexable.length);
    });

    it("every entry URL ends with '/' (Cloudflare Pages trailing-slash invariant)", () => {
        for (const entry of entries) {
            expect(entry.loc, `entry ${entry.loc} must end with slash`).toMatch(/\/$/);
            for (const alt of Object.values(entry.alternates)) {
                expect(alt, `alternate ${alt} must end with slash`).toMatch(/\/$/);
            }
            expect(entry.xDefaultUrl, `x-default ${entry.xDefaultUrl}`).toMatch(/\/$/);
        }
    });

    it("every entry has alternates for every hreflang code incl. generic aliases (complete bidirectional graph)", () => {
        const expectedHreflangs = new Set(indexable.flatMap((l) => getHreflangCodes(l)));
        for (const entry of entries) {
            expect(new Set(Object.keys(entry.alternates)), `alternates for ${entry.loc}`).toEqual(expectedHreflangs);
        }
    });

    it("generic pt alias targets the same URL as pt-BR in every entry", () => {
        for (const entry of entries) {
            expect(entry.alternates.pt, `pt alias for ${entry.loc}`).toBeDefined();
            expect(entry.alternates.pt).toBe(entry.alternates["pt-BR"]);
        }
    });

    it("alternates for a feature page target the SAME slug across locales", () => {
        const enCombine = entries.find((e) => e.loc === "https://dashcamigo.app/en/combine-dashcam-cameras-into-one-video/");
        expect(enCombine).toBeDefined();
        expect(enCombine?.alternates.de).toBe("https://dashcamigo.app/de/combine-dashcam-cameras-into-one-video/");
        expect(enCombine?.alternates.ja).toBe("https://dashcamigo.app/ja/combine-dashcam-cameras-into-one-video/");
        expect(enCombine?.xDefaultUrl).toBe("https://dashcamigo.app/en/combine-dashcam-cameras-into-one-video/");
    });
});

describe("matchFeatureRoute", () => {
    it("matches a locale-prefixed feature page", () => {
        const m = matchFeatureRoute("/ru/combine-dashcam-cameras-into-one-video/");
        expect(m?.lang).toBe("ru");
        expect(m?.page.slug).toBe("combine-dashcam-cameras-into-one-video");
    });

    it("matches a locale-less feature page as English", () => {
        const m = matchFeatureRoute("/add-data-overlay-to-dashcam-video/");
        expect(m?.lang).toBe("en");
        expect(m?.page.slug).toBe("add-data-overlay-to-dashcam-video");
    });

    it("returns null for an unknown slug", () => {
        expect(matchFeatureRoute("/en/does-not-exist/")).toBeNull();
    });

    it("returns null for paths outside the feature space and for too-deep paths", () => {
        expect(matchFeatureRoute("/en/cameras/70mai/")).toBeNull();
        expect(matchFeatureRoute("/en/combine-dashcam-cameras-into-one-video/extra/")).toBeNull();
        expect(matchFeatureRoute("/")).toBeNull();
    });
});

describe("feature-pages locale parity", () => {
    it("has labels and every page's content for every indexable locale (matching list lengths)", () => {
        // Same guard the build runs in closeBundle: every indexable locale must
        // have chrome labels and per-page content (hand-written en/ru or
        // machine-translated community), with options/howSteps/faq lengths
        // matching the English source. Throws with the offending list otherwise.
        expect(() => assertFeatureLocaleParity()).not.toThrow();
    });
});
