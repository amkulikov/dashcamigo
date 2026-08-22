// Aggregates per-scenario metrics from three sources:
//
//   1. performance.measure entries created by src/perf.ts markStage and by
//      ad-hoc entries the app might add. Read via
//      performance.getEntriesByType('measure') with prior clear so each
//      scenario sees only its own marks.
//
//   2. logger ring-buffer entries via window.__dashcamigo.dumpLog(). The
//      ingest pipeline already logs structured durationMs / stageMs for
//      ingest stages; we lift those into the metrics as a secondary channel
//      next to performance.measure (both come from the same mark() helper).
//
//   3. CDP Performance + SystemInfo for native-side numbers (renderer/GPU
//      RSS, CPU time, DOM counters). Snapshot start/end + diff.

import type { CDPSession, Page } from "@playwright/test";

export interface MeasureEntry {
    name: string;
    /** ms since timeOrigin */
    startTime: number;
    duration: number;
}

export interface LogEntrySnippet {
    ts: number;
    ns: string;
    msg: string;
    ctx?: Record<string, unknown>;
}

export interface CdpProcessSnapshot {
    /** type === "renderer" or "gpu" or "browser" */
    type: string;
    cpuTimeSec: number;
    /** Resident bytes of this process. */
    rssBytes: number | null;
}

export interface CdpMetricSnapshot {
    /** Sum of all task durations on main thread since process start. */
    taskDurationSec: number;
    /** Sum of JS execution time. */
    scriptDurationSec: number;
    layoutCount: number;
    recalcStyleCount: number;
    nodes: number;
    layoutObjects: number;
    documents: number;
    frames: number;
}

export const RESET_INIT_SCRIPT = `
(() => {
    const perf = (window.__dashcamigoPerf ||= {});
    perf.reset = () => {
        try { performance.clearMarks(); performance.clearMeasures(); } catch (_) {}
        perf.bytesRead = 0;
        perf.lifecycleEvents = [];
    };
    // Capture lifecycle events from src/perf.ts emitLifecycle so the harness
    // can wait on them (already done via page.waitForEvent('console') would
    // be unreliable) AND so the report can include their detail payloads.
    //
    // Cap at LIFECYCLE_CAP to defend against unbounded growth in long runs
    // or if a future code path emits events from a hot loop. resetPerfState
    // clears the buffer between replays anyway, but the cap is the safety
    // net for whoever forgets to call reset. shift() is O(n), but with a
    // 5-events-per-scenario budget the cap is never actually hit in practice.
    if (!perf.lifecycleInstalled) {
        perf.lifecycleInstalled = true;
        perf.lifecycleEvents = [];
        const LIFECYCLE_CAP = 1000;
        const onEvent = (e) => {
            if (typeof e.type !== 'string' || !e.type.startsWith('dashcamigo:')) return;
            if (perf.lifecycleEvents.length >= LIFECYCLE_CAP) {
                perf.lifecycleEvents.shift();
            }
            perf.lifecycleEvents.push({
                type: e.type,
                t: performance.now(),
                detail: (e instanceof CustomEvent) ? e.detail : undefined,
            });
        };
        for (const ev of ['ingest-list-ready', 'ingest-done', 'trip-activated', 'player-first-frame', 'player-failed', 'map-tracks-rendered', 'chart-rendered']) {
            window.addEventListener('dashcamigo:' + ev, onEvent);
        }
    }
})();
`;

export async function resetPerfState(page: Page): Promise<void> {
    await page.evaluate(() => {
        const w = window as unknown as { __dashcamigoPerf?: { reset?: () => void } };
        w.__dashcamigoPerf?.reset?.();
    });
}

export async function readMeasures(page: Page): Promise<MeasureEntry[]> {
    return await page.evaluate(() => {
        const out: MeasureEntry[] = [];
        for (const e of performance.getEntriesByType("measure")) {
            out.push({ name: e.name, startTime: e.startTime, duration: e.duration });
        }
        return out;
    });
}

export async function readLifecycleEvents(
    page: Page,
): Promise<Array<{ type: string; t: number; detail: Record<string, unknown> | undefined }>> {
    return await page.evaluate(() => {
        const w = window as unknown as {
            __dashcamigoPerf?: { lifecycleEvents?: Array<{ type: string; t: number; detail: unknown }> };
        };
        return (w.__dashcamigoPerf?.lifecycleEvents ?? []).map((e) => ({
            type: e.type,
            t: e.t,
            detail: e.detail as Record<string, unknown> | undefined,
        }));
    });
}

export async function readLogEntries(page: Page): Promise<LogEntrySnippet[]> {
    return await page.evaluate(() => {
        const w = window as unknown as {
            __dashcamigo?: { dumpLog: () => Array<{ ts: number; ns: string; msg: string; ctx?: unknown }> };
        };
        if (!w.__dashcamigo) return [];
        return w.__dashcamigo.dumpLog().map((r) => ({
            ts: r.ts,
            ns: r.ns,
            msg: r.msg,
            ctx: r.ctx as Record<string, unknown> | undefined,
        }));
    });
}

// === CDP-based metrics ===
//
// Two CDP sessions are required:
//   - Page session for Performance.* (per-page metrics: TaskDuration,
//     ScriptDuration, layout/style counts, DOM counters).
//   - Browser session for SystemInfo.getProcessInfo (browser-wide metrics
//     across renderer, gpu, browser, utility processes).
// Playwright exposes the page session via page.context().newCDPSession(page)
// and the browser session via browser().newBrowserCDPSession().

async function getPageCdpSession(page: Page): Promise<CDPSession> {
    const w = page as unknown as { _perfCdpPage?: CDPSession };
    if (w._perfCdpPage) return w._perfCdpPage;
    const sess = await page.context().newCDPSession(page);
    await sess.send("Performance.enable");
    w._perfCdpPage = sess;
    return sess;
}

async function getBrowserCdpSession(page: Page): Promise<CDPSession | null> {
    const w = page as unknown as { _perfCdpBrowser?: CDPSession | null };
    if (w._perfCdpBrowser !== undefined) return w._perfCdpBrowser;
    const browser = page.context().browser();
    if (!browser) {
        w._perfCdpBrowser = null;
        return null;
    }
    try {
        const sess = await browser.newBrowserCDPSession();
        w._perfCdpBrowser = sess;
        return sess;
    } catch {
        // Older Playwright / non-Chromium - process metrics unavailable.
        w._perfCdpBrowser = null;
        return null;
    }
}

export async function readCdpMetrics(page: Page): Promise<CdpMetricSnapshot> {
    const sess = await getPageCdpSession(page);
    const { metrics } = (await sess.send("Performance.getMetrics")) as {
        metrics: Array<{ name: string; value: number }>;
    };
    const m: Record<string, number> = {};
    for (const x of metrics) m[x.name] = x.value;
    return {
        taskDurationSec: m.TaskDuration ?? 0,
        scriptDurationSec: m.ScriptDuration ?? 0,
        layoutCount: m.LayoutCount ?? 0,
        recalcStyleCount: m.RecalcStyleCount ?? 0,
        nodes: m.Nodes ?? 0,
        layoutObjects: m.LayoutObjects ?? 0,
        documents: m.Documents ?? 0,
        frames: m.Frames ?? 0,
    };
}

/**
 * Process-level snapshot via SystemInfo.getProcessInfo on the BROWSER CDP
 * session (this command is unsupported on per-page sessions). Returns one
 * entry per browser process (browser, renderer, gpu, utility). cpuTimeSec
 * is cumulative since process start; the harness subtracts the start
 * snapshot to derive a delta. rss may be null on platforms where Chromium
 * does not report it. Returns [] if no browser CDP session is available
 * (non-Chromium, or older Playwright).
 */
export async function readCdpProcesses(page: Page): Promise<CdpProcessSnapshot[]> {
    const sess = await getBrowserCdpSession(page);
    if (!sess) return [];
    try {
        type ProcInfo = { type: string; id: number; cpuTime: number; rss?: number };
        const result = (await sess.send("SystemInfo.getProcessInfo")) as { processInfo: ProcInfo[] };
        return (result.processInfo ?? []).map((p) => ({
            type: p.type,
            cpuTimeSec: p.cpuTime ?? 0,
            rssBytes: typeof p.rss === "number" ? p.rss : null,
        }));
    } catch {
        // Some Chromium builds don't expose rss/cpuTime - return [] rather
        // than failing the scenario; aggregate sums will be zero deltas.
        return [];
    }
}

/**
 * Sums CPU+RSS across all processes whose type matches (case-insensitive -
 * Chromium reports "GPU" uppercase, "renderer" lowercase, "browser"
 * lowercase). Multiple renderer processes can exist (e.g. iframe isolation,
 * dedicated workers); we attribute them all to the same bucket.
 *
 * Note on RSS: macOS Chromium's SystemInfo.getProcessInfo does NOT populate
 * `rss` (only type/id/cpuTime). On those builds rssBytes is always null and
 * the sum stays at 0. Linux/Windows builds may include it. Treat sum=0 + at
 * least one matched process as "RSS unavailable on this platform" rather
 * than "0 bytes used".
 */
export function sumByType(
    snapshots: CdpProcessSnapshot[],
    type: string,
): { rss: number; cpu: number; matched: number } {
    let rss = 0;
    let cpu = 0;
    let matched = 0;
    const want = type.toLowerCase();
    for (const s of snapshots) {
        if (s.type.toLowerCase() !== want) continue;
        matched++;
        if (s.rssBytes !== null) rss += s.rssBytes;
        cpu += s.cpuTimeSec;
    }
    return { rss, cpu, matched };
}
