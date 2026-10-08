import { expect } from "@playwright/test";
import { loadTrip, openExport, presetLocalStorage } from "../e2e/_fixtures.js";
import { openPortable, test } from "./_fixtures.js";

test("embeds the brand font and watermark icon in the moved offline file", async ({ page }, info) => {
    await presetLocalStorage(page);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openPortable(page, info.outputPath("brand"));
    await expect(page.locator(".topbar .edc-mark")).toHaveAccessibleName("everydashcam");
    expect(
        await page.evaluate(async () => {
            const fonts = await document.fonts.load('700 22px "Chakra Petch"');
            return fonts.some((font) => font.family.includes("Chakra Petch") && font.status === "loaded");
        }),
    ).toBe(true);
    await loadTrip(page);
    await openExport(page);
    const watermark = page.locator("#player-watermark");
    await expect(watermark).toBeVisible();
    await expect(watermark).toHaveText("everydashcam.app");
    await expect(watermark).toHaveCSS("font-family", /Chakra Petch/);
    const icon = watermark.locator(".player-watermark__icon");
    await expect(icon).toHaveAttribute("src", /^data:image\/svg\+xml;base64,/);
    await expect(icon).toBeVisible();
    expect(await icon.evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    await page.screenshot({ path: info.outputPath("watermark.png") });
});
