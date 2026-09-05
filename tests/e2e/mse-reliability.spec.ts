import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { createMseFixture } from "../helpers/mse-fixtures.js";
import { expect, gotoApp, loadTrip, presetLocalStorage, test } from "./_fixtures.js";

let fixtureDirectory: string;

interface QuotaFault {
    injected: boolean;
    retries: number;
    bufferedEnd: number;
    futureRemovals: number;
}

async function installQuotaFault(page: Page, minimumBufferedEnd = 6): Promise<void> {
    await page.evaluate((minimumBufferedEnd) => {
        const fault: QuotaFault = { injected: false, retries: 0, bufferedEnd: 0, futureRemovals: 0 };
        Object.assign(window, { mseQuotaFault: fault });
        const append = SourceBuffer.prototype.appendBuffer;
        const remove = SourceBuffer.prototype.remove;
        let rejected: Parameters<SourceBuffer["appendBuffer"]>[0] | null = null;
        SourceBuffer.prototype.appendBuffer = function (data) {
            if (data === rejected) fault.retries++;
            if (!fault.injected && this.buffered.length > 0 && this.buffered.end(0) >= minimumBufferedEnd) {
                fault.injected = true;
                fault.bufferedEnd = this.buffered.end(0);
                rejected = data;
                throw new DOMException("injected SourceBuffer capacity fault", "QuotaExceededError");
            }
            return append.call(this, data);
        };
        SourceBuffer.prototype.remove = function (start, end) {
            const video = document.querySelector<HTMLVideoElement>("#player");
            if (video && end > video.currentTime) fault.futureRemovals++;
            return remove.call(this, start, end);
        };
    }, minimumBufferedEnd);
}

function readQuotaFault(page: Page): Promise<QuotaFault> {
    return page.evaluate(() => (window as Window & { mseQuotaFault?: QuotaFault }).mseQuotaFault!);
}

test.beforeAll(async () => {
    fixtureDirectory = await mkdtemp(join(tmpdir(), "dashcamigo-mse-browser-"));
    for (const [name, options] of [
        ["long-gop", { gopDurationSec: 10, gopCount: 3 }],
        ["short-audio", { audioDurationSec: 0.4 }],
        ["seek-zero", { gopCount: 120, preserveFrameTiming: true }],
        ["audio-leading", { gopDurationSec: 10, gopCount: 3, audioDurationSec: 30, audioLeadSec: 1024 / 48000 }],
        ["matched-audio", { gopCount: 2, audioDurationSec: 2 }],
    ] as const) {
        const directory = join(fixtureDirectory, name);
        await mkdir(directory);
        await writeFile(join(directory, "clip.mkv"), await createMseFixture({ ...options, format: "matroska" }));
    }
    const tsDirectory = join(fixtureDirectory, "ts-audio");
    await mkdir(tsDirectory);
    await writeFile(
        join(tsDirectory, "clip.ts"),
        await createMseFixture({ format: "mpegts", gopCount: 30, audioDurationSec: 30 }),
    );
});

test.afterAll(async () => {
    if (fixtureDirectory) await rm(fixtureDirectory, { recursive: true, force: true });
});

test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
        const events: unknown[] = [];
        Object.assign(window, { mseEvents: events });
        for (const type of [
            "pause",
            "play",
            "waiting",
            "stalled",
            "ended",
            "loadedmetadata",
            "emptied",
            "ratechange",
        ]) {
            document.addEventListener(
                type,
                (event) => {
                    const video = event.target;
                    if (!(video instanceof HTMLVideoElement)) return;
                    events.push({
                        type,
                        id: video.id,
                        time: video.currentTime,
                        rate: video.playbackRate,
                        paused: video.paused,
                        buffered: Array.from({ length: video.buffered.length }, (_, i) => [
                            video.buffered.start(i),
                            video.buffered.end(i),
                        ]),
                    });
                },
                true,
            );
        }
    });
    await presetLocalStorage(page);
    await gotoApp(page, "en");
});

test.afterEach(async ({ page }, testInfo) => {
    if (testInfo.status === testInfo.expectedStatus) return;
    const diagnosis = await page.evaluate(() => ({
        events: (window as Window & { mseEvents?: unknown[] }).mseEvents,
        logs: window.__dashcamigo.dumpLog(),
        videos: Array.from(document.querySelectorAll("video"), (video) => ({
            id: video.id,
            time: video.currentTime,
            rate: video.playbackRate,
            ready: video.readyState,
            paused: video.paused,
            buffered: Array.from({ length: video.buffered.length }, (_, i) => [
                video.buffered.start(i),
                video.buffered.end(i),
            ]),
        })),
    }));
    const path = testInfo.outputPath("mse-diagnosis.json");
    await writeFile(path, JSON.stringify(diagnosis, null, 2));
    await testInfo.attach("mse-diagnosis", { path, contentType: "application/json" });
});

test("starts MSE playback when one GOP exceeds the ahead window", async ({ page }) => {
    await loadTrip(page, join(fixtureDirectory, "long-gop"));
    await expect
        .poll(() => page.locator("#player").evaluate((video: HTMLVideoElement) => video.currentTime))
        .toBeGreaterThan(4);
    // A trim inside the first GOP would evict its current decode dependencies.
    expect(await page.locator("#player").evaluate((video: HTMLVideoElement) => video.buffered.start(0))).toBe(0);
});

test("plays video past the end of a shorter audio track", async ({ page }) => {
    await loadTrip(page, join(fixtureDirectory, "short-audio"));
    await expect
        .poll(() => page.locator("#player").evaluate((video: HTMLVideoElement) => video.currentTime))
        .toBeGreaterThan(2);
});

test("retains an ordinary matched audio track in MSE playback", async ({ page }) => {
    await loadTrip(page, join(fixtureDirectory, "matched-audio"));
    await expect
        .poll(() => page.locator("#player").evaluate((video: HTMLVideoElement) => video.readyState))
        .toBeGreaterThanOrEqual(2);
    const audioTracks = await page.locator("#player").evaluate((video: HTMLVideoElement) => {
        const stream = (video as HTMLVideoElement & { captureStream(): MediaStream }).captureStream();
        const count = stream.getAudioTracks().length;
        for (const track of stream.getTracks()) track.stop();
        return count;
    });
    expect(audioTracks).toBe(1);
});

test("plays MPEG-TS video with AAC sound before and after a seek", async ({ page }) => {
    await loadTrip(page, join(fixtureDirectory, "ts-audio"));
    await expect
        .poll(() => page.locator("#player").evaluate((video: HTMLVideoElement) => video.currentTime))
        .toBeGreaterThan(1);
    await page.keyboard.press("5");
    await expect
        .poll(() => page.locator("#player").evaluate((video: HTMLVideoElement) => video.currentTime))
        .toBeGreaterThan(16);
    const audioTracks = await page.locator("#player").evaluate((video: HTMLVideoElement) => {
        const stream = (video as HTMLVideoElement & { captureStream(): MediaStream }).captureStream();
        const count = stream.getAudioTracks().length;
        for (const track of stream.getTracks()) track.stop();
        return count;
    });
    expect(audioTracks).toBe(1);
    expect(
        await page.evaluate(() =>
            window.__dashcamigo.dumpLog().filter((entry) => entry.msg.startsWith("backend fail")),
        ),
    ).toEqual([]);
});

test("seeks back to the initial position after MSE trims it", async ({ page }) => {
    await loadTrip(page, join(fixtureDirectory, "seek-zero"));
    await expect
        .poll(() => page.locator("#player").evaluate((video: HTMLVideoElement) => video.currentTime))
        .toBeGreaterThan(0.1);
    // Reach the trim threshold at the normal rate; changing playback speed
    // during decoder startup exercises a separate browser transition.
    await expect
        .poll(() => page.locator("#player").evaluate((video: HTMLVideoElement) => video.currentTime))
        .toBeGreaterThan(8);
    await page.locator("#player").evaluate((video: HTMLVideoElement) => video.pause());
    await expect
        .poll(() => page.locator("#player").evaluate((video: HTMLVideoElement) => video.buffered.start(0)))
        .toBeGreaterThan(0);
    await page.keyboard.press("0");
    await expect
        .poll(() => page.locator("#player").evaluate((video: HTMLVideoElement) => video.currentTime))
        .toBeLessThan(0.2);
    await expect
        .poll(() => page.locator("#player").evaluate((video: HTMLVideoElement) => video.readyState))
        .toBeGreaterThanOrEqual(2);
});

test("retries a quota-blocked append after playback frees a complete GOP", async ({ page }) => {
    await installQuotaFault(page);
    await loadTrip(page, join(fixtureDirectory, "seek-zero"));
    await expect.poll(async () => (await readQuotaFault(page)).retries).toBe(1);
    expect(await page.locator("#player").evaluate((video: HTMLVideoElement) => video.buffered.length)).toBe(1);
    await expect
        .poll(() => page.locator("#player").evaluate((video: HTMLVideoElement) => video.currentTime))
        .toBeGreaterThan(8);
    const fault = await readQuotaFault(page);
    expect(fault.injected).toBe(true);
    expect(fault.bufferedEnd).toBeGreaterThanOrEqual(6);
    expect(fault.futureRemovals).toBe(0);
    expect(fault.retries).toBe(1);
});

test("discards a quota-blocked append when seeking to a new feed cycle", async ({ page }) => {
    await installQuotaFault(page);
    await loadTrip(page, join(fixtureDirectory, "seek-zero"));
    await page.locator("#player").evaluate((video: HTMLVideoElement) => video.pause());
    await expect.poll(async () => (await readQuotaFault(page)).injected).toBe(true);
    expect((await readQuotaFault(page)).retries).toBe(0);
    await page.keyboard.press("5");
    await expect
        .poll(() => page.locator("#player").evaluate((video: HTMLVideoElement) => video.currentTime))
        .toBeGreaterThan(19);
    await expect
        .poll(() => page.locator("#player").evaluate((video: HTMLVideoElement) => video.readyState))
        .toBeGreaterThanOrEqual(2);
    await page.locator("#player").evaluate((video: HTMLVideoElement) => video.play());
    await expect
        .poll(() => page.locator("#player").evaluate((video: HTMLVideoElement) => video.currentTime))
        .toBeGreaterThan(21);
    expect((await readQuotaFault(page)).retries).toBe(0);
});

test("frees a complete video GOP when leading audio follows it in a separate fragment", async ({ page }) => {
    await installQuotaFault(page, 20);
    await loadTrip(page, join(fixtureDirectory, "audio-leading"));
    await expect.poll(async () => (await readQuotaFault(page)).injected).toBe(true);
    await expect
        .poll(() => page.locator("#player").evaluate((video: HTMLVideoElement) => video.currentTime))
        .toBeGreaterThan(6);
    await expect.poll(async () => (await readQuotaFault(page)).retries).toBe(1);
    await expect
        .poll(() => page.locator("#player").evaluate((video: HTMLVideoElement) => video.currentTime))
        .toBeGreaterThan(12);
    const fault = await readQuotaFault(page);
    expect(fault.bufferedEnd).toBeGreaterThanOrEqual(20);
    expect(fault.futureRemovals).toBe(0);
    expect(fault.retries).toBe(1);
});
