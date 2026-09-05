import type { Page } from "@playwright/test";
import { expect, gotoApp, loadTrip, presetLocalStorage, test } from "./_fixtures.js";

test.use({ hasTouch: true, isMobile: true, locale: "ru-RU" });

async function expectPhoneWidth(page: Page, width: number): Promise<void> {
    await expect
        .poll(() =>
            page.evaluate(() => ({
                layout: window.innerWidth,
                content: document.documentElement.scrollWidth,
                scale: window.visualViewport?.scale,
            })),
        )
        .toEqual({ layout: width, content: width, scale: 1 });
    for (const selector of ["#offline-banner-info", "#lang-toggle", "#topbar-overflow"]) {
        const control = page.locator(selector);
        await expect(control).toBeVisible();
        const bounds = await control.boundingBox();
        expect(bounds, `${selector} has a touch target`).not.toBeNull();
        expect(bounds!.x, `${selector} stays inside the left edge`).toBeGreaterThanOrEqual(0);
        expect(bounds!.x + bounds!.width, `${selector} stays inside the right edge`).toBeLessThanOrEqual(width);
        expect(bounds!.width, `${selector} preserves touch size`).toBeGreaterThanOrEqual(40);
        expect(bounds!.height, `${selector} preserves touch height`).toBeGreaterThanOrEqual(40);
    }
}

test("offline status keeps a narrow phone within its viewport and preserves primary controls", async ({ page }) => {
    await presetLocalStorage(page);
    await page.setViewportSize({ width: 320, height: 568 });
    await gotoApp(page, "ru");
    await expect(page.locator("#landing-cta")).toBeEnabled();
    await page.evaluate(() => window.dispatchEvent(new Event("offline")));
    await expect(page.locator("body")).toHaveClass(/has-offline-banner/);
    await expectPhoneWidth(page, 320);
    await expect(page.locator(".topbar .dc-mark")).toHaveAttribute("aria-label", "dashcamigo");
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect(page.locator("#offline-banner")).toBeHidden();
    await loadTrip(page);
    await expect(page.locator("body")).toHaveClass(/has-offline-banner/);
    await expectPhoneWidth(page, 320);
    await expect(page.locator("#topbar-burger")).toBeVisible();
    await page.locator("#offline-banner-info").tap();
    await expect(page.locator("#offline-banner-popover")).toBeVisible();
    await page.locator("#offline-banner-info").tap();
    for (const width of [375, 390]) {
        await page.setViewportSize({ width, height: 844 });
        await expectPhoneWidth(page, width);
        expect(
            await page
                .locator(".topbar .dc-mark")
                .evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize)),
            "wider phones keep the full wordmark",
        ).toBeGreaterThan(0);
    }
});
