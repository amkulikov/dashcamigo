import { describe, expect, it } from "vitest";

import { createPortableMapAssetLoader } from "./portable-map-assets.js";

describe("embedded map assets", () => {
    it("returns parsed sprite metadata and encoded image bytes", async () => {
        const loader = createPortableMapAssetLoader({
            "dcasset://assets/sprite.json": 'data:application/json,{"marker":{"width":1,"height":1}}',
            "dcasset://assets/sprite@2x.png": "data:image/png;base64,AQID",
        });
        const metadata = await loader({ url: "dcasset://assets/sprite.json", type: "json" }, new AbortController());
        expect(metadata.data).toEqual({ marker: { width: 1, height: 1 } });
        const image = await loader({ url: "dcasset://assets/sprite@2x.png" }, new AbortController());
        expect(image.data).toEqual(Uint8Array.of(1, 2, 3).buffer);
    });

    it("rejects missing and external resources without making a request", async () => {
        const loader = createPortableMapAssetLoader({
            "dcasset://assets/sprite.png": "https://example.com/sprite.png",
        });
        await expect(loader({ url: "dcasset://assets/missing.png" }, new AbortController())).rejects.toThrow(
            "embedded map asset is missing",
        );
        await expect(loader({ url: "dcasset://assets/sprite.png" }, new AbortController())).rejects.toThrow(
            "embedded map asset is missing",
        );
    });

    it("honors cancellation", async () => {
        const loader = createPortableMapAssetLoader({ "dcasset://assets/sprite.png": "data:image/png;base64,AQID" });
        const controller = new AbortController();
        controller.abort();
        await expect(loader({ url: "dcasset://assets/sprite.png" }, controller)).rejects.toMatchObject({
            name: "AbortError",
        });
    });
});
