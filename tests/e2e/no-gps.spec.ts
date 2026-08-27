// The GPS-dependent export gate. On a trip with no GPS fix the export panel
// disables (greys out) every option that needs a track - embedded telemetry,
// the .gpx sidecar, and the speed/coords/map overlays - the GPS-track-only
// switch hides, and the produced MP4 carries NO gpmd telemetry track even though
// "keep GPS" is the default. Uses a synthetic H.264 no-GPS sample (every other
// public fixture carries a track by design) so the whole gate runs on CI Chrome,
// not only on a macOS box that decodes HEVC.
//
// Two layers, both regression gates a panel-only test could not give:
//   - the panel DISPLAY (5 checkboxes disabled+unchecked, mode switch hidden)
//   - the PRODUCED FILE: a stale gpmf default must not inject an empty gpmd track
//     (export-flow's `withGpmf && hasGps`). That gate is invisible to a display
//     assertion - only inspecting the output bytes catches a regression in it.

import {
    DESKTOP,
    SAMPLE_NOGPS,
    expect,
    gotoApp,
    installExportCapture,
    loadTrip,
    openExport,
    presetLocalStorage,
    readExportResult,
    shot,
    test,
} from "./_fixtures.js";

const GPS_OPTION_IDS = [
    "#export-panel-gpmf",
    "#export-panel-gpx",
    "#export-panel-ov-speed",
    "#export-panel-ov-coords",
    "#export-panel-ov-map",
    "#export-panel-ov-clock",
    "#export-panel-ov-compass",
    "#export-panel-ov-gforce",
    "#export-panel-ov-distance",
    "#export-panel-ov-graph",
];

test.describe("no-GPS export gate", () => {
    test.beforeEach(async ({ page }) => {
        await presetLocalStorage(page);
        await installExportCapture(page); // before gotoApp - captured at bundle load
        await page.setViewportSize(DESKTOP);
        await gotoApp(page, "en");
        await loadTrip(page, SAMPLE_NOGPS);
        await openExport(page);
    });

    test("panel: GPS-dependent options are disabled and the GPS-track switch hidden", async ({ page }) => {
        // GPS-track-only mode makes no sense without a track - the switch hides
        // (its parent fieldset gets the hidden attribute via syncModeAvailability).
        await expect(page.locator('button[data-mode="gpx"]')).toBeHidden();
        for (const id of GPS_OPTION_IDS) {
            await expect(page.locator(id), `${id} must be disabled with no GPS`).toBeDisabled();
            await expect(page.locator(id), `${id} must be cleared with no GPS`).not.toBeChecked();
        }
        // The map-overlay zoom + shape controls live in the per-widget inspector,
        // which only renders for a selected, enabled widget - on a no-GPS trip
        // nothing is enabled, so the inspector stays hidden.
        await expect(page.locator("#export-panel-overlay-inspector")).toBeHidden();
        await shot(page, "no-gps-01-export-options");
    });

    test("pipeline: a stale 'keep GPS' default does NOT inject a gpmd track", async ({ page }) => {
        // withGpmf defaults true, but
        // the trip has no fix, so export-flow's `withGpmf && hasGps` gate must keep
        // the produced MP4 free of a gpmd track. Single channel + source preset =>
        // stream-copy; the assertion is the absence of gpmd, the inverse of the
        // export-run GPS-sample tests.
        await page.locator("#export-panel-save-btn").click();
        await expect(page.locator("#export-panel-done-summary")).toBeVisible({ timeout: 60_000 });

        const r = await readExportResult(page);
        expect(r, "export must have written bytes through the stubbed handle").not.toBeNull();
        expect(r!.len, "produced MP4 must be non-trivial").toBeGreaterThan(1024);
        expect(r!.ftyp, "MP4 must have an ftyp box").toBe(true);
        expect(r!.moov, "MP4 must have a moov box").toBe(true);
        expect(r!.mdat, "MP4 must have media data").toBe(true);
        expect(r!.gpmd, "no GPS -> no gpmd track, despite the kept-by-default toggle").toBe(false);
    });
});
