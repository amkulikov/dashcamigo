import { validateStyleMin } from "@maplibre/maplibre-gl-style-spec";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createYandexMapStyle, isYandexMapAvailable, yandexMapTileTemplate } from "./yandex-map.js";

describe("Yandex map configuration", () => {
    afterEach(() => vi.unstubAllEnvs());

    it("creates no remote source without a configured key", () => {
        vi.stubEnv("VITE_YANDEX_TILES_API_KEY", "  ");
        expect(isYandexMapAvailable()).toBe(false);
        expect(createYandexMapStyle()).toBeNull();
        expect(yandexMapTileTemplate()).toBeNull();
    });

    it.each([
        ["ru", "ru_RU"],
        ["en", "en_US"],
        ["de", "en_US"],
    ])("produces a valid spherical raster style for %s", (language, expectedLang) => {
        const key = "debug&projection=wgs84_mercator";
        vi.stubEnv("VITE_YANDEX_TILES_API_KEY", key);
        const style = createYandexMapStyle(language)!;
        expect(isYandexMapAvailable()).toBe(true);
        expect(validateStyleMin(style)).toEqual([]);
        const source = style.sources.yandex;
        if (source?.type !== "raster") throw new Error("missing raster source");
        expect(source.tiles![0]).toBe(yandexMapTileTemplate(language));
        const url = new URL(source.tiles![0]!);
        expect(url.origin).toBe("https://tiles.api-maps.yandex.ru");
        expect(url.searchParams.get("projection")).toBe("web_mercator");
        expect(url.searchParams.get("apikey")).toBe(key);
        expect(url.searchParams.get("lang")).toBe(expectedLang);
        expect(url.searchParams.get("scale")).toBe("2");
        expect(url.searchParams.get("x")).toBe("{x}");
        expect(url.searchParams.get("y")).toBe("{y}");
        expect(url.searchParams.get("z")).toBe("{z}");
        expect(source.tileSize).toBe(256);
        expect(source.maxzoom).toBe(20);
        expect(source.attribution).toContain("https://yandex.ru/maps/");
    });
});
