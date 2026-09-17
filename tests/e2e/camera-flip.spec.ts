import { resolve } from "node:path";
import { rolldown } from "rolldown";
import type { renderFlippedFrames } from "../helpers/camera-flip-harness.js";
import {
    DESKTOP,
    MOBILE,
    REPO_ROOT,
    SAMPLE_70MAI,
    SAMPLE_NOGPS,
    SCREENSHOT_DIR,
    expect,
    gotoApp,
    installExportCapture,
    loadTrip,
    openExport,
    pausePlayback,
    presetLocalStorage,
    readTranscodeDoneFields,
    test,
} from "./_fixtures.js";

test.describe("camera reflection", () => {
    test("composition reflects each video before overlays, crops and privacy masks", async ({ page }) => {
        const bundle = await rolldown({
            input: resolve(REPO_ROOT, "tests/helpers/camera-flip-harness.ts"),
            platform: "browser",
            resolve: { extensionAlias: { ".js": [".ts", ".js"] } },
            transform: { define: { "import.meta.env": "{}" } },
        });
        let code: string;
        try {
            const output = await bundle.generate({ format: "es", codeSplitting: false });
            const chunk = output.output.find((entry) => entry.type === "chunk");
            if (!chunk) throw new Error("camera flip harness missing");
            code = chunk.code;
        } finally {
            await bundle.close();
        }
        await page.route("**/flip-harness.js", (route) =>
            route.fulfill({ contentType: "application/javascript", body: code }),
        );
        await page.route("**/flip-harness.html", (route) =>
            route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Camera reflection</title>" }),
        );
        await page.goto("/flip-harness.html");
        const result = await page.evaluate(async () => {
            const url = "/flip-harness.js";
            const module: { renderFlippedFrames: typeof renderFlippedFrames } = await import(url);
            return module.renderFlippedFrames();
        });
        const red = [255, 0, 0],
            green = [0, 255, 0],
            blue = [0, 0, 255],
            yellow = [255, 255, 0];
        expect(result.corners.map((frame) => frame.corners)).toEqual([
            [red, green, blue, yellow],
            [green, red, yellow, blue],
            [blue, yellow, red, green],
            [yellow, blue, green, red],
        ]);
        expect(result.corners.every((frame) => frame.overlay.every((value) => value === 255))).toBe(true);
        expect(result.crop).toEqual(yellow);
        expect(result.privacy).toEqual([yellow, [0, 0, 0]]);
        expect(result.mosaicAfter).toEqual(result.mosaicBefore);
        expect(result.mosaicAfter).toEqual(red);
        expect(result.split).toEqual([green, blue, blue, green]);
    });

    test("settings stay with the camera and channel across reloads and remain usable on mobile", async ({ page }) => {
        await presetLocalStorage(page);
        await page.setViewportSize(DESKTOP);
        await gotoApp(page, "en");
        await loadTrip(page, SAMPLE_70MAI);
        await pausePlayback(page);
        const front = page.locator('.video-tile[data-channel="front"]');
        const rear = page.locator('.video-tile[data-channel="rear"]');
        await front.locator(".camera-settings-button").click();
        await page.getByRole("menuitemcheckbox", { name: "Flip horizontally" }).click();
        await expect(front).toHaveClass(/camera-flipped/);
        await expect(rear).not.toHaveClass(/camera-flipped/);
        await page.keyboard.press("Escape");
        await expect(front.locator(".camera-settings-button")).toBeFocused();
        await page.reload();
        await loadTrip(page, SAMPLE_70MAI);
        await expect(front).toHaveClass(/camera-flipped/);
        await expect(rear).not.toHaveClass(/camera-flipped/);
        await front.locator(".camera-settings-button").click();
        await expect(page.getByRole("menuitemcheckbox", { name: "Flip horizontally" })).toHaveAttribute(
            "aria-checked",
            "true",
        );
        await page.screenshot({ path: `${SCREENSHOT_DIR}/camera-flip-desktop.png` });
        await page.keyboard.press("Escape");
        await page.setViewportSize(MOBILE);
        await front.locator(".camera-settings-button").click();
        await expect(front.getByRole("menu")).toBeInViewport({ ratio: 1 });
        await page.getByRole("menuitemcheckbox", { name: "Flip vertically" }).click();
        await page.screenshot({ path: `${SCREENSHOT_DIR}/camera-flip-mobile.png` });
        await page.keyboard.press("Escape");
        await gotoApp(page, "ru");
        await loadTrip(page, SAMPLE_70MAI);
        await front.locator(".camera-settings-button").click();
        await expect(page.getByRole("menuitemcheckbox", { name: "Отразить по горизонтали" })).toHaveAttribute(
            "aria-checked",
            "true",
        );
        await expect(page.getByRole("menuitemcheckbox", { name: "Отразить по вертикали" })).toHaveAttribute(
            "aria-checked",
            "true",
        );
        await page.screenshot({ path: `${SCREENSHOT_DIR}/camera-flip-ru.png` });
    });

    test("three reflected cameras export a playable file with the expected pixels", async ({ page }) => {
        test.setTimeout(120_000);
        await presetLocalStorage(page);
        await installExportCapture(page);
        await page.setViewportSize(DESKTOP);
        await gotoApp(page, "en");
        await loadTrip(page, SAMPLE_70MAI);
        await pausePlayback(page);
        await page.locator("#player-mini-progress").focus();
        await page.keyboard.press("Home");
        const flips = [
            { channel: "front", horizontal: true, vertical: false },
            { channel: "rear", horizontal: false, vertical: true },
            { channel: "interior", horizontal: true, vertical: true },
        ];
        for (const flip of flips) {
            await page.locator(`.video-tile[data-channel="${flip.channel}"] .camera-settings-button`).click();
            if (flip.horizontal) await page.getByRole("menuitemcheckbox", { name: "Flip horizontally" }).click();
            if (flip.vertical) await page.getByRole("menuitemcheckbox", { name: "Flip vertically" }).click();
            await page.keyboard.press("Escape");
        }
        await openExport(page);
        await page.locator("#export-panel-watermark").uncheck();
        await expect
            .poll(() =>
                page
                    .locator(".video-tile:not([hidden]) video:not(.preload-slot):not(.tile-blur-bg)")
                    .evaluateAll((videos) =>
                        videos.every(
                            (v) =>
                                v instanceof HTMLVideoElement && v.readyState >= 2 && !v.seeking && v.currentTime < 0.1,
                        ),
                    ),
            )
            .toBe(true);
        const expected = await page.evaluate((flips) => {
            const grid = document.querySelector(".video-grid")!.getBoundingClientRect();
            return flips.flatMap((flip) => {
                const tile = document.querySelector(`.video-tile[data-channel="${flip.channel}"]`)!;
                const rect = tile.getBoundingClientRect();
                const video = tile.querySelector<HTMLVideoElement>("video:not(.preload-slot):not(.tile-blur-bg)")!;
                const canvas = document.createElement("canvas");
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;
                const ctx = canvas.getContext("2d")!;
                ctx.drawImage(video, 0, 0);
                const scale = Math.min(rect.width / video.videoWidth, rect.height / video.videoHeight);
                const w = video.videoWidth * scale,
                    h = video.videoHeight * scale;
                return [0.2, 0.35].flatMap((x) =>
                    [0.2, 0.4].map((y) => ({
                        x: (rect.left - grid.left + (rect.width - w) / 2 + x * w) / grid.width,
                        y: (rect.top - grid.top + (rect.height - h) / 2 + y * h) / grid.height,
                        rgb: [
                            ...ctx.getImageData(
                                Math.floor((flip.horizontal ? 1 - x : x) * canvas.width),
                                Math.floor((flip.vertical ? 1 - y : y) * canvas.height),
                                1,
                                1,
                            ).data,
                        ].slice(0, 3),
                    })),
                );
            });
        }, flips);
        await page.locator("#export-panel-save-btn").click();
        await expect(page.locator("#export-panel-done-summary")).toBeVisible({ timeout: 100_000 });
        const result = await page.evaluate(async (expected) => {
            const handle = (window as unknown as { __lastExportHandle: { _buf: Uint8Array } }).__lastExportHandle;
            const url = URL.createObjectURL(new Blob([handle._buf.slice()], { type: "video/mp4" }));
            const video = document.createElement("video");
            video.muted = true;
            try {
                await new Promise<void>((resolve, reject) => {
                    video.onloadeddata = () => resolve();
                    video.onerror = () => reject(new Error("exported video cannot play"));
                    video.src = url;
                });
                // Seek within frame zero: loadeddata alone can precede a drawable image in Chromium.
                await new Promise<void>((resolve) => {
                    video.onseeked = () => resolve();
                    video.currentTime = 0.000001;
                });
                const canvas = document.createElement("canvas");
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;
                const ctx = canvas.getContext("2d")!;
                ctx.drawImage(video, 0, 0);
                return {
                    duration: video.duration,
                    errors: expected.map((point) => {
                        const actual = ctx.getImageData(
                            Math.floor(point.x * canvas.width),
                            Math.floor(point.y * canvas.height),
                            1,
                            1,
                        ).data;
                        return point.rgb.reduce((sum, value, i) => sum + Math.abs(value - actual[i]!), 0) / 3;
                    }),
                };
            } finally {
                video.removeAttribute("src");
                video.load();
                URL.revokeObjectURL(url);
            }
        }, expected);
        expect(result.duration).toBeCloseTo(4, 1);
        expect(Math.max(...result.errors), JSON.stringify(result)).toBeLessThan(20);
    });

    test("a reflected single-camera export cannot bypass composition", async ({ page }) => {
        test.setTimeout(120_000);
        await presetLocalStorage(page);
        await installExportCapture(page);
        await page.setViewportSize(DESKTOP);
        await gotoApp(page, "en");
        await loadTrip(page, SAMPLE_NOGPS);
        await page.locator(".video-tile:not([hidden]) .camera-settings-button").click();
        await page.getByRole("menuitemcheckbox", { name: "Flip horizontally" }).click();
        await page.keyboard.press("Escape");
        await openExport(page);
        await page.locator('input[name="export-panel-quality"][value="original"]').check();
        await page.locator("#export-panel-watermark").uncheck();
        await page.locator("#export-panel-save-btn").click();
        await expect(page.locator("#export-panel-done-summary")).toBeVisible({ timeout: 100_000 });
        const done = await readTranscodeDoneFields(page);
        expect(done).not.toBeNull();
        expect(done!.framesEncoded).toBeGreaterThan(0);
        expect(done!.framesDirect).toBe(0);
    });
});
