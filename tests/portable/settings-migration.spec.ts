import { expect } from "@playwright/test";
import { presetLocalStorage } from "../e2e/_fixtures.js";
import { openPortable, test } from "./_fixtures.js";

test("omits the hosted migration section while keeping notes import", async ({ page }, info) => {
    await presetLocalStorage(page);
    await openPortable(page, info.outputPath("portable-settings"));
    await page.locator("#settings-btn").click();
    await expect(page.locator("#settings-migration-section")).toHaveCount(0);
    await expect(page.locator("#migration-banner")).toHaveCount(0);
    await expect(page.locator("#migration-restore-modal")).toHaveCount(0);
    await expect(page.locator("#settings-notes-import-btn")).toBeVisible();
});
