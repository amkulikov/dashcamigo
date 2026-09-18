import path from "node:path";
import type { Locator, Page } from "@playwright/test";

import {
    DESKTOP,
    MOBILE,
    REPO_ROOT,
    expect,
    gotoApp,
    loadTrip,
    openExport,
    pausePlayback,
    presetLocalStorage,
    test,
} from "./_fixtures.js";

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
    await gotoApp(page);
});

async function expectControlsDisabled(controls: Locator, isDisabled: boolean): Promise<void> {
    expect(await controls.count(), "the controls under test must exist").toBeGreaterThan(0);
    for (const control of await controls.all()) {
        if (isDisabled) await expect(control).toBeDisabled();
        else await expect(control).toBeEnabled();
    }
}

async function expectViewerSource(page: Page, source: string): Promise<void> {
    await expect
        .poll(() =>
            page.evaluate((source) => {
                const { map, miniMap } = window.__dashcamigo.state;
                return Boolean(map?.getSource(source)) && Boolean(miniMap?.getSource(source));
            }, source),
        )
        .toBe(true);
}

async function chooseViewerProvider(page: Page, provider: string): Promise<void> {
    await page.locator("#settings-btn").click();
    await page.locator("#settings-map-provider-select").selectOption(provider);
    await page.locator("#settings-modal-header-close").click();
}

async function expectCreditsInside(map: Locator): Promise<void> {
    const credits = map.locator(".dc-map-attrib");
    await expect(credits).toBeVisible();
    const links = credits.locator("a");
    expect(await links.count(), "map attribution must include source links").toBeGreaterThan(0);
    for (const link of await links.all()) await expect(link).toBeVisible();
    await expect
        .poll(() =>
            map.evaluate((map) => {
                const bounds = map.getBoundingClientRect();
                const credits = map.querySelector(".dc-map-attrib")!.getBoundingClientRect();
                return (
                    credits.left >= bounds.left - 1 &&
                    credits.top >= bounds.top - 1 &&
                    credits.right <= bounds.right + 1 &&
                    credits.bottom <= bounds.bottom + 1
                );
            }),
        )
        .toBe(true);
}

async function expectCreditsClickable(map: Locator): Promise<void> {
    const links = map.locator(".dc-map-attrib a");
    expect(await links.count(), "map attribution must include clickable links").toBeGreaterThan(0);
    for (const link of await links.all()) {
        await expect
            .poll(() =>
                link.evaluate((link) => {
                    const box = link.getBoundingClientRect();
                    return link.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
                }),
            )
            .toBe(true);
    }
}

async function expectYandexLogo(map: Locator, tooltip: string): Promise<void> {
    const logo = map.locator(".dc-map-logo");
    await expect(logo).toBeVisible();
    await expect(logo.locator("img")).toBeVisible();
    await expect(logo).toHaveAttribute("href", "https://yandex.ru/maps/");
    await expect(logo).toHaveAttribute("title", tooltip);
}

async function expectMainCreditsAbovePlayerBar(page: Page, tooltip: string): Promise<void> {
    const main = page.locator("#map");
    await expectCreditsInside(main);
    await expectYandexLogo(main, tooltip);
    await expect
        .poll(() =>
            page.evaluate(() => {
                const credits = document.querySelector("#map .dc-map-attrib")!.getBoundingClientRect();
                const playerBar = document.querySelector(".player-bar")!.getBoundingClientRect();
                return (
                    credits.top >= 0 &&
                    credits.left >= 0 &&
                    credits.right <= window.innerWidth &&
                    credits.bottom <= Math.min(playerBar.top, window.innerHeight)
                );
            }),
        )
        .toBe(true);
    await expectCreditsClickable(main);
}

test("Yandex selection syncs map settings and limits the camera to north-up", async ({ page }) => {
    await loadTrip(page);
    await pausePlayback(page);
    await page.locator(".mini-map").click();
    await page.locator("#map-settings-toggle").click();
    const quickProvider = page.locator("#map-provider-select");
    await expect(quickProvider).toHaveAccessibleName("Map provider");
    await page.locator("#map-style-select").selectOption("road");
    await page.locator("#map-theme-select").selectOption("light");
    await quickProvider.selectOption("yandex");
    await expectViewerSource(page, "yandex");
    await expect(page.locator('.map-follow-seg[data-follow-mode="chase"]')).toBeDisabled();
    await expect(page.locator('.map-follow-seg[data-follow-mode="rotate"]')).toBeDisabled();
    await expect.poll(() => page.evaluate(() => window.__dashcamigo.state.map!.getBearing())).toBe(0);
    await expect.poll(() => page.evaluate(() => window.__dashcamigo.state.map!.getPitch())).toBe(0);
    const quickAppearance = page.locator(
        "#map-style-select, #map-theme-select, #map-buildings3d-toggle, #map-label-scale-segment button, #map-street-names-segment button",
    );
    await expectControlsDisabled(quickAppearance, true);
    await expect(page.locator("#map-style-unavailable")).toHaveText(
        "Map appearance settings are unavailable for raster maps.",
    );
    await expect(page.locator("#map-style-unavailable")).toBeVisible();
    await expectControlsDisabled(page.locator("#map-marker-control button, #map-marker-control input"), false);
    await expect(page.locator("#settings-map-provider-select")).toHaveValue("yandex");

    await page.keyboard.press("Escape");
    await page.locator("#settings-btn").click();
    const modalAppearance = page.locator(
        "#settings-map-style-select, #settings-map-theme-select, #settings-map-buildings3d-toggle, #settings-map-label-scale-select, #settings-map-street-names-select",
    );
    await expectControlsDisabled(modalAppearance, true);
    await expect(page.locator("#settings-map-style-unavailable")).toBeVisible();
    await expectControlsDisabled(
        page.locator("#settings-map-marker-control button, #settings-map-marker-control input"),
        false,
    );
    await page.locator("#settings-map-provider-select").selectOption("osm-vector");
    await expect(quickProvider).toHaveValue("osm-vector");
    await expectControlsDisabled(modalAppearance, false);
    await expectControlsDisabled(quickAppearance, false);
    await expect(page.locator("#settings-map-style-select")).toHaveValue("road");
    await expect(page.locator("#settings-map-theme-select")).toHaveValue("light");
    await expect(page.locator("#settings-map-style-unavailable")).toBeHidden();

    await page.locator("#settings-map-provider-select").selectOption("yandex");
    await gotoApp(page, "ru");
    await page.locator("#settings-btn").click();
    await expect(page.locator("#settings-map-provider-select")).toHaveValue("yandex");
    await expect(page.locator('#settings-map-provider-select option[value="yandex"]')).toHaveText("Яндекс Карты");
    await expect(page.locator("#settings-map-style-unavailable")).toHaveText(
        "Настройки оформления недоступны для растровых карт.",
    );
    await expectControlsDisabled(modalAppearance, true);
});

test("every mini-map is rectangular and Yandex credits stay visible on both maps", async ({ page }) => {
    const requests: URL[] = [];
    page.on("request", (request) => {
        const url = new URL(request.url());
        if (url.hostname === "tiles.api-maps.yandex.ru") requests.push(url);
    });
    await loadTrip(page);
    await pausePlayback(page);
    const mini = page.locator("#mini-map");
    for (const [provider, source] of [
        ["openfreemap", "openmaptiles"],
        ["osm-vector", "osm-shortbread"],
        ["yandex", "yandex"],
    ] as const) {
        await chooseViewerProvider(page, provider);
        await expectViewerSource(page, source);
        await expect(mini).toBeVisible();
        const shape = await mini.evaluate((map) => {
            const box = map.getBoundingClientRect();
            return {
                width: box.width,
                height: box.height,
                radius: parseFloat(getComputedStyle(map).borderTopLeftRadius),
            };
        });
        expect(shape.width, `${provider} mini-map must be wider than it is tall`).toBeGreaterThan(shape.height);
        expect(shape.radius, `${provider} mini-map must have rectangular corners`).toBeLessThan(shape.height / 4);
        await expectCreditsInside(mini);
        if (provider !== "yandex") {
            await expect(mini.getByRole("link", { name: /OpenStreetMap/ })).toBeVisible();
            await expect(mini.locator(".dc-map-logo")).toHaveCount(0);
        }
    }
    await expectYandexLogo(mini, "Open in Maps");
    await expect.poll(() => requests.length).toBeGreaterThan(0);
    for (const url of requests) {
        expect(url.searchParams.get("projection")).toBe("web_mercator");
        expect(url.searchParams.get("lang")).toBe("en_US");
        expect(Boolean(url.searchParams.get("apikey"))).toBe(true);
    }

    await mini.click({ position: { x: 30, y: 30 } });
    const main = page.locator("#map");
    await expectCreditsInside(main);
    await expectYandexLogo(main, "Open in Maps");
});

test("overlay uses its own provider while Yandex remains selected in the viewer", async ({ page }) => {
    await loadTrip(page);
    await pausePlayback(page);
    await chooseViewerProvider(page, "yandex");
    await expectViewerSource(page, "yandex");
    const requestedHosts = new Set<string>();
    page.on("request", (request) => requestedHosts.add(new URL(request.url()).hostname));

    await openExport(page);
    await page.locator("#export-panel-ov-map").check();
    const provider = page.locator("#export-map-provider-select");
    await expect(provider).toHaveValue("openfreemap");
    await expect(provider.locator('option[value="yandex"]')).toHaveText("Yandex Maps");
    await expect(provider.locator('option[value="yandex"]')).toBeDisabled();
    await expect(page.locator("#export-map-provider-description")).toBeVisible();
    await expect(provider).toHaveAccessibleDescription(
        "Yandex’s terms don’t clearly allow saving maps in videos, so Yandex Maps is unavailable here.",
    );
    await expect.poll(() => [...requestedHosts].some((host) => host.endsWith("openfreemap.org"))).toBe(true);
    await expect
        .poll(() =>
            page.locator("#player-map-overlay-canvas").evaluate((canvas) => (canvas as HTMLCanvasElement).width),
        )
        .toBeGreaterThan(300);
    await expectViewerSource(page, "yandex");

    await provider.selectOption("osm-vector");
    await expect(provider).toHaveValue("osm-vector");
    await expect.poll(() => requestedHosts.has("vector.openstreetmap.org")).toBe(true);
    await expectViewerSource(page, "yandex");
    await expect(page.locator("#settings-map-provider-select")).toHaveValue("yandex");
    await page.locator("#export-panel-close").click();
    await openExport(page);
    await expect(page.locator("#export-map-provider-select")).toHaveValue("osm-vector");
    await expectViewerSource(page, "yandex");
});

test("Yandex network failure falls back to OpenFreeMap while retaining the chosen provider", async ({ page }) => {
    await loadTrip(page);
    await pausePlayback(page);
    let yandexRequests = 0;
    let fallbackProbes = 0;
    await page.route("https://tiles.api-maps.yandex.ru/**", (route) => {
        yandexRequests++;
        return route.abort();
    });
    await page.route("https://tiles.openfreemap.org/**", (route) => {
        const url = new URL(route.request().url());
        if (url.pathname === "/planet") {
            fallbackProbes++;
            return route.fulfill({
                json: {
                    tilejson: "3.0.0",
                    tiles: ["https://tiles.openfreemap.org/yandex-fallback/{z}/{x}/{y}.pbf"],
                    minzoom: 0,
                    maxzoom: 14,
                },
                headers: { "access-control-allow-origin": "*" },
            });
        }
        return route.fulfill({ body: Buffer.alloc(0), headers: { "access-control-allow-origin": "*" } });
    });

    await chooseViewerProvider(page, "yandex");
    await expect.poll(() => yandexRequests).toBeGreaterThanOrEqual(2);
    await expect.poll(() => fallbackProbes).toBeGreaterThan(0);
    await expectViewerSource(page, "openmaptiles");
    await expect(page.locator("#settings-map-provider-select")).toHaveValue("yandex");
    await expect(page.locator("#mini-map .dc-map-logo")).toHaveCount(0);
    await expect(page.locator("#mini-map").getByRole("link", { name: /OpenStreetMap/ })).toBeVisible();
    await expect
        .poll(() => page.evaluate(() => Boolean(window.__dashcamigo.state.map?.getLayer("trip-line"))))
        .toBe(true);
    await expect(page.locator("#player")).toHaveJSProperty("paused", true);
});

for (const [locale, tooltip] of [
    ["en", "Open in Maps"],
    ["ru", "Открыть в Картах"],
    ["de", "In Maps öffnen"],
] as const) {
    test(`Yandex credits clear the mini-map marker and mobile player bar in ${locale}`, async ({ page }) => {
        await gotoApp(page, locale);
        await loadTrip(page);
        await pausePlayback(page);
        await chooseViewerProvider(page, "yandex");
        await expectViewerSource(page, "yandex");
        const mini = page.locator("#mini-map");
        const marker = mini.locator(".car-marker__canvas");
        await expect(marker).toBeVisible();
        await expectCreditsInside(mini);
        await expectYandexLogo(mini, tooltip);
        await expect
            .poll(() =>
                mini.evaluate((map) => {
                    const marker = map.querySelector(".car-marker__canvas")!.getBoundingClientRect();
                    const credits = map.querySelector(".dc-map-attrib")!.getBoundingClientRect();
                    return marker.bottom < credits.top;
                }),
            )
            .toBe(true);
        await expectCreditsClickable(mini);

        await mini.click({ position: { x: 30, y: 30 } });
        await expect(page.locator("body")).not.toHaveClass(/map-morphing/);
        await page.setViewportSize(MOBILE);
        if ((await page.locator(".sidebar").getAttribute("data-drawer-open")) === "true") {
            await page.locator("#topbar-burger").click();
        }
        await expectMainCreditsAbovePlayerBar(page, tooltip);
        await page.locator(".viewer").evaluate((viewer) => {
            viewer.scrollTop = viewer.scrollHeight;
        });
        await expectMainCreditsAbovePlayerBar(page, tooltip);
    });
}
