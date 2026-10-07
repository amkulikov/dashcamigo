import { verifyGpxSpeed } from "./_gpx-speed.js";
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
