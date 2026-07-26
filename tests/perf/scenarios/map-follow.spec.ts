// Map follow-mode steady-state load during playback.
//
// Complements trip-activation (one-shot latency): this scenario measures the
// CONTINUOUS cost of the tracking camera - the load that runs for the whole
// viewing session. Trip 0 is activated, the big map is expanded (default
// follow mode "chase": tilt + 3D buildings + heading-up + adaptive zoom),
// playback starts, and after a settle period a fixed window is sampled:
//   - map renders per second (map 'render' event count / window)
//   - main-thread rAF cadence + long-animation-frames (jank)
//   - renderer / GPU process CPU deltas (CDP)
//
// NOT hermetic: tiles come from the live tile server, like the rest of the
// perf suite (only e2e aborts it). The settle period absorbs the initial
// style/tile burst; steady-state motion still fetches tiles as the car moves -
// that is part of the real load being measured. Numbers are comparable only
// between runs pinned to the same vendor (-g "map follow: <vendor>").
//
// Vendors are skipped (not failed) when there is nothing to measure: video
// that cannot decode in the harness browser (HEVC in Playwright Chromium),
// no GPS track, or a playhead that does not advance.

import { expect, test } from "@playwright/test";

import { presetLocalStorage } from "../../e2e/_fixtures.js";
import { parseEnvInt } from "../harness/env.js";
import { deliverFiles } from "../harness/files.js";
import type { PerfAnnotationPayload } from "../harness/json-reporter.js";
import { readCdpMetrics, readCdpProcesses, sumByType } from "../harness/measure.js";
import { setupPage } from "../harness/setup.js";
import { discoverVendors } from "../harness/vendors.js";

// Settle covers: chase entry ease (500 ms), style/tile burst after expand,
// decoder spin-up. Measure window: long enough that per-frame noise averages
// out (~900 frames at 60 Hz), short enough to keep the suite usable.
const SETTLE_MS = parseEnvInt("PERF_FOLLOW_SETTLE_MS", 3000);
const MEASURE_MS = parseEnvInt("PERF_FOLLOW_MEASURE_MS", 15000);

// Shape of the in-page collector installed for the measure window. Lives on
// window so install/read run in separate evaluate calls.
interface FollowCollectorResult {
    renders: number;
    rafCount: number;
    frameP50Ms: number;
    frameP95Ms: number;
    frameMaxMs: number;
    loafCount: number;
    loafTotalMs: number;
    windowMs: number;
    currentTimeDeltaSec: number;
    endedOrPaused: boolean;
}

const vendors = discoverVendors();

if (vendors.length === 0) {
    test.skip(true, "no vendor samples in private/samples - skipping map-follow suite");
}

for (const vendor of vendors) {
    test(`map follow: ${vendor.name}`, async ({ browser }, testInfo) => {
        const mbTotal = Math.ceil(vendor.totalBytes / (1024 * 1024));
        const ingestBudgetMs = 60_000 + mbTotal * 250;
        test.setTimeout(ingestBudgetMs + SETTLE_MS + MEASURE_MS + 60_000);

        const ctx = await browser.newContext();
        const page = await ctx.newPage();
        try {
            // Suppress first-run overlays (onboarding tour, PWA toast, upload
            // warning) - they cover the mini-map and block the expand click.
            // Must run before setupPage: it registers init scripts, and
            // setupPage navigates.
            await presetLocalStorage(page);
            await setupPage(page);
            await deliverFiles(page, vendor.absPath);
            await page.waitForFunction(
                () => {
                    const w = window as unknown as {
                        __dashcamigoPerf?: { lifecycleEvents?: Array<{ type: string }> };
                    };
                    return !!w.__dashcamigoPerf?.lifecycleEvents?.some((e) => e.type === "dashcamigo:ingest-done");
                },
                { timeout: ingestBudgetMs, polling: 100 },
            );

            const tripCount = await page.evaluate(() => {
                const w = window as unknown as { __dashcamigo?: { state: { trips: unknown[] } } };
                return w.__dashcamigo?.state.trips.length ?? 0;
            });
            if (tripCount === 0) {
                test.skip(true, `vendor ${vendor.name} has 0 trips, nothing to follow`);
                return;
            }

            // Activate trip 0 (data-trip-index is the original state index,
            // stable across sidebar sorting - same rationale as trip-activation).
            await page.locator('li.trip[data-trip-index="0"] .trip-header').click();
            await page.waitForFunction(
                () => {
                    const w = window as unknown as {
                        __dashcamigoPerf?: { lifecycleEvents?: Array<{ type: string }> };
                    };
                    const seen = new Set((w.__dashcamigoPerf?.lifecycleEvents ?? []).map((e) => e.type));
                    const playerDone =
                        seen.has("dashcamigo:player-first-frame") || seen.has("dashcamigo:player-failed");
                    return playerDone && seen.has("dashcamigo:map-tracks-rendered");
                },
                { timeout: 15_000, polling: 100 },
            );

            const activation = await page.evaluate(() => {
                const w = window as unknown as {
                    __dashcamigoPerf?: { lifecycleEvents?: Array<{ type: string }> };
                    __dashcamigo?: { state: { hasTrack: boolean } };
                };
                const seen = new Set((w.__dashcamigoPerf?.lifecycleEvents ?? []).map((e) => e.type));
                return {
                    playerFailed: seen.has("dashcamigo:player-failed"),
                    hasTrack: w.__dashcamigo?.state.hasTrack ?? false,
                };
            });
            if (activation.playerFailed) {
                test.skip(true, `vendor ${vendor.name}: video does not decode in the harness browser`);
                return;
            }
            if (!activation.hasTrack) {
                test.skip(true, `vendor ${vendor.name}: no GPS track, no follow load to measure`);
                return;
            }

            // No-WebGL browsers set body.map-unavailable and hide the mini-map
            // via CSS - the click below would then auto-wait until the test
            // timeout instead of skipping.
            const mapless = await page.evaluate(() => document.body.classList.contains("map-unavailable"));
            if (mapless) {
                test.skip(true, `vendor ${vendor.name}: no WebGL, map cannot render`);
                return;
            }

            // Expand the big map (mini-map click). Default follow mode is chase;
            // fresh context has no persisted override, so the tilt ease engages.
            await page.locator(".mini-map").click();
            await page.waitForFunction(
                () => {
                    const w = window as unknown as {
                        __dashcamigo?: { state?: { map?: { getPitch?: () => number } } };
                    };
                    return (w.__dashcamigo?.state?.map?.getPitch?.() ?? 0) > 1;
                },
                { timeout: 10_000, polling: 100 },
            );

            // Muted script-initiated play is exempt from autoplay policy. The
            // app's own play handlers sync slave channels off the master.
            await page.evaluate(() => {
                const w = window as unknown as { __dashcamigo: { dom: { player: HTMLVideoElement } } };
                w.__dashcamigo.dom.player.muted = true;
                return w.__dashcamigo.dom.player.play();
            });
            await page.waitForTimeout(SETTLE_MS);
            const advanced = await page.evaluate(() => {
                const w = window as unknown as { __dashcamigo: { dom: { player: HTMLVideoElement } } };
                return w.__dashcamigo.dom.player.currentTime;
            });
            if (advanced < 1) {
                test.skip(true, `vendor ${vendor.name}: playhead does not advance (currentTime=${advanced})`);
                return;
            }

            // Install collectors for the measure window.
            await page.evaluate(() => {
                const w = window as unknown as {
                    __dashcamigo: {
                        state: { map: { on: (t: string, h: () => void) => void } };
                        dom: { player: HTMLVideoElement };
                    };
                    __followCollector?: Record<string, unknown>;
                };
                const collector: {
                    renders: number;
                    rafCount: number;
                    frameDeltas: number[];
                    loafCount: number;
                    loafTotalMs: number;
                    startMs: number;
                    startCurrentTime: number;
                    rafId: number;
                    onRender: () => void;
                    po: PerformanceObserver | null;
                } = {
                    renders: 0,
                    rafCount: 0,
                    frameDeltas: [],
                    loafCount: 0,
                    loafTotalMs: 0,
                    startMs: performance.now(),
                    startCurrentTime: w.__dashcamigo.dom.player.currentTime,
                    rafId: 0,
                    onRender: () => {
                        collector.renders++;
                    },
                    po: null,
                };
                w.__dashcamigo.state.map.on("render", collector.onRender);
                let last = performance.now();
                const loop = (t: number): void => {
                    collector.rafCount++;
                    collector.frameDeltas.push(t - last);
                    last = t;
                    collector.rafId = requestAnimationFrame(loop);
                };
                collector.rafId = requestAnimationFrame(loop);
                try {
                    collector.po = new PerformanceObserver((list) => {
                        for (const e of list.getEntries()) {
                            collector.loafCount++;
                            collector.loafTotalMs += e.duration;
                        }
                    });
                    collector.po.observe({ type: "long-animation-frame" } as PerformanceObserverInit);
                } catch {
                    collector.po = null; // LoAF unsupported - counts stay 0
                }
                w.__followCollector = collector as unknown as Record<string, unknown>;
            });

            const cdpBefore = await readCdpMetrics(page);
            const procBefore = await readCdpProcesses(page);
            await page.waitForTimeout(MEASURE_MS);
            const cdpAfter = await readCdpMetrics(page);
            const procAfter = await readCdpProcesses(page);

            const collected = await page.evaluate((): FollowCollectorResult => {
                const w = window as unknown as {
                    __dashcamigo: {
                        state: { map: { off: (t: string, h: () => void) => void } };
                        dom: { player: HTMLVideoElement };
                    };
                    __followCollector: {
                        renders: number;
                        rafCount: number;
                        frameDeltas: number[];
                        loafCount: number;
                        loafTotalMs: number;
                        startMs: number;
                        startCurrentTime: number;
                        rafId: number;
                        onRender: () => void;
                        po: PerformanceObserver | null;
                    };
                };
                const c = w.__followCollector;
                cancelAnimationFrame(c.rafId);
                w.__dashcamigo.state.map.off("render", c.onRender);
                c.po?.disconnect();
                const sorted = [...c.frameDeltas].sort((a, b) => a - b);
                const pick = (q: number): number =>
                    sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] ?? 0;
                const player = w.__dashcamigo.dom.player;
                return {
                    renders: c.renders,
                    rafCount: c.rafCount,
                    frameP50Ms: pick(0.5),
                    frameP95Ms: pick(0.95),
                    frameMaxMs: sorted[sorted.length - 1] ?? 0,
                    loafCount: c.loafCount,
                    loafTotalMs: c.loafTotalMs,
                    windowMs: performance.now() - c.startMs,
                    currentTimeDeltaSec: player.currentTime - c.startCurrentTime,
                    endedOrPaused: player.paused || player.ended,
                };
            });

            // The window is only a valid follow-load sample if the playhead
            // actually advanced through it (a too-long PERF_FOLLOW_MEASURE_MS
            // can outrun the trip). Fail loud instead of publishing numbers
            // that quietly measured a paused map. Note: currentTimeDeltaSec is
            // computed on whatever element dom.player resolves to at read time
            // - a clip/preload-slot swap inside the window makes the value
            // wrong as a duration (it can even go negative), so only its SIGN
            // is asserted; the detail dump carries it for eyeballing.
            expect(
                collected.endedOrPaused || collected.currentTimeDeltaSec > 0,
                "playhead must advance through the measure window (or end mid-window)",
            ).toBe(true);

            const rendererBefore = sumByType(procBefore, "renderer");
            const rendererAfter = sumByType(procAfter, "renderer");
            const gpuBefore = sumByType(procBefore, "gpu");
            const gpuAfter = sumByType(procAfter, "gpu");
            const windowSec = collected.windowMs / 1000;
            // Absolute totals scale with the window length - tag them so two
            // runs with different PERF_FOLLOW_MEASURE_MS are not compared as if
            // they were the same metric.
            const windowTag = `${Math.round(collected.windowMs)}ms window`;

            const prefix = `map-follow/${vendor.name}/`;
            testInfo.annotations.push({
                type: "perf",
                description: JSON.stringify({
                    // CPU deltas first: during steady playback the render
                    // cadence saturates at the rAF rate regardless of the
                    // camera implementation, so the cost story is in the CPU
                    // numbers, not the fps ones.
                    entries: [
                        {
                            name: `${prefix}renderer-cpu-ms`,
                            value: round2((rendererAfter.cpu - rendererBefore.cpu) * 1000),
                            unit: "ms",
                            extra: windowTag,
                        },
                        {
                            name: `${prefix}gpu-cpu-ms`,
                            value: round2((gpuAfter.cpu - gpuBefore.cpu) * 1000),
                            unit: "ms",
                            extra: windowTag,
                        },
                        {
                            name: `${prefix}script-cpu-ms`,
                            value: round2((cdpAfter.scriptDurationSec - cdpBefore.scriptDurationSec) * 1000),
                            unit: "ms",
                            extra: windowTag,
                        },
                        { name: `${prefix}frame-p95-ms`, value: round2(collected.frameP95Ms), unit: "ms" },
                        {
                            name: `${prefix}long-frames-count`,
                            value: collected.loafCount,
                            unit: "count",
                            extra: windowTag,
                        },
                        {
                            name: `${prefix}long-frames-total-ms`,
                            value: round2(collected.loafTotalMs),
                            unit: "ms",
                            extra: windowTag,
                        },
                        {
                            name: `${prefix}map-renders-per-sec`,
                            value: round2(collected.renders / windowSec),
                            unit: "fps",
                        },
                        {
                            name: `${prefix}main-raf-per-sec`,
                            value: round2(collected.rafCount / windowSec),
                            unit: "fps",
                        },
                    ],
                    detail: {
                        vendor: vendor.name,
                        windowMs: Math.round(collected.windowMs),
                        settleMs: SETTLE_MS,
                        frameP50Ms: round2(collected.frameP50Ms),
                        frameMaxMs: round2(collected.frameMaxMs),
                        currentTimeDeltaSec: round2(collected.currentTimeDeltaSec),
                        endedOrPaused: collected.endedOrPaused,
                        taskCpuMsDelta: round2((cdpAfter.taskDurationSec - cdpBefore.taskDurationSec) * 1000),
                        layoutCountDelta: cdpAfter.layoutCount - cdpBefore.layoutCount,
                    },
                } satisfies PerfAnnotationPayload),
            });
        } finally {
            await ctx.close();
        }
    });
}

function round2(n: number): number {
    return Math.round(n * 100) / 100;
}

// Sanity note for readers: publishMetrics-style aggregation (median over
// replays) is deliberately absent - one window already averages ~900 frames,
// and replaying would re-pay the full ingest per sample. Pin the vendor and
// compare windows across runs instead.
