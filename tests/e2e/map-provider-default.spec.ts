import path from "node:path";
import type { Page } from "@playwright/test";

import {
    DESKTOP,
    REPO_ROOT,
    expect,
    gotoApp,
    loadTrip,
    openExport,
    pausePlayback,
    presetLocalStorage,
    test,
} from "./_fixtures.js";

const defaultProvider = process.env.VITE_DEFAULT_MAP_PROVIDER || "openfreemap";
const providerStorageKey = "dashcamigo:mapProvider";

test.use({ serviceWorkers: "block" });

test.beforeEach(async ({ page }) => {
    await presetLocalStorage(page);
    await page.setViewportSize(DESKTOP);
    await page.route("https://tiles.api-maps.yandex.ru/**", (route) =>
        route.fulfill({
            path: path.join(REPO_ROOT, "public/favicon-192.png"),
            contentType: "image/png",
            headers: { "access-control-allow-origin": "*" },
        }),
    );
});

async function expectDefaultViewerSource(page: Page): Promise<void> {
    const source =
        defaultProvider === "yandex" ? "yandex" : defaultProvider === "osm-vector" ? "osm-shortbread" : "openmaptiles";
    await expect
        .poll(() =>
            page.evaluate((source) => {
                const { map, miniMap } = window.__dashcamigo.state;
                return Boolean(map?.getSource(source)) && Boolean(miniMap?.getSource(source));
            }, source),
        )
        .toBe(true);
}

test("first launch uses the build default in both English and Russian without saving a choice", async ({ page }) => {
    await gotoApp(page);
    await loadTrip(page);
    await pausePlayback(page);
    await expect(page.locator("#settings-map-provider-select")).toHaveValue(defaultProvider);
    const style = page.locator("#settings-map-style-select");
    if (defaultProvider === "yandex") await expect(style).toBeDisabled();
    else await expect(style).toBeEnabled();
    await expectDefaultViewerSource(page);
    expect(await page.evaluate((key) => localStorage.getItem(key), providerStorageKey)).toBeNull();

    await gotoApp(page, "ru");
    await expect(page.locator("#settings-map-provider-select")).toHaveValue(defaultProvider);
    expect(await page.evaluate((key) => localStorage.getItem(key), providerStorageKey)).toBeNull();
});

test("saved OpenFreeMap overrides the build default and later choices survive reloads", async ({ page }) => {
    await gotoApp(page);
    await page.evaluate((key) => localStorage.setItem(key, "openfreemap"), providerStorageKey);
    await page.reload();
    const provider = page.locator("#settings-map-provider-select");
    await expect(provider).toHaveValue("openfreemap");

    for (const choice of ["osm-vector", "openfreemap"]) {
        await page.locator("#settings-btn").click();
        await provider.selectOption(choice);
        expect(await page.evaluate((key) => localStorage.getItem(key), providerStorageKey)).toBe(choice);
        await page.reload();
        await expect(provider).toHaveValue(choice);
    }
});

test("the viewer build default leaves the export provider independent", async ({ page }) => {
    await gotoApp(page);
    await loadTrip(page);
    await pausePlayback(page);
    await expectDefaultViewerSource(page);

    await openExport(page);
    await page.locator("#export-panel-ov-map").check();
    const exportProvider = page.locator("#export-map-provider-select");
    await expect(exportProvider).toHaveValue("openfreemap");
    await expect(exportProvider.locator('option[value="yandex"]')).toBeDisabled();
    await exportProvider.selectOption("osm-vector");
    await expect(exportProvider).toHaveValue("osm-vector");
    await expect(page.locator("#settings-map-provider-select")).toHaveValue(defaultProvider);
    await expectDefaultViewerSource(page);
});
