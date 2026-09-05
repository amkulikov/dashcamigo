import {
    DESKTOP,
    MOBILE,
    SAMPLE_70MAI,
    boxOf,
    expect,
    gotoApp,
    loadTrip,
    mockDirectoryPicker,
    openExport,
    presetLocalStorage,
    test,
} from "./_fixtures.js";

test("sidebar keyboard resizing follows the visible edge and reports its size", async ({ page }) => {
    await presetLocalStorage(page);
    await page.setViewportSize(DESKTOP);
    await gotoApp(page);
    await loadTrip(page);

    const handle = page.locator("#sidebar-resize");
    const before = await boxOf(page, "#sidebar");
    await handle.focus();
    await page.keyboard.press("ArrowRight");
    const after = await boxOf(page, "#sidebar");
    expect(after.width - before.width).toBeCloseTo(16, 0);
    await expect(handle).toHaveAttribute("aria-valuenow", String(Math.round(after.width)));

    await page.keyboard.press("End");
    await page.setViewportSize({ width: 800, height: 900 });
    const capped = await boxOf(page, "#sidebar");
    await page.keyboard.press("ArrowLeft");
    const reduced = await boxOf(page, "#sidebar");
    expect(capped.width - reduced.width, "a capped sidebar responds to the first key press").toBeCloseTo(16, 0);
    await expect(handle).toHaveAttribute("aria-valuenow", String(Math.round(reduced.width)));
});

test("export removes the desktop trip list from keyboard navigation and restores it on close", async ({ page }) => {
    await presetLocalStorage(page);
    await page.setViewportSize(DESKTOP);
    await gotoApp(page);
    await loadTrip(page);
    const sidebar = page.locator("#sidebar");
    await expect(sidebar).not.toHaveAttribute("inert", "");
    await openExport(page);
    await expect(sidebar).toHaveAttribute("inert", "");
    await page.locator("#export-panel-close").click();
    await expect(sidebar).not.toHaveAttribute("inert", "");
});

test.describe("trip navigation with touch", () => {
    test.use({ hasTouch: true });

    test("localized sorting and the folder menu fit a narrow sidebar", async ({ page }) => {
        await presetLocalStorage(page);
        await page.setViewportSize({ width: 1024, height: 768 });
        await mockDirectoryPicker(page, [{ label: "MOCKCARD", dir: SAMPLE_70MAI }]);
        await gotoApp(page, "ru");
        await page.locator("#landing-cta").click();
        await expect(page.locator("li.trip").first()).toBeVisible({ timeout: 30_000 });
        await page.locator("#sidebar-resize").focus();
        await page.keyboard.press("Home");
        await page.locator("#trip-sort-key").selectOption("duration");

        const sidebar = await boxOf(page, "#sidebar");
        for (const selector of [".sidebar-header h2", "#trip-sort-key", "#trip-sort-dir", "#sidebar-collapse"]) {
            const control = await boxOf(page, selector);
            expect(control.x, selector).toBeGreaterThanOrEqual(sidebar.x);
            expect(control.x + control.width, selector).toBeLessThanOrEqual(sidebar.x + sidebar.width);
        }
        const row = page.locator("#folder-sources .folder-source");
        await row.locator(".folder-source__remember").click();
        await expect(row.locator(".folder-source__state")).toBeVisible();
        expect(
            await row.locator(".folder-source__label").evaluate((label) => label.scrollWidth <= label.clientWidth),
            "the folder name remains readable next to its saved state",
        ).toBe(true);
        await row.locator(".folder-source__menu").click();
        const menu = await boxOf(page, ".folder-source__popup");
        expect(menu.x, "the folder menu is not clipped by the scroll container").toBeGreaterThanOrEqual(sidebar.x);
        expect(menu.x + menu.width).toBeLessThanOrEqual(sidebar.x + sidebar.width);
        await expect(row.locator(".folder-source__popup button")).toBeInViewport();
    });

    test("Escape dismisses the folder menu before the trip drawer", async ({ page }) => {
        await presetLocalStorage(page);
        await page.setViewportSize(MOBILE);
        await mockDirectoryPicker(page, [{ label: "MOCKCARD", dir: SAMPLE_70MAI }]);
        await gotoApp(page);
        await page.locator("#landing-cta").click();
        const trip = page.locator("li.trip").first();
        await expect(trip).toBeVisible({ timeout: 30_000 });
        await trip.locator(".trip-title").click();
        await expect(page.locator("body")).not.toHaveClass(/browsing/);
        await expect(page.locator("#sidebar")).toHaveCount(1);
        await page.locator("#topbar-burger").click();
        const sidebar = page.locator("#sidebar");
        await expect(sidebar).toHaveAttribute("data-drawer-open", "true");
        const row = page.locator("#folder-sources .folder-source");
        await row.locator(".folder-source__remember").click();
        await expect(row.locator(".folder-source__state")).toBeVisible();
        const toggle = row.locator(".folder-source__menu");
        await toggle.click();
        await expect(row.locator(".folder-source__popup")).toBeVisible();
        await toggle.press("Escape");
        await expect(row.locator(".folder-source__popup")).toBeHidden();
        await expect(sidebar).toHaveAttribute("data-drawer-open", "true");
        await expect(toggle).toBeFocused();
        await page.locator("#topbar-burger").click();
        await expect(sidebar).not.toHaveAttribute("data-drawer-open", "true");
        await expect(page.locator("#drawer-scrim")).toBeHidden();
    });
});
