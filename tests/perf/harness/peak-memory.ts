// Peak memory poller: samples performance.memory + measureUserAgentSpecificMemory
// every ~100 ms while a scenario runs, keeps the max. Run in the page context
// via setInterval so the sampler does not have to cross the CDP boundary
// every tick (which would itself add ~1-5 ms of overhead per sample).
//
// At scenario end the harness pulls the accumulated peak/series back via
// page.evaluate. The sampler is then torn down so it does not leak into the
// next scenario.

import type { Page } from "@playwright/test";

export interface PeakMemorySample {
    /** ms since sampler start */
    t: number;
    /** performance.memory.usedJSHeapSize (main thread only) */
    usedJSHeapSize: number;
    /** performance.memory.totalJSHeapSize */
    totalJSHeapSize: number;
}

export interface PeakMemoryResult {
    peakUsedJSHeapSize: number;
    peakTotalJSHeapSize: number;
    /** Result of measureUserAgentSpecificMemory() if crossOriginIsolated and supported - bytes including workers. null otherwise. */
    crossOriginIsolated: boolean;
    measureUASpecificMemoryBytes: number | null;
    sampleCount: number;
    /** All raw samples (may be large for long scenarios; skip serialization to JSON if >1k). */
    samples: PeakMemorySample[];
}

export const PEAK_MEMORY_INIT_SCRIPT = `
(() => {
    const perf = (window.__dashcamigoPerf ||= {});
    perf.peakMemory = null;
})();
`;

export async function startPeakMemoryPoller(page: Page, intervalMs = 100): Promise<void> {
    await page.evaluate((iv) => {
        const w = window as unknown as {
            __dashcamigoPerf?: {
                peakMemory?: {
                    samples: PeakMemorySample[];
                    peakUsedJSHeapSize: number;
                    peakTotalJSHeapSize: number;
                    intervalId: number;
                    startTs: number;
                };
            };
        };
        type PeakMemorySample = { t: number; usedJSHeapSize: number; totalJSHeapSize: number };
        w.__dashcamigoPerf ||= {};
        const perf = w.__dashcamigoPerf;
        // Tear down any prior sampler to avoid leaks across replays.
        if (perf.peakMemory?.intervalId) {
            clearInterval(perf.peakMemory.intervalId);
        }
        const samples: PeakMemorySample[] = [];
        let peakUsed = 0;
        let peakTotal = 0;
        const start = performance.now();
        const mem = (
            performance as Performance & {
                memory?: { usedJSHeapSize: number; totalJSHeapSize: number };
            }
        ).memory;
        const tick = (): void => {
            if (!mem) return;
            const u = mem.usedJSHeapSize;
            const t = mem.totalJSHeapSize;
            if (u > peakUsed) peakUsed = u;
            if (t > peakTotal) peakTotal = t;
            samples.push({ t: Math.round(performance.now() - start), usedJSHeapSize: u, totalJSHeapSize: t });
        };
        tick();
        const intervalId = window.setInterval(tick, iv);
        perf.peakMemory = {
            samples,
            peakUsedJSHeapSize: peakUsed,
            peakTotalJSHeapSize: peakTotal,
            intervalId,
            startTs: start,
        };
    }, intervalMs);
}

export async function stopAndReadPeakMemory(page: Page): Promise<PeakMemoryResult> {
    return await page.evaluate(() => {
        const w = window as unknown as {
            __dashcamigoPerf?: {
                peakMemory?: {
                    samples: { t: number; usedJSHeapSize: number; totalJSHeapSize: number }[];
                    peakUsedJSHeapSize: number;
                    peakTotalJSHeapSize: number;
                    intervalId: number;
                };
            };
            crossOriginIsolated?: boolean;
        };
        const state = w.__dashcamigoPerf?.peakMemory;
        if (!state) {
            return {
                peakUsedJSHeapSize: 0,
                peakTotalJSHeapSize: 0,
                crossOriginIsolated: false,
                measureUASpecificMemoryBytes: null,
                sampleCount: 0,
                samples: [],
            };
        }
        clearInterval(state.intervalId);
        // After the sampler stopped, recompute peaks from the recorded samples
        // (defensive - peak counters are updated in the tick, but a stuck tick
        // could lag the last reading).
        let pu = state.peakUsedJSHeapSize;
        let pt = state.peakTotalJSHeapSize;
        for (const s of state.samples) {
            if (s.usedJSHeapSize > pu) pu = s.usedJSHeapSize;
            if (s.totalJSHeapSize > pt) pt = s.totalJSHeapSize;
        }
        return {
            peakUsedJSHeapSize: pu,
            peakTotalJSHeapSize: pt,
            crossOriginIsolated: !!w.crossOriginIsolated,
            // measureUserAgentSpecificMemory is intentionally NOT called here:
            // it synchronizes with GC and can take up to 20s per call. Per-
            // replay polling would explode test duration. Use
            // readMeasureUASpecificMemory() once at end-of-test instead.
            measureUASpecificMemoryBytes: null,
            sampleCount: state.samples.length,
            samples: state.samples,
        };
    });
}

/**
 * One-shot measureUserAgentSpecificMemory() reading. Requires crossOriginIsolated
 * (vite preview middleware turns this on under PERF_TEST=1). Returns null if
 * the API throws or is unavailable. Cost: up to ~20 s as the API synchronizes
 * with GC - call this exactly once at end-of-test, never inside a replay loop.
 */
export async function readMeasureUASpecificMemory(page: Page): Promise<number | null> {
    return await page.evaluate(async () => {
        const w = window as unknown as { crossOriginIsolated?: boolean };
        if (!w.crossOriginIsolated) return null;
        type UASpecificMem = () => Promise<{ bytes: number }>;
        const perfWithUASpec = performance as Performance & {
            measureUserAgentSpecificMemory?: UASpecificMem;
        };
        if (typeof perfWithUASpec.measureUserAgentSpecificMemory !== "function") return null;
        try {
            const r = await perfWithUASpec.measureUserAgentSpecificMemory();
            return r.bytes ?? null;
        } catch {
            return null;
        }
    });
}
