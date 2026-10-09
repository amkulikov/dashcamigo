import type { Page } from "@playwright/test";
import { expect, gotoApp, presetLocalStorage, test } from "./_fixtures.js";

async function serveLocalBuildAt(page: Page, origin: string): Promise<void> {
    await page.route(`${origin}/**`, async (route) => {
        const url = new URL(route.request().url());
        const response = await route.fetch({ url: `http://localhost:4173${url.pathname}${url.search}` });
        await route.fulfill({ response });
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
                "settings.privacy.crash.optInDescription",
            );
        });
    }
});

test.describe("migration at the new address", () => {
    test.use({ baseURL: "https://everydashcam.app" });

    test("offers each old address before the existing import control", async ({ page }) => {
        await serveLocalBuildAt(page, "https://everydashcam.app");
        await gotoApp(page);
        await page.locator("#settings-btn").click();
        await expect(page.locator("#settings-migration-section")).toBeVisible();
        await expect(page.locator("#settings-migration-old")).toBeHidden();
        const sources = page.locator("#settings-migration-new");
        await expect(sources).toContainText("same browser and profile");
        expect(
            await sources.locator("a").evaluateAll((links) => links.map((link) => link.getAttribute("href"))),
        ).toEqual([
            "https://dashcamigo.app/migrate/",
            "https://ru.dashcamigo.app/migrate/",
            "https://beta.dashcamigo.app/migrate/",
        ]);
        await expect(page.locator("#settings-notes-import-btn")).toBeVisible();
        expect(
            await sources.evaluate((element) => {
                const importer = document.getElementById("settings-notes-import-btn");
                return !!importer && !!(element.compareDocumentPosition(importer) & Node.DOCUMENT_POSITION_FOLLOWING);
            }),
        ).toBe(true);
        await expect(page.locator("#settings-crash-description")).toHaveAttribute(
            "data-i18n",
            "settings.privacy.crash.optInDescription",
        );
        await expect(page.locator("#settings-crash-description")).toContainText("Off until you turn it on here");
    });
});

test("keeps migration guidance hidden on a self-hosted site", async ({ page }) => {
    await presetLocalStorage(page);
    await gotoApp(page);
    await page.locator("#settings-btn").click();
    await expect(page.locator("#settings-migration-section")).toBeHidden();
    await expect(page.locator("#settings-notes-import-btn")).toBeVisible();
});
