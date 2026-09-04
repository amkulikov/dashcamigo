import { DESKTOP, SAMPLE_70MAI, expect, gotoApp, loadTrip, presetLocalStorage, test } from "./_fixtures.js";

test.beforeEach(async ({ page }) => {
    await presetLocalStorage(page);
    await page.setViewportSize(DESKTOP);
    await gotoApp(page, "en");
    await loadTrip(page, SAMPLE_70MAI);
    const video = page.locator(".video-tile.active video:not(.preload-slot):not(.tile-blur-bg)");
    await video.evaluate((el: HTMLVideoElement) => el.pause());
    await expect.poll(() => video.evaluate((el: HTMLVideoElement) => !el.seeking && el.readyState >= 2)).toBe(true);
});

test("unchanged playback samples preserve readout and progress text", async ({ page }, testInfo) => {
    const result = await page.evaluate(() => {
        const video = document.querySelector<HTMLVideoElement>(
            ".video-tile.active video:not(.preload-slot):not(.tile-blur-bg)",
        );
        const speed = document.getElementById("pm-speed");
        const coords = document.getElementById("pm-coords");
        const clock = document.getElementById("pm-time");
        const distance = document.getElementById("pm-distance-value");
        const progress = document.getElementById("player-mini-progress");
        const unitsToggle = document.getElementById("pm-speed-toggle");
        if (!video || !speed || !coords || !clock || !distance || !progress || !unitsToggle) {
            throw new Error("playback readout unavailable");
        }
        video.dispatchEvent(new Event("timeupdate"));
        const observer = new MutationObserver(() => {});
        for (const el of [speed, coords, clock, distance]) {
            observer.observe(el, { childList: true, characterData: true, subtree: true });
        }
        observer.observe(progress, { attributes: true, attributeFilter: ["aria-valuetext"] });
        const before = speed.textContent;
        for (let index = 0; index < 50; index++) video.dispatchEvent(new Event("timeupdate"));
        const repeatedWrites = observer.takeRecords().length;
        unitsToggle.click();
        const unitChangeWrites = observer.takeRecords().length;
        observer.disconnect();
        return { repeatedWrites, unitChangeWrites, before, after: speed.textContent };
    });
    expect(result.repeatedWrites, "unchanged samples do not replace text nodes or accessibility text").toBe(0);
    expect(result.unitChangeWrites, "unit changes invalidate the cached readout").toBeGreaterThan(0);
    expect(result.after).not.toBe(result.before);
    await testInfo.attach("readout-work", { body: JSON.stringify(result), contentType: "application/json" });
});

test("in-place GPS corrections refresh readouts and then stay idle", async ({ page }) => {
    const result = await page.evaluate(async () => {
        const { state, dom } = window.__dashcamigo;
        const video = dom.player;
        const trip = state.active && state.trips[state.active.trip];
        const record = trip?.records[0];
        const frame = state.active && trip?.frames[state.active.frame];
        if (!record || !frame || !record.active || Math.abs(record.unixSeconds - frame.startUtc) > 0.01) {
            throw new Error("initial GPS sample unavailable");
        }
        if (video.currentTime !== 0) {
            const seeked = new Promise<void>((resolve) =>
                video.addEventListener("seeked", () => resolve(), { once: true }),
            );
            video.currentTime = 0;
            await seeked;
        }
        const refresh = (): void => {
            video.dispatchEvent(new Event("timeupdate"));
        };
        refresh();
        const before = {
            clock: dom.metrics.time.textContent,
            speed: dom.metrics.speed.textContent,
            coords: dom.metrics.coords.textContent,
        };
        const original = { ...record };
        const observer = new MutationObserver(() => {});
        for (const el of [dom.metrics.time, dom.metrics.speed, dom.metrics.coords, dom.metrics.distance]) {
            observer.observe(el, { childList: true, characterData: true, subtree: true });
        }
        try {
            // Keep this same sample nearer than the next 1 Hz record at t=0.
            // Progressive metadata can correct the object without replacing it.
            record.unixSeconds -= 0.75;
            refresh();
            const correctedClock = dom.metrics.time.textContent;
            record.speedMs += 1;
            refresh();
            const correctedSpeed = dom.metrics.speed.textContent;
            record.lat += 0.001;
            refresh();
            const correctedLat = dom.metrics.coords.textContent;
            record.lon += 0.001;
            refresh();
            const correctedLon = dom.metrics.coords.textContent;
            record.active = false;
            refresh();
            const lostFix = dom.metrics.readout.classList.contains("is-nofix");
            const lostSpeed = dom.metrics.speed.textContent;
            record.active = true;
            refresh();
            const restoredFix = !dom.metrics.readout.classList.contains("is-nofix");
            observer.takeRecords();
            for (let index = 0; index < 50; index++) refresh();
            return {
                before,
                correctedClock,
                correctedSpeed,
                correctedLat,
                correctedLon,
                lostFix,
                lostSpeed,
                restoredFix,
                repeatedWrites: observer.takeRecords().length,
            };
        } finally {
            observer.disconnect();
            Object.assign(record, original);
            refresh();
        }
    });
    expect(result.correctedClock, "a timestamp correction on the same GPS object updates its clock").not.toBe(
        result.before.clock,
    );
    expect(result.correctedSpeed).not.toBe(result.before.speed);
    expect(result.correctedLat).not.toBe(result.before.coords);
    expect(result.correctedLon).not.toBe(result.correctedLat);
    expect(result.lostFix).toBe(true);
    expect(result.lostSpeed).not.toBe(result.correctedSpeed);
    expect(result.restoredFix).toBe(true);
    expect(result.repeatedWrites, "corrected but unchanged samples preserve their text nodes").toBe(0);
});

test("paused map checks the playhead at idle cadence", async ({ page }, testInfo) => {
    const currentTimeReads = await page.evaluate(async () => {
        const video = document.querySelector<HTMLVideoElement>(
            ".video-tile.active video:not(.preload-slot):not(.tile-blur-bg)",
        );
        const descriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "currentTime");
        if (!video || !descriptor?.get || !descriptor.set) throw new Error("media clock unavailable");
        const read = descriptor.get;
        const write = descriptor.set;
        let reads = 0;
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
        try {
            await new Promise((resolve) => setTimeout(resolve, 1000));
            return reads;
        } finally {
            Reflect.deleteProperty(video, "currentTime");
        }
    });
    expect(currentTimeReads, "idle still observes the playhead for map-state changes").toBeGreaterThan(0);
    expect(currentTimeReads, "a paused mini-map does not poll at display refresh rate").toBeLessThanOrEqual(20);
    await testInfo.attach("idle-work", { body: JSON.stringify({ currentTimeReads }), contentType: "application/json" });
});
