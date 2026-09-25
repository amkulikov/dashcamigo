import type { StyleSpecification } from "maplibre-gl";
import type { MapStyleId } from "./theme.js";

// The portable build aliases this module to bundled JSON imports.
const MAP_STYLE_URLS: Record<MapStyleId, string> = {
    light: "/styles/light.json",
    dark: "/styles/dark.json",
    neon: "/styles/neon.json",
};

export async function loadMapStyleSource(theme: MapStyleId, signal: AbortSignal): Promise<StyleSpecification> {
    const response = await fetch(MAP_STYLE_URLS[theme], { signal });
    if (!response.ok) throw new Error(`http ${response.status}`);
    return response.json() as Promise<StyleSpecification>;
}
