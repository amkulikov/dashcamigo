// Pixel-diff visual regression (run via playwright.vrt.config.ts, NOT the e2e
// gate). Snapshots only DETERMINISTIC surfaces; the nondeterministic map canvas
// and video frames are masked. Catches CSS/layout regressions that the
// behavior-asserting e2e suite and the eyeball screenshots both miss.
//
// Baselines are platform-specific - see the header in playwright.vrt.config.ts
// for the Docker command to regenerate Linux baselines for CI.

import { DESKTOP, MOBILE, expect, gotoApp, loadTrip, openExport, presetLocalStorage, test } from "./_fixtures.js";

// Fonts are self-hosted; wait for them so text metrics are stable before a shot.
async function settle(page: import("@playwright/test").Page): Promise<void> {
    await page.evaluate(() => document.fonts.ready);
}

test.describe("visual regression", () => {
    test.beforeEach(async ({ page }) => {
        await presetLocalStorage(page);
    });

    test("landing - desktop", async ({ page }) => {
        await page.setViewportSize(DESKTOP);
        await gotoApp(page, "en");
        await expect(page.locator("#landing")).toBeVisible();
        await settle(page);
        await expect(page).toHaveScreenshot("landing-desktop.png", { fullPage: true });
    });

    test("landing - mobile", async ({ page }) => {
        await page.setViewportSize(MOBILE);
        await gotoApp(page, "en");
        await expect(page.locator("#landing")).toBeVisible();
        await settle(page);
        await expect(page).toHaveScreenshot("landing-mobile.png", { fullPage: true });
    });

    test("settings modal", async ({ page }) => {
        await page.setViewportSize(DESKTOP);
        await gotoApp(page, "en");
        await page.locator("#settings-btn").click();
        const modal = page.locator("#settings-modal");
        await expect(modal).toBeVisible();
        await settle(page);
        await expect(modal).toHaveScreenshot("settings-modal.png");
    });

    test("hotkeys modal", async ({ page }) => {
        await page.setViewportSize(DESKTOP);
        await gotoApp(page, "en");
        await loadTrip(page);
        await page.keyboard.press("?");
        const modal = page.locator("#hotkeys-modal");
        await expect(modal).toBeVisible();
        await settle(page);
        await expect(modal).toHaveScreenshot("hotkeys-modal.png");
    });

    test("export panel options (video grid masked)", async ({ page }) => {
        await page.setViewportSize(DESKTOP);
        await gotoApp(page, "en");
        await loadTrip(page);
        await openExport(page);
        const panel = page.locator("#export-panel");
        await expect(panel).toBeVisible();
        await settle(page);
        // The panel embeds the live multichannel preview (nondeterministic video
        // frames) - mask it so only the controls/layout are compared.
        await expect(panel).toHaveScreenshot("export-panel.png", {
            mask: [page.locator("#video-grid")],
        });
    });
});
