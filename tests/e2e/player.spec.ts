// Player controls and timeline interactions on a loaded multichannel trip.
// Fail-loud, web-first assertions so a regression turns the test red.

import {
    DESKTOP,
    SAMPLE_70MAI,
    boxOf,
    expect,
    gotoApp,
    loadTrip,
    masterVideoTime,
    presetLocalStorage,
    shot,
    test,
} from "./_fixtures.js";

// Mirrors the mini-map drag geometry in ui/map.ts (padding around the widget
// inside its frame, and the movement that turns a press into a drag). Copied,
// not imported: both live inside the module's DOM-singleton graph, and the
// suite stays black-box against the built app.
const MINIMAP_FRAME_PADDING_PX = 16;
const MINIMAP_DRAG_THRESHOLD_PX = 5;

test.describe("player", () => {
    test.beforeEach(async ({ page }) => {
        await presetLocalStorage(page);
        await page.setViewportSize(DESKTOP);
        await gotoApp(page, "en");
        await loadTrip(page, SAMPLE_70MAI);
    });

    test("play/pause control toggles the playing state", async ({ page }) => {
        const play = page.locator("#player-play");
        // The app may auto-start playback on trip activation, so the initial state
        // is not stable across runs - assert the control toggles it BOTH ways
        // from whatever it is. (Actual frame decode/advance is covered by the
        // export-run suite, which reads decoded frames; asserting currentTime here
        // is flaky under headless multichannel.)
        const startedPaused = (await play.getAttribute("data-paused")) === "true";
        await play.click();
        await expect(play).toHaveAttribute("data-paused", startedPaused ? "false" : "true");
        await play.click();
        await expect(play).toHaveAttribute("data-paused", startedPaused ? "true" : "false");
        await shot(page, "player-01-playpause");
    });

    test("frame-step buttons step the paused player frame by frame, both ways", async ({ page }) => {
        const play = page.locator("#player-play");
        // Pause deterministically whatever the auto-start state was.
        if ((await play.getAttribute("data-paused")) === "false") await play.click();
        await expect(play).toHaveAttribute("data-paused", "true");

        // Measure the master tile only - a frame step is defined off it (see
        // masterVideoTime). Math.max over every tile flakes: slaves drift ahead
        // during playback and the first step re-syncs them down below the drift.
        const time = () => masterVideoTime(page);

        // The fixture is 30 fps, so a step is 1/30s. Each step is an async seek;
        // fire them one-settled-at-a-time rather than hammering three at once. A
        // slow software decoder (Linux CI's H.264) coalesces back-to-back seeks
        // into fewer frames, so unsynchronized clicks flake. The product itself
        // paces held stepping (REPEAT_MS in player-frame-step) so a step lands
        // before the next - mirror that here.
        const t0 = await time();
        const fwd = page.locator("#player-step-fwd");
        let prev = t0;
        for (let step = 1; step <= 3; step++) {
            await fwd.click();
            // Wait for this step to land before the next. Half a frame is the
            // floor: a step from a sub-frame position snaps to the next frame
            // boundary, which is always > 0 but can be < 1/30.
            await expect
                .poll(time, { message: `forward step ${step} must advance a frame` })
                .toBeGreaterThan(prev + 0.5 / 30);
            prev = await time();
        }
        const t3 = prev;
        // 3 steps advanced ~3 frames; the lower bound (2.5 frames) tolerates
        // seek rounding, the upper bound catches a step that degenerated into a
        // whole-second seek.
        expect(t3 - t0, "3 forward steps must advance ~3 frames").toBeGreaterThan(2.5 / 30);
        expect(t3 - t0, "3 frame steps must stay a micro-seek, not a jump").toBeLessThan(1);

        await page.locator("#player-step-back").click();
        await expect.poll(time, { message: "a back step must rewind" }).toBeLessThan(t3);
        // Stepping must not resume playback.
        await expect(play).toHaveAttribute("data-paused", "true");
    });

    test("frame-step while playing pauses first; holding auto-repeats", async ({ page }) => {
        const play = page.locator("#player-play");
        if ((await play.getAttribute("data-paused")) === "true") await play.click();
        await expect(play).toHaveAttribute("data-paused", "false");

        const fwd = page.locator("#player-step-fwd");
        await fwd.click();
        await expect(play, "step while playing must pause, not seek under playback").toHaveAttribute(
            "data-paused",
            "true",
        );

        const time = () => masterVideoTime(page);
        const t0 = await time();
        // Hold the button past the repeat delay: pointerdown steps once
        // immediately, then the auto-repeat must contribute more steps. A 1.2s
        // hold = 1 + ~(1200-400)/150 ≈ 6 steps of 1/30s; require > 3 frames so
        // a repeat that never started (one step = 1/30) fails loudly without
        // making CI timing precision the gate.
        const box = await boxOf(page, "#player-step-fwd");
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        await page.waitForTimeout(1200);
        await page.mouse.up();
        await expect
            .poll(time, { message: "a >1s hold must auto-repeat (3+ frames), not step once" })
            .toBeGreaterThan(t0 + 3.5 / 30);
    });

    test("speed menu changes the playback rate label", async ({ page }) => {
        const speedBtn = page.locator("#player-speed");
        const before = (await speedBtn.innerText()).trim();
        await speedBtn.click();
        await expect(page.locator("#player-speed-menu")).toBeVisible();
        const opt2x = page.locator('#player-speed-menu [data-rate="2"]');
        await expect(opt2x).toBeVisible();
        await opt2x.click();
        await expect(speedBtn).not.toHaveText(before);
    });

    test("loop button toggles aria-pressed", async ({ page }) => {
        const loop = page.locator("#player-loop");
        await expect(loop).toBeVisible();
        const before = await loop.getAttribute("aria-pressed");
        await loop.click();
        await expect(loop).not.toHaveAttribute("aria-pressed", before ?? "");
    });

    test("capture button downloads a JPEG frame", async ({ page }) => {
        const downloadPromise = page.waitForEvent("download", { timeout: 10_000 });
        await page.locator("#player-capture").click();
        const dl = await downloadPromise;
        expect(dl.suggestedFilename()).toMatch(/\.(jpe?g|png)$/i);
    });

    test("tile click swaps the audio source", async ({ page }) => {
        const rearTile = page.locator('.video-tile[data-channel="rear"]');
        await expect(rearTile).toBeVisible();
        await rearTile.click();
        await expect(page.locator(".top-panel__audio-select")).toHaveValue("rear");
        await shot(page, "player-02-audio-swap");
    });

    test("dragging a tile by its grip inserts it into the drop slot", async ({ page }) => {
        const front = page.locator('.video-tile[data-channel="front"]');
        const rear = page.locator('.video-tile[data-channel="rear"]');
        const interior = page.locator('.video-tile[data-channel="interior"]');
        await expect(front).toHaveAttribute("data-slot", "0");
        await expect(rear).toHaveAttribute("data-slot", "1");
        await expect(interior).toHaveAttribute("data-slot", "2");

        const handle = await boxOf(page, '.video-tile[data-channel="front"] .tile-drag-handle');
        const target = await boxOf(page, '.video-tile[data-channel="interior"]');
        await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
        await page.mouse.down();
        // Two hops so the ghost + placeholder appear mid-gesture.
        await page.mouse.move(handle.x + 40, handle.y + 40, { steps: 4 });
        await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 8 });
        await expect(page.locator(".tile-drag-ghost")).toBeVisible();
        await expect(page.locator('.video-tile[data-channel="interior"] .tile-drop-placeholder')).toBeVisible();
        await shot(page, "player-03-tile-reorder");
        await page.mouse.up();

        // Insert (not swap): rear -> primary, interior -> slot 1, front -> slot 2.
        await expect(rear).toHaveAttribute("data-slot", "0");
        await expect(interior).toHaveAttribute("data-slot", "1");
        await expect(front).toHaveAttribute("data-slot", "2");
        await expect(page.locator(".tile-drag-ghost")).toHaveCount(0);
        await expect(page.locator(".tile-drop-placeholder")).toHaveCount(0);
    });

    test("dragging a top-panel chip reorders channels", async ({ page }) => {
        const chips = page.locator(".top-panel__channel-chip");
        await expect(chips).toHaveCount(3);
        const firstCh = await chips.first().getAttribute("data-channel");

        const front = await boxOf(page, '.top-panel__channel-chip[data-channel="front"]');
        const interior = await boxOf(page, '.top-panel__channel-chip[data-channel="interior"]');
        await page.mouse.move(front.x + front.width / 2, front.y + front.height / 2);
        await page.mouse.down();
        await page.mouse.move(front.x + front.width / 2 + 8, front.y + front.height / 2, { steps: 3 });
        await page.mouse.move(interior.x + interior.width / 2, interior.y + interior.height / 2, { steps: 8 });
        await expect(page.locator(".chip-drag-ghost")).toBeVisible();
        await expect(page.locator('.top-panel__channel-chip[data-channel="interior"]')).toHaveClass(/drop-before/);
        await page.mouse.up();

        await expect(chips.first()).not.toHaveAttribute("data-channel", firstCh ?? "");
        await expect(page.locator(".chip-drag-ghost")).toHaveCount(0);
    });

    test("mini-map drag moves it and persists the position", async ({ page }) => {
        // The widget is anchored to its frame's top-left and its drag offset is
        // clamped to 0..range, so how far it CAN travel depends on the frame the
        // current layout gives it. Measure the room that is actually there and
        // drag into it - a fixed pixel delta silently gets eaten by the clamp
        // (dragging left from the anchor moves nothing at all) and the assertion
        // then reads as a product bug instead of a miscalibrated gesture.
        const room = await page.evaluate((padPx) => {
            const mini = document.querySelector<HTMLElement>(".mini-map");
            const frame = mini?.parentElement;
            if (!mini || !frame) return null;
            const m = mini.getBoundingClientRect();
            const f = frame.getBoundingClientRect();
            return { right: f.right - padPx - m.right, down: f.bottom - padPx - m.bottom };
        }, MINIMAP_FRAME_PADDING_PX);
        expect(room, ".mini-map must be mounted inside a frame").not.toBeNull();

        // Down-right is the direction with headroom. Cap the request by the room
        // so the expected delta is exactly what the clamp will allow.
        const dx = Math.max(0, Math.min(120, Math.floor(room?.right ?? 0)));
        const dy = Math.max(0, Math.min(80, Math.floor(room?.down ?? 0)));
        expect(dx + dy, "the layout must leave room to drag the mini-map into").toBeGreaterThan(
            MINIMAP_DRAG_THRESHOLD_PX,
        );

        const before = await boxOf(page, ".mini-map");
        const grabX = before.x + before.width / 2;
        const grabY = before.y + before.height / 2;
        await page.mouse.move(grabX, grabY);
        await page.mouse.down();
        await page.mouse.move(grabX + dx, grabY + dy, { steps: 10 });
        await page.mouse.up();

        // Position persisted to localStorage (survives reload) AND the widget
        // actually followed the pointer.
        const persisted = await page.evaluate(() => localStorage.getItem("dashcamigo:minimap-pos"));
        expect(persisted, "mini-map position must be persisted after a drag").not.toBeNull();
        const after = await boxOf(page, ".mini-map");
        // Subpixel layout only, so a couple of px of slack - not a "did it move
        // at all" threshold: the widget must land where the pointer left it.
        expect(Math.abs(after.x - before.x - dx), "mini-map must follow the pointer horizontally").toBeLessThanOrEqual(
            2,
        );
        expect(Math.abs(after.y - before.y - dy), "mini-map must follow the pointer vertically").toBeLessThanOrEqual(2);
        await shot(page, "player-04-minimap-moved");
    });

    test("chase is the default follow mode: expanding the big map tilts it", async ({ page }) => {
        const pitch = () =>
            page.evaluate(() => {
                const w = window as unknown as { __dashcamigo?: { state?: { map?: { getPitch?: () => number } } } };
                return w.__dashcamigo?.state?.map?.getPitch?.() ?? 0;
            });
        // Chase is the default. Expanding the big map (the follow control lives
        // there) engages it: the camera tilts and the chase sub-controls show.
        await page.locator(".mini-map").click();
        const chaseBtn = page.locator('.map-follow-seg[data-follow-mode="chase"]');
        await expect(chaseBtn).toBeVisible();
        await expect(chaseBtn).toHaveAttribute("aria-pressed", "true");
        await expect(page.locator("#map-chase-controls")).toBeVisible();
        await expect.poll(pitch).toBeGreaterThan(20);
        await shot(page, "player-09-chase-mode");

        // Switching to plain follow un-tilts back to flat and hides the controls.
        await page.locator('.map-follow-seg[data-follow-mode="follow"]').click();
        await expect(page.locator("#map-chase-controls")).toBeHidden();
        await expect.poll(pitch).toBeLessThan(2);

        // Re-selecting chase re-tilts and re-reveals the controls.
        await chaseBtn.click();
        await expect(page.locator("#map-chase-controls")).toBeVisible();
        await expect.poll(pitch).toBeGreaterThan(20);
    });

    test("manual zoom on the chase map keeps speed-adaptive zoom on", async ({ page }) => {
        await page.locator(".mini-map").click(); // expand -> chase (default) engaged
        const adaptive = page.locator("#map-chase-adaptive");
        await expect(adaptive).toBeVisible();
        await expect(adaptive).toHaveAttribute("aria-pressed", "true"); // default on
        // A user wheel-zoom now only pauses auto-follow for the grace window; it
        // must NOT disable adaptive zoom (which re-applies on resume). The toggle
        // stays the user's deliberate switch, untouched by a stray gesture.
        const map = await boxOf(page, "#map");
        await page.mouse.move(map.x + map.width / 2, map.y + map.height / 2);
        await page.mouse.wheel(0, -240);
        await expect(adaptive).toHaveAttribute("aria-pressed", "true");
        // The explicit toggle still works.
        await adaptive.click();
        await expect(adaptive).toHaveAttribute("aria-pressed", "false");
    });

    test("chart hover shows the hover cursor", async ({ page }) => {
        const chart = await boxOf(page, "#player-chart-canvas");
        // Two moves near the top edge (clear of the strip overlay below) so the
        // rAF-throttled mousemove handler sees a transition.
        await page.mouse.move(chart.x + 30, chart.y + 5);
        await page.mouse.move(chart.x + 60, chart.y + 20);
        await expect(page.locator("#player-chart-hover-cursor")).not.toHaveAttribute("hidden", "");
        await shot(page, "player-05-chart-hover");
    });

    test("chart wheel-zoom re-anchors the playhead", async ({ page }) => {
        // Seek to mid-trip so the playhead sits away from the left edge (a t=0
        // playhead could map to the same edge pixel after zoom).
        const bar = await boxOf(page, "#player-mini-progress");
        await page.mouse.click(bar.x + bar.width * 0.5, bar.y + bar.height / 2);
        const playhead = page.locator("#player-chart-playhead");
        const before = await playhead.evaluate((el) => (el as HTMLElement).style.left);
        expect(before, "playhead must have a position before zoom").not.toBe("");

        const chart = await boxOf(page, "#player-chart");
        await page.mouse.move(chart.x + chart.width * 0.78, chart.y + chart.height * 0.4);
        for (let i = 0; i < 4; i++) {
            await page.mouse.wheel(0, -200);
        }
        await expect.poll(() => playhead.evaluate((el) => (el as HTMLElement).style.left)).not.toBe(before);
    });

    test("sidebar collapse button hides the trip list and the edge tab restores it", async ({ page }) => {
        const sidebar = page.locator(".sidebar").first();
        await expect(sidebar).toBeVisible();
        await page.locator("#sidebar-collapse").click();
        await expect(sidebar, "list leaves the layout").toBeHidden();
        const tab = page.locator("#sidebar-expand");
        await expect(tab, "edge tab is the way back").toBeVisible();
        // The viewer must take over the freed column, not slide into the
        // 0-width sidebar track (which rendered the whole area black when
        // the hidden boxes left the grid flow).
        const viewport = page.viewportSize();
        const video = await page.locator("#video-grid").boundingBox();
        expect(video?.width ?? 0, "player keeps a real width").toBeGreaterThan((viewport?.width ?? 0) * 0.5);
        // Session-only by design: a fresh page must show the list again (it is
        // the only way to pick a trip). Asserted as "nothing about collapsing
        // was written", not as one guessed key name - a persistence attempt
        // under any other name has to fail this too.
        const persisted = await page.evaluate(() => Object.keys(localStorage).filter((k) => /collaps/i.test(k)));
        expect(persisted, "no localStorage key about collapsing may be written").toEqual([]);
        await tab.click();
        await expect(sidebar).toBeVisible();
        await expect(tab).toBeHidden();
    });

    test("map divider drag resizes the expanded map pane", async ({ page }) => {
        await page.locator("#mini-map").click();
        await expect(page.locator("#player-wrap")).toHaveClass(/map-expanded/);
        const before = await page.locator("#map").boundingBox();
        expect(before, "map pane must be laid out").not.toBeNull();

        const divider = await boxOf(page, "#video-map-resize");
        const y = divider.y + divider.height / 2;
        await page.mouse.move(divider.x + divider.width / 2, y);
        await page.mouse.down();
        await page.mouse.move(divider.x - 120, y, { steps: 5 });
        await page.mouse.up();

        const after = await page.locator("#map").boundingBox();
        expect((after?.width ?? 0) - (before?.width ?? 0), "map grows by roughly the drag distance").toBeGreaterThan(
            80,
        );
        // The bar loses the map column's width in this layout; buttons must
        // shed into the overflow menu instead of squishing (flex-shrink: 0).
        const play = await boxOf(page, "#player-play");
        expect(play.width, "transport keeps its size in the narrowed bar").toBeGreaterThanOrEqual(38);
        await page.locator("#map-collapse").click();
        await expect(page.locator("#player-wrap")).not.toHaveClass(/map-expanded/);
    });

    test("fullscreen: mini-map click expands the map into a visible split", async ({ page }) => {
        await page.locator("#player-fullscreen").click();
        await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(true);

        // Desktop expand entry is the mini-map circle. In fullscreen it must
        // reveal the big map pane (video | map split), not leave both maps
        // invisible until fullscreen exit.
        await page.locator("#mini-map").click();
        await expect(page.locator("#player-wrap")).toHaveClass(/map-expanded/);
        const mapBox = await page.locator("#map").boundingBox();
        expect(mapBox, "big map pane must be laid out").not.toBeNull();
        expect(mapBox?.width ?? 0, "map pane occupies a real column").toBeGreaterThan(200);
        // The video keeps the remaining width instead of the 100vw overlay size.
        const videoBox = await page.locator("#video-grid").boundingBox();
        const viewport = page.viewportSize();
        expect((videoBox?.width ?? 0) + (mapBox?.width ?? 0), "split shares the screen").toBeLessThanOrEqual(
            (viewport?.width ?? 0) + 8,
        );

        // The chart/bar overlays are confined to the video column, so the
        // map's lower band keeps taking pointer input while the controls are
        // visible (mousemove keeps them visible whenever the cursor lives on
        // the map, so a full-width overlay would permanently shadow it).
        const probeX = (mapBox?.x ?? 0) + (mapBox?.width ?? 0) / 2;
        const probeY = (mapBox?.y ?? 0) + (mapBox?.height ?? 0) - 20;
        await page.mouse.move(probeX, probeY);
        await expect(page.locator("#player-wrap")).toHaveClass(/controls-visible/);
        const hitsMap = await page.evaluate(
            ([x, y]) => !!document.elementFromPoint(x ?? 0, y ?? 0)?.closest(".map-wrap"),
            [probeX, probeY],
        );
        expect(hitsMap, "map bottom stays clickable under visible controls").toBe(true);

        // The map's collapse X returns to the video-only fullscreen layout.
        await page.locator("#map-collapse").click();
        await expect(page.locator("#player-wrap")).not.toHaveClass(/map-expanded/);
        await expect.poll(() => page.evaluate(() => !!document.fullscreenElement), "still fullscreen").toBe(true);

        await page.evaluate(() => document.exitFullscreen());
        await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(false);
    });

    test("chart drag-select zooms to the selected span", async ({ page }) => {
        const chart = await boxOf(page, "#player-chart-canvas");
        const y = chart.y + chart.height * 0.4;
        // Drag from ~30% to ~70% of the plot. Multiple intermediate moves so the
        // 5px threshold trips and the selection rectangle path runs.
        await page.mouse.move(chart.x + chart.width * 0.3, y);
        await page.mouse.down();
        await page.mouse.move(chart.x + chart.width * 0.45, y, { steps: 4 });
        await expect(page.locator(".chart-drag-select"), "selection rect appears mid-drag").toBeVisible();
        await page.mouse.move(chart.x + chart.width * 0.7, y, { steps: 4 });
        await page.mouse.up();

        const zoomState = await page.evaluate(() => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const st = (window as any).__dashcamigo.state;
            return {
                zoomed: st.chartZoomed,
                preview: st.isPreviewZoom,
                windowMin: st.chart.scales.x.min as number,
                windowMax: st.chart.scales.x.max as number,
            };
        });
        expect(zoomState.zoomed, "drag-select must zoom the timeline").toBe(true);
        expect(zoomState.preview, "drag-select is inspection, not a preview").toBe(false);
        // The window matches the dragged span, not the full trip.
        expect(zoomState.windowMin).toBeGreaterThan(0);
        expect(zoomState.windowMax).toBeLessThan(4);
        expect(zoomState.windowMax).toBeGreaterThan(zoomState.windowMin);
        // The selection rectangle is gone after release.
        await expect(page.locator(".chart-drag-select")).toHaveCount(0);

        // Double-click resets back to the full view (existing gesture).
        await page.mouse.dblclick(chart.x + chart.width * 0.5, y);
        await expect
            .poll(() =>
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                page.evaluate(() => (window as any).__dashcamigo.state.chartZoomed),
            )
            .toBe(false);
    });

    test("inspection zoom does not clamp seeks to the window", async ({ page }) => {
        // A wheel/keyboard zoom is inspection, not a bounded Preview-clip window:
        // seeks must roam the whole trip (isPreviewZoom stays false). Regression
        // for the old "any zoom traps playback in its window" behavior.
        const play = page.locator("#player-play");
        if ((await play.getAttribute("data-paused")) === "false") await play.click();
        await expect(play).toHaveAttribute("data-paused", "true");

        const chart = await boxOf(page, "#player-chart");
        await page.mouse.move(chart.x + chart.width * 0.2, chart.y + chart.height * 0.4);
        for (let i = 0; i < 4; i++) await page.mouse.wheel(0, -200);

        const zoomState = await page.evaluate(() => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const st = (window as any).__dashcamigo.state;
            return { zoomed: st.chartZoomed, preview: st.isPreviewZoom, windowMax: st.chart.scales.x.max as number };
        });
        expect(zoomState.zoomed, "the wheel must have zoomed the timeline").toBe(true);
        expect(zoomState.preview, "a wheel zoom is inspection, not a preview").toBe(false);
        // The window ends before the trip end, so a 90%-of-trip seek overshoots it.
        expect(zoomState.windowMax).toBeLessThan(3);

        // Digit "9" jumps to 90% of the TRIP (~3.6s) - a trip-time seek past the
        // window edge (the mini-progress scrubber is window-mapped and can't reach
        // past it, so it cannot exercise the clamp). Inspection lets it land there;
        // a preview window would clamp it back. Paused, so this is the seek alone,
        // not playback drifting past the edge.
        await page.keyboard.press("9");
        const current = page.locator("#player-current");
        await expect
            .poll(() =>
                current.evaluate((el) =>
                    Number((el.textContent ?? "0:0").split(":").reduce((a, p) => a * 60 + Number(p), 0)),
                ),
            )
            .toBeGreaterThan(zoomState.windowMax);
    });

    test("inspection zoom playback crosses the window edge instead of stopping", async ({ page }) => {
        // The core fix: playing inside an inspection zoom must NOT stop/loop at the
        // window's right edge (that behavior is reserved for a Preview-clip window).
        const parseClock = (s: string): number => s.split(":").reduce((a, p) => a * 60 + Number(p), 0);
        const chart = await boxOf(page, "#player-chart");
        await page.mouse.move(chart.x + chart.width * 0.2, chart.y + chart.height * 0.4);
        for (let i = 0; i < 4; i++) await page.mouse.wheel(0, -200);
        const windowMax = await page.evaluate(() => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const st = (window as any).__dashcamigo.state;
            return st.chartZoomed && !st.isPreviewZoom ? (st.chart.scales.x.max as number) : Number.NaN;
        });
        expect(windowMax, "must be a live inspection zoom below the trip end").toBeGreaterThan(0);
        expect(windowMax).toBeLessThan(3);

        // Seek just inside the window, then play. A grace window pauses auto-follow
        // right after the wheel gesture, but inspection playback is unbounded
        // regardless, so the playhead runs straight past the (frozen) window edge.
        const bar = await boxOf(page, "#player-mini-progress");
        const seekFrac = Math.max(0.02, (windowMax - 0.4) / 4);
        await page.mouse.click(bar.x + bar.width * seekFrac, bar.y + bar.height / 2);
        const play = page.locator("#player-play");
        if ((await play.getAttribute("data-paused")) === "true") await play.click();
        await expect(play).toHaveAttribute("data-paused", "false");

        const current = page.locator("#player-current");
        await expect
            .poll(async () => parseClock((await current.textContent())?.trim() ?? "0:00"), { timeout: 6000 })
            .toBeGreaterThan(windowMax);
    });

    test("playhead re-anchors when the chart resizes while paused", async ({ page }) => {
        // Regression for "the export player puts the current position in the
        // wrong place": the playhead is positioned in absolute px
        // (frac * chart width). Entering export-mode resizes the chart (sidebar
        // vacates, the panel reserves margin) AND pauses playback, so no
        // timeupdate refreshes the px - a stale playhead freezes at the old
        // width, mispositioned by an amount proportional to how far into the
        // trip we are (invisible at t=0, off everywhere else). The chart
        // ResizeObserver must re-anchor it. Driven here through a large viewport
        // resize - the same resize-while-paused code path export-mode hits, with
        // an unambiguous width delta that a stale px cannot survive.
        const play = page.locator("#player-play");
        if ((await play.getAttribute("data-paused")) !== "true") await play.click();
        await expect(play).toHaveAttribute("data-paused", "true");

        // Seek well past the start so a frozen playhead is clearly off.
        const bar = await boxOf(page, "#player-mini-progress");
        await page.mouse.click(bar.x + bar.width * 0.7, bar.y + bar.height / 2);
        await page.waitForTimeout(800); // let the (possibly async cross-file) seek LAND

        const playhead = page.locator("#player-chart-playhead");
        // playerChartEl.clientWidth is exactly the basis setPlayerCursorRelSec
        // multiplies by, so left/clientWidth recovers the trip-time fraction.
        // It is invariant under resize for a fixed playback position (the zoom
        // window is unchanged), bar a tiny Y-axis-gutter shift.
        const playheadFraction = async (): Promise<number> => {
            const left = await playhead.evaluate((el) => Number.parseFloat((el as HTMLElement).style.left));
            const width = await page.locator("#player-chart").evaluate((el) => (el as HTMLElement).clientWidth);
            expect(width, "chart must have a width").toBeGreaterThan(0);
            return left / width;
        };
        const before = await playheadFraction();
        expect(before, "playhead must sit away from the left edge to expose drift").toBeGreaterThan(0.4);

        const chartWidthBefore = await page.locator("#player-chart").evaluate((el) => (el as HTMLElement).clientWidth);
        await page.setViewportSize({ width: 900, height: 900 });
        // Wait for the chart to actually shrink, otherwise the assertion below
        // could pass trivially on a no-op resize (silent green).
        await expect
            .poll(() => page.locator("#player-chart").evaluate((el) => (el as HTMLElement).clientWidth))
            .not.toBe(chartWidthBefore);

        // Re-anchored: same trip-time fraction (bar the gutter wobble). Without
        // the fix the playhead px is frozen at the old width and the fraction
        // drifts far past this tolerance on a shrink this big - and, since the
        // seek has already landed and playback is paused, nothing ever heals it
        // (exactly the export-mode report). The poll only covers the fix's own
        // async settle (the ResizeObserver fires a frame after Chart.js resizes).
        await expect.poll(playheadFraction, { timeout: 4000 }).toBeCloseTo(before, 1);
    });

    test("timeline click seeks even when the chart canvas is hidden", async ({ page }) => {
        // Hide chart + strip -> the canvas is display:none, exactly the no-GPS
        // layout. Clicking the ruler must still seek (shared handler, not the
        // dead plot area).
        await page.locator("#player-view-menu").click();
        await page.locator('.view-menu-row[data-panel="chart"]').click();
        await page.locator('.view-menu-row[data-panel="strip"]').click();
        await page.locator("body").click(); // close popover
        await expect(page.locator("#player-chart-canvas")).toBeHidden();

        const current = page.locator("#player-current");
        const before = (await current.textContent())?.trim();
        const ruler = await boxOf(page, "#player-chart-ruler-top");
        await page.mouse.click(ruler.x + ruler.width * 0.7, ruler.y + ruler.height / 2);
        await expect(current).not.toHaveText(before ?? "");
        await expect(current).not.toHaveText("0:00");
    });

    test("the readout row carries the GPS values and copies the coordinates", async ({ page }) => {
        const row = page.locator("#player-readout");
        await expect(row).toBeVisible();
        // Speed left the bar for the row - the bar's copy is the mobile one.
        await expect(page.locator("#player-metrics")).toBeHidden();
        await expect(page.locator("#pm-coords")).toHaveText(/-?\d+\.\d{4}, -?\d+\.\d{4}/);
        await expect(page.locator("#pm-time")).toHaveText(/\d{2}:\d{2}:\d{2}/);
        await expect(page.locator("#readout-fix-label")).toHaveText("GPS signal");
        // The clip name is what you need before going looking for the file.
        await expect(page.locator("#readout-file")).toHaveText(/\.(mp4|mov|ts)$/i);

        await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
        const shown = (await page.locator("#pm-coords").textContent())?.trim();
        await page.locator("#pm-coords").click();
        const copied = await page.evaluate(() => navigator.clipboard.readText());
        expect(copied, "the clipboard must carry exactly what the row showed").toBe(shown);
    });

    test("the View menu collapses the readout row and G toggles it back", async ({ page }) => {
        const row = page.locator("#player-readout");
        const frameHeight = async (): Promise<number> => (await boxOf(page, ".video-frame")).height;
        const withRow = await frameHeight();

        await page.locator("#player-view-menu").click();
        await page.locator('.view-menu-row[data-panel="readout"]').click();
        await page.locator("body").click(); // close popover
        await expect(row).toBeHidden();
        // The row's grid track is `auto`, so hiding it hands the height back to
        // the video rather than leaving a gap.
        expect(await frameHeight(), "hiding the row must give the video its pixels back").toBeGreaterThan(withRow);

        await page.keyboard.press("g");
        await expect(row).toBeVisible();
    });

    test("hotkeys modal opens with '?'", async ({ page }) => {
        await page.keyboard.press("?");
        await expect(page.locator("#hotkeys-modal")).toBeVisible();
        await shot(page, "player-06-hotkeys-modal");
    });

    test("global letter hotkeys are inert while a modal is open", async ({ page }) => {
        const inExportMode = () => page.evaluate(() => document.body.classList.contains("export-mode"));
        expect(await inExportMode(), "trip loads outside export-mode").toBe(false);

        await page.keyboard.press("?");
        const modal = page.locator("#hotkeys-modal");
        await expect(modal).toBeVisible();

        // "e" must NOT leak to toggleExportMode while the modal owns the keyboard.
        await page.keyboard.press("e");
        expect(await inExportMode(), "E must not toggle export-mode under a modal").toBe(false);
        await expect(modal).toBeVisible();

        // Close it; the same hotkey now works - the gate is "a modal is open",
        // not a blanket disable.
        await page.keyboard.press("Escape");
        await expect(modal).toBeHidden();
        await page.keyboard.press("e");
        await expect.poll(() => inExportMode()).toBe(true);
    });

    test("settings: switching units updates the speed unit label", async ({ page }) => {
        await page.locator("#settings-btn").click();
        await expect(page.locator("#settings-modal")).toBeVisible();
        const sel = page.locator("#settings-units-select");
        const before = await sel.inputValue();
        const target = before === "metric" ? "imperial" : "metric";
        await sel.selectOption(target);
        await page.locator("#settings-modal-close").click();
        const unit = page.locator("#pm-unit");
        if (target === "metric") await expect(unit).toHaveText(/kph|km/i);
        else await expect(unit).toHaveText(/mph|mi/i);
        await shot(page, "player-07-units");
    });
});
