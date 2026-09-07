import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { DESKTOP, SAMPLE_70MAI, expect, gotoApp, loadTrip, presetLocalStorage, shot, test } from "./_fixtures.js";

const temporaryDirectories: string[] = [];

function cameraFolder(frontOffsetSec: number, hasRecognizedNames = true): string {
    const directory = mkdtempSync(path.join(tmpdir(), "dashcamigo-recognition-cameras-"));
    temporaryDirectories.push(directory);
    // Keep real playable streams while reproducing disagreement between the
    // recording names and container clocks. No application state is injected.
    const streams = [
        { channel: "F", offset: frontOffsetSec, sample: "Normal/Front/NO20260101-120000-000001F.MP4" },
        { channel: "R", offset: 0, sample: "Normal/Back/NO20260101-120000-000001B.MP4" },
    ];
    for (let minute = 0; minute < 3; minute++) {
        for (const stream of streams) {
            const bytes = readFileSync(path.join(SAMPLE_70MAI, stream.sample));
            const mvhd = bytes.indexOf("mvhd", 0, "ascii");
            if (mvhd < 0 || bytes[mvhd + 4] !== 0) throw new Error("fixture needs a version-0 mvhd box");
            const creationTime = Date.UTC(2026, 0, 1, 12, minute, stream.offset) / 1000 + 2_082_844_800;
            bytes.writeUInt32BE(creationTime, mvhd + 8);
            bytes.writeUInt32BE(creationTime, mvhd + 12);
            const clock = `12${String(minute).padStart(2, "0")}00`;
            const name = hasRecognizedNames
                ? `20260101_${clock}_N${stream.channel}.mp4`
                : `recording-20260101${clock}-${stream.channel === "F" ? "first" : "second"}.mp4`;
            writeFileSync(path.join(directory, name), bytes);
        }
    }
    return directory;
}

test.describe("camera recognition help", () => {
    test.use({ viewport: DESKTOP, timezoneId: "UTC" });

    test.beforeEach(async ({ page }) => {
        await presetLocalStorage(page);
        await gotoApp(page);
    });

    test.afterEach(() => {
        for (const directory of temporaryDirectories.splice(0)) {
            rmSync(directory, { recursive: true, force: true });
        }
    });

    test("offers support for repeated recognized cameras that remain separate after analysis", async ({ page }) => {
        await loadTrip(page, cameraFolder(20));
        await expect(page.locator("#recognition-banner")).toBeVisible({ timeout: 30_000 });
        await expect(page.locator("#trip-analysis-status")).toBeHidden();
        await expect(page.locator(".viewer")).not.toHaveClass(/preparing|codec-unsupported|playback-failed/);
        await expect(page.locator("#recognition-cameras-body")).toBeVisible();
        await expect(page.locator("#recognition-gps-body")).toBeHidden();
        await expect(page.locator("#recognition-contact")).toHaveAttribute("data-feedback-preset", "cameras");
        await expect(page.locator("#recognition-banner")).toHaveCSS("opacity", "1");
        await shot(page, "recognition-camera-invitation");

        await page.locator("#recognition-contact").click();
        await expect(page.locator("#feedback-modal")).toBeVisible();
        await expect(page.locator("#recognition-banner")).toBeHidden();
        await expect(page.locator("#feedback-primary")).toBeVisible();
        await expect(page.locator("#feedback-context-help")).toBeVisible();
        await page.locator("#feedback-cancel").click();
        await expect(page.locator("#player-play")).toBeFocused();
        await expect(page.locator("#recognition-banner")).toBeHidden();
    });

    test("keeps a dismissed invitation closed when the same recordings are selected again", async ({ page }) => {
        const directory = cameraFolder(20);
        await loadTrip(page, directory);
        await expect(page.locator("#recognition-banner")).toBeVisible({ timeout: 30_000 });
        await page.locator("#recognition-later").click();
        await expect(page.locator("#recognition-banner")).toBeHidden();
        await expect(page.locator("#player-play")).toBeFocused();

        await page.locator("#folder-input").setInputFiles(directory);
        await expect(page.locator("#trip-list")).toHaveAttribute("aria-busy", "false", { timeout: 30_000 });
        await page.locator("#trip-sort-dir").click();
        await expect(page.locator("#recognition-banner")).toBeHidden();
        await expect(page.locator("#feedback-modal")).toBeHidden();
    });

    test("leaves correctly paired recordings without GPS free of automatic warnings", async ({ page }) => {
        await loadTrip(page, cameraFolder(0));
        await expect(page.locator("#trip-analysis-status")).toBeHidden({ timeout: 30_000 });
        await expect(page.locator("#video-grid")).toHaveAttribute("data-channel-count", "2");
        await page.locator("#trip-sort-dir").click();
        await expect(page.locator("#recognition-banner")).toBeHidden();
    });

    test("does not speculate about cameras in unfamiliar filenames", async ({ page }) => {
        await loadTrip(page, cameraFolder(20, false));
        await expect(page.locator("#trip-analysis-status")).toBeHidden({ timeout: 30_000 });
        await page.locator("#trip-sort-dir").click();
        await expect(page.locator("#recognition-banner")).toBeHidden();
    });
});
