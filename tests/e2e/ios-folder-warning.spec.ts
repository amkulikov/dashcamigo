// iOS folder-picker warning. On iOS 18.4+ <input webkitdirectory> copies the
// whole chosen folder into the browser's temporary storage before the page
// sees anything (see src/ui/ios-folder-warning-modal.ts) - so on iOS the CTA
// must route through a warning that shows EVERY time and offers picking
// individual files instead. OS detection is UA-based (identifyBrowser), so an
// iPhone UA on Chromium exercises the real gating code path.

import path from "node:path";

import { MOBILE, SAMPLE_GOPRO, expect, gotoApp, presetLocalStorage, test } from "./_fixtures.js";

const IPHONE_UA =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1";

test.use({ userAgent: IPHONE_UA });

test.describe("iOS folder warning", () => {
    test.beforeEach(async ({ page }) => {
        // presetLocalStorage marks the 30-day upload warning as seen - the iOS
        // warning must show regardless, proving it is not TTL-gated.
        await presetLocalStorage(page);
        await page.setViewportSize(MOBILE);
        await gotoApp(page, "en");
    });

    test("shows before every folder pick, and cancel opens nothing", async ({ page }) => {
        const modal = page.locator("#ios-folder-warning-modal");

        await page.locator("#landing-cta").click();
        await expect(modal).toBeVisible();
        await expect(modal).toContainText("iPhone and iPad");

        await page.locator("#ios-folder-warning-modal-cancel").click();
        await expect(modal).toBeHidden();
        // Cancel must not raise the pre-ingest overlay (no picker was opened).
        await expect(page.locator("#ingest-overlay")).toBeHidden();

        // A second click shows it again - the warning has no once-per-TTL gate.
        await page.locator("#landing-cta").click();
        await expect(modal).toBeVisible();
        await page.locator("#ios-folder-warning-modal-cancel").click();
    });

    test("choose-files opens a multi-file picker and the flat selection ingests", async ({ page }) => {
        await page.locator("#landing-cta").click();
        await expect(page.locator("#ios-folder-warning-modal")).toBeVisible();

        // "Choose files" must open the plain file chooser (not the folder one)
        // with multi-select on.
        const chooserPromise = page.waitForEvent("filechooser");
        await page.locator("#ios-folder-warning-modal-files").click();
        const chooser = await chooserPromise;
        expect(chooser.isMultiple(), "file chooser allows multiple files").toBe(true);
        await expect(page.locator("#ios-folder-warning-modal")).toBeHidden();

        // A flat selection (bare filenames, no folder structure) must ingest:
        // GoPro clips carry GPS in the video itself, no sidecar needed.
        await chooser.setFiles([
            path.join(SAMPLE_GOPRO, "hero5-trimmed.mp4"),
            path.join(SAMPLE_GOPRO, "hero6-trimmed.mp4"),
        ]);
        await expect(page.locator("li.trip:not(.unindexed-note)").first()).toBeVisible({ timeout: 30_000 });
    });
});
