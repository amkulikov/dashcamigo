// Mobile (390x844 portrait + landscape) layout flows. The project treats
// mobile as first-class, so these are real regression guards, not screenshots:
// the drawer, the overflow kebab, the view-menu, the mini-progress fallback,
// map expansion, and the export panel sitting in-flow (not as a right drawer
// that shoves the player off-screen).

import {
    MOBILE,
    MOBILE_LANDSCAPE,
    SAMPLE_70MAI,
    boxOf,
    expect,
    gotoApp,
    loadTrip,
    openMobileExport,
    presetLocalStorage,
    shot,
    test,
} from "./_fixtures.js";

test.describe("mobile portrait", () => {
    test.beforeEach(async ({ page }) => {
        await presetLocalStorage(page);
        await page.setViewportSize(MOBILE);
        await gotoApp(page, "en");
    });

    test("browsing: trip list is the full-screen surface before a pick", async ({ page }) => {
        await page.locator("#folder-input").setInputFiles(SAMPLE_70MAI);
        await expect(page.locator("li.trip:not(.unindexed-note)").first()).toBeVisible({ timeout: 30_000 });
        // While browsing (trips loaded, none active) the burger is hidden - the
        // list itself is the surface.
        await expect(page.locator("#topbar-burger")).toBeHidden();
        await shot(page, "mobile-01-browsing-list");
    });

    test("export button is reachable and enabled after a trip loads", async ({ page }) => {
        await loadTrip(page, SAMPLE_70MAI);
        await expect(page.locator("#player-export")).toBeEnabled();
        await openMobileExport(page);
        await expect(page.locator("#export-panel")).toBeVisible();
        await shot(page, "mobile-02-export-open");
    });

    test("overflow kebab opens as a sheet", async ({ page }) => {
        await loadTrip(page, SAMPLE_70MAI);
        const overflow = page.locator("#player-overflow");
        await expect(overflow).toBeVisible();
        await overflow.click();
        await expect(page.locator("#player-overflow-menu")).toBeVisible();
        await shot(page, "mobile-03-overflow");
    });

    test("overflow kebab carries a working volume slider", async ({ page }) => {
        // On the narrow bar mute collapses into the kebab; its popover slider is
        // hidden with the wrap, so the menu renders its own slider (drag to 0
        // mutes). Regression guard for the no-volume-in-kebab gap.
        await loadTrip(page, SAMPLE_70MAI);
        await page.locator("#player-overflow").click();
        await expect(page.locator("#player-overflow-menu")).toBeVisible();
        const slider = page.locator(".overflow-menu-volume-slider");
        await expect(slider).toBeVisible();

        // A range input is driven via a dispatched 'input' event (Playwright's
        // fill() does not move sliders).
        const setLevel = (v: string) =>
            slider.evaluate((el, value) => {
                (el as HTMLInputElement).value = value;
                el.dispatchEvent(new Event("input", { bubbles: true }));
            }, v);

        // Up: sets the level and lifts mute.
        await setLevel("0.5");
        await expect(page.locator("#player-mute")).toHaveAttribute("aria-label", "Mute");
        await expect(page.locator("#player-volume")).toHaveValue("0.5");

        // To 0: mutes (the bar slider mirrors to 0, the button flips to Unmute).
        await setLevel("0");
        await expect(page.locator("#player-mute")).toHaveAttribute("aria-label", "Unmute");
        await expect(page.locator("#player-volume")).toHaveValue("0");
    });

    test("view-menu opens", async ({ page }) => {
        await loadTrip(page, SAMPLE_70MAI);
        await page.locator("#player-view-menu").click();
        // The view-menu popover with the panel toggles.
        await expect(page.locator('.view-menu-row[data-panel="chart"]')).toBeVisible();
        await shot(page, "mobile-04-view-menu");
    });

    test("hiding both panels reveals the mini-progress scrubber", async ({ page }) => {
        await loadTrip(page, SAMPLE_70MAI);
        await page.locator("#player-view-menu").click();
        await page.locator('.view-menu-row[data-panel="chart"]').click();
        await page.locator('.view-menu-row[data-panel="strip"]').click();
        await page.locator("body").click(); // close popover
        await expect(page.locator("#player-mini-progress")).toBeVisible();
        await shot(page, "mobile-05-mini-progress");
    });

    test("sidebar drawer opens over the viewer", async ({ page }) => {
        await loadTrip(page, SAMPLE_70MAI);
        // Two .sidebar nodes exist (landing + app shell); dom.sidebar is the first.
        const sidebar = page.locator(".sidebar").first();
        // The drawer may already be open after the browse->watch transition; only
        // toggle when it is closed, then assert it is open (attr + scrim shown).
        if ((await sidebar.getAttribute("data-drawer-open")) !== "true") {
            await page.locator("#topbar-burger").click();
        }
        await expect(sidebar).toHaveAttribute("data-drawer-open", "true");
        await expect(page.locator("#drawer-scrim")).toBeVisible();
        await shot(page, "mobile-06-drawer");
    });

    test("map expands from the player bar", async ({ page }) => {
        await loadTrip(page, SAMPLE_70MAI);
        // The mini-map circle is hidden on mobile; #player-map is the entry point.
        // Expansion is the documented state toggle: #player-wrap gets .map-expanded.
        await expect(page.locator("#player-wrap")).not.toHaveClass(/map-expanded/);
        await page.locator("#player-map").click();
        await expect(page.locator("#player-wrap")).toHaveClass(/map-expanded/);
        await shot(page, "mobile-07-map-expanded");
    });
});

test.describe("mobile landscape", () => {
    test.beforeEach(async ({ page }) => {
        await presetLocalStorage(page);
        await page.setViewportSize(MOBILE_LANDSCAPE);
        await gotoApp(page, "en");
        await loadTrip(page, SAMPLE_70MAI);
    });

    test("stacked layout yields plain wheel to the page scroll", async ({ page }) => {
        // The reported trap: video (and map) consumed the wheel, so a short
        // viewport could never scroll down to the timeline. Plain wheel must
        // fall through to .viewer (the stacked scroll container); zoom moves
        // to Ctrl/Cmd+wheel, mirroring the map's cooperative gestures.
        const video = await boxOf(page, "#video-grid");
        await page.mouse.move(video.x + video.width / 2, video.y + video.height / 2);

        // The cooperative bypass zooms. Checked before any scrolling so the
        // cursor is still guaranteed to sit on the active video element.
        await page.keyboard.down("Control");
        await page.mouse.wheel(0, -200);
        await page.keyboard.up("Control");
        await expect
            .poll(() =>
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                page.evaluate(() => (window as any).__dashcamigo.state.videoZoom.scale),
            )
            .toBeGreaterThan(1);
        // Back to the neutral scale so the plain-wheel check below starts clean.
        await page.keyboard.down("Control");
        await page.mouse.wheel(0, 800);
        await page.keyboard.up("Control");
        await expect
            .poll(() =>
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                page.evaluate(() => (window as any).__dashcamigo.state.videoZoom.scale),
            )
            .toBe(1);

        await page.mouse.wheel(0, 300);
        await expect
            .poll(() => page.evaluate(() => document.querySelector(".viewer")?.scrollTop ?? 0), "plain wheel scrolls")
            .toBeGreaterThan(0);
        const zoomAfterPlain = await page.evaluate(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            () => (window as any).__dashcamigo.state.videoZoom.scale,
        );
        expect(zoomAfterPlain, "plain wheel does not zoom the video").toBe(1);

        // The map runs MapLibre cooperative gestures in this layout even on a
        // fine pointer - the overlay hint (with the Ctrl/Cmd message) exists,
        // which means the wheel is not trapped by the map either.
        await page.locator("#player-map").click();
        await expect(page.locator("#player-wrap")).toHaveClass(/map-expanded/);
        await expect(page.locator(".maplibregl-cooperative-gesture-screen")).toBeAttached();
    });

    test("export panel is in-flow, not a right drawer squeezing the player", async ({ page }) => {
        await openMobileExport(page);
        const panel = await boxOf(page, "#export-panel");
        // Regression: the panel used to stay a 360px right drawer on landscape
        // (its bottom-sheet breakpoint was max-width:720, and 844 > 720), pushing
        // the player off-screen. In-flow now: the panel spans most of the width.
        expect(panel.width).toBeGreaterThan(MOBILE_LANDSCAPE.width * 0.6);
        await shot(page, "mobile-08-landscape-export");
    });
});
