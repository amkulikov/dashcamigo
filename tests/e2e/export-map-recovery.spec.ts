import type { Page, Route } from "@playwright/test";

import { DESKTOP, expect, gotoApp, loadTrip, openExport, presetLocalStorage, test } from "./_fixtures.js";

test.use({ serviceWorkers: "block" });

test.beforeEach(async ({ page }) => {
    await presetLocalStorage(page);
    await page.setViewportSize(DESKTOP);
    await gotoApp(page);
    await loadTrip(page);
    await openExport(page);
});

async function solidTile(page: Page): Promise<Buffer> {
    const encoded = await page.evaluate(() => {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 256;
        const ctx = canvas.getContext("2d")!;
        ctx.fillStyle = "#20a040";
        ctx.fillRect(0, 0, 256, 256);
        return canvas.toDataURL().split(",")[1]!;
    });
    return Buffer.from(encoded, "base64");
}

async function previewPixel(page: Page): Promise<number[]> {
    return page.locator("#player-map-overlay-canvas").evaluate((el) => {
        const canvas = el as HTMLCanvasElement;
        return Array.from(canvas.getContext("2d")!.getImageData(0, 0, 1, 1).data);
    });
}

async function expectPreviewSettles(page: Page): Promise<void> {
    const writes = await page.locator("#player-map-overlay-canvas").evaluate(
        (canvas) =>
            new Promise<number>((resolve) => {
                let mutations = 0;
                let frames = 0;
                const observer = new MutationObserver((entries) => {
                    mutations += entries.length;
                });
                observer.observe(canvas, { attributes: true, attributeFilter: ["width", "height"] });
                const next = (): void => {
                    if (++frames < 12) requestAnimationFrame(next);
                    else {
                        observer.disconnect();
                        resolve(mutations);
                    }
                };
                requestAnimationFrame(next);
            }),
    );
    expect(writes, "an idle map must not keep resnapshotting the paused preview").toBe(0);
}

test("repaints a paused map preview after its provider changes without rebuilding the map", async ({ page }) => {
    const tile = await solidTile(page);
    await page.locator("#export-panel-ov-map").check();
    await expect.poll(() => previewPixel(page)).toEqual([0, 0, 0, 128]);
    const playhead = await page.locator("#player").evaluate((el) => (el as HTMLVideoElement).currentTime);
    await page.locator("#export-map-snapshot-host").evaluate((el) => {
        (el as HTMLElement).dataset.providerTest = "true";
    });

    // Keep fallback probes unavailable until the initial provider has painted.
    await page.route("https://tile.openstreetmap.org/**", (route) =>
        route.fulfill({ body: tile, contentType: "image/png", headers: { "access-control-allow-origin": "*" } }),
    );
    await page.evaluate(() => window.__dashcamigo.setMapProvider("osm-raster"));

    await expect.poll(() => previewPixel(page)).toEqual([32, 160, 64, 255]);
    await expect(page.locator('[data-provider-test="true"]')).toHaveCount(1);
    await expect(page.locator("#player")).toHaveJSProperty("paused", true);
    await expect(page.locator("#player")).toHaveJSProperty("currentTime", playhead);
    await expectPreviewSettles(page);
    await page.locator("#export-panel-close").click();
    await expect(page.locator("#export-map-snapshot-host")).toHaveCount(0);
});

test("repaints a paused map preview when tiles arrive after the bounded snapshot wait", async ({ page }) => {
    const tile = await solidTile(page);
    let pendingTile: Route | undefined;
    await page.route("**/preview-map-tile.png", (route) => {
        pendingTile = route;
    });
    await page.route("**/styles/neon.json", (route) =>
        route.fulfill({
            json: {
                version: 8,
                sources: {
                    delayed: {
                        type: "raster",
                        tiles: [new URL("/preview-map-tile.png", page.url()).href],
                        tileSize: 256,
                        maxzoom: 0,
                    },
                },
                layers: [
                    { id: "background", type: "background", paint: { "background-color": "#000000" } },
                    { id: "delayed", type: "raster", source: "delayed", paint: { "raster-fade-duration": 0 } },
                ],
            },
        }),
    );
    await page.locator("#export-panel-ov-map").check();
    await expect.poll(() => Boolean(pendingTile)).toBe(true);
    await expect.poll(() => previewPixel(page)).toEqual([0, 0, 0, 255]);
    const playhead = await page.locator("#player").evaluate((el) => (el as HTMLVideoElement).currentTime);
    if (!pendingTile) throw new Error("preview tile request is missing");

    await pendingTile.fulfill({ body: tile, contentType: "image/png" });

    await expect.poll(() => previewPixel(page)).toEqual([32, 160, 64, 255]);
    await expect(page.locator("#player")).toHaveJSProperty("paused", true);
    await expect(page.locator("#player")).toHaveJSProperty("currentTime", playhead);
    await expectPreviewSettles(page);
    await page.locator("#export-panel-close").click();
    await expect(page.locator("#export-map-snapshot-host")).toHaveCount(0);
});
