// HEVC (hev1) playback through the MSE remux backend. A hev1-tagged file renders
// black on native <video>.src, so the viewer remuxes it per-file via mediabunny
// and feeds a MediaSource (PerFileMseBackend) - the BlackVue ELITE / Vantrue
// decode path.
//
// HEVC decode is not available on every platform (notably many Linux CI
// runners), so the test skips itself when the browser can't decode HEVC rather
// than failing red. Where it runs, it asserts the full remux+MSE+decode chain by
// requiring playback to actually advance.

import { SAMPLE_HEVC, expect, gotoApp, loadTrip, presetLocalStorage, shot, test } from "./_fixtures.js";
import { DESKTOP } from "./_fixtures.js";

test.describe("hevc playback", () => {
    test.beforeEach(async ({ page }) => {
        await presetLocalStorage(page);
        await page.setViewportSize(DESKTOP);
        await gotoApp(page, "en");
    });

    test("hev1 file remuxes through MSE and plays", async ({ page }) => {
        const hevcSupported = await page.evaluate(async () => {
            const codec = "hev1.1.6.L93.B0";
            try {
                // WebCodecs is what the remux backend ultimately decodes through.
                const vd = (
                    globalThis as unknown as {
                        VideoDecoder?: { isConfigSupported(c: { codec: string }): Promise<{ supported?: boolean }> };
                    }
                ).VideoDecoder;
                if (vd) {
                    const s = await vd.isConfigSupported({ codec });
                    if (s?.supported) return true;
                }
            } catch {
                /* fall through to MSE probe */
            }
            return typeof MediaSource !== "undefined" && MediaSource.isTypeSupported(`video/mp4; codecs="${codec}"`);
        });
        test.skip(!hevcSupported, "HEVC decode not supported on this platform");

        await loadTrip(page, SAMPLE_HEVC);
        // No GPS in this sample, so loadTrip resolved on the mvhd duration. Now
        // require real playback: currentTime must advance, which only happens if
        // the remuxed segments fed to MediaSource actually decode.
        await page.locator("#player-play").click();
        await expect
            .poll(() => page.evaluate(() => (document.getElementById("player") as HTMLVideoElement).currentTime), {
                timeout: 8000,
            })
            .toBeGreaterThan(0);
        await shot(page, "hevc-01-playing");
    });
});
