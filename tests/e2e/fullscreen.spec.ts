import type { Page } from "@playwright/test";

import {
    DESKTOP,
    MOBILE_LANDSCAPE,
    SAMPLE_70MAI,
    SAMPLE_GOPRO,
    boxOf,
    expect,
    gotoApp,
    loadTrip,
    masterVideoTime,
    presetLocalStorage,
    test,
} from "./_fixtures.js";

async function pausePlayback(page: Page): Promise<void> {
    const play = page.locator("#player-play");
    if ((await play.getAttribute("data-paused")) === "false") await play.click();
    await expect(play).toHaveAttribute("data-paused", "true");
}

async function startLoopingPlayback(page: Page): Promise<void> {
    await pausePlayback(page);
    await page.keyboard.press("r");
    await expect(page.locator("#player-loop")).toHaveAttribute("aria-label", "Loop on");
    await page.locator("#player-mini-progress").focus();
    await page.keyboard.press("Home");
    const master = page.locator(".video-tile.active video:not(.preload-slot):not(.tile-blur-bg)");
    await expect
        .poll(() =>
            master.evaluate(
                (video: HTMLVideoElement) => video.readyState >= 2 && !video.seeking && video.currentTime < 0.1,
            ),
        )
        .toBe(true);
    await page.locator("#player-play").click();
    await expect(page.locator("#player-play")).toHaveAttribute("data-paused", "false");
}

async function disableNativeFullscreen(page: Page): Promise<void> {
    await page.addInitScript(() => {
        Object.defineProperty(Element.prototype, "requestFullscreen", { configurable: true, value: undefined });
        Object.defineProperty(Document.prototype, "fullscreenEnabled", { configurable: true, get: () => false });
    });
}

async function enterFullscreen(page: Page): Promise<void> {
    await activateFullscreenEntry(page);
    await expect(page.locator("#player-wrap")).toHaveClass(/player-expanded/);
    await expect.poll(() => page.evaluate(() => document.fullscreenElement?.id)).toBe("player-wrap");
}

async function activateFullscreenEntry(page: Page, touch = false): Promise<void> {
    let entry = page.locator("#player-fullscreen");
    if (!(await entry.isVisible())) {
        const label = (await entry.getAttribute("aria-label")) ?? "";
        expect(label).not.toBe("");
        const overflow = page.locator("#player-overflow");
        if (touch) await overflow.tap();
        else await overflow.click();
        entry = page.locator("#player-overflow-menu").getByRole("button", { name: label, exact: true });
        await expect(entry).toBeVisible();
    }
    if (touch) await entry.tap();
    else await entry.click();
}

async function moveAwayFromControls(page: Page): Promise<void> {
    const frame = await boxOf(page, ".video-frame");
    await page.mouse.move(frame.x + frame.width / 2, frame.y + frame.height / 2);
}

test.beforeEach(async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await presetLocalStorage(page);
});

for (const copy of [
    { locale: "en", enter: "Full screen", exit: "Exit full screen", shortExit: "Exit" },
    { locale: "ru", enter: "На весь экран", exit: "Выйти из полного экрана", shortExit: "Выйти" },
]) {
    test(`fullscreen has a visible entry and a distinct exit in ${copy.locale}`, async ({ page }) => {
        await gotoApp(page, copy.locale);
        await loadTrip(page, SAMPLE_70MAI);
        await pausePlayback(page);
        const entry = page.locator("#player-fullscreen");
        const exit = page.locator("#player-fullscreen-exit");
        const actions = page.locator(".player-fullscreen-actions");
        await expect(page.locator("#player-bar #player-fullscreen")).toBeVisible();
        await expect(entry).toHaveAccessibleName(copy.enter);
        await expect(entry.locator(".fullscreen-label")).toBeHidden();
        await expect(entry.locator(".fullscreen-enter-icon")).toBeVisible();
        await expect(entry.locator(".fullscreen-exit-icon")).toBeHidden();
        await expect(actions).toBeHidden();
        await expect(exit).toBeHidden();
        const barBounds = await boxOf(page, "#player-bar");
        const entryBounds = await boxOf(page, "#player-fullscreen");
        expect(entryBounds.x).toBeGreaterThanOrEqual(barBounds.x);
        expect(entryBounds.y).toBeGreaterThanOrEqual(barBounds.y);
        expect(entryBounds.x + entryBounds.width).toBeLessThanOrEqual(barBounds.x + barBounds.width);
        expect(entryBounds.y + entryBounds.height).toBeLessThanOrEqual(barBounds.y + barBounds.height);
        await enterFullscreen(page);
        await expect(entry).toBeHidden();
        await expect(actions).toBeVisible();
        await expect(actions.locator("#player-fullscreen-exit")).toBeVisible();
        await expect(exit).toHaveAccessibleName(copy.exit);
        await expect(exit.locator(".fullscreen-label")).toHaveText(copy.shortExit);
        await expect(exit.locator(".fullscreen-enter-icon")).toBeHidden();
        await expect(exit.locator(".fullscreen-exit-icon")).toBeVisible();
        await exit.click();
        await expect(page.locator("#player-wrap")).not.toHaveClass(/player-expanded/);
        await expect(entry).toHaveAccessibleName(copy.enter);
        await expect(entry).toBeFocused();
        await expect(actions).toBeHidden();
        await expect(page.locator("#player-controls-pin")).toBeHidden();
    });
}

test("fullscreen keeps a separate detail view and restores the paused recording", async ({ page }) => {
    await gotoApp(page);
    await loadTrip(page, SAMPLE_70MAI);
    await pausePlayback(page);
    await page.locator("#player-view-menu").click();
    await page.locator('.view-menu-row[data-panel="readout"]').click();
    await page.locator("#player-view-menu").click();
    await expect(page.locator("#player-chart-canvas")).toBeVisible();
    await expect(page.locator("#player-readout")).toBeHidden();
    const time = await masterVideoTime(page);
    const camera = await page.locator(".video-tile.active").getAttribute("data-channel");
    const normalPreferences = await page.evaluate(() => localStorage.getItem("dc.viewer.panels"));

    await enterFullscreen(page);
    await expect(page.locator("#player-chart-canvas")).toBeHidden();
    await expect(page.locator("#player-readout")).toBeHidden();
    await expect(page.locator("#player-mini-progress")).toBeVisible();
    await page.locator("#player-view-menu").click();
    await expect(page.locator('.view-menu-row[data-panel="strip"]')).toHaveAttribute("aria-checked", "false");
    await page.locator('.view-menu-row[data-panel="readout"]').click();
    await page.locator("#player-view-menu").click();
    await expect(page.locator("#player-readout")).toBeVisible();
    await expect(page.locator("#player-chart-canvas")).toBeHidden();
    expect(await page.evaluate(() => localStorage.getItem("dc.viewer.panels"))).toBe(normalPreferences);

    // Browser-owned exit drives fullscreenchange without using our exit button.
    await page.evaluate(() => document.exitFullscreen());
    await expect(page.locator("#player-wrap")).not.toHaveClass(/player-expanded/);
    await expect(page.locator("#player-chart-canvas")).toBeVisible();
    await expect(page.locator("#player-readout")).toBeHidden();
    await expect(page.locator("#player-play")).toHaveAttribute("data-paused", "true");
    expect(await masterVideoTime(page)).toBeCloseTo(time, 2);
    await expect(page.locator(".video-tile.active")).toHaveAttribute("data-channel", camera ?? "");

    await enterFullscreen(page);
    await expect(page.locator("#player-chart-canvas")).toBeHidden();
    await expect(page.locator("#player-readout")).toBeVisible();
});

test("paused fullscreen keeps controls visible beyond the idle deadline", async ({ page }) => {
    await gotoApp(page);
    await loadTrip(page, SAMPLE_70MAI);
    await pausePlayback(page);
    await enterFullscreen(page);
    await moveAwayFromControls(page);
    // The idle deadline itself is under test.
    await page.waitForTimeout(3300);
    await expect(page.locator("#player-wrap")).toHaveClass(/controls-visible/);
    await expect(page.locator("#player-play")).toHaveAttribute("data-paused", "true");
});

test("pinning and an open menu keep fullscreen controls available during playback", async ({ page }) => {
    await gotoApp(page);
    await loadTrip(page, SAMPLE_70MAI);
    await startLoopingPlayback(page);
    await enterFullscreen(page);
    const player = page.locator("#player-wrap");
    const pin = page.locator("#player-controls-pin");
    await expect(pin).toHaveAccessibleName("Keep controls visible");
    await expect(pin).toHaveAttribute("aria-pressed", "false");
    await pin.click();
    await expect(pin).toHaveAttribute("aria-pressed", "true");
    await expect(pin).toHaveAccessibleName("Keep controls visible");
    await moveAwayFromControls(page);
    await page.waitForTimeout(3300);
    await expect(player).toHaveClass(/controls-visible/);
    await pin.click();
    await moveAwayFromControls(page);
    await expect(player).not.toHaveClass(/controls-visible/);
    await page.keyboard.press("Tab");
    await expect(player).toHaveClass(/controls-visible/);
    await expect(page.locator("#player-play")).toHaveAttribute("data-paused", "false");
    await page.locator("#player-speed").click();
    await moveAwayFromControls(page);
    await page.waitForTimeout(3300);
    await expect(page.locator("#player-speed-menu")).toBeVisible();
    await expect(player).toHaveClass(/controls-visible/);
});

for (const method of ["button", "shortcut"]) {
    test(`saving a clip by ${method} exits fullscreen into a visible editor`, async ({ page }) => {
        await gotoApp(page);
        await loadTrip(page, SAMPLE_70MAI);
        await pausePlayback(page);
        const time = await masterVideoTime(page);
        await enterFullscreen(page);
        if (method === "button") await page.locator("#player-export").click();
        else await page.keyboard.press("e");
        await expect(page.locator("#player-wrap")).not.toHaveClass(/player-expanded/);
        await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(false);
        await expect(page.locator("#export-panel")).toBeVisible();
        const panel = await boxOf(page, "#export-panel");
        expect(panel.x).toBeGreaterThanOrEqual(0);
        expect(panel.y + panel.height).toBeLessThanOrEqual(DESKTOP.height);
        expect(await masterVideoTime(page)).toBeCloseTo(time, 2);
    });
}

for (const mode of ["native button", "native shortcut", "viewport"]) {
    test(`the clip editor preserves its range and settings across ${mode} fullscreen`, async ({ page }) => {
        if (mode === "viewport") await disableNativeFullscreen(page);
        await gotoApp(page);
        await loadTrip(page, SAMPLE_70MAI);
        await page.locator("#player-export").click();
        const panel = page.locator("#export-panel");
        await expect(panel).toBeVisible();
        const start = page.locator('.export-trim-bar__input[data-range-edge="start"]');
        await start.fill("00:01");
        await start.press("Enter");
        const rangeStart = await start.inputValue();
        const quality = page.locator('.export-panel__radio input[value="low"]');
        await quality.check();
        const time = await masterVideoTime(page);
        await expect(page.locator("#player-fullscreen")).toBeEnabled();
        if (mode === "native shortcut") {
            await page.locator("#player-play").focus();
            await page.keyboard.press("f");
        } else {
            await activateFullscreenEntry(page);
        }
        const player = page.locator("#player-wrap");
        await expect(player).toHaveClass(/player-expanded/);
        await expect(panel).toBeHidden();
        await expect(page.locator("#export-trim-bar")).toBeHidden();
        const bounds = await boxOf(page, "#player-wrap");
        expect(bounds.x).toBe(0);
        expect(bounds.width).toBe(DESKTOP.width);
        expect(bounds.height).toBe(DESKTOP.height);
        if (mode !== "viewport") {
            await expect.poll(() => page.evaluate(() => document.fullscreenElement?.id)).toBe("player-wrap");
        }
        if (mode === "viewport") await page.keyboard.press("Escape");
        else if (mode === "native shortcut") await page.keyboard.press("f");
        else await page.locator("#player-fullscreen-exit").click();
        await expect(player).not.toHaveClass(/player-expanded/);
        await expect(panel).toBeVisible();
        await expect(page.locator("#export-trim-bar")).toBeVisible();
        await expect(start).toHaveValue(rangeStart);
        await expect(quality).toBeChecked();
        expect(await masterVideoTime(page)).toBeCloseTo(time, 2);
    });
}

test.describe("touch fullscreen", () => {
    test.use({ hasTouch: true, isMobile: true });

    for (const viewport of [MOBILE_LANDSCAPE, { width: 320, height: 568 }]) {
        test(`exit stays fully on screen at ${viewport.width} by ${viewport.height}`, async ({ page }) => {
            await page.setViewportSize(viewport);
            await gotoApp(page, "ru");
            await loadTrip(page, SAMPLE_70MAI);
            await pausePlayback(page);
            const entry = page.locator("#player-fullscreen");
            if (viewport.width === 320) {
                await expect(entry).toBeHidden();
                await expect(entry).toHaveAttribute("data-overflow-hidden", "true");
            }
            await expect(page.locator(".player-fullscreen-actions")).toBeHidden();
            await activateFullscreenEntry(page, true);
            await expect(page.locator("#player-wrap")).toHaveClass(/player-expanded/);
            await expect(entry).toBeHidden();
            const exit = await boxOf(page, "#player-fullscreen-exit");
            expect(exit.x).toBeGreaterThanOrEqual(0);
            expect(exit.y).toBeGreaterThanOrEqual(0);
            expect(exit.x + exit.width).toBeLessThanOrEqual(viewport.width);
            expect(exit.y + exit.height).toBeLessThanOrEqual(viewport.height);
            await expect(page.locator("#player-fullscreen-exit")).toHaveAccessibleName("Выйти из полного экрана");
            if (viewport.width === 320) {
                await page.locator("#player-overflow").tap();
                const menu = page.locator("#player-overflow-menu");
                await expect(menu).toBeVisible();
                await expect(menu.getByRole("button", { name: "На весь экран", exact: true })).toHaveCount(0);
            }
            await page.locator("#player-fullscreen-exit").tap();
            await expect(page.locator("#player-wrap")).not.toHaveClass(/player-expanded/);
            await expect(page.locator(".player-fullscreen-actions")).toBeHidden();
            await expect(page.locator("#player-overflow-menu")).toBeHidden();
            const returnFocus = (await entry.isVisible()) ? entry : page.locator("#player-overflow");
            await expect(returnFocus).toBeFocused();
            if (viewport.width === 320) {
                await activateFullscreenEntry(page, true);
                await expect(page.locator("#player-wrap")).toHaveClass(/player-expanded/);
                await page.locator("#player-fullscreen-exit").tap();
                await expect(returnFocus).toBeFocused();
            }
        });
    }

    test("the first tap reveals hidden controls without pausing the recording", async ({ page }) => {
        await page.setViewportSize(MOBILE_LANDSCAPE);
        await gotoApp(page);
        // A single-camera tap normally toggles playback; multichannel taps only route audio.
        await loadTrip(page, SAMPLE_GOPRO);
        await startLoopingPlayback(page);
        await activateFullscreenEntry(page, true);
        const player = page.locator("#player-wrap");
        await expect(player).toHaveClass(/player-expanded/);
        // Expansion can place controls under the setup's synthetic mouse pointer.
        await moveAwayFromControls(page);
        await expect(player).not.toHaveClass(/controls-visible/);
        const video = await boxOf(page, ".video-tile.active");
        await page.touchscreen.tap(video.x + video.width / 2, video.y + video.height / 2);
        await expect(player).toHaveClass(/controls-visible/);
        await expect(page.locator("#player-play")).toHaveAttribute("data-paused", "false");
        await expect(player).not.toHaveClass(/controls-visible/);
        await expect(page.locator("#player-play")).toHaveAttribute("data-paused", "false");
    });
});

test("a browser without fullscreen offers an expanded player with button and Escape exits", async ({ page }) => {
    await disableNativeFullscreen(page);
    await gotoApp(page);
    await loadTrip(page, SAMPLE_70MAI);
    await pausePlayback(page);
    const player = page.locator("#player-wrap");
    const button = page.locator("#player-fullscreen");
    const exit = page.locator("#player-fullscreen-exit");
    await expect(button).toHaveAccessibleName("Expand player");
    await button.click();
    await expect(player).toHaveClass(/player-expanded/);
    await expect(button).toBeHidden();
    await expect(exit).toHaveAccessibleName("Back to viewer");
    expect(await page.evaluate(() => document.fullscreenElement)).toBeNull();
    const expanded = await boxOf(page, "#player-wrap");
    expect(expanded.x).toBe(0);
    expect(expanded.y).toBe(0);
    expect(expanded.width).toBe(DESKTOP.width);
    expect(expanded.height).toBe(DESKTOP.height);
    await page.keyboard.press("Escape");
    await expect(player).not.toHaveClass(/player-expanded/);
    await expect(button).toBeFocused();
    await button.click();
    await expect(player).toHaveClass(/player-expanded/);
    await exit.click();
    await expect(player).not.toHaveClass(/player-expanded/);
    await expect(button).toHaveAccessibleName("Expand player");
    await expect(button).toBeFocused();
    await expect(page.locator(".player-fullscreen-actions")).toBeHidden();
});

test("a rejected fullscreen request leaves the viewer usable and explains how to retry", async ({ page }) => {
    await page.addInitScript(() => {
        Object.defineProperty(Element.prototype, "requestFullscreen", {
            configurable: true,
            value: () => Promise.reject(new DOMException("fullscreen request denied", "NotAllowedError")),
        });
    });
    await gotoApp(page);
    await loadTrip(page, SAMPLE_70MAI);
    await pausePlayback(page);
    await page.locator("#player-fullscreen").click();
    await expect(page.locator("#toast-container")).toContainText("Couldn’t open full screen. Try again.");
    await expect(page.locator("#player-wrap")).not.toHaveClass(/player-expanded/);
    await expect(page.locator("#player-fullscreen")).toHaveAccessibleName("Full screen");
    await expect(page.locator("#player-chart-canvas")).toBeVisible();
    await expect(page.locator("#player-readout")).toBeVisible();
    await page.locator("#player-play").click();
    await expect(page.locator("#player-play")).toHaveAttribute("data-paused", "false");
});

test("a rejected exit keeps controls available and prevents a hidden clip editor", async ({ page }) => {
    await page.addInitScript(() => {
        Object.defineProperty(Document.prototype, "exitFullscreen", {
            configurable: true,
            value: () => Promise.reject(new DOMException("fullscreen exit denied", "InvalidStateError")),
        });
    });
    await gotoApp(page);
    await loadTrip(page, SAMPLE_70MAI);
    await pausePlayback(page);
    await enterFullscreen(page);
    await page.locator("#player-fullscreen-exit").click();
    await expect(page.locator("#player-fullscreen-hint")).toHaveText("Couldn’t leave full screen. Try again.");
    await expect(page.locator("#player-wrap")).toHaveClass(/player-expanded/);
    await expect(page.locator("#player-wrap")).toHaveClass(/controls-visible/);
    await page.keyboard.press("e");
    await expect(page.locator("#export-panel")).toBeHidden();
    await expect.poll(() => page.evaluate(() => document.fullscreenElement?.id)).toBe("player-wrap");
});

test("double-clicking another camera changes fullscreen without changing playback or audio", async ({ page }) => {
    await gotoApp(page);
    await loadTrip(page, SAMPLE_70MAI);
    await pausePlayback(page);
    const audio = page.locator(".top-panel__audio-select");
    const camera = await audio.inputValue();
    expect(camera).not.toBe("rear");
    const time = await masterVideoTime(page);
    const rear = page.locator('.video-tile[data-channel="rear"] video:not(.preload-slot):not(.tile-blur-bg)');
    await rear.dblclick();
    await expect(page.locator("#player-wrap")).toHaveClass(/player-expanded/);
    // Survive the single-click delay so a deferred audio swap cannot pass unnoticed.
    await page.waitForTimeout(350);
    await expect(audio).toHaveValue(camera);
    await expect(page.locator("#player-play")).toHaveAttribute("data-paused", "true");
    expect(await masterVideoTime(page)).toBeCloseTo(time, 2);
    await rear.dblclick();
    await expect(page.locator("#player-wrap")).not.toHaveClass(/player-expanded/);
    await page.waitForTimeout(350);
    await expect(audio).toHaveValue(camera);
    await expect(page.locator("#player-play")).toHaveAttribute("data-paused", "true");
});

test("expanded fallback contains modal focus and restores the viewer scroll and focus", async ({ page }) => {
    await disableNativeFullscreen(page);
    await page.setViewportSize({ width: 600, height: 390 });
    await gotoApp(page);
    await loadTrip(page, SAMPLE_70MAI);
    await pausePlayback(page);
    const viewer = page.locator(".viewer");
    await viewer.evaluate((element) => {
        element.scrollTop = 120;
    });
    await page.locator("#player-speed").focus();
    const scrollTop = await viewer.evaluate((element) => element.scrollTop);
    expect(scrollTop, "the viewer must have a real scroll position to restore").toBeGreaterThan(0);
    await page.keyboard.press("f");
    const player = page.locator("#player-wrap");
    await expect(player).toHaveClass(/player-expanded/);
    await page.locator("#player-controls-pin").focus();
    await page.keyboard.press("Shift+Tab");
    expect(await player.evaluate((element) => element.contains(document.activeElement))).toBe(true);
    await page.keyboard.press("?");
    const modal = page.locator("#hotkeys-modal");
    await expect(modal).toBeVisible();
    await expect(player.locator("#hotkeys-modal")).toBeVisible();
    await page.keyboard.press("Tab");
    expect(await modal.evaluate((element) => element.contains(document.activeElement))).toBe(true);
    await page.keyboard.press("Escape");
    await expect(modal).toBeHidden();
    await expect(player).toHaveClass(/player-expanded/);
    await page.keyboard.press("Escape");
    await expect(player).not.toHaveClass(/player-expanded/);
    await expect(page.locator("#player-speed")).toBeFocused();
    expect(await viewer.evaluate((element) => element.scrollTop)).toBeCloseTo(scrollTop, 0);
});

test("expanded fallback isolates fixed banners while an existing GPS dialog stays interactive", async ({ page }) => {
    await disableNativeFullscreen(page);
    await gotoApp(page);
    await loadTrip(page, SAMPLE_70MAI);
    await pausePlayback(page);
    await page.locator("#gps-sync-pill").click();
    const dialog = page.locator("#gps-sync-modal");
    await expect(dialog).toHaveClass(/is-modeless/);
    const banner = page.locator("#support-banner");
    await banner.evaluate((element: HTMLElement) => {
        element.hidden = false;
    });
    await expect(banner).toHaveCSS("position", "fixed");
    await expect(banner).toBeVisible();
    const later = page.getByRole("button", { name: "Maybe later", exact: true });
    // Role locators infer semantics from the DOM and still match inert nodes.
    const accessibility = await page.context().newCDPSession(page);
    const accessibleLaterCount = async (): Promise<number> => {
        const { nodes } = await accessibility.send("Accessibility.getFullAXTree");
        return nodes.filter(
            (node) => !node.ignored && node.role?.value === "button" && node.name?.value === "Maybe later",
        ).length;
    };
    await expect.poll(accessibleLaterCount).toBe(1);
    const topbar = page.locator(".topbar");
    await topbar.evaluate((element: HTMLElement) => {
        element.inert = true;
    });

    await page.locator("#player-fullscreen").click();
    const player = page.locator("#player-wrap");
    await expect(player).toHaveClass(/player-expanded/);
    await expect(banner).toHaveAttribute("inert", "");
    await expect.poll(accessibleLaterCount).toBe(0);
    await expect(player.locator("#gps-sync-modal")).toBeVisible();
    await expect(dialog).not.toHaveAttribute("inert");
    const offset = page.locator("#gps-sync-offset-input");
    await expect(offset).toBeFocused();
    await page.locator("#support-banner-later").evaluate((element) => element.focus());
    await expect(offset).toBeFocused();
    await offset.fill("1");
    await offset.press("Enter");
    await expect(page.locator("#gps-sync-reset")).toBeEnabled();

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(player).toHaveClass(/player-expanded/);
    await page.keyboard.press("Escape");
    await expect(player).not.toHaveClass(/player-expanded/);
    await expect(banner).not.toHaveAttribute("inert");
    await expect(topbar).toHaveAttribute("inert", "");
    await expect.poll(accessibleLaterCount).toBe(1);
    await later.click();
    await expect(banner).toBeHidden();
    await accessibility.detach();
});

test("fallback Escape closes each open player menu before leaving the expanded view", async ({ page }) => {
    await disableNativeFullscreen(page);
    await page.setViewportSize({ width: 320, height: 568 });
    await gotoApp(page);
    await loadTrip(page, SAMPLE_70MAI);
    await pausePlayback(page);
    await activateFullscreenEntry(page);
    const player = page.locator("#player-wrap");
    await expect(player).toHaveClass(/player-expanded/);
    const speed = page.locator("#player-speed");
    await speed.click();
    await expect(page.locator("#player-speed-menu")).toBeVisible();
    // Escape from the trigger must also respect the open menu.
    await speed.focus();
    await page.keyboard.press("Escape");
    await expect(page.locator("#player-speed-menu")).toBeHidden();
    await expect(speed).toBeFocused();
    await expect(player).toHaveClass(/player-expanded/);
    await page.locator("#player-overflow").click();
    await expect(page.locator("#player-overflow-menu")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator("#player-overflow-menu")).toBeHidden();
    await expect(player).toHaveClass(/player-expanded/);
    await page.keyboard.press("Escape");
    await expect(player).not.toHaveClass(/player-expanded/);
    await expect(page.locator("#player-overflow")).toBeFocused();
});
