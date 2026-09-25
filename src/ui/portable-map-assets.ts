import type { AddProtocolAction } from "maplibre-gl";

/** MapLibre appends sprite extensions, so an embedded sprite needs a protocol URL. */
export function createPortableMapAssetLoader(assets: Readonly<Record<string, string>>): AddProtocolAction {
    return async (request, abortController) => {
        const url = assets[request.url];
        if (!url?.startsWith("data:")) throw new Error("embedded map asset is missing");
        const response = await fetch(url, { signal: abortController.signal });
        if (request.type === "json") {
            const data: unknown = await response.json();
            if (typeof data !== "object" || data === null) throw new Error("invalid embedded map json");
            return { data };
        }
        return { data: await response.arrayBuffer() };
    };
}
