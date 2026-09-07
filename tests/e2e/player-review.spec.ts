import {
    DESKTOP,
    MOBILE,
    SAMPLE_70MAI,
    boxOf,
    expect,
    gotoApp,
    loadTrip,
    masterVideoTime,
    openExport,
    pausePlayback,
    presetLocalStorage,
    test,
} from "./_fixtures.js";

test.beforeEach(async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await presetLocalStorage(page);
});

test("playback speed supports keyboard selection and returns focus", async ({ page }) => {
    await gotoApp(page);
    await loadTrip(page, SAMPLE_70MAI);
    const speed = page.locator("#player-speed");
    await speed.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator('#player-speed-menu [data-rate="1"]')).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(page.locator('#player-speed-menu [data-rate="1.25"]')).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(speed).toHaveText("1.25x");
    await expect(speed).toBeFocused();
    await expect(page.locator('#player-speed-menu [data-rate="1.25"]')).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("ArrowUp");
    await expect(page.locator('#player-speed-menu [data-rate="8"]')).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.locator("#player-speed-menu")).toBeHidden();
    await expect(speed).toBeFocused();
});

test("map menu arrow navigation leaves playback position unchanged", async ({ page }) => {
    await gotoApp(page);
    await loadTrip(page, SAMPLE_70MAI);
    await pausePlayback(page);
    await page.locator("#player-view-menu").click();
    await page.locator('[data-map-mode="mini"]').focus();
    const before = await masterVideoTime(page);
    await page.keyboard.press("ArrowLeft");
    await expect(page.locator('[data-map-mode="off"]')).toBeFocused();
    expect(await masterVideoTime(page)).toBeCloseTo(before, 2);
    await page.keyboard.press("Escape");
    await expect(page.locator("#player-view-menu")).toBeFocused();
});

test("portrait view menu stays inside the viewer at narrow phone widths", async ({ page }) => {
    await page.setViewportSize({ ...MOBILE, width: 320 });
    await gotoApp(page);
    await loadTrip(page, SAMPLE_70MAI);
    await page.locator("#player-view-menu").click();
    const menu = page.locator("#player-view-menu-popover");
    await expect(menu).toBeVisible();
    await expect.poll(async () => (await boxOf(page, "#player-view-menu-popover")).x).toBeGreaterThanOrEqual(0);
    const bounds = await boxOf(page, "#player-view-menu-popover");
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(320);
    const row = await boxOf(page, '.view-menu-row[data-panel="chart"]');
    expect(row.x).toBeGreaterThanOrEqual(0);
    await page.locator('.view-menu-row[data-panel="chart"]').click();
    await expect(page.locator("#player-chart-canvas")).toBeHidden();
});

test("narrow desktop export keeps speed and GPS synchronization inside the readout", async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await gotoApp(page, "ru");
    await loadTrip(page, SAMPLE_70MAI);
    await openExport(page);
    const readout = page.locator("#player-readout");
    await expect(readout).toBeVisible();
    await expect(page.locator("#pm-speed-toggle")).toBeVisible();
    await expect(page.locator("#pm-coords")).toBeHidden();
    await expect(page.locator("#pm-time")).toBeHidden();
    expect(await readout.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
    const row = await boxOf(page, "#player-readout");
    const sync = await boxOf(page, "#gps-sync-pill");
    expect(sync.x).toBeGreaterThanOrEqual(row.x);
    expect(sync.x + sync.width).toBeLessThanOrEqual(row.x + row.width);
    expect(sync.width).toBeGreaterThan(36);
    await page.locator("#gps-sync-pill").click();
    await expect(page.locator("#gps-sync-modal")).toBeVisible();
});

test.describe("touch player toolbar", () => {
    test.use({ hasTouch: true, isMobile: true, locale: "ru-RU" });

    test("a narrow phone keeps fullscreen and export reachable", async ({ page }) => {
        await page.setViewportSize({ width: 320, height: 568 });
        await gotoApp(page, "ru");
        await loadTrip(page, SAMPLE_70MAI);
        await expect
            .poll(() => page.locator("#player-bar").evaluate((element) => element.scrollWidth - element.clientWidth))
            .toBeLessThanOrEqual(1);
        const overflow = await boxOf(page, "#player-overflow");
        expect(overflow.x).toBeGreaterThanOrEqual(0);
        expect(overflow.x + overflow.width).toBeLessThanOrEqual(320);
        await expect(page.locator("#player-fullscreen")).toBeHidden();
        await expect(page.locator(".player-fullscreen-actions")).toBeHidden();
        await page.locator("#player-overflow").tap();
        await expect(page.locator("#player-overflow-menu")).toBeVisible();
        await expect(
            page.locator("#player-overflow-menu").getByRole("button", { name: "На весь экран", exact: true }),
        ).toBeVisible();
        await expect(page.locator("#player-overflow-menu .overflow-menu-btn", { hasText: /карту/i })).toBeVisible();
        await page.locator("#player-overflow-menu .overflow-menu-btn", { hasText: "Сохранить фрагмент" }).tap();
        await expect(page.locator("#export-panel")).toBeVisible();
        await page.locator("#export-panel-close").tap();
        await page.setViewportSize({ width: 767, height: 1024 });
        await expect(page.locator("#player-map")).toBeVisible();
        await expect(page.locator("#player-map")).toHaveAttribute("data-overflow-hidden", "false");
    });

    test("page zoom preserves the map and export controls when the toolbar has room", async ({ page, context }) => {
        await page.setViewportSize({ width: 767, height: 1024 });
        await gotoApp(page, "ru");
        await loadTrip(page, SAMPLE_70MAI);
        await expect(page.locator("#player-map")).toBeVisible();
        await expect(page.locator("#player-export")).toBeVisible();

        const session = await context.newCDPSession(page);
        await session.send("Emulation.setPageScaleFactor", { pageScaleFactor: 2 });
        // A real layout resize forces overflow to measure while page zoom is
        // active; the visual viewport is now narrower than the flex toolbar.
        await page.setViewportSize({ width: 766, height: 1024 });

        await expect.poll(() => page.evaluate(() => window.visualViewport?.scale)).toBeCloseTo(2);
        await expect(page.locator("#player-map")).toHaveAttribute("data-overflow-hidden", "false");
        await expect(page.locator("#player-export")).toHaveAttribute("data-overflow-hidden", "false");
        await expect(page.locator("#player-map")).toBeVisible();
        await expect(page.locator("#player-export")).toBeVisible();
        await session.detach();
    });
});

test("expanded map fills a narrow desktop viewer after sidebar resizing", async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 900 });
    await page.addInitScript(() => localStorage.setItem("dashcamigo:sidebar-width", "600"));
    await gotoApp(page);
    await loadTrip(page, SAMPLE_70MAI);
    await page.locator("#mini-map").click();
    await expect(page.locator("#player-wrap")).toHaveClass(/map-expanded/);
    await expect(page.locator("body")).not.toHaveClass(/map-morphing/);
    const viewer = await boxOf(page, ".viewer");
    expect(viewer.width).toBeLessThan(768);
    const map = await boxOf(page, ".map-wrap");
    expect(map.x).toBeCloseTo(viewer.x, 0);
    expect(map.width).toBeCloseTo(viewer.width, 0);
    await expect(page.locator(".video-frame")).toBeHidden();
    await page.locator("#map-collapse").click();
    await expect(page.locator(".video-frame")).toBeVisible();
});

test("fullscreen controls remain available while hovered or keyboard focused", async ({ page }) => {
    await gotoApp(page);
    await loadTrip(page, SAMPLE_70MAI);
    await page.keyboard.press("r");
    await expect(page.locator("#player-loop")).toHaveAttribute("aria-label", "Loop on");
    const play = page.locator("#player-play");
    // Trip autoplay settles after the chart appears; a toggle can race it.
    await expect(play).toHaveAttribute("data-paused", "false");
    await page.locator("#player-fullscreen").click();
    const player = page.locator("#player-wrap");
    await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(true);
    const speed = await boxOf(page, "#player-speed");
    await page.mouse.move(speed.x + speed.width / 2, speed.y + speed.height / 2);
    // The idle deadline itself is under test: controls must survive beyond it.
    await page.waitForTimeout(3300);
    await expect(player).toHaveClass(/controls-visible/);
    await page.mouse.move(10, 10);
    await expect(player).not.toHaveClass(/controls-visible/);
    await page.keyboard.press("Tab");
    await expect(player).toHaveClass(/controls-visible/);
    await page.waitForTimeout(3300);
    await expect(player).toHaveClass(/controls-visible/);
    await page.locator("#player-fullscreen-exit").click();
    await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(false);
});
