// Ingest: the SD-card -> sidebar -> active trip pipeline. This is the flow a
// human exercises first on every manual pass. Asserts that a real multichannel
// trip indexes, activates, and renders all panels - and that a single-channel
// camera does NOT show multichannel affordances. The tile server is aborted by
// the fixture, so these also prove the map degrades gracefully (no base layer,
// everything else works) without tripping the error sentinel.

import {
    DESKTOP,
    SAMPLE_70MAI,
    SAMPLE_GOPRO,
    expect,
    gotoApp,
    loadTrip,
    presetLocalStorage,
    shot,
    test,
} from "./_fixtures.js";

test.describe("ingest", () => {
    test.beforeEach(async ({ page }) => {
        await presetLocalStorage(page);
        await page.setViewportSize(DESKTOP);
        await gotoApp(page, "en");
    });

    test("70mai multichannel: indexes, activates, renders every panel", async ({ page }) => {
        await page.locator("#folder-input").setInputFiles(SAMPLE_70MAI);

        // Sidebar shows at least one real trip card (not the unindexed note).
        const trips = page.locator("li.trip:not(.unindexed-note)");
        await expect(trips.first()).toBeVisible({ timeout: 30_000 });
        expect(await trips.count(), "70mai sample yields at least one trip").toBeGreaterThanOrEqual(1);

        await trips.first().click();

        // Active trip: chart canvas painted with non-zero width, scrubber spans
        // a real duration (total advanced past 0:00).
        await expect(page.locator("#player-chart-canvas")).toBeVisible();
        await expect
            .poll(async () => (await page.locator("#player-total").textContent())?.trim(), {
                timeout: 15_000,
            })
            .not.toBe("0:00");

        // Multichannel grid: front + rear + interior tiles all present & visible.
        for (const ch of ["front", "rear", "interior"] as const) {
            await expect(
                page.locator(`#video-grid .video-tile[data-channel="${ch}"]`),
                `${ch} tile must render`,
            ).toBeVisible();
        }

        // Map degradation guard: the MapLibre canvas still mounts with non-zero
        // size even though every tile request was aborted by the fixture.
        const mapCanvas = page.locator(".mini-map canvas.maplibregl-canvas").first();
        await expect(mapCanvas).toBeVisible();
        const canvasBox = await mapCanvas.boundingBox();
        expect(canvasBox, "map canvas must have a size with the tile server down").not.toBeNull();
        expect(canvasBox!.width).toBeGreaterThan(0);

        await shot(page, "ingest-01-multichannel-active");
    });

    test("gopro single-channel: no multichannel UI", async ({ page }) => {
        await loadTrip(page, SAMPLE_GOPRO);

        // A single camera has no F/R/I split, so the channel switcher must stay
        // hidden and the grid must hold exactly one tile.
        await expect(page.locator("#channel-switcher")).toBeHidden();
        await expect(page.locator("#video-grid .video-tile:not([hidden])")).toHaveCount(1);

        await shot(page, "ingest-02-gopro-single");
    });
});
