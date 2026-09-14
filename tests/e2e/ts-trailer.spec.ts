import { readFileSync } from "node:fs";
import path from "node:path";
import { DESKTOP, REPO_ROOT, expect, gotoApp, pausePlayback, presetLocalStorage, test } from "./_fixtures.js";

test.describe("TS trailer recording ingest", () => {
    test.beforeEach(async ({ page }) => {
        await presetLocalStorage(page);
        await page.setViewportSize(DESKTOP);
        await gotoApp(page, "en");
    });

    for (const [dialect, stamp, suffix] of [
        ["count", "20260904_202849", ""],
        ["count", "20260904_235813", "_SOS"],
        ["empty", "20260902_174435", "_PARK"],
    ]) {
        test(`indexes and plays both channels with ${suffix || "normal"} filenames`, async ({ page }) => {
            const buffer = readFileSync(
                path.join(REPO_ROOT, `src/parsers/__fixtures__/ligogps-trailer-ts/real-anonymized-${dialect}.TS`),
            );
            await page.locator("#file-input").setInputFiles(
                ["F", "R"].map((channel) => ({
                    name: `${stamp}${channel}${suffix}.ts`,
                    mimeType: "video/mp2t",
                    buffer,
                })),
            );
            const trips = page.locator("li.trip:not(.unindexed-note)");
            await expect(trips).toHaveCount(1);
            await trips.first().click();
            for (const channel of ["front", "rear"]) {
                await expect(page.locator(`#video-grid .video-tile[data-channel="${channel}"]`)).toBeVisible();
            }
            await expect
                .poll(() =>
                    page.evaluate(() => {
                        const state = window.__dashcamigo.state;
                        return state.trips[state.active!.trip]!.records.length;
                    }),
                )
                .toBe(dialect === "empty" ? 0 : 60);
            await expect
                .poll(() =>
                    page
                        .locator("#video-grid .video-tile:not([hidden]) > video:not(.preload-slot):not(.tile-blur-bg)")
                        .evaluateAll(
                            (videos: HTMLVideoElement[]) =>
                                videos.length === 2 && videos.every((video) => video.readyState >= 2),
                        ),
                )
                .toBe(true);
            await pausePlayback(page);
            await page.locator("#player-mini-progress").focus();
            await page.keyboard.press("Home");
            await expect
                .poll(() =>
                    page
                        .locator(".video-tile.active video:not(.preload-slot):not(.tile-blur-bg)")
                        .evaluate(
                            (video: HTMLVideoElement) =>
                                !video.seeking && video.readyState >= 2 && video.currentTime < 0.1,
                        ),
                )
                .toBe(true);
            await page.locator("#player-play").click();
            await expect
                .poll(() =>
                    page
                        .locator("#video-grid .video-tile:not([hidden]) > video:not(.preload-slot):not(.tile-blur-bg)")
                        .evaluateAll(
                            (videos: HTMLVideoElement[]) =>
                                videos.length === 2 &&
                                videos.every((video) => video.readyState >= 2 && video.currentTime > 0.2),
                        ),
                )
                .toBe(true);
        });
    }
});
