import {
    DESKTOP,
    SAMPLE_70MAI,
    boxOf,
    expect,
    gotoApp,
    loadTrip,
    openExport,
    presetLocalStorage,
    test,
} from "./_fixtures.js";

test.beforeEach(async ({ page }) => {
    await presetLocalStorage(page);
    await page.setViewportSize(DESKTOP);
    await gotoApp(page, "en");
    await loadTrip(page, SAMPLE_70MAI);
    await openExport(page);
});

test("map preview stays inside the output after resize, shape, and aspect changes", async ({ page }) => {
    await page.locator("#export-panel-ov-map").check();
    const inspector = page.locator("#export-panel-overlay-inspector");
    await inspector.locator('button[data-shape="rect"]').click();
    const map = page.locator("#player-map-overlay");
    const frame = await boxOf(page, "#player-overlay-frame");
    const initial = await boxOf(page, "#player-map-overlay");
    await page.mouse.move(initial.x + initial.width / 2, initial.y + initial.height / 2);
    await page.mouse.down();
    await page.mouse.move(frame.x + frame.width, frame.y + frame.height, { steps: 8 });
    await page.mouse.up();
    await inspector
        .locator('input[type="range"]')
        .first()
        .evaluate((el) => {
            const input = el as HTMLInputElement;
            input.value = "200";
            input.dispatchEvent(new Event("input", { bubbles: true }));
        });
    const expectInside = async (): Promise<void> => {
        await expect
            .poll(async () => {
                const f = await boxOf(page, "#player-overlay-frame");
                const m = await boxOf(page, "#player-map-overlay");
                return (
                    m.x >= f.x - 1 &&
                    m.y >= f.y - 1 &&
                    m.x + m.width <= f.x + f.width + 1 &&
                    m.y + m.height <= f.y + f.height + 1
                );
            })
            .toBe(true);
        await expect(map).toBeVisible();
    };
    await expectInside();
    await expect.poll(() => map.evaluate((el) => parseFloat((el as HTMLElement).style.left))).toBeCloseTo(50);
    await inspector.locator('button[data-shape="circle"]').click();
    await expectInside();
    await page.locator("#export-panel-output").selectOption("1080_9x16");
    await expectInside();
});

test("map preview retries a temporary WebGL initialization failure at the same position", async ({ page }) => {
    await page.evaluate(() => {
        const proto = HTMLCanvasElement.prototype as unknown as {
            getContext: (type: string, ...rest: unknown[]) => unknown;
        };
        const original = proto.getContext;
        proto.getContext = function (type: string, ...rest: unknown[]) {
            if (type === "webgl2") {
                proto.getContext = original;
                document.body.dataset.mapProbeFailed = "true";
                return null;
            }
            return original.call(this, type, ...rest);
        };
    });
    const toggle = page.locator("#export-panel-ov-map");
    await toggle.check();
    await expect(page.locator("body")).toHaveAttribute("data-map-probe-failed", "true");
    await toggle.uncheck();
    await toggle.check();
    await expect
        .poll(() => page.locator("#player-map-overlay-canvas").evaluate((el) => (el as HTMLCanvasElement).width))
        .toBeGreaterThan(300);
    await expect(page.locator("#export-map-snapshot-host")).toHaveCount(1);
});

test("map preview rebuilds a replaced track while the playhead stays still", async ({ page }) => {
    await page.locator("#export-panel-ov-map").check();
    const host = page.locator("#export-map-snapshot-host");
    await expect
        .poll(() => page.locator("#player-map-overlay-canvas").evaluate((el) => (el as HTMLCanvasElement).width))
        .toBeGreaterThan(300);
    await host.evaluate((el) => {
        (el as HTMLElement).dataset.oldTrack = "true";
    });
    await page.evaluate(() => {
        const { state, dom } = window.__dashcamigo;
        const trip = state.trips[state.active!.trip]!;
        trip.records = trip.records.slice();
        dom.player.dispatchEvent(new Event("timeupdate"));
    });
    await expect(page.locator('[data-old-track="true"]')).toHaveCount(0);
    await expect(host).toHaveCount(1);
});
