import { describe, expect, it } from "vitest";
import { SUPPORTED_BRANDS } from "../../vite-plugins/supported-brands.js";
import { matchVendorRoute, renderCamerasIndexPage } from "../../vite-plugins/vendor-pages.js";
import { getIndexableSeoLocales } from "./seo-config.js";

describe("supported camera catalog", () => {
    it("shows every registered brand once in every locale with matching structured data", () => {
        for (const locale of getIndexableSeoLocales()) {
            const html = renderCamerasIndexPage(locale.lang, {});
            const names = [...html.matchAll(/<span class="vp-vendor-card-name">([^<]+)<\/span>/g)].map((match) => match[1]);
            expect(names.length, locale.lang).toBe(SUPPORTED_BRANDS.length);
            expect(names, locale.lang).toEqual(SUPPORTED_BRANDS.map((brand) => brand.displayName));
            expect([...html.matchAll(/<ul class="vp-vendor-grid">/g)], locale.lang).toHaveLength(1);
            const documents = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((match) => JSON.parse(match[1]!));
            const collection = documents.find((document) => document["@type"] === "CollectionPage");
            expect(collection.mainEntity.numberOfItems, locale.lang).toBe(names.length);
            expect(
                collection.mainEntity.itemListElement.map((item: { name: string }) => item.name),
                locale.lang,
            ).toEqual(names);
            for (const item of collection.mainEntity.itemListElement) {
                expect(names, locale.lang).toContain(item.name);
                const target = new URL(item.url);
                if (target.hash) expect(html, item.url).toContain(`id="${target.hash.slice(1)}"`);
                else expect(matchVendorRoute(target.pathname)?.kind, item.url).toBe("vendor");
            }
        }
    });

    it("keeps GPS claims tied to supported models and useful requirements", () => {
        const html = renderCamerasIndexPage("en", {});
        const card = (slug: string) => new RegExp(`<li id="camera-${slug}">([\\s\\S]*?)</li>`).exec(html)?.[1];
        expect(card("avylet")).toContain("A1");
        expect(card("avylet")).toContain("GPS receiver required");
        expect(card("datakam")).toContain("GPS in exported recordings");
        expect(card("botslab")).toContain("G300H 2K");
        expect(card("izeeker")).toContain("iD300");
        expect(card("izeeker")).toContain("Video and GPS");
        expect(card("hp")).toContain("f969x");
        expect(card("hp")).toContain("Video playback");
        expect(card("hp")).not.toContain("Video and GPS");
        expect(card("ibox")).toContain("iCON");
        expect(card("ibox")).not.toContain("RoadScan");
    });
});
