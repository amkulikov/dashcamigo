import { rmSync } from "node:fs";
import { ddpaiFixtureFolder } from "./_ddpai-gps.js";
import { DESKTOP, expect, gotoApp, loadTrip, presetLocalStorage, shot, test } from "./_fixtures.js";

const directories: string[] = [];
function folder(withGps: boolean, hasLayout = true): string {
    const root = ddpaiFixtureFolder(withGps, hasLayout);
    directories.push(root);
    return root;
}

test.use({ viewport: DESKTOP });
test.beforeEach(async ({ page }) => {
    await presetLocalStorage(page);
});
test.afterEach(() => {
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

for (const locale of ["en", "ru"] as const) {
    test(`DDPAI without GPS offers conditional USB and folder instructions (${locale})`, async ({ page }) => {
        await gotoApp(page, locale);
        await loadTrip(page, folder(false));
        const notice = page.locator(".dc-toast").filter({ hasText: "203gps" });
        await expect(notice).toBeVisible({ timeout: 30_000 });
        await expect(notice).toContainText(
            locale === "en" ? "If you have a DDPAI Z60 Pro" : "Если у тебя DDPAI Z60 Pro",
        );
        await expect(notice).toContainText("200video");
        await expect(notice).toContainText("USB");
        await expect(notice).toHaveCSS("opacity", "1");
        await shot(page, `ddpai-gps-folder-${locale}`);
        await page.locator("#trip-sort-dir").click();
        await expect(notice).toHaveCount(1);
    });
}

test("a DDPAI archive supplies GPS through the worker without a folder reminder", async ({ page }) => {
    await gotoApp(page, "en");
    await loadTrip(page, folder(true));
    await expect(page.locator("#trip-analysis-status")).toBeHidden({ timeout: 30_000 });
    await expect(page.locator(".player-no-gps")).toBeHidden();
    await expect(page.locator(".dc-toast").filter({ hasText: "203gps" })).toHaveCount(0);
    await expect(page.locator("#player-chart-canvas")).toBeVisible();
});

test("a matching filename without a DDPAI directory stays silent", async ({ page }) => {
    await gotoApp(page, "en");
    await loadTrip(page, folder(false, false));
    await expect(page.locator("#trip-analysis-status")).toBeHidden({ timeout: 30_000 });
    await expect(page.locator(".dc-toast").filter({ hasText: "203gps" })).toHaveCount(0);
});
