import type { Page } from "@playwright/test";
import { DESKTOP, SAMPLE_70MAI, expect, gotoApp, loadTrip, presetLocalStorage, test } from "./_fixtures.js";

test.use({
    serviceWorkers: "block",
    launchOptions: {
        args: [
            "--disable-background-timer-throttling",
            "--disable-backgrounding-occluded-windows",
            "--disable-renderer-backgrounding",
        ],
    },
});

async function waitForMapIdle(page: Page): Promise<void> {
    await page.evaluate(
        () =>
            new Promise<void>((resolve, reject) => {
                const map = window.__dashcamigo.state.map;
                if (!map) throw new Error("map unavailable");
                const timeout = setTimeout(() => {
                    map.off("idle", onIdle);
                    reject(new Error("map did not settle"));
                }, 5000);
                const onIdle = (): void => {
                    clearTimeout(timeout);
                    map.off("idle", onIdle);
                    resolve();
                };
                map.on("idle", onIdle);
                map.triggerRepaint();
            }),
    );
}

async function seekPaused(page: Page, time: number): Promise<void> {
    await page.evaluate(async (target) => {
        const player = window.__dashcamigo.dom.player;
        player.pause();
        if (Math.abs(player.currentTime - target) < 0.0001) return;
        await new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => {
                player.removeEventListener("seeked", onSeeked);
                reject(new Error("paused seek did not finish"));
            }, 5000);
            const onSeeked = (): void => {
                clearTimeout(timeout);
                player.removeEventListener("seeked", onSeeked);
                resolve();
            };
            player.addEventListener("seeked", onSeeked);
            player.currentTime = target;
        });
    }, time);
    await expect
        .poll(() =>
            page.evaluate(() => {
                const player = window.__dashcamigo.dom.player;
                return player.paused && !player.seeking && player.readyState >= 2;
            }),
        )
        .toBe(true);
}

async function openChase(page: Page, withoutFrameCallbacks = false): Promise<void> {
    await presetLocalStorage(page);
    await page.setViewportSize(DESKTOP);
    if (withoutFrameCallbacks) {
        await page.addInitScript(() => {
            Object.defineProperty(HTMLVideoElement.prototype, "requestVideoFrameCallback", { value: undefined });
        });
    }
    await gotoApp(page, "en");
    await loadTrip(page, SAMPLE_70MAI);
    await seekPaused(page, 0);
    await page.locator("#mini-map").click();
    await expect(page.locator("body")).not.toHaveClass(/map-morphing/);
    await expect.poll(() => page.evaluate(() => window.__dashcamigo.state.map?.getPitch() ?? 0)).toBeCloseTo(58, 1);
    await waitForMapIdle(page);
}

async function measureChase(page: Page) {
    return page.evaluate(async () => {
        const { state, dom } = window.__dashcamigo;
        const map = state.map;
        if (!map || !state.active) throw new Error("Chase playback unavailable");
        const player = dom.player;
        const originalRate = player.playbackRate;
        const source = player.currentSrc;
        const active = { ...state.active };
        let renders = 0;
        let moves = 0;
        let videoFrames = 0;
        let animationFrames = 0;
        let styleLoads = 0;
        let raf: number | null = null;
        let frameCallback: number | null = null;
        const interruptions: string[] = [];
        const interruptTypes = ["pause", "waiting", "stalled", "ended", "seeking", "emptied", "error"] as const;
        const onInterruption = (event: Event): void => {
            interruptions.push(event.type);
        };
        const onRender = (): void => {
            renders++;
        };
        const onMove = (): void => {
            moves++;
        };
        const onStyleLoad = (): void => {
            styleLoads++;
        };
        const frame = (): void => {
            videoFrames++;
            frameCallback = player.requestVideoFrameCallback(frame);
        };
        const animationFrame = (): void => {
            animationFrames++;
            raf = requestAnimationFrame(animationFrame);
        };
        try {
            player.playbackRate = 0.25;
            player.muted = true;
            await player.play();
            // Start inside a fully decoded clip, after playback and camera entry settle.
            await new Promise((resolve) => setTimeout(resolve, 500));
            const startTime = player.currentTime;
            const startCenter = map.getCenter();
            const before = player.getVideoPlaybackQuality();
            const playingBefore = !player.paused && !player.ended && !player.seeking && player.readyState >= 3;
            map.on("render", onRender);
            map.on("move", onMove);
            map.on("style.load", onStyleLoad);
            for (const type of interruptTypes) player.addEventListener(type, onInterruption);
            if (typeof player.requestVideoFrameCallback === "function") {
                frameCallback = player.requestVideoFrameCallback(frame);
            }
            raf = requestAnimationFrame(animationFrame);
            await new Promise((resolve) => setTimeout(resolve, 1600));
            const after = player.getVideoPlaybackQuality();
            const endCenter = map.getCenter();
            return {
                renders,
                moves,
                videoFrames,
                animationFrames,
                styleLoads,
                interruptions,
                playingBefore,
                playingAfter: !player.paused && !player.ended && !player.seeking && player.readyState >= 3,
                samePlayer: dom.player === player,
                sameSource: player.currentSrc === source,
                sameFrame: state.active?.trip === active.trip && state.active.frame === active.frame,
                advanced: player.currentTime - startTime,
                decodedFrames: after.totalVideoFrames - before.totalVideoFrames,
                droppedFrames: after.droppedVideoFrames - before.droppedVideoFrames,
                centerShift: Math.hypot(endCenter.lat - startCenter.lat, endCenter.lng - startCenter.lng),
                mode: state.followMode,
            };
        } finally {
            if (raf !== null) cancelAnimationFrame(raf);
            if (frameCallback !== null) player.cancelVideoFrameCallback(frameCallback);
            map.off("render", onRender);
            map.off("move", onMove);
            map.off("style.load", onStyleLoad);
            for (const type of interruptTypes) player.removeEventListener(type, onInterruption);
            player.pause();
            player.playbackRate = originalRate;
        }
    });
}

function expectMovingWindow(result: Awaited<ReturnType<typeof measureChase>>): void {
    expect(result.playingBefore).toBe(true);
    expect(result.playingAfter).toBe(true);
    expect(result.samePlayer).toBe(true);
    expect(result.sameSource).toBe(true);
    expect(result.sameFrame).toBe(true);
    expect(result.interruptions, "the whole sample covers uninterrupted playback").toEqual([]);
    expect(result.styleLoads, "style recovery must not distort the cadence sample").toBe(0);
    expect(result.advanced).toBeGreaterThan(0.3);
    expect(result.decodedFrames).toBeGreaterThan(8);
    expect(result.animationFrames).toBeGreaterThan(8);
    expect(result.centerShift).toBeGreaterThan(0.000001);
    expect(result.mode).toBe("chase");
}

function expectVideoCadence(result: Awaited<ReturnType<typeof measureChase>>): void {
    expectMovingWindow(result);
    expect(result.videoFrames).toBeGreaterThan(8);
    expect(result.animationFrames, "display refresh remains distinct from the measured video cadence").toBeGreaterThan(
        result.videoFrames * 1.3,
    );
    expect(result.renders, "native map renders stay near actual presented video frames").toBeLessThanOrEqual(
        result.videoFrames * 1.4 + 3,
    );
    expect(result.renders, "the map keeps painting while the video advances").toBeGreaterThan(result.videoFrames * 0.5);
    expect(result.renders, "video cadence stays materially below display refresh").toBeLessThan(
        result.animationFrames * 0.6,
    );
    expect(result.moves, "camera motion follows the same presented frames").toBeLessThanOrEqual(
        result.videoFrames * 1.4 + 3,
    );
    expect(result.moves).toBeGreaterThan(result.videoFrames * 0.5);
}

test("Chase paints at the presented video cadence while playback and following advance", async ({ page }, testInfo) => {
    await openChase(page);
    const result = await measureChase(page);
    await testInfo.attach("map-video-cadence", { body: JSON.stringify(result), contentType: "application/json" });
    expectVideoCadence(result);
});

test("a paused seek updates the Chase camera and returns to idle without new video frames", async ({ page }) => {
    await openChase(page);
    const before = await page.evaluate(() => window.__dashcamigo.state.map!.getCenter().toArray());
    await seekPaused(page, 1.4);
    await expect
        .poll(() =>
            page.evaluate(() => {
                const { map, marker } = window.__dashcamigo.state;
                if (!map || !marker) return Number.POSITIVE_INFINITY;
                const center = map.getCenter();
                const position = marker.getLngLat();
                return Math.hypot(center.lat - position.lat, center.lng - position.lng);
            }),
        )
        .toBeLessThan(0.0000002);
    await waitForMapIdle(page);
    const result = await page.evaluate(async () => {
        const { state, dom } = window.__dashcamigo;
        const map = state.map!;
        let renders = 0;
        const onRender = (): void => {
            renders++;
        };
        map.on("render", onRender);
        try {
            await new Promise((resolve) => setTimeout(resolve, 350));
            return {
                renders,
                center: map.getCenter().toArray(),
                paused: dom.player.paused,
                time: dom.player.currentTime,
            };
        } finally {
            map.off("render", onRender);
        }
    });
    expect(result.paused).toBe(true);
    expect(result.time).toBeCloseTo(1.4, 2);
    expect(Math.hypot(result.center[0] - before[0], result.center[1] - before[1])).toBeGreaterThan(0.000001);
    expect(result.renders, "settled paused Chase does not keep repainting").toBeLessThanOrEqual(1);
});

test("zoom, drag and recenter remain responsive during frame-paced Chase", async ({ page }) => {
    await openChase(page);
    const start = await page.evaluate(async () => {
        const { state, dom } = window.__dashcamigo;
        dom.player.playbackRate = 0.25;
        dom.player.muted = true;
        await dom.player.play();
        return { zoom: state.map!.getZoom(), time: dom.player.currentTime };
    });
    await page.locator("#map .maplibregl-ctrl-zoom-in").click();
    await expect
        .poll(() => page.evaluate(() => window.__dashcamigo.state.map!.getZoom()))
        .toBeGreaterThan(start.zoom + 0.6);
    await expect.poll(() => page.evaluate(() => window.__dashcamigo.state.map!.isMoving())).toBe(false);
    const beforeDrag = await page.evaluate(() => window.__dashcamigo.state.map!.getCenter().toArray());
    const canvas = await page.locator("#map canvas.maplibregl-canvas").boundingBox();
    if (!canvas) throw new Error("map canvas unavailable");
    const x = canvas.x + canvas.width * 0.5;
    const y = canvas.y + canvas.height * 0.55;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 100, y + 30, { steps: 8 });
    await page.mouse.up();
    await expect
        .poll(() =>
            page.evaluate((before) => {
                const center = window.__dashcamigo.state.map!.getCenter();
                return Math.hypot(center.lng - before[0], center.lat - before[1]);
            }, beforeDrag),
        )
        .toBeGreaterThan(0.00001);
    await page.locator("#map-recenter").click();
    await expect
        .poll(() =>
            page.evaluate(() => {
                const { map, marker } = window.__dashcamigo.state;
                if (!map || !marker) return Number.POSITIVE_INFINITY;
                const car = map.project(marker.getLngLat());
                const center = map.project(map.getCenter());
                return Math.hypot(car.x - center.x, car.y - center.y);
            }),
        )
        .toBeLessThan(20);
    const after = await page.evaluate(() => ({
        mode: window.__dashcamigo.state.followMode,
        paused: window.__dashcamigo.dom.player.paused,
        time: window.__dashcamigo.dom.player.currentTime,
    }));
    expect(after.mode).toBe("chase");
    expect(after.paused).toBe(false);
    expect(after.time - start.time).toBeGreaterThan(0.1);
});

test("Chase follows a different physical master after channel reordering", async ({ page }, testInfo) => {
    await openChase(page);
    const previous = await page.evaluateHandle(() => window.__dashcamigo.dom.player);
    try {
        await page.evaluate(async () => {
            const player = window.__dashcamigo.dom.player;
            player.playbackRate = 0.25;
            player.muted = true;
            await player.play();
        });
        const rear = await page.locator('.top-panel__channel-chip[data-channel="rear"]').boundingBox();
        const front = await page.locator('.top-panel__channel-chip[data-channel="front"]').boundingBox();
        if (!rear || !front) throw new Error("camera reorder controls unavailable");
        await page.mouse.move(rear.x + rear.width / 2, rear.y + rear.height / 2);
        await page.mouse.down();
        await page.mouse.move(front.x + front.width / 2, front.y + front.height / 2, { steps: 8 });
        await page.mouse.up();
        await expect(page.locator(".top-panel__channel-chip").first()).toHaveAttribute("data-channel", "rear");
        expect(await page.evaluate((old) => window.__dashcamigo.dom.player !== old, previous)).toBe(true);
        const result = await measureChase(page);
        await testInfo.attach("master-swap-cadence", { body: JSON.stringify(result), contentType: "application/json" });
        expectVideoCadence(result);
    } finally {
        await previous.dispose();
    }
});

test("missing video frame callbacks preserve ordinary playback and map rendering", async ({ page }, testInfo) => {
    await openChase(page, true);
    const result = await measureChase(page);
    await testInfo.attach("map-cadence-without-rvfc", {
        body: JSON.stringify(result),
        contentType: "application/json",
    });
    expectMovingWindow(result);
    expect(result.videoFrames).toBe(0);
    expect(
        result.renders,
        "an unavailable presentation clock does not block native repaint scheduling",
    ).toBeGreaterThan(result.animationFrames * 0.55);
    expect(result.moves).toBeGreaterThan(result.animationFrames * 0.55);
});
