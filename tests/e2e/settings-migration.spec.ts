import type { Page } from "@playwright/test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { expect, gotoApp, presetLocalStorage, test } from "./_fixtures.js";

async function serveLocalBuildAt(page: Page, origin: string): Promise<void> {
    await page.route(`${origin}/**`, async (route) => {
        const url = new URL(route.request().url());
        const path = resolve("dist", `.${url.pathname}${url.pathname.endsWith("/") ? "index.html" : ""}`);
        if (!existsSync(path)) throw new Error(`missing local fixture: ${url.pathname}`);
        await route.fulfill({ path });
    });
    await presetLocalStorage(page);
}

test.describe("migration from the old address", () => {
    test.use({ baseURL: "https://dashcamigo.app" });

    for (const locale of ["en", "ru"]) {
        test(`keeps ${locale} notes recovery in the current app`, async ({ page }) => {
            await serveLocalBuildAt(page, "https://dashcamigo.app");
            await gotoApp(page, locale);
            await page.locator("#settings-btn").click();
            const section = page.locator("#settings-migration-section");
            await expect(section).toBeVisible();
            await expect(page.locator("#settings-migration-new")).toBeHidden();
            await expect(section).toContainText("everydashcam.app");
            const recovery = page.locator("#settings-migration-old a");
            await expect(recovery).toHaveAttribute("href", "/migrate/");
            expect(await recovery.getAttribute("target")).toBeNull();
            await expect(section.locator('a[href*="everydashcam.app"]')).toHaveCount(0);
            await expect(section.locator('[data-i18n="settings.migration.installed"]')).toContainText(
                locale === "en" ? "before removing it" : "перед удалением",
            );
            await expect(page.locator("#settings-crash-description")).toHaveAttribute(
                "data-i18n",
                "settings.privacy.crash.description",
            );
        });
    }
});

test.describe("migration at the new address", () => {
    test.use({ baseURL: "https://everydashcam.app" });

    test("offers only the matching old site before the existing import control", async ({ page }) => {
        await serveLocalBuildAt(page, "https://everydashcam.app");
        await gotoApp(page);
        await page.locator("#settings-btn").click();
        await expect(page.locator("#settings-migration-section")).toBeVisible();
        await expect(page.locator("#settings-migration-old")).toBeHidden();
        const sources = page.locator("#settings-migration-new");
        await expect(sources).toContainText("same browser and profile");
        expect(
            await sources.locator("a").evaluateAll((links) => links.map((link) => link.getAttribute("href"))),
        ).toEqual(["https://dashcamigo.app/migrate/"]);
        await expect(sources).not.toContainText("ru.dashcamigo.app");
        await expect(sources).not.toContainText("beta");
        await expect(page.locator("#settings-notes-import-btn")).toBeVisible();
        expect(
            await sources.evaluate((element) => {
                const importer = document.getElementById("settings-notes-import-btn");
                return !!importer && !!(element.compareDocumentPosition(importer) & Node.DOCUMENT_POSITION_FOLLOWING);
            }),
        ).toBe(true);
        await expect(page.locator("#settings-crash-description")).toHaveAttribute(
            "data-i18n",
            "settings.privacy.crash.description",
        );
        await expect(page.locator("#settings-crash-description")).toContainText("On by default; switch it off here");
    });
});

for (const host of ["everydashcam.app", "ru.everydashcam.app"]) {
    test.describe(`migration recovery on ${host}`, () => {
        test.use({ baseURL: `https://${host}` });
        for (const source of [null, "apex", "ru"] as const) {
            test(`chooses one recovery link for ${source ?? "a direct visit"}`, async ({ page }) => {
                await serveLocalBuildAt(page, `https://${host}`);
                await page.goto(`/en/${source ? `?dc_from=${source}` : ""}`);
                if (source) await page.locator("#migration-banner-transfer").click();
                else await page.locator("#settings-btn").click();
                const section = page.locator("#settings-migration-new");
                const isRu = source === "ru" || (source === null && host === "ru.everydashcam.app");
                await expect(section.locator("a")).toHaveCount(1);
                await expect(section.locator("a")).toHaveAttribute(
                    "href",
                    `https://${isRu ? "ru." : ""}dashcamigo.app/migrate/`,
                );
                await expect(section).not.toContainText("ru.dashcamigo.app");
                await expect(section).not.toContainText("beta");
                await page.unrouteAll({ behavior: "wait" });
            });
        }
    });
}

test("keeps migration guidance hidden on a self-hosted site", async ({ page }) => {
    await presetLocalStorage(page);
    await gotoApp(page);
    await page.locator("#settings-btn").click();
    await expect(page.locator("#settings-migration-section")).toBeHidden();
    await expect(page.locator("#settings-notes-import-btn")).toBeVisible();
});

test.describe("migration arrival notice", () => {
    test.use({ baseURL: "https://everydashcam.app" });

    test.beforeEach(async ({ page }) => {
        await serveLocalBuildAt(page, "https://everydashcam.app");
    });

    test.afterEach(async ({ page }) => {
        await page.unrouteAll({ behavior: "wait" });
    });

    for (const locale of ["en", "ru"]) {
        test(`explains a marked arrival and opens the ${locale} recovery instructions`, async ({ page }, info) => {
            await page.goto(`/${locale}/?keep=a%20b&keep=2&dc_from=apex#test-anchor`);
            const banner = page.locator("#migration-banner");
            await expect(banner).toBeVisible();
            await expect(page).toHaveURL(`https://everydashcam.app/${locale}/?keep=a%20b&keep=2#test-anchor`);
            await expect(page.locator("#settings-modal")).toBeHidden();
            await expect(banner).toContainText(locale === "ru" ? "Ты на новом адресе" : "You're at our new address");
            await page.setViewportSize({ width: 390, height: 844 });
            await expect(page.locator("#migration-banner-transfer")).toBeInViewport();
            await expect(page.locator("#migration-banner-dismiss")).toBeInViewport();
            await page.screenshot({ path: info.outputPath(`migration-${locale}-mobile.png`) });
            await page.locator("#migration-banner-transfer").click();
            await expect(banner).toBeHidden();
            await expect(page.locator("#settings-migration-heading")).toBeFocused();
            await expect(page.locator("#settings-migration-heading")).toBeInViewport();
            await expect(page.locator("#settings-migration-new")).toBeVisible();
        });
    }

    test("carries the marker through the root locale redirect and remembers each source separately", async ({
        page,
    }) => {
        await page.goto("/?dc_from=apex&keep=1#test-anchor");
        const banner = page.locator("#migration-banner");
        await expect(banner).toBeVisible();
        await expect(page).toHaveURL("https://everydashcam.app/en/?keep=1#test-anchor");
        await page.reload();
        await expect(banner).toBeVisible();
        await page.locator("#migration-banner-dismiss").click();
        await page.goto("/en/?dc_from=apex");
        await expect(page.locator("#settings-btn")).toBeVisible();
        await expect(banner).toBeHidden();
        await page.goto("/en/?dc_from=ru");
        await expect(banner).toBeVisible();
    });

    for (const query of ["", "?dc_from=beta", "?dc_from=unknown", "?dc_from=https%3A%2F%2Fevil.example"]) {
        test(`keeps a fresh visit quiet for ${query || "no marker"}`, async ({ page }) => {
            await page.goto(`/en/${query}`, { referer: "https://dashcamigo.app/" });
            await expect(page.locator("#settings-btn")).toBeVisible();
            await expect(page.locator("#migration-banner")).toBeHidden();
        });
    }

    test("remembers dismissal for the session when persistent storage is unavailable", async ({ page }) => {
        await page.addInitScript(() => {
            for (const method of ["getItem", "setItem"] as const) {
                const original = Storage.prototype[method];
                Object.defineProperty(Storage.prototype, method, {
                    value: function (key: string, value: string) {
                        if (this === localStorage && key.startsWith("everydashcam:migration:"))
                            throw new DOMException("blocked", "SecurityError");
                        return Reflect.apply(original, this, [key, value]);
                    },
                });
            }
        });
        await page.goto("/en/?dc_from=apex");
        await expect(page.locator("#migration-banner")).toBeVisible();
        await page.locator("#migration-banner-dismiss").click();
        await page.goto("/en/?dc_from=apex");
        await expect(page.locator("#settings-btn")).toBeVisible();
        await expect(page.locator("#migration-banner")).toBeHidden();
    });
});
