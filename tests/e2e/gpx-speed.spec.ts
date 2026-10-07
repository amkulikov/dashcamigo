import { verifyGpxSpeed, verifyRobustGpxSpeed } from "./_gpx-speed.js";
import { DESKTOP, gotoApp, presetLocalStorage, test } from "./_fixtures.js";

test.use({ locale: "de-DE" });

for (const locale of ["en", "ru"]) {
    for (const mode of ["sidecar", "manual"] as const) {
        test(`GPX ${mode} import distinguishes measured, estimated and missing speed in ${locale}`, async ({
            page,
        }) => {
            await presetLocalStorage(page, { lang: locale });
            await page.setViewportSize(DESKTOP);
            await gotoApp(page, locale);
            await verifyGpxSpeed(page, mode, locale === "en" ? "Estimated speed" : "Расчётная скорость");
        });
    }
}

test("GPS acquisition-time errors do not create speed spikes in the viewer or GPX export", async ({ page }) => {
    await presetLocalStorage(page, { lang: "en" });
    await page.setViewportSize(DESKTOP);
    await gotoApp(page, "en");
    await verifyRobustGpxSpeed(page);
});
