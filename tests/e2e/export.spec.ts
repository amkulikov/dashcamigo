// Export mode: range selection, output presets, crop editor, watermark/overlays
// and channel composition - the most regression-prone surface in the app. Uses
// boxOf() (asserts presence, returns a non-null box) for element geometry.

import { readFile } from "node:fs/promises";

import {
    DESKTOP,
    SAMPLE_70MAI,
    boxOf,
    expect,
    gotoApp,
    loadTrip,
    openExport,
    presetLocalStorage,
    shot,
    test,
} from "./_fixtures.js";

// Timecode helpers for the range-input assertions, mirroring src/ui/format.ts
// formatTime (default, unpadded minutes): "m:ss" under an hour, "h:mm:ss" above.
function parseClock(s: string): number {
    return s
        .trim()
        .split(":")
        .reduce((acc, part) => acc * 60 + Number(part), 0);
}
function formatClock(totalSec: number): string {
    const total = Math.floor(totalSec);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const pad = (n: number): string => String(n).padStart(2, "0");
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

test.describe("export", () => {
    test.beforeEach(async ({ page }) => {
        await presetLocalStorage(page);
        await page.setViewportSize(DESKTOP);
        await gotoApp(page, "en");
        await loadTrip(page, SAMPLE_70MAI);
        await openExport(page);
    });

    test("panel opens with audio + GPS included", async ({ page }) => {
        await expect(page.locator("#export-panel-audio")).toBeChecked();
        await expect(page.locator("#export-panel-gpmf")).toBeChecked();
        await shot(page, "export-01-default");
    });

    test("app-mode language switch confirms before reload, cancel keeps state, confirm navigates", async ({ page }) => {
        // A trip is loaded (app mode), so switching language is a full reload
        // that discards the loaded recordings - the switcher confirms first via
        // a modal instead of a live in-place swap. No dictionary swap happens
        // until navigation: only the active locale ships on the page.
        const save = page.locator("#export-panel-save-btn");
        await expect(save).toHaveText("Save");

        // The lang menu opens from the topbar; it must sit above the export
        // drawer (z-index) or this click would be intercepted by the panel.
        await page.locator("#lang-toggle").click();
        await expect(page.locator("#lang-menu")).toBeVisible();
        await page.locator('#lang-menu [data-lang="ru"]').click();

        // Confirm modal appears; nothing has changed yet.
        const modal = page.locator("#switch-lang-modal");
        await expect(modal).toBeVisible();
        await expect(save).toHaveText("Save");

        // Cancel keeps the session intact: modal closes, still on /en/, English.
        await page.locator("#switch-lang-modal-cancel").click();
        await expect(modal).toBeHidden();
        await expect(page).toHaveURL(/\/en\//);
        await expect(save).toHaveText("Save");

        // Reopen and confirm: full navigation to the prerendered /ru/ page.
        await page.locator("#lang-toggle").click();
        await page.locator('#lang-menu [data-lang="ru"]').click();
        await expect(modal).toBeVisible();
        await page.locator("#switch-lang-modal-confirm").click();
        await page.waitForURL(/\/ru\//);
        // The freshly loaded /ru/ page carries the Russian dictionary (baked into
        // its HTML island); the document lang attribute reflects the switch.
        await expect(page.locator("html")).toHaveAttribute("lang", "ru");
    });

    test("speed-up 8x forces re-encode: audio disabled + dropped, result length shown", async ({ page }) => {
        const seg8 = page.locator('.export-panel__seg-btn[data-factor="8"]');
        await seg8.click();
        await expect(seg8).toHaveClass(/active/);
        // Audio is force-dropped at >1x: the positive option clears and disables.
        await expect(page.locator("#export-panel-audio")).toBeDisabled();
        await expect(page.locator("#export-panel-audio")).not.toBeChecked();
        await expect(page.locator(".export-panel__speed-result")).toBeVisible();
        await shot(page, "export-02-speed-8x");
    });

    test("custom output exposes width/height inputs", async ({ page }) => {
        await page.locator("#export-panel-output").selectOption("custom");
        await expect(page.locator("#export-panel-output")).toHaveValue("custom");
        // Custom mode reveals the W × H number inputs (built once, toggled by preset).
        await expect(page.locator('.export-panel__output-custom input[type="number"]')).toHaveCount(2);
        await expect(page.locator('.export-panel__output-custom input[type="number"]').first()).toBeVisible();
        await shot(page, "export-03-custom");
    });

    test("top quality tier relabels Original <-> High as the config forces a re-encode", async ({ page }) => {
        // The top tier is a single radio whose wording reflects what the export
        // will actually do: "Original" when it copies the source untouched
        // (lossless), "High" when a multi-camera layout / resize / overlay forces
        // a rebuild. The sample loads multichannel, so the default (3 cameras)
        // already forces a re-encode.
        const topTier = page.locator('.export-panel__radio:has(input[value="original"]) strong');
        await expect(topTier).toHaveText("High");
        // Reduce to a single camera (output=source by default) -> lossless again.
        const includes = page.locator(".top-panel__channel-include");
        await includes.nth(2).click();
        await includes.nth(1).click();
        await expect(page.locator(".top-panel__channel-include:checked")).toHaveCount(1);
        await expect(topTier).toHaveText("Original");
        // Resizing the output away from source forces a re-encode again.
        await page.locator("#export-panel-output").selectOption("720_16x9");
        await expect(topTier).toHaveText("High");
        await shot(page, "export-03b-quality-tier-relabel");
    });

    test("a manual bitrate takes over from the quality tiers and reverts on an empty field", async ({ page }) => {
        const manual = page.locator("#export-panel-bitrate");
        const topRadio = page.locator('.export-panel__radio input[value="original"]');
        // Folded away by default - the tiers are the answer for almost everyone.
        await expect(manual).toBeHidden();
        await expect(topRadio).toBeEnabled();

        await page.locator(".export-panel__manual-bitrate > summary").click();
        await expect(manual).toBeVisible();
        // Empty means auto, so opening the block alone changes nothing.
        await expect(topRadio).toBeEnabled();
        // The source's own rate is the reference for picking a number.
        await expect(page.locator(".export-panel__manual-bitrate .export-panel__note").first()).toBeVisible();

        // 2 Mbit/s sits well under this sample's automatic budget and under any
        // device encode ceiling, so the estimate has to visibly shrink - which is
        // what proves the field reaches the real bitrate resolver.
        const size = page.locator(".export-panel__estimate-size");
        const autoSize = await size.textContent();
        await manual.fill("2");
        await manual.blur();
        await expect(size).not.toHaveText(autoSize ?? "");
        // The override wins over the tiers, and the panel says so rather than
        // leaving two controls both claiming to set quality.
        await expect(topRadio).toBeDisabled();
        await expect(page.locator('.export-panel__radio:has(input[value="original"])')).toHaveClass(/is-disabled/);
        await shot(page, "export-03c-manual-bitrate");

        await manual.fill("");
        await manual.blur();
        await expect(topRadio).toBeEnabled();
        await expect(size).toHaveText(autoSize ?? "");
    });

    test("an out-of-range manual bitrate is clamped rather than accepted", async ({ page }) => {
        await page.locator(".export-panel__manual-bitrate > summary").click();
        const manual = page.locator("#export-panel-bitrate");
        await manual.fill("99999");
        await manual.blur();
        await expect(manual).toHaveValue("400");
        await manual.fill("0");
        await manual.blur();
        // Zero is not a bitrate - it reads as "no override" and clears the field.
        await expect(manual).toHaveValue("");
    });

    test("vertical 9:16 preset paints the export-frame ring", async ({ page }) => {
        await page.locator("#export-panel-output").selectOption("1080_9x16");
        // The ::after ring on the grid marks the baked output boundary.
        const ring = await page.locator("#video-grid").evaluate((el) => {
            const s = getComputedStyle(el, "::after");
            return { width: s.borderTopWidth, style: s.borderTopStyle };
        });
        expect(ring.width).toBe("2px");
        expect(ring.style).toBe("solid");
        await shot(page, "export-04-vertical");
    });

    test("range end pull-tab drag shrinks the selection", async ({ page }) => {
        const tab = page.locator(".timeline-range__tab--end");
        const before = await boxOf(page, ".timeline-range__tab--end");
        await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
        await page.mouse.down();
        await page.mouse.move(before.x - 120, before.y + before.height / 2, { steps: 8 });
        await page.mouse.up();
        // The tab actually moved left (range narrowed).
        await expect.poll(async () => (await tab.boundingBox())?.x ?? before.x).toBeLessThan(before.x - 40);
        await shot(page, "export-05-range-drag");
    });

    test("typing start/end times moves the range and the tabs follow", async ({ page }) => {
        const startInput = page.locator('.export-trim-bar__input[data-range-edge="start"]');
        const endInput = page.locator('.export-trim-bar__input[data-range-edge="end"]');
        const startTab = page.locator(".timeline-range__tab--start");
        const endTab = page.locator(".timeline-range__tab--end");
        const host = await boxOf(page, "#player-chart");

        // The end input opens at the full trip length; derive interior targets as
        // thirds so the assertions hold regardless of the exact sample duration
        // (the fixture is only a few seconds long, so fixed offsets would collapse
        // against MIN_RANGE_SEC).
        const full = parseClock(await endInput.inputValue());
        expect(full, "the sample must be long enough to trim").toBeGreaterThan(2);
        const startSec = Math.round(full / 3);
        const endSec = Math.round((full * 2) / 3);

        // Plain-seconds form (parser accepts it); commit with Enter. The start tab
        // slides in from the left edge to roughly a third across.
        await startInput.fill(String(startSec));
        await startInput.press("Enter");
        await expect
            .poll(async () => (await startTab.boundingBox())?.x ?? 0)
            .toBeGreaterThan(host.x + host.width * 0.15);
        // The commit is routed through the shared clamp + notify, so the input
        // reflects the normalized (formatTime) value, not the raw digits typed.
        await expect(startInput).not.toHaveValue(String(startSec));

        // Typing an earlier end pulls the end tab left of the right edge.
        await endInput.fill(String(endSec));
        await endInput.press("Enter");
        await expect
            .poll(async () => (await endTab.boundingBox())?.x ?? host.x + host.width)
            .toBeLessThan(host.x + host.width * 0.85);

        // Out-of-range text is valid input that clamps, not a revert: an absurd end
        // snaps back to the full trip length.
        await endInput.fill("99:59:59");
        await endInput.press("Enter");
        await expect(endInput).toHaveValue(formatClock(full));
        await shot(page, "export-05b-range-typed");
    });

    test("dragging a tab updates the numeric range inputs", async ({ page }) => {
        const endInput = page.locator('.export-trim-bar__input[data-range-edge="end"]');
        const before = await endInput.inputValue();
        const box = await boxOf(page, ".timeline-range__tab--end");
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        await page.mouse.move(box.x - 120, box.y + box.height / 2, { steps: 8 });
        await page.mouse.up();
        // The end field (not focused during the drag) follows the tab down.
        await expect.poll(() => endInput.inputValue()).not.toBe(before);
        expect(parseClock(await endInput.inputValue())).toBeLessThan(parseClock(before));
    });

    test("invalid range input reverts to the current value", async ({ page }) => {
        const startInput = page.locator('.export-trim-bar__input[data-range-edge="start"]');
        const startTab = page.locator(".timeline-range__tab--start");
        // Move the edge OFF its opening value of 0:00 first: a broken revert path
        // (NaN/0 flowing into the range) also renders as "0:00", so asserting
        // against the untouched baseline could never fail. A committed non-zero
        // start makes corruption visibly different from a correct revert.
        const host = await boxOf(page, "#player-chart");
        await startInput.fill("0:02");
        await startInput.press("Enter");
        await expect(startInput).toHaveValue("0:02");
        // 2s of the ~4s fixture puts the tab near mid-chart; anything left of
        // 20% across means the committed start never reached the tab.
        await expect
            .poll(async () => (await startTab.boundingBox())?.x ?? 0)
            .toBeGreaterThan(host.x + host.width * 0.2);
        const tabX = (await startTab.boundingBox())?.x ?? 0;
        // Unparseable text on Enter -> revert, no dialog, range untouched - but
        // no longer silent: the feedback line names the accepted format.
        await startInput.fill("garbage");
        await startInput.press("Enter");
        await expect(startInput).toHaveValue("0:02");
        await expect(page.locator(".export-trim-bar__feedback")).toHaveText(/1:23/);
        await expect(startInput).toHaveAttribute("aria-invalid", "true");
        // Same on blur.
        await startInput.fill("1:2:3:4");
        await startInput.blur();
        await expect(startInput).toHaveValue("0:02");
        // The range state (tab position), not just the input text, stayed put
        // (4px = the suite's geometry-equality tolerance).
        expect(Math.abs(((await startTab.boundingBox())?.x ?? 0) - tabX)).toBeLessThan(4);
        // A later valid commit clears the invalid marker.
        await startInput.fill("0:01");
        await startInput.press("Enter");
        await expect(startInput).not.toHaveAttribute("aria-invalid", "true");
    });

    test("I / O hotkeys set the clip edges at the playhead", async ({ page }) => {
        const startTab = page.locator(".timeline-range__tab--start");
        const endTab = page.locator(".timeline-range__tab--end");
        const startInput = page.locator('.export-trim-bar__input[data-range-edge="start"]');
        const host = await boxOf(page, "#player-chart");
        const endBefore = await boxOf(page, ".timeline-range__tab--end");

        // Park the playhead at 50% (digit jump), then mark the clip start there.
        await page.keyboard.press("Digit5");
        await page.keyboard.press("KeyI");
        await expect
            .poll(async () => (await startTab.boundingBox())?.x ?? 0)
            .toBeGreaterThan(host.x + host.width * 0.3);
        await expect(startInput).not.toHaveValue("0:00");

        // Playhead to 90%, mark the clip end - the end tab leaves the right edge.
        await page.keyboard.press("Digit9");
        await page.keyboard.press("KeyO");
        await expect.poll(async () => (await endTab.boundingBox())?.x ?? endBefore.x).toBeLessThan(endBefore.x - 10);
        await shot(page, "export-05c-io-hotkeys");
    });

    test("Shift+I / Shift+O jump the playhead to the clip boundaries", async ({ page }) => {
        const startInput = page.locator('.export-trim-bar__input[data-range-edge="start"]');
        const endInput = page.locator('.export-trim-bar__input[data-range-edge="end"]');
        const current = page.locator("#player-current");
        // 0:01 keeps the start INSIDE the first source file: the fixture is two
        // 2s files, and a boundary start would make Shift+I a cross-file seek
        // whose async load races the immediately-following Shift+O (a
        // pre-existing rapid-double-seek race in the player core, not what this
        // test is about).
        await startInput.fill("0:01");
        await startInput.press("Enter");
        const end = await endInput.inputValue();

        await page.keyboard.press("Shift+KeyI");
        await expect(current).toHaveText("0:01");
        await page.keyboard.press("Shift+KeyO");
        await expect(current).toHaveText(end);
    });

    test("whole-trip reset button appears once trimmed and restores the full range", async ({ page }) => {
        const reset = page.locator("#export-trim-reset");
        const startInput = page.locator('.export-trim-bar__input[data-range-edge="start"]');
        const endInput = page.locator('.export-trim-bar__input[data-range-edge="end"]');
        const full = await endInput.inputValue();

        // Full-span default: nothing to reset, the button stays hidden.
        await expect(reset).toBeHidden();

        await startInput.fill("0:02");
        await startInput.press("Enter");
        await expect(reset).toBeVisible();

        await reset.click();
        await expect(startInput).toHaveValue("0:00");
        await expect(endInput).toHaveValue(full);
        await expect(reset).toBeHidden();
    });

    test("whole-trip reset is undoable; a manual re-trim discards the snapshot", async ({ page }) => {
        const reset = page.locator("#export-trim-reset");
        const undo = page.locator("#export-trim-undo");
        const startInput = page.locator('.export-trim-bar__input[data-range-edge="start"]');

        // Nothing was reset yet - no snapshot to offer.
        await expect(undo).toBeHidden();

        await startInput.fill("0:02");
        await startInput.press("Enter");
        await reset.click();
        await expect(startInput).toHaveValue("0:00");

        // The wipe is recoverable: undo brings the trimmed range back and
        // consumes itself; the reset button returns in its place.
        await expect(undo).toBeVisible();
        await undo.click();
        await expect(startInput).toHaveValue("0:02");
        await expect(undo).toBeHidden();
        await expect(reset).toBeVisible();

        // A new manual trim supersedes the snapshot - a stale range must never
        // resurface after the user made a fresh selection.
        await reset.click();
        await expect(undo).toBeVisible();
        await startInput.fill("0:01");
        await startInput.press("Enter");
        await expect(undo).toBeHidden();
    });

    test("Play clip starts a playhead parked at the clip end from the selected start", async ({ page }) => {
        const startInput = page.locator('.export-trim-bar__input[data-range-edge="start"]');
        const endInput = page.locator('.export-trim-bar__input[data-range-edge="end"]');
        const current = page.locator("#player-current");
        const play = page.locator("#player-play");

        // Trim the start, then park the playhead exactly at the clip end, where
        // pressing play would otherwise stop instantly.
        await startInput.fill("0:01");
        await startInput.press("Enter");
        const end = await endInput.inputValue();
        await page.keyboard.press("Shift+KeyO");
        await expect(current).toHaveText(end);

        await page.locator("#export-trim-preview").click();
        await expect(play).toHaveAttribute("data-paused", "false");
        await expect(current).not.toHaveText(end);
    });

    test("ArrowUp/Down nudge the focused edge by one second", async ({ page }) => {
        const startInput = page.locator('.export-trim-bar__input[data-range-edge="start"]');
        await startInput.click();
        await startInput.press("ArrowUp");
        await expect(startInput).toHaveValue("0:01");
        await startInput.press("ArrowUp");
        await expect(startInput).toHaveValue("0:02");
        await startInput.press("ArrowDown");
        await expect(startInput).toHaveValue("0:01");
    });

    test("colliding edges surface the 1-second-minimum note", async ({ page }) => {
        const startInput = page.locator('.export-trim-bar__input[data-range-edge="start"]');
        const endInput = page.locator('.export-trim-bar__input[data-range-edge="end"]');
        // Pull the start up, then ask for an end BEFORE it: the shared clamp
        // holds the 1s floor and the feedback line explains why the value
        // snapped instead of obeying.
        await startInput.fill("0:02");
        await startInput.press("Enter");
        await endInput.fill("0:01");
        await endInput.press("Enter");
        await expect(page.locator(".export-trim-bar__feedback")).toHaveText(/1 second|секунд/);
        expect(parseClock(await endInput.inputValue())).toBeGreaterThan(parseClock(await startInput.inputValue()));
    });

    test("dragging a tab shows a live timecode bubble", async ({ page }) => {
        const bubble = page.locator(".timeline-range__bubble");
        await expect(bubble).toBeHidden();
        const box = await boxOf(page, ".timeline-range__tab--end");
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        await page.mouse.move(box.x - 80, box.y + box.height / 2, { steps: 5 });
        await expect(bubble).toBeVisible();
        await expect(bubble).toHaveText(/^\d+:\d{2}$/);
        await page.mouse.up();
        // Short linger, then gone.
        await expect(bubble).toBeHidden();
    });

    test("event popup's save-clip action opens export mode on the event window", async ({ page }) => {
        // No public fixture produces a detected brake event (the samples are
        // seconds long, steady speed), so inject a synthetic TripEvent through
        // the __dashcamigo debug handle - the popup hit-test reads trip.events
        // live, no chart rebuild needed. Gray-box on purpose: the alternative
        // is no coverage of the event->export leg at all.
        await page.evaluate(() => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const st = (window as any).__dashcamigo.state;
            const trip = st.trips[st.active.trip];
            trip.events.push({
                kind: "brake",
                unixSeconds: trip.startUtc + 2,
                relSec: 2,
                severity: 0.42,
                recordIndex: 0,
            });
        });
        // Narrow the range first: ±10s around the event covers this whole ~4s
        // trip, so the action must OVERWRITE the stale narrow range with the
        // clamped full-trip window - which makes the setRange leg observable
        // (a vacuous "range still full" pass is impossible from this state).
        const startInput = page.locator('.export-trim-bar__input[data-range-edge="start"]');
        const endInput = page.locator('.export-trim-bar__input[data-range-edge="end"]');
        const full = await endInput.inputValue();
        await startInput.fill("0:02");
        await startInput.press("Enter");
        await expect(startInput).toHaveValue("0:02");

        // Close export mode: the action must open it itself.
        await page.keyboard.press("KeyE");
        await expect(page.locator("#export-panel-options")).toBeHidden();

        // Click the marker strip at the event's exact pixel: map relSec=2
        // through the live x-scale (the canvas has y-axis gutters, so a naive
        // width fraction can miss the popup hit radius).
        const host = await boxOf(page, "#player-chart-canvas");
        const evPx = await page.evaluate(() => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return (window as any).__dashcamigo.state.chart.scales.x.getPixelForValue(2) as number;
        });
        await page.mouse.click(host.x + evPx, host.y + 4);
        const popupExport = page.locator(".event-popup-export");
        await expect(popupExport).toBeVisible();

        await popupExport.click();
        // Export mode opened and the event window REPLACED the stale narrow
        // range: ±10s around relSec=2 clamps to the whole short trip, so start
        // returns to 0:00 and end to the full length.
        await expect(page.locator("#export-panel-options")).toBeVisible();
        await expect(startInput).toHaveValue("0:00");
        await expect(endInput).toHaveValue(full);
        await expect(page.locator("#event-popup")).toBeHidden();
        await shot(page, "export-05e-event-export");
    });

    test("preview-clip zooms the timeline to the range; use-zoomed-view adopts the window", async ({ page }) => {
        const startInput = page.locator('.export-trim-bar__input[data-range-edge="start"]');
        const startTab = page.locator(".timeline-range__tab--start");
        const fromZoom = page.locator("#export-trim-from-zoom");
        const host = await boxOf(page, "#player-chart");

        // Unzoomed: the from-zoom bridge has nothing to offer and stays hidden.
        await expect(fromZoom).toBeHidden();

        // Trim the start, then preview: the window snaps to the clip, so the
        // start tab (mid-chart a moment ago) pins to the left edge while the
        // committed range itself stays put.
        await startInput.fill("0:02");
        await startInput.press("Enter");
        await expect
            .poll(async () => (await startTab.boundingBox())?.x ?? 0)
            .toBeGreaterThan(host.x + host.width * 0.2);
        await page.locator("#export-trim-preview").click();
        await expect.poll(async () => (await startTab.boundingBox())?.x ?? 0).toBeLessThan(host.x + host.width * 0.1);
        await expect(startInput).toHaveValue("0:02");

        // The timeline is now zoomed -> the bridge button appears; adopting the
        // window is a no-op here (window == clip), so instead widen the range
        // back first and adopt the still-zoomed window.
        await expect(fromZoom).toBeVisible();
        // While the window matches the clip exactly, neither tab is off-screen.
        await expect(startTab).not.toHaveClass(/is-offscreen/);
        await page.locator("#export-trim-reset").click();
        await expect(startInput).toHaveValue("0:00");
        // Full range under a still-zoomed window: the start boundary (0:00) now
        // lies left of the window, so its pinned tab flags the off-screen state.
        await expect(startTab).toHaveClass(/is-offscreen/);
        await fromZoom.click();
        await expect(startInput).not.toHaveValue("0:00");
        await shot(page, "export-05d-zoom-bridge");
    });

    test("a preview-clip window clamps seeks to the clip (bounded virtual trip)", async ({ page }) => {
        const endInput = page.locator('.export-trim-bar__input[data-range-edge="end"]');
        const current = page.locator("#player-current");
        const play = page.locator("#player-play");

        // Pause deterministically: a playing clip could loop at the window end and
        // read "0:00" instead of the clamped "0:01", masking the clamp under
        // playback. This test asserts the SEEK clamp, not the loop.
        if ((await play.getAttribute("data-paused")) === "false") await play.click();
        await expect(play).toHaveAttribute("data-paused", "true");

        // Trim to the first second and preview: the window becomes [0, 0:01] and
        // isPreviewZoom bounds playback to it.
        await endInput.fill("0:01");
        await endInput.press("Enter");
        await expect(endInput).toHaveValue("0:01");
        await page.locator("#export-trim-preview").click();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect(await page.evaluate(() => (window as any).__dashcamigo.state.isPreviewZoom)).toBe(true);

        // Pause the one-click preview before asserting the independent seek clamp.
        if ((await play.getAttribute("data-paused")) === "false") await play.click();
        await expect(play).toHaveAttribute("data-paused", "true");

        // Digit "9" jumps to 90% of the TRIP (~3.6s) - a trip-time seek that
        // targets well past the window (the mini-progress scrubber is window-mapped
        // and could never overshoot it). The preview clamp snaps it back to the
        // clip end (0:01), not the trip end. Non-vacuous: with the isPreviewZoom
        // clamp removed this reads ~0:03. (Enter above blurs the input, so the
        // digit hotkey is not swallowed as text.)
        await page.keyboard.press("9");
        await expect(current).toHaveText("0:01");
    });

    test("one click on Play clip plays the clip from its start", async ({ page }) => {
        const startInput = page.locator('.export-trim-bar__input[data-range-edge="start"]');
        const endInput = page.locator('.export-trim-bar__input[data-range-edge="end"]');
        const current = page.locator("#player-current");
        const play = page.locator("#player-play");

        // Pause deterministically, trim the start, and park the playhead at the clip end.
        if ((await play.getAttribute("data-paused")) === "false") await play.click();
        await expect(play).toHaveAttribute("data-paused", "true");
        await startInput.fill("0:01");
        await startInput.press("Enter");
        const end = await endInput.inputValue();
        await page.keyboard.press("Shift+KeyO");
        await expect(current).toHaveText(end);

        await page.locator("#export-trim-preview").click();
        await expect(play).toHaveAttribute("data-paused", "false");
        // Playing from the START, not resuming at the parked end.
        await expect(current).not.toHaveText(end);
    });

    test("Play clip handles a clip starting on a file boundary (offset-0 cross-file)", async ({ page }) => {
        // Regression: seekThenPlay's resume latch must also land via loadedmetadata.
        // A cross-file seek to a frame-start target (trip 0:00 = first file, offset
        // 0) writes no currentTime, so it fires no 'seeked'; wired only to 'seeked',
        // the latch would hang and the clip never play. The fixture is two 2s files,
        // so trip 0:00 is a real file-0 start and a seek there from the second file
        // is cross-file with offset 0.
        const endInput = page.locator('.export-trim-bar__input[data-range-edge="end"]');
        const current = page.locator("#player-current");
        const play = page.locator("#player-play");

        if ((await play.getAttribute("data-paused")) === "false") await play.click();
        await expect(play).toHaveAttribute("data-paused", "true");

        // Park the playhead in the SECOND file (~3.5s) via the whole-trip scrubber
        // (not zoomed yet, so it is trip-mapped) and wait for that cross-file seek
        // to LAND, then trim the clip to [0, 0:03].
        const bar = await boxOf(page, "#player-mini-progress");
        await page.mouse.click(bar.x + bar.width * 0.88, bar.y + bar.height / 2);
        await expect
            .poll(async () => parseClock((await current.textContent())?.trim() ?? "0:00"))
            .toBeGreaterThanOrEqual(3);
        await endInput.fill("0:03");
        await endInput.press("Enter");

        // One click rewinds to the cross-file, offset-0 start and then plays.
        await page.locator("#export-trim-preview").click();
        await expect(play).toHaveAttribute("data-paused", "false");
    });

    test("watermark drag snaps to a corner (inline left/top set)", async ({ page }) => {
        const wm = page.locator("#player-watermark");
        await expect(wm).toBeVisible();
        const wmBox = await boxOf(page, "#player-watermark");
        const grid = await boxOf(page, "#video-grid");
        await page.mouse.move(wmBox.x + wmBox.width / 2, wmBox.y + wmBox.height / 2);
        await page.mouse.down();
        await page.mouse.move(grid.x + 30, grid.y + 30, { steps: 8 });
        await page.mouse.up();
        // Snapped to top-left: left/top inline set (right/bottom cleared).
        await expect.poll(() => wm.evaluate((el) => (el as HTMLElement).style.left)).not.toBe("");
        await expect.poll(() => wm.evaluate((el) => (el as HTMLElement).style.top)).not.toBe("");
        await shot(page, "export-06-watermark-tl");
    });

    test("watermark opt-out hides the preview mark and reveals the plea", async ({ page }) => {
        const cb = page.locator("#export-panel-watermark");
        const plea = page.locator("#export-panel-watermark-plea");
        const wm = page.locator("#player-watermark");
        // Default: the mark ships, so the positive box is checked and the note stays out of
        // the way.
        await expect(cb).toBeChecked();
        await expect(plea).toBeHidden();
        await expect(wm).toBeVisible();

        await cb.uncheck();
        await expect(plea).toBeVisible();
        // WYSIWYG: opting out drops the mark from the preview, not just the export.
        await expect(wm).toBeHidden();

        await cb.check();
        await expect(plea).toBeHidden();
        await expect(wm).toBeVisible();
    });

    test("crop edit: source frame while dragging, zoom result on release", async ({ page }) => {
        await page.locator('#video-grid .video-tile[data-channel="front"]').dblclick();
        const editor = page.locator(".crop-editor");
        await expect(editor).toBeVisible();
        const readClip = () => page.locator("#player").evaluate((el) => el.style.getPropertyValue("clip-path"));

        const handle = await boxOf(page, ".crop-handle--br");
        await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
        await page.mouse.down();
        await page.mouse.move(handle.x - 90, handle.y - 60, { steps: 8 });
        // While dragging (pointer down) the video stays on the full source frame:
        // crop clip-path must be empty.
        expect(await readClip()).toBe("");
        await shot(page, "export-07-crop-drag");
        await page.mouse.up();

        // On release the zoomed result preview applies; the editor stays open.
        await expect.poll(() => readClip()).not.toBe("");
        await expect(editor).toBeVisible();
        await shot(page, "export-08-crop-result");
    });

    test("crop overlays stay output-frame-relative, not crop-relative", async ({ page }) => {
        await page.locator('#video-grid .video-tile[data-channel="front"]').dblclick();
        await expect(page.locator(".crop-editor")).toBeVisible();
        await page.locator(".crop-aspect-btn", { hasText: "9:16" }).click();

        const frame = await boxOf(page, "#player-overlay-frame");
        const wm = await boxOf(page, "#player-watermark");
        const grid = await boxOf(page, "#video-grid");
        // The overlay frame spans the FULL output frame (the grid), not the
        // narrow 9:16 crop column.
        expect(frame.width).toBeGreaterThanOrEqual(grid.width - 5);
        // Default watermark (br anchor) hugs the FULL frame corner. Margin must
        // equal drawWatermark's: max(8, 4% of min frame axis).
        const rightGap = grid.x + grid.width - (wm.x + wm.width);
        const bottomGap = grid.y + grid.height - (wm.y + wm.height);
        const expectedMargin = Math.max(8, Math.round(Math.min(grid.width, grid.height) * 0.04));
        expect(Math.abs(rightGap - expectedMargin)).toBeLessThanOrEqual(4);
        expect(Math.abs(bottomGap - expectedMargin)).toBeLessThanOrEqual(4);
        await shot(page, "export-09-crop-overlay-frame");
    });

    test("crop Done confirms the crop and dismisses the selector", async ({ page }) => {
        await page.locator('#video-grid .video-tile[data-channel="front"]').dblclick();
        const editor = page.locator(".crop-editor");
        await expect(editor).toBeVisible();
        await page.locator(".crop-aspect-btn", { hasText: "9:16" }).click();
        const readClip = () => page.locator("#player").evaluate((el) => el.style.getPropertyValue("clip-path"));
        await expect.poll(() => readClip()).not.toBe("");
        await page.locator(".crop-done-btn").click();
        await expect(editor).toHaveCount(0);
        // Crop persists after Done.
        expect(await readClip()).not.toBe("");
        await shot(page, "export-10-crop-done");
    });

    test("crop 1:1 aspect lock keeps the ratio while resizing", async ({ page }) => {
        await page.locator('#video-grid .video-tile[data-channel="front"]').dblclick();
        await expect(page.locator(".crop-editor")).toBeVisible();
        const oneToOne = page.locator('.crop-aspect-btn[data-preset="1:1"]');
        await oneToOne.click();
        await expect(oneToOne).toHaveClass(/is-active/);

        const handle = await boxOf(page, ".crop-handle--br");
        await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
        await page.mouse.down();
        await page.mouse.move(handle.x - 120, handle.y - 20, { steps: 8 });
        // Measure WHILE pointer is down: a 1:1-locked rect renders square.
        const box = await page.locator(".crop-rect").boundingBox();
        expect(box, "crop-rect must be present mid-drag").not.toBeNull();
        const skew = Math.abs(box!.width - box!.height) / Math.max(box!.width, box!.height);
        expect(skew, "aspect ratio must survive an asymmetric drag").toBeLessThan(0.06);
        await shot(page, "export-11-crop-aspect-lock");
        await page.mouse.up();
    });

    test("excluding a camera drops it from the grid and export", async ({ page }) => {
        const includes = page.locator(".top-panel__channel-include");
        await expect(includes).toHaveCount(3);
        await expect(page.locator(".top-panel__channel-include:checked")).toHaveCount(3);
        // .click (not .uncheck): the list re-renders on change; a post-uncheck
        // state read would race the re-render.
        await includes.last().click();
        await expect(page.locator(".top-panel__channel-include:checked")).toHaveCount(2);
        await expect(page.locator(".top-panel__channel-chip.is-excluded")).toHaveCount(1);
        await shot(page, "export-12-channel-exclude");
    });

    test("layout v2 stacks 2-up after excluding a camera (no black column)", async ({ page }) => {
        await page.locator(".top-panel__channel-include").last().click();
        await expect(page.locator(".top-panel__channel-include:checked")).toHaveCount(2);
        await page.locator('.top-panel__layout-btn[data-layout="v2"]').click();

        const grid = await boxOf(page, "#video-grid");
        const tiles = page.locator("#video-grid .video-tile:not([hidden])");
        await expect(tiles).toHaveCount(2);
        const boxes = await tiles.evaluateAll((els) =>
            els.map((e) => {
                const r = e.getBoundingClientRect();
                return { x: r.x, y: r.y, w: r.width, h: r.height };
            }),
        );
        // v2 = one full-width column, two rows. Each tile spans ~full grid width;
        // the bug put both in a half-width column with the right half black.
        for (const b of boxes) expect(b.w).toBeGreaterThan(grid.width * 0.9);
        const [top, bottom] = boxes.sort((p, q) => p.y - q.y);
        expect(bottom!.y).toBeGreaterThan(top!.y + top!.h * 0.5);
        await shot(page, "export-13-layout-v2");
    });

    test("estimate block recomputes when Output changes", async ({ page }) => {
        const size = page.locator(".export-panel__estimate-size");
        const details = page.locator(".export-panel__estimate-details");
        await expect(size).toContainText("≈");
        await expect(details).toContainText("×");
        const before = (await details.textContent()) ?? "";
        await page.locator("#export-panel-output").selectOption("1080_9x16");
        await expect(details).not.toHaveText(before);
        await expect(details).toContainText("1080");
        await shot(page, "export-14-estimate");
    });

    test("overlays: speed/coords/map enable and the speed overlay drags", async ({ page }) => {
        await page.locator("#export-panel-ov-speed").check();
        await page.locator("#export-panel-ov-coords").check();
        await page.locator("#export-panel-ov-map").check();
        await expect(page.locator("#player-speed-overlay")).toBeVisible();
        await expect(page.locator("#player-coords-overlay")).toBeVisible();
        await expect(page.locator("#player-map-overlay")).toBeVisible();

        const sp = page.locator("#player-speed-overlay");
        const sb = await boxOf(page, "#player-speed-overlay");
        await page.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2);
        await page.mouse.down();
        await page.mouse.move(sb.x + 160, sb.y - 80, { steps: 8 });
        await page.mouse.up();
        await expect.poll(() => sp.evaluate((el) => (el as HTMLElement).style.left)).not.toBe("");
        await shot(page, "export-15-overlays");
    });

    test("map overlay is draggable (pointer-events guard)", async ({ page }) => {
        await page.locator("#export-panel-ov-map").check();
        const map = page.locator("#player-map-overlay");
        await expect(map).toBeVisible();
        const before = await map.evaluate((el) => (el as HTMLElement).style.left);
        const mb = await boxOf(page, "#player-map-overlay");
        // Grab the centre (clear of the resize grip) and drag.
        await page.mouse.move(mb.x + mb.width / 2, mb.y + mb.height / 2);
        await page.mouse.down();
        await page.mouse.move(mb.x - 120, mb.y + 60, { steps: 8 });
        await page.mouse.up();
        await expect.poll(() => map.evaluate((el) => (el as HTMLElement).style.left)).not.toBe(before);
        await shot(page, "export-16-map-drag");
    });

    test("viewer map + mini-map hide in export mode and restore on close", async ({ page }) => {
        // beforeEach left us in export mode: the live viewer mini-map is
        // suppressed (the player is the WYSIWYG export preview; the export's own
        // #player-map-overlay is a separate element and stays).
        await expect(page.locator("#mini-map")).toBeHidden();
        // Leaving export restores the viewer layout (mini-map back for a GPS trip).
        await page.locator("#export-panel-close").click();
        await expect(page.locator("#mini-map")).toBeVisible();

        // Expand the big map, then re-enter export: the big map hides too, and
        // closing restores the expanded layout - suppression never mutates
        // state.mapExpanded, so "as it was" comes back from the same recompute.
        await page.locator("#mini-map").click();
        await expect(page.locator("#player-wrap")).toHaveClass(/map-expanded/);
        await openExport(page);
        await expect(page.locator("#player-wrap")).not.toHaveClass(/map-expanded/);
        await expect(page.locator("#mini-map")).toBeHidden();
        await page.locator("#export-panel-close").click();
        await expect(page.locator("#player-wrap")).toHaveClass(/map-expanded/);
        await shot(page, "export-16b-map-hidden-in-export");
    });

    test("overlay inspector slider survives a value change (drag not aborted)", async ({ page }) => {
        // Regression: every notifyExportStateChanged rebuilt the inspector
        // (innerHTML = ""), so the first `input` event of a slider drag destroyed
        // the <input> under the pointer and the drag aborted instantly. Selecting
        // a widget opens the inspector with the size slider.
        await page.locator("#export-panel-ov-speed").check();
        const inspector = page.locator("#export-panel-overlay-inspector");
        await expect(inspector).toBeVisible();
        const slider = inspector.locator('input[type="range"]').first();
        await expect(slider).toBeVisible();
        // Tag the live node, then drive a value change the way a drag tick does.
        await slider.evaluate((el) => {
            (el as HTMLElement).dataset.dragProbe = "1";
        });
        await slider.evaluate((el) => {
            const input = el as HTMLInputElement;
            input.value = String(Number(input.value) + 20);
            input.dispatchEvent(new Event("input", { bubbles: true }));
        });
        // Same element still present => not rebuilt => a real pointer drag keeps
        // tracking instead of dying on the first move.
        await expect(inspector.locator('input[type="range"][data-drag-probe="1"]')).toHaveCount(1);
    });

    test("map overlay theme segment toggles light/dark/neon", async ({ page }) => {
        await page.locator("#export-panel-ov-map").check();
        const inspector = page.locator("#export-panel-overlay-inspector");
        await expect(inspector).toBeVisible();
        const light = inspector.locator('button[data-maptheme="light"]');
        const dark = inspector.locator('button[data-maptheme="dark"]');
        const neon = inspector.locator('button[data-maptheme="neon"]');
        // Neon is the export-only default (snapshotter loads neon.json on enable).
        await expect(neon).toHaveClass(/is-active/); // default
        await dark.click();
        await expect(dark).toHaveClass(/is-active/);
        await expect(neon).not.toHaveClass(/is-active/);
        await light.click();
        await expect(light).toHaveClass(/is-active/);
        await expect(dark).not.toHaveClass(/is-active/);
        await expect(page.locator("#player-map-overlay")).toBeVisible();
    });

    test("map marker starts from settings and stays local to the export", async ({ page }) => {
        await page.locator("#export-panel-close").click();
        await page.locator("#settings-btn").click();
        const settingsControl = page.locator('[data-marker-control="settings"]');
        await settingsControl.locator('button[data-marker-shape="sedan"]').click();
        await settingsControl.locator('button[data-marker-color="#30a46c"]').click();
        await settingsControl.locator('button[data-marker-size="large"]').click();
        await page.locator("#settings-modal-close").click();

        await openExport(page);
        await page.locator("#export-panel-ov-map").check();
        const exportControl = page.locator('[data-marker-control="export"]');
        await expect(exportControl.locator('button[data-marker-shape="sedan"]')).toHaveAttribute(
            "aria-pressed",
            "true",
        );
        await expect(exportControl.locator('button[data-marker-size="large"]')).toHaveAttribute("aria-pressed", "true");

        await exportControl.locator('button[data-marker-shape="truck"]').click();
        await exportControl.locator('button[data-marker-color="#e5484d"]').click();
        await exportControl.locator('button[data-marker-size="small"]').click();
        await exportControl.scrollIntoViewIfNeeded();
        await shot(page, "export-22-map-marker");
        const globalPreference = await page.evaluate(() =>
            JSON.parse(localStorage.getItem("dashcamigo:mapMarker") ?? "null"),
        );
        expect(globalPreference).toEqual({ shape: "sedan", color: "#30a46c", size: "large" });

        await page.locator("#export-panel-close").click();
        await openExport(page);
        await expect(page.locator('[data-marker-control="export"] button[data-marker-shape="sedan"]')).toHaveAttribute(
            "aria-pressed",
            "true",
        );
    });

    test("map overlay mode segment switches north/chase and reveals tilt + adaptive", async ({ page }) => {
        await page.locator("#export-panel-ov-map").check();
        const inspector = page.locator("#export-panel-overlay-inspector");
        await expect(inspector).toBeVisible();
        const north = inspector.locator('button[data-mapmode="north"]');
        const chase = inspector.locator('button[data-mapmode="chase"]');
        // Chase is the default; its extras (tilt slider + adaptive toggle, default
        // on) are revealed inline from the start.
        await expect(chase).toHaveClass(/is-active/);
        await expect(page.locator("#export-panel-ov-adaptive")).toBeVisible();
        await expect(page.locator("#export-panel-ov-adaptive")).toBeChecked();

        // Switching to north-up hides the chase extras.
        await north.click();
        await expect(north).toHaveClass(/is-active/);
        await expect(chase).not.toHaveClass(/is-active/);
        await expect(page.locator("#export-panel-ov-adaptive")).toBeHidden();

        // Back to chase re-reveals them.
        await chase.click();
        await expect(chase).toHaveClass(/is-active/);
        await expect(page.locator("#export-panel-ov-adaptive")).toBeVisible();
    });

    test("widget settings expand inline under the row and collapse on re-click", async ({ page }) => {
        const inspector = page.locator("#export-panel-overlay-inspector");
        const clockName = page.locator('.export-panel__ov-row[data-widget="clock"] .export-panel__ov-name');
        // Clicking the widget name expands its settings (and enables the widget).
        await clockName.click();
        await expect(inspector).toBeVisible();
        await expect(page.locator("#export-panel-ov-clock")).toBeChecked();
        // The inspector docks directly under the clicked row (accordion).
        const prevWidget = await inspector.evaluate(
            (el) => (el.previousElementSibling as HTMLElement | null)?.dataset.widget ?? null,
        );
        expect(prevWidget).toBe("clock");
        // Position is by dragging on the frame: a size slider + a drag hint, and
        // NO X/Y sliders or align grid.
        await expect(inspector.locator('input[type="range"]')).toHaveCount(1);
        await expect(inspector.locator(".export-panel__ov-hint")).toBeVisible();
        // Re-click collapses the settings; the widget stays enabled.
        await clockName.click();
        await expect(inspector).toBeHidden();
        await expect(page.locator("#export-panel-ov-clock")).toBeChecked();
        // Layout presets are gone.
        await expect(page.locator(".export-panel__ov-preset")).toHaveCount(0);
    });

    test("compass widget renders on the preview canvas without error", async ({ page }) => {
        // Enabling the compass paints it via the same draw code the export burns
        // in (drawCompass). The heading readout now sits centered on a pill; this
        // exercises that path - the fail-loud teardown catches any draw throw.
        await page.locator('.export-panel__ov-row[data-widget="compass"] .export-panel__ov-name').click();
        await expect(page.locator("#export-panel-ov-compass")).toBeChecked();
        await expect(page.locator("#player-telemetry-canvas")).toBeVisible();
    });

    test("blurred letterbox preview mirrors the master when playing", async ({ page }) => {
        await page.locator("#export-panel-output").selectOption("1080_9x16");
        await page.locator("#export-panel-blur").check();
        await page.locator("#player-play").click();
        await expect(page.locator("body")).toHaveClass(/letterbox-blur/);
        await expect(page.locator('#video-grid .video-tile[data-channel="front"] > video.tile-blur-bg')).toBeVisible();
        await shot(page, "export-17-blur");
    });

    test("range selection stays usable with the chart hidden", async ({ page }) => {
        await page.locator("#player-view-menu").click();
        await page.locator('.view-menu-row[data-panel="chart"]').click();
        await page.locator('.view-menu-row[data-panel="strip"]').click();
        await page.keyboard.press("Escape");
        await expect(page.locator("#player-chart-canvas")).toBeHidden();
        await expect(page.locator("#timeline-range")).toBeVisible();
        await expect(page.locator(".timeline-range__tab--start")).toBeVisible();
        await expect(page.locator(".timeline-range__tab--end")).toBeVisible();

        // Seek on the progress bar; the playhead lines up with the thumb (both
        // share timelineSecToFrac, not the dead plot area).
        const bar = await boxOf(page, "#player-mini-progress");
        await page.mouse.click(bar.x + bar.width / 2, bar.y + bar.height / 2);
        const ph = await boxOf(page, "#player-chart-playhead");
        const th = await boxOf(page, "#player-mini-progress-thumb");
        expect(Math.abs(ph.x + ph.width / 2 - (th.x + th.width / 2))).toBeLessThan(4);
        await shot(page, "export-18-range-chart-hidden");
    });

    test("Close exits export mode", async ({ page }) => {
        await page.locator("#export-panel-close").click();
        await expect(page.locator("#export-panel")).toBeHidden();
        await expect(page.locator("body")).not.toHaveClass(/export-mode/);
    });
});

// Device-encode ceiling: SAMPLE_70MAI is multichannel, so the default export is
// a composite re-encode (canStreamCopy false). With VideoEncoder.isConfigSupported
// stubbed to reject every config (a mobile encoder that can't do the High-profile
// H.264 we emit at this size), resolveEncodableH264 finds no encodable rung and
// the panel must surface this BEFORE Save. Stub installed before app code so the
// first probe sees it.
test.describe("export device-encode limit", () => {
    test.beforeEach(async ({ page }) => {
        await presetLocalStorage(page);
        await page.setViewportSize(DESKTOP);
        await page.addInitScript(() => {
            const ve = (globalThis as { VideoEncoder?: { isConfigSupported?: unknown } }).VideoEncoder;
            if (ve) ve.isConfigSupported = async () => ({ supported: false });
        });
        await gotoApp(page, "en");
        await loadTrip(page, SAMPLE_70MAI);
        await openExport(page);
    });

    test("device cannot encode at this resolution: Save disabled + block note", async ({ page }) => {
        const note = page.locator("#export-panel-encode-note");
        await expect(note).toBeVisible();
        await expect(note).toContainText("can't save video at this resolution");
        await expect(note).toHaveClass(/is-error/);
        await expect(page.locator("#export-panel-save-btn")).toBeDisabled();
        await shot(page, "export-19-device-no-encode");
    });
});

// Non-Chromium nudge: on a Gecko/WebKit UA the export panel shows a banner that
// opens a "use a Chromium browser" modal with download links. We spoof the UA to
// Firefox so identifyBrowser() reports gecko - the REAL engine stays Chromium,
// which is what actually decodes the trip and renders the panel here; the UA only
// drives the nudge. (Engine, not UA, is what capabilities gate on, so the app
// still runs.)
test.describe("export Chromium nudge - non-Chromium UA", () => {
    test.use({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:128.0) Gecko/20100101 Firefox/128.0" });

    test.beforeEach(async ({ page }) => {
        await presetLocalStorage(page);
        await page.setViewportSize(DESKTOP);
        await gotoApp(page, "en");
        await loadTrip(page, SAMPLE_70MAI);
        await openExport(page);
    });

    test("banner opens the Chromium-browsers modal with safe external download links", async ({ page }) => {
        const banner = page.locator("#export-panel-chromium-banner");
        await expect(banner, "a non-Chromium UA must show the banner").toBeVisible();

        const modal = page.locator("#chromium-browsers-modal");
        await expect(modal).toBeHidden();
        await banner.click();
        await expect(modal).toBeVisible();

        const chips = modal.locator(".chromium-modal-chip");
        await expect(chips).toHaveCount(5);
        await expect(chips.first()).toHaveAttribute("href", /chrome/i);
        // Every chip is an external link with a safe rel (no opener/referrer leak).
        const rels = await chips.evaluateAll((els) => els.map((e) => e.getAttribute("rel") ?? ""));
        for (const rel of rels) expect(rel).toContain("noopener");
        await shot(page, "export-20-chromium-modal");

        await page.locator("#chromium-browsers-modal-close").click();
        await expect(modal).toBeHidden();
    });
});

// Gating: on the default (Chromium) engine the banner must NOT render.
test.describe("export Chromium nudge - Chromium UA", () => {
    test.beforeEach(async ({ page }) => {
        await presetLocalStorage(page);
        await page.setViewportSize(DESKTOP);
        await gotoApp(page, "en");
        await loadTrip(page, SAMPLE_70MAI);
        await openExport(page);
    });

    test("no banner on a Chromium engine", async ({ page }) => {
        await expect(page.locator("#export-panel-chromium-banner")).toHaveCount(0);
    });
});

// GPS-track-only export: the mode switch reconfigures the panel to a single .gpx
// download straight from the parsed GPS - no decode, so it runs on bundled
// Chromium (no proprietary codecs) where the video export self-skips.
// straight from the parsed GPS - no decode, so it runs on bundled Chromium (no
// proprietary codecs) where the video export self-skips.
test.describe("export GPX-only mode", () => {
    test.beforeEach(async ({ page }) => {
        await presetLocalStorage(page);
        await page.setViewportSize(DESKTOP);
        await gotoApp(page, "en");
        await loadTrip(page, SAMPLE_70MAI);
        await openExport(page);
    });

    test("switching to GPX-only hides the video controls, shows the track summary and relabels Save", async ({
        page,
    }) => {
        // The mode switch only appears for trips that carry GPS (this sample does).
        const gpxMode = page.locator('.export-panel__seg-btn[data-mode="gpx"]');
        await expect(gpxMode).toHaveCount(1);
        await expect(page.locator("#export-panel-output")).toBeVisible();
        await expect(page.locator(".export-panel__gpx-summary")).toBeHidden();

        await gpxMode.click();
        // Every video control lives under one wrapper that collapses in gpx mode.
        await expect(page.locator(".export-panel__video-only")).toBeHidden();
        await expect(page.locator("#export-panel-output")).toBeHidden();
        await expect(page.locator("#export-panel-save-btn")).toHaveText("Save .gpx");
        // The summary stands in for the hidden controls: "N points · dist · len".
        const summary = page.locator(".export-panel__gpx-summary");
        await expect(summary).toBeVisible();
        await expect(summary).toContainText(/\d+ points/);
        await shot(page, "export-21-gpx-only");
    });

    test("GPX-only Save downloads a valid .gpx with track points", async ({ page }) => {
        await page.locator('.export-panel__seg-btn[data-mode="gpx"]').click();

        const [download] = await Promise.all([
            page.waitForEvent("download"),
            page.locator("#export-panel-save-btn").click(),
        ]);
        expect(download.suggestedFilename()).toMatch(/\.gpx$/);

        const path = await download.path();
        expect(path, "the download must have produced a file").not.toBeNull();
        const text = await readFile(path as string, "utf8");
        expect(text, "must be a GPX document").toContain("<gpx");
        expect(text, "must carry at least one track point").toContain("<trkpt");

        // Success is surfaced as a toast (no phase change - the panel stays open).
        await expect(page.locator(".dc-toast")).toContainText("GPS track saved");
    });
});
