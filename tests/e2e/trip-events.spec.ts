import { DESKTOP, SAMPLE_70MAI, expect, gotoApp, loadTrip, presetLocalStorage, test } from "./_fixtures.js";

for (const locale of ["en", "ru"]) {
    test(`trip events keep their jump and save actions on one row in ${locale}`, async ({ page }) => {
        await presetLocalStorage(page, { theme: "light" });
        await page.setViewportSize(DESKTOP);
        await gotoApp(page, locale);
        if (locale === "ru") await page.locator(".lang-banner-dismiss").click();
        await loadTrip(page, SAMPLE_70MAI);
        // Public samples have no detected impacts; use the event seam shared
        // with the timeline popup and mobile event-list tests.
        await page.evaluate(() => {
            const state = window.__dashcamigo.state;
            const trip = state.trips[state.active!.trip]!;
            trip.events = [1, 2, 3].map((relSec) => ({
                kind: "brake",
                unixSeconds: trip.startUtc + relSec,
                relSec,
                severity: 0.42,
                recordIndex: 0,
            }));
        });
        await page.locator("#trip-sort-key").selectOption("duration");
        const events = page.locator(".trip-events-list");
        await events.locator("summary").click();
        await expect(events.locator(".trip-event-row")).toHaveCount(3);
        const save = events.locator(".trip-event-save").first();
        await expect(save).toHaveAccessibleName(locale === "en" ? "Save clip ±10s" : "Сохранить фрагмент ±10 с");
        for (const row of await events.locator(".trip-event-row").all()) {
            const layout = await row.evaluate((element) => {
                const [jump, save] = Array.from(element.querySelectorAll("button"), (button) =>
                    button.getBoundingClientRect(),
                );
                return { height: element.getBoundingClientRect().height, jumpY: jump!.y, saveY: save!.y };
            });
            expect(layout.jumpY).toBe(layout.saveY);
            expect(layout.height).toBeLessThanOrEqual(33);
        }
        await events.screenshot({ path: `tests/e2e/screenshots/trip-events-${locale}.png` });
        await page.locator("#sidebar-resize").focus();
        await page.keyboard.press("Home");
        await expect(save.locator(".trip-event-save__label")).toBeHidden();
        expect(await events.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
        await save.click();
        await expect(page.locator("body")).toHaveClass(/export-mode/);
        await expect(page.locator('.export-trim-bar__input[data-range-edge="start"]')).toHaveValue("0:00");
    });
}
