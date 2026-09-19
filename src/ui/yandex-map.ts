import type { StyleSpecification } from "maplibre-gl";

function yandexMapKey(): string {
    return import.meta.env.VITE_YANDEX_TILES_API_KEY?.trim() ?? "";
}

export function isYandexMapAvailable(): boolean {
    return yandexMapKey().length > 0;
}

export function createYandexMapStyle(language = "en"): StyleSpecification | null {
    const key = yandexMapKey();
    if (!key) return null;
    const lang = language === "ru" ? "ru_RU" : language === "tr" ? "tr_TR" : language === "uk" ? "uk_UA" : "en_US";
    // The API defaults to ellipsoidal Mercator; MapLibre requires spherical tiles.
    const tileUrl = `https://tiles.api-maps.yandex.ru/v1/tiles/?x={x}&y={y}&z={z}&lang=${lang}&l=map&scale=2&projection=web_mercator&apikey=${encodeURIComponent(key)}`;
    return {
        version: 8,
        sources: {
            yandex: {
                type: "raster",
                tiles: [tileUrl],
                // Keep logical size fixed while scale increases raster resolution.
                tileSize: 256,
                maxzoom: 20,
                attribution: '<a href="https://yandex.ru/maps/" target="_blank" rel="noopener">© Yandex</a>',
            },
        },
        layers: [{ id: "yandex-map", type: "raster", source: "yandex", paint: { "raster-fade-duration": 0 } }],
    };
}
