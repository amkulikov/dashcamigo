import type { GeoJSONSource } from "maplibre-gl";
import { DESKTOP, expect, gotoApp, loadTrip, presetLocalStorage, test } from "./_fixtures.js";

test.use({ serviceWorkers: "block" });

test("completes the saved chase tilt when the basemap interrupts initial entry", async ({ page }) => {
    await presetLocalStorage(page);
    await page.addInitScript(() =>
        localStorage.setItem("dc.viewer.panels", JSON.stringify({ map: true, mapMode: "large" })),
    );
    await page.route("**/styles/dark.json", async (route) => {
        await page.waitForFunction(() => (window.__dashcamigo.state.map?.getPitch() ?? 0) > 5);
        await route.fallback();
    });
    await gotoApp(page);
    await loadTrip(page);
    await expect.poll(() => page.evaluate(() => window.__dashcamigo.state.map?.getPitch() ?? 0)).toBeCloseTo(58, 1);
});

test("starts and responds to theme controls when storage access is denied", async ({ page }) => {
    await presetLocalStorage(page);
    await page.addInitScript(() => {
        Object.defineProperty(window, "localStorage", {
            get() {
                throw new DOMException("storage denied", "SecurityError");
            },
        });
    });
    await gotoApp(page);
    await expect.poll(() => page.evaluate(() => Boolean(window.__dashcamigo))).toBe(true);
    await page.locator('.theme-toggle-btn[data-theme="light"]').click();
    await expect(page.locator("html")).toHaveClass(/dc-light/);
});

test("keeps a crossing route and follow camera near the antimeridian", async ({ page }) => {
    await presetLocalStorage(page);
    await page.setViewportSize(DESKTOP);
    await gotoApp(page);
    await loadTrip(page);
    await page.locator("#mini-map").click();
    await expect(page.locator("body")).not.toHaveClass(/map-morphing/);
    await page.locator('.map-follow-seg[data-follow-mode="off"]').click();
    await page.evaluate(() => {
        const { state, dom, setMapProvider } = window.__dashcamigo;
        dom.player.pause();
        const trip = state.trips[state.active!.trip]!;
        const startUtc = trip.frames[state.active!.frame]!.startUtc;
        const record = trip.records.find((r) => r.active)!;
        trip.records = [179.99, -179.99, -179.98].map((lon, i) => ({
            ...record,
            unixSeconds: startUtc + i,
            lat: 50,
            lon,
        }));
        setMapProvider("osm-raster");
    });
    await expect
        .poll(async () =>
            page.evaluate(async () => {
                const source = window.__dashcamigo.state.map?.getSource("trip-line") as GeoJSONSource | undefined;
                if (!source) return false;
                const data = await source.getData();
                return (
                    data.type === "Feature" &&
                    data.geometry.type === "LineString" &&
                    data.geometry.coordinates[1]![0]! > 180
                );
            }),
        )
        .toBe(true);
    expect(Math.abs(await page.evaluate(() => window.__dashcamigo.state.map!.getCenter().lng))).toBeGreaterThan(179);
    await page.locator('.map-follow-seg[data-follow-mode="follow"]').click();
    for (const [time, expectedLon] of [
        [0.5, 180],
        [1.5, 180.015],
    ] as const) {
        await page.evaluate((time) => {
            window.__dashcamigo.dom.player.currentTime = time;
        }, time);
        await expect
            .poll(() =>
                page.evaluate((lon) => {
                    const actual = window.__dashcamigo.state.marker!.getLngLat().lng;
                    return ((actual - lon + 540) % 360) - 180;
                }, expectedLon),
            )
            .toBeCloseTo(0, 4);
        await expect
            .poll(() =>
                page.evaluate((lon) => {
                    const actual = window.__dashcamigo.state.map!.getCenter().lng;
                    return ((actual - lon + 540) % 360) - 180;
                }, expectedLon),
            )
            .toBeCloseTo(0, 3);
    }
});
