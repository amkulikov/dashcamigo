import { expect, gotoApp, presetLocalStorage, shot, test } from "./_fixtures.js";

test.describe("landing layout", () => {
    test.beforeEach(async ({ page }) => {
        await presetLocalStorage(page, { theme: "light" });
    });

    for (const locale of ["en", "ru", "de"]) {
        test(`folder dock keeps its action inside the panel in ${locale}`, async ({ page }) => {
            await page.setViewportSize({ width: 320, height: 568 });
            await gotoApp(page, locale);
            const landing = page.locator("#landing");
            await expect(landing).toBeVisible();
            await page.evaluate(() => document.fonts.ready);
            await landing.evaluate((element) => {
                element.scrollTop = element.scrollHeight;
            });
            const dock = page.locator("#landing-dock");
            await expect(dock).toBeVisible();
            for (const width of [320, 390, 768, 1024]) {
                await page.setViewportSize({ width, height: 568 });
                await expect
                    .poll(() =>
                        dock.evaluate((element) => {
                            const action = element.querySelector("button");
                            if (!action) return false;
                            const panel = element.getBoundingClientRect();
                            const button = action.getBoundingClientRect();
                            return (
                                panel.left >= 0 &&
                                panel.right <= innerWidth &&
                                button.left >= panel.left &&
                                button.right <= panel.right &&
                                element.scrollWidth <= element.clientWidth + 1
                            );
                        }),
                    )
                    .toBe(true);
            }
            await page.setViewportSize({ width: 390, height: 844 });
            await shot(page, `landing-footer-${locale}`);
        });
    }

    test("language choices support keyboard selection and focus return", async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await gotoApp(page, "en");
        const toggle = page.locator("#lang-toggle");
        const menu = page.locator("#lang-menu");
        await toggle.focus();
        await page.keyboard.press("Enter");
        await expect(menu.getByRole("menuitemradio", { name: "English", exact: true })).toBeFocused();
        await expect(menu.getByRole("menuitemradio", { name: "English", exact: true })).toHaveAttribute(
            "aria-checked",
            "true",
        );
        await page.keyboard.press("End");
        await expect(menu.getByRole("menuitemradio").last()).toBeFocused();
        await page.keyboard.press("Escape");
        await expect(menu).toBeHidden();
        await expect(toggle).toBeFocused();
        await page.keyboard.press("ArrowDown");
        await expect(menu.getByRole("menuitemradio").first()).toBeFocused();
        await page.keyboard.press("ArrowDown");
        await page.keyboard.press("Space");
        await expect(menu).toBeHidden();
        await expect(toggle).toBeFocused();
        await toggle.click();
        await menu.getByRole("menuitemradio", { name: "Русский", exact: true }).focus();
        await page.keyboard.press("Enter");
        await expect(page).toHaveURL(/\/ru\/$/);
        await expect(page.locator("#landing h1")).toContainText(/[а-яё]/i);
    });
});

test.describe("language menu on touch screens", () => {
    test.use({ hasTouch: true, viewport: { width: 844, height: 390 } });

    test("all languages remain reachable in a short landscape window", async ({ page }) => {
        await presetLocalStorage(page);
        await gotoApp(page, "en");
        await page.locator("#lang-toggle").click();
        const menu = page.locator("#lang-menu");
        await expect(menu).toBeVisible();
        const bounds = await menu.boundingBox();
        expect(bounds).not.toBeNull();
        expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(390);
        const last = menu.getByRole("menuitemradio").last();
        await last.scrollIntoViewIfNeeded();
        await expect(last).toBeInViewport();
        expect((await last.boundingBox())!.height).toBeGreaterThanOrEqual(40);
        await last.click();
        await expect(page).toHaveURL(/\/ko\/$/);
    });
});
