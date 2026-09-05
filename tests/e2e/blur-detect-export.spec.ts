import { readFileSync } from "node:fs";
import path from "node:path";

import {
    DESKTOP,
    SAMPLE_70MAI,
    expect,
    gotoApp,
    hasWebGpuAdapter,
    installExportCapture,
    openExport,
    presetLocalStorage,
    readExportResult,
    test,
} from "./_fixtures.js";

test("Save keeps an adopted detection pass when playback switches trips", async ({ page }) => {
    test.setTimeout(120_000);
    await presetLocalStorage(page);
    await installExportCapture(page);
    await page.addInitScript(() => {
        const target = window as typeof window & {
            __detectResponseHeld?: boolean;
            __releaseDetectResponse?: () => void;
        };
        let released = false;
        const pending: Array<() => void> = [];
        target.__releaseDetectResponse = () => {
            released = true;
            for (const deliver of pending.splice(0)) deliver();
        };
        const NativeWorker = window.Worker;
        window.Worker = class extends NativeWorker {
            constructor(scriptURL: string | URL, options?: WorkerOptions) {
                super(scriptURL, options);
                if (options?.name !== "tracker-worker") return;
                // Hold the real inference result at the message boundary so
                // Save has to adopt background work still pending in the UI.
                this.addEventListener("message", (event: MessageEvent<unknown>) => {
                    const message = event.data;
                    if (
                        released ||
                        !message ||
                        typeof message !== "object" ||
                        !("__k" in message) ||
                        message.__k !== "res"
                    )
                        return;
                    event.stopImmediatePropagation();
                    target.__detectResponseHeld = true;
                    pending.push(() => this.dispatchEvent(new MessageEvent("message", { data: message })));
                });
            }
        };
    });
    await page.setViewportSize(DESKTOP);
    await gotoApp(page, "en");
    test.skip(!(await hasWebGpuAdapter(page)), "WebGPU adapter unavailable - detection is WebGPU-only");

    const buffer = readFileSync(path.join(SAMPLE_70MAI, "Normal/Front/NO20260101-120000-000001F.MP4"));
    await page.locator("#file-input").setInputFiles([
        { name: "NO20260101-120000-000001F.MP4", mimeType: "video/mp4", buffer },
        { name: "NO20260102-120000-000001F.MP4", mimeType: "video/mp4", buffer },
    ]);
    const trips = page.locator("li.trip:not(.unindexed-note)");
    await expect(trips).toHaveCount(2);
    await trips.first().locator(".trip-header").click();
    await openExport(page);
    await page.locator("#export-panel-blur-plates").check();
    await page.locator(".export-panel__blur-detect-strip").getByRole("button", { name: "Download & scan" }).click();
    await expect
        .poll(() =>
            page.evaluate(() => (window as typeof window & { __detectResponseHeld?: boolean }).__detectResponseHeld),
        )
        .toBe(true);

    await page.locator("#export-panel-save-btn").click();
    await expect(page.getByText("Finding plates and faces...", { exact: true })).toBeVisible();
    // Export hides the sidebar, but playback can still advance the active
    // trip. Exercise its navigation handler while Save awaits this response.
    await trips.last().locator(".trip-header").dispatchEvent("click");
    await expect(trips.last()).toHaveClass(/\bactive\b/);
    await page.evaluate(() => {
        const release = (window as typeof window & { __releaseDetectResponse?: () => void }).__releaseDetectResponse;
        if (!release) throw new Error("detect response release missing");
        release();
    });
    await expect.poll(async () => (await readExportResult(page))?.len ?? 0, { timeout: 60_000 }).toBeGreaterThan(1024);
    const result = await readExportResult(page);
    expect(result?.ftyp).toBe(true);
    expect(result?.moov).toBe(true);
    expect(result?.mdat).toBe(true);
});
