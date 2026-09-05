// Privacy blur zones: draw-on-tile editor, panel rows, the stream-copy gate
// (a zone MUST force re-encode - silently shipping the unblurred original is
// the feature's worst failure mode), and the actual burn-in. The burn-in test
// decodes the produced MP4 back in-page and compares pixel luma inside vs
// outside the zone - the only spec that re-decodes output pixels, because for
// a privacy feature box markers prove nothing about the pixels.

import {
    DESKTOP,
    SAMPLE_70MAI,
    canEncodeHighProfileH264,
    expect,
    gotoApp,
    hasWebGpuAdapter,
    installExportCapture,
    loadTrip,
    openExport,
    presetLocalStorage,
    test,
} from "./_fixtures.js";
import type { Page } from "@playwright/test";

/** Drags a marquee on the front tile's draw layer between two fractional
 *  points of the layer box. */
async function drawZone(page: Page, x0: number, y0: number, x1: number, y1: number): Promise<void> {
    await page.locator(".export-panel__blur-add-btn").click();
    const layer = page.locator('.video-tile[data-channel="front"] .blur-draw-layer');
    await expect(layer).toBeVisible();
    const box = await layer.boundingBox();
    expect(box).not.toBeNull();
    const b = box!;
    await page.mouse.move(b.x + b.width * x0, b.y + b.height * y0);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width * x1, b.y + b.height * y1, { steps: 6 });
    await page.mouse.up();
}

/** The drawn zone's rect in normalized SOURCE coordinates, recovered from the
 *  on-screen box geometry against the video's contain-fit content rect (the
 *  same mapping the app uses; no crop is set in these tests). */
async function zoneSourceRect(page: Page): Promise<{ x: number; y: number; w: number; h: number }> {
    return page.evaluate(() => {
        const tile = document.querySelector<HTMLElement>('.video-tile[data-channel="front"]');
        const boxEl = tile?.querySelector<HTMLElement>(".blur-box:not([hidden])");
        // A tile holds TWO <video> elements (active + hidden preload slot);
        // the preload one has videoWidth=0 and would NaN the whole mapping.
        const video = [...(tile?.querySelectorAll<HTMLVideoElement>("video") ?? [])].find((v) => v.videoWidth > 0);
        if (!tile || !boxEl || !video) throw new Error("zone box / video not found");
        const tr = tile.getBoundingClientRect();
        const br = boxEl.getBoundingClientRect();
        const videoAspect = video.videoWidth / video.videoHeight;
        const tileAspect = tr.width / tr.height;
        let dw: number;
        let dh: number;
        if (videoAspect > tileAspect) {
            dw = tr.width;
            dh = tr.width / videoAspect;
        } else {
            dh = tr.height;
            dw = tr.height * videoAspect;
        }
        const dx = (tr.width - dw) / 2;
        const dy = (tr.height - dh) / 2;
        return {
            x: (br.left - tr.left - dx) / dw,
            y: (br.top - tr.top - dy) / dh,
            w: br.width / dw,
            h: br.height / dh,
        };
    });
}

test.describe("blur regions", () => {
    test.beforeEach(async ({ page }) => {
        await presetLocalStorage(page);
        await installExportCapture(page, undefined, { pickerDelayMs: 500 }); // before gotoApp - captured at bundle load
        await page.setViewportSize(DESKTOP);
        await gotoApp(page, "en");
        await loadTrip(page, SAMPLE_70MAI);
        await openExport(page);
        // Single channel -> the stream-copy path is reachable, so the gate
        // assertion below is meaningful.
        const includes = page.locator(".top-panel__channel-include");
        await expect(includes).toHaveCount(3);
        await includes.nth(2).click();
        await includes.nth(1).click();
        await expect(page.locator(".top-panel__channel-include:checked")).toHaveCount(1);
    });

    test("draw zone: row appears, box editable, stream-copy tier relabels", async ({ page }) => {
        const topTier = page.locator('.export-panel__radio:has(input[value="original"]) strong');
        await expect(topTier).toHaveText("Original");

        await drawZone(page, 0.4, 0.4, 0.6, 0.6);

        // Row in the panel + live box on the tile.
        await expect(page.locator(".export-panel__blur-row")).toHaveCount(1);
        await expect(page.locator('.video-tile[data-channel="front"] .blur-box:not([hidden])')).toBeVisible();
        // The zone forces re-encode: the top tier stops claiming stream-copy.
        await expect(topTier).toHaveText("High");

        // Delete via the header button - everything unwinds, stream-copy returns.
        await page.locator(".export-panel__blur-del-btn").click();
        await expect(page.locator(".export-panel__blur-row")).toHaveCount(0);
        await expect(page.locator('.video-tile[data-channel="front"] .blur-box')).toHaveCount(0);
        await expect(topTier).toHaveText("Original");
    });

    test("manual timing: setters + whole-clip shortcut", async ({ page }) => {
        await drawZone(page, 0.4, 0.4, 0.6, 0.6);
        const seg = page.locator(".export-panel__blur-duration");
        // A freshly drawn zone uses hand-set timing (autoEnd off); tracked
        // geometry, if added later, is independent of that choice.
        await expect(
            seg.getByRole("button", { name: "Set the start and end yourself; tracked motion stays" }),
        ).toHaveAttribute("aria-pressed", "true");
        await expect(page.locator(".export-panel__blur-row-actions button")).toHaveCount(3);
        // Whole-clip stays in manual timing; the setters remain.
        await page.getByRole("button", { name: "Keep this zone active for the whole clip" }).click();
        await expect(
            seg.getByRole("button", { name: "Set the start and end yourself; tracked motion stays" }),
        ).toHaveAttribute("aria-pressed", "true");
        await expect(page.locator(".export-panel__blur-row-actions button")).toHaveCount(3);
    });

    test("zone can be moved and resized from the keyboard", async ({ page }) => {
        await drawZone(page, 0.4, 0.4, 0.6, 0.6);
        const box = page.getByRole("group", {
            name: "Zone 1 · Front camera. Edit blur zone. Arrows move; Shift plus arrows resize.",
        });
        await expect(box).toBeVisible();
        const before = await zoneSourceRect(page);

        await box.focus();
        await page.keyboard.press("ArrowRight");
        await expect.poll(async () => (await zoneSourceRect(page)).x).toBeGreaterThan(before.x);
        const moved = await zoneSourceRect(page);
        expect(moved.w).toBeCloseTo(before.w, 2);

        await page.keyboard.press("Shift+ArrowRight");
        // Geometry paints on the blur preview's next rAF; poll instead of
        // sampling in the same task as keydown.
        await expect.poll(async () => (await zoneSourceRect(page)).w).toBeGreaterThan(moved.w);
    });

    test("paused blur preview sleeps and wakes for seeks, playback and resize", async ({ page }, testInfo) => {
        await drawZone(page, 0.4, 0.4, 0.6, 0.6);
        const canvas = page.locator('.video-tile[data-channel="front"] .blur-preview-canvas');
        await expect(page.locator('.video-tile[data-channel="front"] .blur-box:not([hidden])')).toBeVisible();
        const work = await canvas.evaluate(async (el: HTMLCanvasElement) => {
            const video = el.parentElement?.querySelector<HTMLVideoElement>(
                "video:not(.preload-slot):not(.tile-blur-bg)",
            );
            const ctx = el.getContext("2d");
            const descriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "currentTime");
            if (!video || !ctx || !descriptor?.get || !descriptor.set) throw new Error("preview unavailable");
            const read = descriptor.get;
            const write = descriptor.set;
            const clear = ctx.clearRect;
            let reads = 0;
            let paints = 0;
            const settle = async (): Promise<void> => {
                await new Promise<void>((resolve) =>
                    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
                );
            };
            video.pause();
            await settle();
            Object.defineProperty(video, "currentTime", {
                configurable: true,
                get() {
                    reads++;
                    return read.call(video);
                },
                set(value: number) {
                    write.call(video, value);
                },
            });
            ctx.clearRect = (...args) => {
                paints++;
                clear.apply(ctx, args);
            };
            try {
                await new Promise((resolve) => setTimeout(resolve, 1000));
                const idleReads = reads;
                const idlePaints = paints;
                const seeked = new Promise<void>((resolve) =>
                    video.addEventListener("seeked", () => resolve(), { once: true }),
                );
                video.currentTime = Math.min(video.duration / 2, video.currentTime + 0.5);
                await seeked;
                await settle();
                const seekPaints = paints - idlePaints;
                const beforePlay = paints;
                await video.play();
                await new Promise((resolve) => setTimeout(resolve, 250));
                video.pause();
                await settle();
                return { idleReads, idlePaints, seekPaints, playbackPaints: paints - beforePlay };
            } finally {
                Reflect.deleteProperty(video, "currentTime");
                ctx.clearRect = clear;
            }
        });
        expect(work.idleReads, "paused blur does not poll the media clock at display refresh rate").toBeLessThanOrEqual(
            20,
        );
        expect(work.idlePaints, "paused preview keeps the painted pixels").toBeLessThanOrEqual(1);
        expect(work.seekPaints, "a paused seek redraws the decoded frame").toBeGreaterThan(0);
        expect(work.playbackPaints, "playback resumes continuous redraws").toBeGreaterThan(1);

        const before = await zoneSourceRect(page);
        const oldWidth = await canvas.evaluate((el: HTMLCanvasElement) => el.width);
        await page.setViewportSize({ width: 1100, height: DESKTOP.height });
        await expect.poll(() => canvas.evaluate((el: HTMLCanvasElement) => el.width)).not.toBe(oldWidth);
        const resized = await zoneSourceRect(page);
        expect(resized.x).toBeCloseTo(before.x, 2);
        expect(resized.w).toBeCloseTo(before.w, 2);

        await page.locator(".export-panel__crop-btn").click();
        await expect(page.locator(".crop-editor")).toBeVisible();
        await expect(page.locator(".blur-box-layer")).toBeHidden();
        await page.locator(".crop-done-btn").click();
        await expect(page.locator(".crop-editor")).toHaveCount(0);
        await expect(page.locator('.video-tile[data-channel="front"] .blur-box:not([hidden])')).toBeVisible();
        await testInfo.attach("blur-preview-work", { body: JSON.stringify(work), contentType: "application/json" });
    });

    test("escape cancels drawing without creating a zone", async ({ page }) => {
        await page.locator(".export-panel__blur-add-btn").click();
        await expect(page.locator(".blur-draw-layer").first()).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(page.locator(".blur-draw-layer")).toHaveCount(0);
        await expect(page.locator(".export-panel__blur-row")).toHaveCount(0);
        // Export-mode itself must survive that Escape (the capture-phase
        // handler swallows it, same contract as the crop editor).
        await expect(page.locator("#export-panel")).toBeVisible();
    });

    test("Follow gates on the one-time download, then tracks and keeps the zone editable", async ({ page }) => {
        // Real asset download (~14 MB, warmed on the main thread) + vittrack
        // inference over the sample clip (WASM). Deterministic input ->
        // deterministic pass; we assert the lifecycle (consent -> download ->
        // follow -> settled, zone intact), not specific box coordinates.
        test.setTimeout(180_000);
        await drawZone(page, 0.4, 0.4, 0.6, 0.6);
        await expect(page.locator(".export-panel__blur-row")).toHaveCount(1);

        const followBtn = page.locator(".export-panel__blur-follow-btn");
        await expect(followBtn).toHaveText("Follow");

        // First Follow on a fresh device: consent strip, no tracking yet.
        await followBtn.click();
        const strip = page.locator(".export-panel__blur-tracker");
        await expect(strip).toBeVisible();
        await expect(page.locator("#export-panel-save-btn")).toBeDisabled();
        await expect(page.locator("#export-panel-follow-save-note")).toHaveText(
            "Finish or cancel Follow before saving.",
        );
        await strip.getByRole("button", { name: "Download & follow" }).click();

        // Download runs, then the follow pass starts (button flips to the
        // running label with live percent, e.g. "Following… 42%") and later
        // settles back to "Follow".
        await expect(followBtn).toHaveText(/Following…/, { timeout: 90_000 });
        await expect(followBtn).toHaveText("Follow", { timeout: 90_000 });
        await expect(page.locator("#export-panel-save-btn")).toBeEnabled();

        // The strip is gone once the assets are ready, and the zone survived the
        // pass with its box still live on the tile.
        await expect(strip).toBeHidden();
        await expect(page.locator(".export-panel__blur-row")).toHaveCount(1);
        await expect(page.locator('.video-tile[data-channel="front"] .blur-box:not([hidden])')).toBeVisible();
    });

    test("plate checkbox gates on the model download, scans the range and reports a count", async ({ page }) => {
        // Real model download (webgpu ort runtime + plate model, from the
        // local server) + a real detector pass over the 4 s sample - headless
        // Chromium's SwiftShader adapter is what the pass runs on, same
        // webgpu-only path as production (no wasm fallback exists). The
        // synthetic clip has no plates, so the
        // honest settled state is a zero count - the assertion is the LIFECYCLE
        // (consent -> download -> scan -> count row), not detections.
        //
        // Detection is WebGPU-only; without a real adapter the checkbox is
        // disabled and .check() below would hang the whole 180 s. Skip cleanly
        // instead (CI's SwiftShader provides an adapter, so it runs there).
        test.skip(!(await hasWebGpuAdapter(page)), "WebGPU adapter unavailable - plate detection is WebGPU-only");
        test.setTimeout(180_000);
        const platesCb = page.locator("#export-panel-blur-plates");
        await expect(platesCb).toBeVisible();
        // A pending scan must gate stream-copy - the top tier stops claiming
        // "Original" the moment the checkbox is on (privacy over copy speed).
        const topTier = page.locator('.export-panel__radio:has(input[value="original"]) strong');
        await expect(topTier).toHaveText("Original");
        await platesCb.check();
        await expect(topTier).toHaveText("High");

        // Fresh device: the detect consent strip appears; the Follow strip stays out.
        const strip = page.locator(".export-panel__blur-detect-strip");
        await expect(strip).toBeVisible();
        await expect(page.locator(".export-panel__blur-tracker")).toBeHidden();
        await strip.getByRole("button", { name: "Download & scan" }).click();

        // Scan settles into the found-count row; nothing found -> stream-copy
        // is honestly available again.
        const status = page.locator(".export-panel__blur-detect-status");
        await expect(status).toHaveText(/Plates: 0/, { timeout: 120_000 });
        await expect(strip).toBeHidden();
        await expect(topTier).toHaveText("Original");
    });

    test("detect consent 'Not now' unchecks the box and hides the strip", async ({ page }) => {
        // Same WebGPU gate as the scan test: a disabled checkbox makes .check() hang.
        test.skip(!(await hasWebGpuAdapter(page)), "WebGPU adapter unavailable - plate detection is WebGPU-only");
        const platesCb = page.locator("#export-panel-blur-plates");
        await platesCb.check();
        const strip = page.locator(".export-panel__blur-detect-strip");
        await expect(strip).toBeVisible();
        await strip.getByRole("button", { name: "Not now" }).click();
        // A checked box with no model would silently protect nothing - "Not
        // now" must roll the checkbox back, not leave a dead promise.
        await expect(platesCb).not.toBeChecked();
        await expect(strip).toBeHidden();
    });

    test("both detect checkboxes are disabled with the why-note without WebGPU", async ({ page }) => {
        // Detection is WebGPU-only for both kinds (blur-detect.ts). Headless
        // Chromium on this suite DOES expose a (SwiftShader) adapter, so the
        // no-GPU state is forced deterministically: kill navigator.gpu before
        // the app bundle loads, then walk through a fresh app load in-place.
        await page.context().addInitScript(() => {
            Object.defineProperty(Navigator.prototype, "gpu", { get: () => undefined });
        });
        await gotoApp(page, "en");
        await loadTrip(page, SAMPLE_70MAI);
        await openExport(page);
        await expect(page.locator("#export-panel-blur-faces")).toBeDisabled();
        await expect(page.locator("#export-panel-blur-plates")).toBeDisabled();
        await expect(page.getByText("Automatic plate and face finding isn't available in this browser")).toBeVisible();
        // The degradation is detect-only - manual zones with Follow stay
        // available (vittrack runs on wasm).
        await expect(page.locator(".export-panel__blur-add-btn")).toBeEnabled();
    });

    test("solid-cover zone is actually burned into the exported pixels", async ({ page, browserName }) => {
        test.skip(browserName === "firefox", "Firefox WebCodecs H.264 encode is broken (Bugzilla 1918769)");
        test.skip(
            !(await canEncodeHighProfileH264(page)),
            "WebCodecs High-profile H.264 encode not available on this platform",
        );
        test.setTimeout(120_000);

        await drawZone(page, 0.35, 0.35, 0.65, 0.65);
        // The box element is positioned by the preview rAF loop - wait for it.
        await expect(page.locator('.video-tile[data-channel="front"] .blur-box:not([hidden])')).toBeVisible();
        const zone = await zoneSourceRect(page);
        for (const v of Object.values(zone)) {
            expect(Number.isFinite(v), `zone rect must be finite: ${JSON.stringify(zone)}`).toBe(true);
        }
        // "fill" burns pure black - the strongest, and the only style with a
        // deterministic pixel assertion.
        await page.locator("#export-panel-blur-style").selectOption("fill");

        await page.locator("#export-panel-save-btn").click();
        await expect
            .poll(() =>
                page.evaluate(
                    () => (window as unknown as { __exportPickerOpened?: boolean }).__exportPickerOpened === true,
                ),
            )
            .toBe(true);
        // Adversarially edit the still-visible form while the async picker is
        // pending. The run must keep the fill style captured at Save; the old
        // flow re-read this mutable region later and exported pixelation. Real
        // interaction is inert now; dispatch directly to keep the race test.
        await expect(page.locator("#export-panel-options")).toHaveAttribute("aria-busy", "true");
        await page.evaluate(() => {
            const select = document.querySelector<HTMLSelectElement>("#export-panel-blur-style");
            if (!select) throw new Error("blur style select missing");
            select.value = "pixelate";
            select.dispatchEvent(new Event("change", { bubbles: true }));
        });
        await expect(page.locator("#export-panel-progress")).toBeVisible();
        await expect(page.locator(".export-panel__progress-bar")).toHaveAttribute("role", "progressbar");
        // E cannot hide a live export or expose editable boxes behind it.
        await page.keyboard.press("e");
        await expect(page.locator("#export-panel")).toBeVisible();
        await expect(page.locator("#export-panel-progress")).toBeVisible();
        await expect(page.locator(".blur-box-layer")).toBeHidden();
        await expect(page.locator("#export-panel-done-summary")).toBeVisible({ timeout: 60_000 });

        // Decode the produced MP4 in-page (bytes never leave the browser) and
        // compare mean luma: deep inside the zone vs a ring around it.
        const luma = await page.evaluate(async (z) => {
            const h = (window as unknown as { __lastExportHandle?: { _buf: Uint8Array } }).__lastExportHandle;
            if (!h || h._buf.length === 0) throw new Error("no export bytes captured");
            // Copy into a fresh ArrayBuffer-backed view for the Blob ctor.
            const bytes = new Uint8Array(h._buf);
            const url = URL.createObjectURL(new Blob([bytes], { type: "video/mp4" }));
            const video = document.createElement("video");
            video.muted = true;
            video.src = url;
            await new Promise<void>((res, rej) => {
                video.onloadeddata = () => res();
                video.onerror = () => rej(new Error("decode failed"));
            });
            for (let i = 0; i < 40 && video.videoWidth === 0; i++) {
                await new Promise((res) => setTimeout(res, 50));
            }
            if (video.videoWidth === 0) throw new Error("exported video has no dimensions");
            // Mid-zone moment: the zone spans playhead(0)..+5s and the sample
            // clip is ~5s, so 1s is safely inside.
            video.currentTime = Math.min(1, video.duration / 2);
            await new Promise<void>((res) => {
                video.onseeked = () => res();
            });
            const canvas = document.createElement("canvas");
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            const ctx = canvas.getContext("2d");
            if (!ctx) throw new Error("no 2d ctx");
            ctx.drawImage(video, 0, 0);
            const mean = (fx: number, fy: number, fw: number, fh: number): number => {
                const x = Math.max(0, Math.round(fx * canvas.width));
                const y = Math.max(0, Math.round(fy * canvas.height));
                const w = Math.max(1, Math.min(canvas.width - x, Math.round(fw * canvas.width)));
                const hgt = Math.max(1, Math.min(canvas.height - y, Math.round(fh * canvas.height)));
                const d = ctx.getImageData(x, y, w, hgt).data;
                let sum = 0;
                for (let i = 0; i < d.length; i += 4) {
                    sum += 0.2126 * d[i]! + 0.7152 * d[i + 1]! + 0.0722 * d[i + 2]!;
                }
                return sum / (d.length / 4);
            };
            // Inside: shrink 25% inward to dodge boundary rounding/bleed.
            const inx = z.x + z.w * 0.25;
            const iny = z.y + z.h * 0.25;
            const inside = mean(inx, iny, z.w * 0.5, z.h * 0.5);
            // Outside: two horizontal strips above and below the zone.
            const stripH = Math.min(z.h * 0.5, z.y, 1 - z.y - z.h);
            const above = mean(z.x, z.y - stripH, z.w, stripH * 0.9);
            const below = mean(z.x, z.y + z.h + stripH * 0.1, z.w, stripH * 0.9);
            URL.revokeObjectURL(url);
            return { inside, outside: (above + below) / 2 };
        }, zone);

        // Solid black + encoder noise stays near zero; the surrounding video
        // content must be meaningfully brighter or the patch missed its spot.
        expect(luma.inside, `inside=${luma.inside} outside=${luma.outside}`).toBeLessThan(16);
        expect(luma.outside - luma.inside, "zone must be darker than its surroundings").toBeGreaterThan(24);
    });
});
