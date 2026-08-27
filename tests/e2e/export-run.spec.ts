// Export EXECUTION (not just the panel): drives the Save flow end to end with
// window.showSaveFilePicker stubbed to an in-memory file, then inspects the
// bytes the pipeline actually produced. Two real paths:
//   - stream-copy (single channel, no transforms) + GPMF meta-track injection
//   - re-encode / compositing (multichannel split-screen via WebCodecs)
//
// We assert container validity by ISO-BMFF box markers (ftyp/moov/mdat) and the
// GPMF telemetry track by the 'gpmd' handler, rather than re-decoding pixels.

import type { Page } from "@playwright/test";

import {
    DESKTOP,
    type ExportSinkFailure,
    SAMPLE_70MAI,
    canEncodeHighProfileH264,
    expect,
    gotoApp,
    installExportCapture,
    installInMemoryExportCapture,
    loadTrip,
    openExport,
    presetLocalStorage,
    readExportResult,
    readInMemoryDownload,
    readTranscodeDoneFields,
    test,
} from "./_fixtures.js";

test.describe("export run", () => {
    test.beforeEach(async ({ page }) => {
        await presetLocalStorage(page);
        await installExportCapture(page); // before gotoApp - captured at bundle load
        await page.setViewportSize(DESKTOP);
        await gotoApp(page, "en");
        await loadTrip(page, SAMPLE_70MAI);
        await openExport(page);
    });

    test("stream-copy single channel writes a valid MP4 with a GPMF track", async ({ page }) => {
        // Reduce to one channel -> canStreamCopy() is true (no re-encode). GPMF is
        // kept by default, so the
        // post-process meta-track injection must run and land a 'gpmd' handler.
        const includes = page.locator(".top-panel__channel-include");
        await expect(includes).toHaveCount(3);
        await includes.nth(2).click();
        await includes.nth(1).click();
        await expect(page.locator(".top-panel__channel-include:checked")).toHaveCount(1);

        // Native path streams to disk at any size -> the in-memory warning stays
        // hidden (the other half of the no-native assertion below).
        await expect(page.locator("#export-panel-fallback-warn")).toBeHidden();

        await page.locator("#export-panel-save-btn").click();
        await expect(page.locator("#export-panel-done-summary")).toBeVisible({ timeout: 60_000 });

        const r = await readExportResult(page);
        expect(r, "export must have written bytes through the stubbed handle").not.toBeNull();
        expect(r!.len, "produced MP4 must be non-trivial").toBeGreaterThan(1024);
        expect(r!.ftyp, "MP4 must have an ftyp box").toBe(true);
        expect(r!.moov, "MP4 must have a moov box").toBe(true);
        expect(r!.mdat, "MP4 must have media data").toBe(true);
        expect(r!.gpmd, "GPMF telemetry track (gpmd handler) must be injected").toBe(true);
        expect(r!.soun, "audio must be copied into the stream-copy export").toBe(true);
    });

    test("re-encode split-screen writes a valid MP4 (compositing pipeline)", async ({ page, browserName }) => {
        // Default multichannel keeps all 3 channels -> split-screen -> canStreamCopy
        // is false -> the decode/composite/re-encode WebCodecs pipeline runs. This
        // is the only coverage of the actual compositing path. Skip (not fail)
        // where High-profile H.264 encode is unavailable - the stream-copy case
        // above still exercises the mux path everywhere.
        // Firefox: H.264 encode is broken (Bugzilla 1918769) and the probe can't
        // see it (isConfigSupported lies), so skip Gecko explicitly.
        test.skip(browserName === "firefox", "Firefox WebCodecs H.264 encode is broken (Bugzilla 1918769)");
        test.skip(
            !(await canEncodeHighProfileH264(page)),
            "WebCodecs High-profile H.264 encode not available on this platform",
        );

        test.setTimeout(120_000);
        await expect(page.locator(".top-panel__channel-include:checked")).toHaveCount(3);

        await page.locator("#export-panel-save-btn").click();
        await expect(page.locator("#export-panel-done-summary")).toBeVisible({ timeout: 100_000 });

        const r = await readExportResult(page);
        expect(r, "re-encode must have written bytes").not.toBeNull();
        expect(r!.len, "re-encoded MP4 must be non-trivial").toBeGreaterThan(1024);
        expect(r!.ftyp).toBe(true);
        expect(r!.moov).toBe(true);
        expect(r!.mdat).toBe(true);
        // GPMF on the re-encode path goes through the findMoovInFile fallback (the
        // worker mux has no onMoov on the main thread), the branch the stream-copy
        // tests do NOT cover.
        expect(r!.gpmd, "GPMF track must inject on the re-encode path too").toBe(true);
        // Audio survives the re-encode: the 70mai source is AAC, so the pipeline
        // stream-copies its packets through the compositing export with NO audio
        // encoder (the codec-stripped-Chromium fix). A regression here = silent clip.
        expect(r!.soun, "audio (AAC passthrough) must survive the re-encode export").toBe(true);
    });

    test("re-encode single channel takes the composite-free path", async ({ page, browserName }) => {
        // One channel, source dimensions, no overlays, no watermark: nothing is
        // painted over the video, so the pipeline hands decoded frames straight to
        // the encoder instead of routing them through the composition canvas. The
        // only coverage of that branch - a source whose frames the encoder rejects
        // (or silently mis-renders) would otherwise ship a broken file.
        test.skip(browserName === "firefox", "Firefox WebCodecs H.264 encode is broken (Bugzilla 1918769)");
        test.skip(
            !(await canEncodeHighProfileH264(page)),
            "WebCodecs High-profile H.264 encode not available on this platform",
        );
        test.setTimeout(120_000);

        const includes = page.locator(".top-panel__channel-include");
        await includes.nth(2).click();
        await includes.nth(1).click();
        await expect(page.locator(".top-panel__channel-include:checked")).toHaveCount(1);

        // Below the top tier -> re-encode (the top tier would stream-copy instead).
        await page.locator('input[name="export-panel-quality"][value="medium"]').check();
        await page.locator("#export-panel-watermark").uncheck();

        await page.locator("#export-panel-save-btn").click();
        await expect(page.locator("#export-panel-done-summary")).toBeVisible({ timeout: 100_000 });

        const r = await readExportResult(page);
        expect(r, "re-encode must have written bytes").not.toBeNull();
        expect(r!.len, "re-encoded MP4 must be non-trivial").toBeGreaterThan(1024);
        expect(r!.ftyp).toBe(true);
        expect(r!.moov).toBe(true);
        expect(r!.mdat).toBe(true);
        expect(r!.soun, "audio must survive the composite-free re-encode").toBe(true);

        // The done-line reports how many frames skipped the canvas. Without this
        // the test would still pass with the fast path silently never engaging.
        const done = await readTranscodeDoneFields(page);
        expect(done, "the transcode worker must have logged its done line").not.toBeNull();
        expect(done!.framesEncoded, "frames must have been encoded").toBeGreaterThan(0);
        expect(done!.framesDirect, "every frame should have bypassed the canvas").toBe(done!.framesEncoded);
    });
});

// The destination dying mid-write. A sink failure is the one class of export
// failure the user can act on, and it reaches the error mapping only if its
// DOMException name survives - on the re-encode path that means surviving the
// worker port, which flattens errors to text. These two tests are the gate on
// that: a generic "something went wrong" here means the class was lost again.
test.describe("export run (the destination goes away)", () => {
    // The failure is injected on purpose, and the flow logs the raw cause to the
    // ring buffer (which mirrors to console.error) exactly as designed.
    test.use({ tolerateConsole: [/the destination is gone/] });

    const setup = async (page: Page, failure: ExportSinkFailure): Promise<void> => {
        await presetLocalStorage(page);
        await installExportCapture(page, failure);
        await page.setViewportSize(DESKTOP);
        await gotoApp(page, "en");
        await loadTrip(page, SAMPLE_70MAI);
        await openExport(page);
        // One channel: stream-copy eligible, and the cheapest re-encode too.
        const includes = page.locator(".top-panel__channel-include");
        await includes.nth(2).click();
        await includes.nth(1).click();
        await expect(page.locator(".top-panel__channel-include:checked")).toHaveCount(1);
    };

    test("stream-copy: names the real cause and offers a way to report it", async ({ page }) => {
        await setup(page, { afterBytes: 0, errorName: "NotFoundError" });

        await page.locator("#export-panel-save-btn").click();

        const status = page.locator(".export-panel__error-status");
        await expect(status).toBeVisible({ timeout: 60_000 });
        await expect(status, "a lost destination must not read as the generic failure").toContainText(
            "the file being written is gone",
        );

        // The report entry point: a failed export is where the ring buffer still
        // holds the run that died.
        const report = page.locator("#export-panel-error .feedback-link");
        await expect(report).toBeVisible();
        await report.click();
        await expect(page.locator("#feedback-modal")).toBeVisible();
    });

    test("re-encode: the failure keeps its class across the worker bridge", async ({ page, browserName }) => {
        test.skip(browserName === "firefox", "Firefox WebCodecs H.264 encode is broken (Bugzilla 1918769)");
        test.setTimeout(120_000);
        // Fail the first write. A byte threshold would not do: the muxer buffers
        // into 4 MiB chunks, so a short clip reaches the destination as a single
        // write at the end and a small file would slip under any threshold - the
        // run would then only trip on the telemetry pass, which is a different
        // (soft, notify-only) path.
        await setup(page, { afterBytes: 0, errorName: "NotFoundError" });
        test.skip(
            !(await canEncodeHighProfileH264(page)),
            "WebCodecs High-profile H.264 encode not available on this platform",
        );

        // Below the top tier -> re-encode in the worker (the top tier stream-copies).
        await page.locator('input[name="export-panel-quality"][value="medium"]').check();
        await page.locator("#export-panel-save-btn").click();

        const status = page.locator(".export-panel__error-status");
        await expect(status).toBeVisible({ timeout: 100_000 });
        await expect(status, "the DOMException name must survive the port hop").toContainText(
            "the file being written is gone",
        );
    });
});

// No native save picker (Android Chrome / Firefox / Safari): the export must NOT
// hang at "Finalizing" (the old ponyfill SW-streaming bug). It buffers the MP4
// in RAM and offers it via a done-view Download button. This is the regression
// gate for that fix.
test.describe("export run (in-memory, no native FSA)", () => {
    test.beforeEach(async ({ page }) => {
        await presetLocalStorage(page);
        await installInMemoryExportCapture(page); // before gotoApp - patched at bundle load
        await page.setViewportSize(DESKTOP);
        await gotoApp(page, "en");
        await loadTrip(page, SAMPLE_70MAI);
        await openExport(page);
    });

    test("stream-copy buffers in memory and offers a Download button with a valid MP4", async ({ page }) => {
        // Single channel -> stream-copy. GPMF kept by default; on the in-memory
        // handle the re-open + truncate+append injection works too.
        const includes = page.locator(".top-panel__channel-include");
        await expect(includes).toHaveCount(3);
        await includes.nth(2).click();
        await includes.nth(1).click();
        await expect(page.locator(".top-panel__channel-include:checked")).toHaveCount(1);

        // Degraded-notice half of graceful degradation: on a no-native-FSA browser
        // the panel must warn that the export builds in RAM BEFORE the user commits.
        // (The stub hides showSaveFilePicker -> nativeFsaAvailable() is false.)
        await expect(page.locator("#export-panel-fallback-warn")).toBeVisible();

        await page.locator("#export-panel-save-btn").click();
        // Must reach Done (not stuck at Finalizing) and surface a Download button.
        await expect(page.locator("#export-panel-done-summary")).toBeVisible({ timeout: 60_000 });
        const downloadBtn = page.locator("#export-panel-done-summary button");
        await expect(downloadBtn).toBeVisible();
        await downloadBtn.click();

        const r = await readInMemoryDownload(page);
        expect(r, "a video/mp4 blob must have been offered for download").not.toBeNull();
        expect(r!.len, "produced MP4 must be non-trivial").toBeGreaterThan(1024);
        expect(r!.ftyp).toBe(true);
        expect(r!.moov).toBe(true);
        expect(r!.mdat).toBe(true);
        expect(r!.gpmd, "GPMF track must inject on the in-memory handle too").toBe(true);
        expect(r!.soun, "audio must be copied into the in-memory stream-copy export").toBe(true);
    });

    test("re-encode buffers in memory and injects GPMF via the snapshot+walk fallback", async ({
        page,
        browserName,
    }) => {
        // The most complex path in this changeset, and the only one with no other
        // coverage: worker mux -> createWorkerWritableProxy -> InMemoryMuxWritable
        // commit -> postProcessTelemetry with NO capturedMoov -> handle.getFile()
        // snapshot + findMoovInFile -> InMemoryInjectionWritable staged replay ->
        // takeDownloadBlob. Keep all 3 channels -> split-screen -> re-encode.
        // Firefox: H.264 encode is broken (Bugzilla 1918769); skip Gecko explicitly
        // (the probe below can't detect it - isConfigSupported lies).
        test.skip(browserName === "firefox", "Firefox WebCodecs H.264 encode is broken (Bugzilla 1918769)");
        test.skip(
            !(await canEncodeHighProfileH264(page)),
            "WebCodecs High-profile H.264 encode not available on this platform",
        );
        test.setTimeout(120_000);
        await expect(page.locator(".top-panel__channel-include:checked")).toHaveCount(3);

        await page.locator("#export-panel-save-btn").click();
        await expect(page.locator("#export-panel-done-summary")).toBeVisible({ timeout: 100_000 });
        const downloadBtn = page.locator("#export-panel-done-summary button");
        await expect(downloadBtn).toBeVisible();
        await downloadBtn.click();

        const r = await readInMemoryDownload(page);
        expect(r, "a video/mp4 blob must have been offered for download").not.toBeNull();
        expect(r!.len, "re-encoded MP4 must be non-trivial").toBeGreaterThan(1024);
        expect(r!.ftyp).toBe(true);
        expect(r!.moov).toBe(true);
        expect(r!.mdat).toBe(true);
        expect(r!.gpmd, "GPMF must inject on the in-memory re-encode (snapshot+walk) path").toBe(true);
        expect(r!.soun, "audio (AAC passthrough) must survive the in-memory re-encode export").toBe(true);
    });
});
