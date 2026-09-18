import { t, type I18nKey } from "../i18n/index.js";
import type { MapProviderPreference } from "./map-provider.js";

const PROVIDER_LABEL_KEYS = {
    openfreemap: "settings.map.provider.openfreemap",
    "osm-vector": "settings.map.provider.openstreetmap",
    yandex: "settings.map.provider.yandex",
} as const satisfies Record<MapProviderPreference, I18nKey>;

interface MapProviderSelectOptions {
    id: string;
    value: MapProviderPreference;
    isYandexDisabled: boolean;
    onChange: (provider: MapProviderPreference) => void;
}

export function createMapProviderSelect(options: MapProviderSelectOptions): HTMLSelectElement {
    const select = document.createElement("select");
    select.id = options.id;
    select.className = "settings-select";
    for (const provider of ["openfreemap", "osm-vector", "yandex"] as const) {
        const option = document.createElement("option");
        option.value = provider;
        option.textContent = t(PROVIDER_LABEL_KEYS[provider]);
        option.disabled = provider === "yandex" && options.isYandexDisabled;
        select.append(option);
    }
    select.value = options.value;
    select.addEventListener("change", () => {
        const provider = select.value;
        if (provider === "openfreemap" || provider === "osm-vector") options.onChange(provider);
        else if (provider === "yandex" && !options.isYandexDisabled) options.onChange(provider);
    });
    return select;
}
