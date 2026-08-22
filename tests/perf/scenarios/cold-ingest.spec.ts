// Cold ingest per vendor: drop the vendor folder, wait for ingest-done
// lifecycle event, snapshot metrics. Warmup + 3 replays per vendor, median
// reported as the canonical value.
//
// Hot-cache mode: no purge between replays - the warmup pass populates the
// OS page cache, replays see consistent IO. Cold-cache mode is out of scope
// for the first iteration.

import { test } from "@playwright/test";

import { deliverFiles } from "../harness/files.js";
import { parseEnvInt } from "../harness/env.js";
import { readBytesRead, resetBytesRead } from "../harness/bytes-read.js";
import {
    type CdpProcessSnapshot,
    readCdpMetrics,
    readCdpProcesses,
    readLifecycleEvents,
    readLogEntries,
    readMeasures,
    resetPerfState,
    sumByType,
} from "../harness/measure.js";
import { readMeasureUASpecificMemory, startPeakMemoryPoller, stopAndReadPeakMemory } from "../harness/peak-memory.js";
import { aggregate, runWithReplays } from "../harness/repeat.js";
import { setupPage } from "../harness/setup.js";
import { discoverVendors, type VendorSample } from "../harness/vendors.js";

// Defaults: 1 warmup + 3 replays + median. Override via env for quick smokes:
//   PERF_WARMUP=1 PERF_REPLAYS=1 make perf-vendor VENDOR=...
// Invalid env (typo, non-numeric) falls back to default with a stderr warn
// instead of silently producing NaN (which would skip the loop entirely).
const WARMUP = parseEnvInt("PERF_WARMUP", 1);
const REPLAYS = parseEnvInt("PERF_REPLAYS", 3);

const vendors = discoverVendors();

// Tracks vendors that already emitted the relativePath warning so warnings
// stay one-per-vendor across warmup + replays. Module-scope is fine: a
// single Playwright worker runs the whole suite (workers:1 in config), so
// there's no cross-test contamination.
const relativePathWarned = new Set<string>();

if (vendors.length === 0) {
    test.skip(true, "no vendor samples in private/samples - skipping cold-ingest suite");
}

for (const vendor of vendors) {
    test(`cold ingest: ${vendor.name}`, async ({ browser }, testInfo) => {
        // Budgets scale with vendor weight. Mandatory metadata and bounded GPS
        // probes can still be expensive on large removable-media samples; full
        // scans stay outside cold ingest because they never block initial trip
        // access. The conservative ceiling also covers slow CI disks.
        const mbTotal = Math.ceil(vendor.totalBytes / (1024 * 1024));
        const replayBudgetMs = 60_000 + mbTotal * 250;
        test.setTimeout(Math.max(replayBudgetMs * (WARMUP + REPLAYS), 180_000));

        const samples = await runWithReplays<ScenarioResult>(browser, {
            warmup: WARMUP,
            replays: REPLAYS,
            setup: async (page) => {
                await setupPage(page);
            },
            scenario: async (page) => {
                await resetPerfState(page);
                await resetBytesRead(page);
                await startPeakMemoryPoller(page, 100);

                // Snapshot CDP metrics before the scenario so we can diff
                // (TaskDuration etc. are cumulative since process start).
                const cdpBefore = await readCdpMetrics(page);
                const procBefore = await readCdpProcesses(page);

                const wallStart = Date.now();
                await deliverFiles(page, vendor.absPath);

                // Relative-path sanity check via app's own logger - ingest.ts
                // logs `relativePathsSample: vfiles.slice(0,5).map(vf=>vf.relativePath)`
                // in its "ingest started" record. If those samples are bare
                // basenames for a multi-file vendor, Playwright/Chromium did
                // not populate webkitRelativePath and channel/mode heuristics
                // that read parentDir will misfire. Warn once per vendor; do
                // not fail (this is a Playwright limitation, the perf test
                // remains useful for ingest timing). Skip the check on the
                // warmup pass to keep stderr clean.
                // The check happens at the end after we've already pulled
                // logs from the ring buffer.

                // Wait for the ingest-done lifecycle event, bounded by the
                // vendor-scaled per-replay budget computed above - a fixed
                // timeout would spuriously fail heavy vendors (Juscar 2.2 GB
                // legitimately needs minutes on its full-file streaming scan).
                await page.waitForFunction(
                    () => {
                        const w = window as unknown as {
                            __dashcamigoPerf?: { lifecycleEvents?: Array<{ type: string }> };
                        };
                        return !!w.__dashcamigoPerf?.lifecycleEvents?.some((e) => e.type === "dashcamigo:ingest-done");
                    },
                    { timeout: replayBudgetMs, polling: 100 },
                );
                const wallEnd = Date.now();

                const cdpAfter = await readCdpMetrics(page);
                const procAfter = await readCdpProcesses(page);
                const measures = await readMeasures(page);
                const lifecycleEvents = await readLifecycleEvents(page);
                const bytesRead = await readBytesRead(page);
                const peakMem = await stopAndReadPeakMemory(page);
                // Total page memory (including workers) is expensive: the API
                // synchronizes with GC and can take up to ~20 s per call. Off
                // by default - opt in via PERF_MEASURE_UA=1 when you actually
                // want it. Otherwise a 4-replay cold-ingest spends ~60 s of
                // wall time on this single metric, dwarfing the real ingest.
                const measureUABytes =
                    process.env.PERF_MEASURE_UA === "1" ? await readMeasureUASpecificMemory(page) : null;
                const logs = await readLogEntries(page);

                // Pull stageMs out of the "ingest done" log entry. ingest.ts
                // logs it with a structured ctx.
                const ingestDoneLog = logs.find((e) => e.ns === "ingest" && e.msg === "ingest done");
                const stageMs = (ingestDoneLog?.ctx?.stageMs as Record<string, number> | undefined) ?? {};
                const ingestDoneCtx = (ingestDoneLog?.ctx as Record<string, unknown>) ?? {};

                // Relative-path probe via the "ingest started" log entry.
                // Warn at most once per vendor across warmup+replays.
                if (vendor.filePaths.length > 1 && !relativePathWarned.has(vendor.name)) {
                    const ingestStartedLog = logs.find((e) => e.ns === "ingest" && e.msg === "ingest started");
                    const paths = (ingestStartedLog?.ctx?.relativePathsSample as string[] | undefined) ?? [];
                    const allBare = paths.length > 0 && paths.every((p) => !p.includes("/"));
                    if (allBare) {
                        relativePathWarned.add(vendor.name);
                        process.stderr.write(
                            `warn: webkitRelativePath empty for ${vendor.name} ` +
                                `(${vendor.filePaths.length} files). Playwright/Chromium did not preserve ` +
                                `the directory layout. Ingest timings are valid; channel/mode heuristics ` +
                                `that read parentDir are bypassed in this run.\n`,
                        );
                    }
                }

                const rendererBefore = sumByType(procBefore, "renderer");
                const rendererAfter = sumByType(procAfter, "renderer");
                const gpuBefore = sumByType(procBefore, "gpu");
                const gpuAfter = sumByType(procAfter, "gpu");

                return {
                    wallMs: wallEnd - wallStart,
                    stageMs,
                    bytesRead,
                    peakUsedJSHeap: peakMem.peakUsedJSHeapSize,
                    peakTotalJSHeap: peakMem.peakTotalJSHeapSize,
                    measureUASpecificMemoryBytes: measureUABytes,
                    crossOriginIsolated: peakMem.crossOriginIsolated,
                    cdpScriptDurationSecDelta: cdpAfter.scriptDurationSec - cdpBefore.scriptDurationSec,
                    cdpTaskDurationSecDelta: cdpAfter.taskDurationSec - cdpBefore.taskDurationSec,
                    cdpLayoutCountDelta: cdpAfter.layoutCount - cdpBefore.layoutCount,
                    cdpRecalcStyleCountDelta: cdpAfter.recalcStyleCount - cdpBefore.recalcStyleCount,
                    cdpNodesAfter: cdpAfter.nodes,
                    rendererRssDeltaBytes: rendererAfter.rss - rendererBefore.rss,
                    rendererCpuSecDelta: rendererAfter.cpu - rendererBefore.cpu,
                    gpuRssDeltaBytes: gpuAfter.rss - gpuBefore.rss,
                    gpuCpuSecDelta: gpuAfter.cpu - gpuBefore.cpu,
                    ingestStartUtcMs: wallStart,
                    ingestDoneCtx,
                    measures,
                    lifecycleEvents,
                    procSnapshotsAfter: procAfter,
                };
            },
        });

        publishMetrics(testInfo, vendor, samples);
    });
}

interface ScenarioResult {
    wallMs: number;
    stageMs: Record<string, number>;
    bytesRead: number;
    peakUsedJSHeap: number;
    peakTotalJSHeap: number;
    measureUASpecificMemoryBytes: number | null;
    crossOriginIsolated: boolean;
    cdpScriptDurationSecDelta: number;
    cdpTaskDurationSecDelta: number;
    cdpLayoutCountDelta: number;
    cdpRecalcStyleCountDelta: number;
    cdpNodesAfter: number;
    rendererRssDeltaBytes: number;
    rendererCpuSecDelta: number;
    gpuRssDeltaBytes: number;
    gpuCpuSecDelta: number;
    ingestStartUtcMs: number;
    ingestDoneCtx: Record<string, unknown>;
    measures: Array<{ name: string; startTime: number; duration: number }>;
    lifecycleEvents: Array<{ type: string; t: number; detail: Record<string, unknown> | undefined }>;
    procSnapshotsAfter: CdpProcessSnapshot[];
}

interface PerfAnnotationPayload {
    entries: Array<{ name: string; value: number; unit: string; extra?: string }>;
    detail?: Record<string, unknown>;
}

function publishMetrics(
    testInfo: { annotations: Array<{ type: string; description?: string }> },
    vendor: VendorSample,
    samples: ScenarioResult[],
): void {
    if (samples.length === 0) return;
    const prefix = `cold-ingest/${vendor.name}/`;
    const wall = aggregate(samples.map((s) => s.wallMs));
    const listReadyDurations = samples.map((sample) => {
        const event = sample.lifecycleEvents.find((entry) => entry.type === "dashcamigo:ingest-list-ready");
        const duration = Number(event?.detail?.durationMs);
        if (!Number.isFinite(duration)) throw new Error(`missing ingest-list-ready metric for ${vendor.name}`);
        return duration;
    });
    const listReady = aggregate(listReadyDurations);
    const heap = aggregate(samples.map((s) => s.peakUsedJSHeap));
    const bytes = aggregate(samples.map((s) => s.bytesRead));
    const scriptCpu = aggregate(samples.map((s) => s.cdpScriptDurationSecDelta * 1000));
    const taskCpu = aggregate(samples.map((s) => s.cdpTaskDurationSecDelta * 1000));
    const layout = aggregate(samples.map((s) => s.cdpLayoutCountDelta));
    const restyle = aggregate(samples.map((s) => s.cdpRecalcStyleCountDelta));
    const rendererRss = aggregate(samples.map((s) => s.rendererRssDeltaBytes));
    const rendererCpu = aggregate(samples.map((s) => s.rendererCpuSecDelta * 1000));
    const gpuRss = aggregate(samples.map((s) => s.gpuRssDeltaBytes));
    const gpuCpu = aggregate(samples.map((s) => s.gpuCpuSecDelta * 1000));

    const stageNames = new Set<string>();
    for (const s of samples) for (const k of Object.keys(s.stageMs)) stageNames.add(k);

    const entries: PerfAnnotationPayload["entries"] = [
        { name: `${prefix}list-ready-ms (median)`, value: listReady.median, unit: "ms" },
        { name: `${prefix}list-ready-ms (max)`, value: listReady.max, unit: "ms" },
        { name: `${prefix}wall-ms (median)`, value: wall.median, unit: "ms" },
        { name: `${prefix}wall-ms (max)`, value: wall.max, unit: "ms" },
        { name: `${prefix}peak-heap-bytes (median)`, value: heap.median, unit: "B" },
        // bytes-REQUESTED, not unique read. The Blob.slice().arrayBuffer()
        // counter sums every materialized read; the same byte range read
        // twice (Mp4Index header + a primitive re-reading the same window)
        // is counted twice. Ratio > 1 is a useful signal of redundant IO in
        // the parser pipeline, not a bug in the counter.
        { name: `${prefix}bytes-requested (median)`, value: bytes.median, unit: "B" },
        {
            name: `${prefix}bytes-requested/file-bytes`,
            value: bytes.median / Math.max(vendor.totalBytes, 1),
            unit: "ratio",
        },
        { name: `${prefix}script-cpu-ms (median)`, value: scriptCpu.median, unit: "ms" },
        { name: `${prefix}task-cpu-ms (median)`, value: taskCpu.median, unit: "ms" },
        { name: `${prefix}layout-count`, value: layout.median, unit: "count" },
        { name: `${prefix}restyle-count`, value: restyle.median, unit: "count" },
        { name: `${prefix}renderer-rss-delta-bytes`, value: rendererRss.median, unit: "B" },
        { name: `${prefix}renderer-cpu-ms (median)`, value: rendererCpu.median, unit: "ms" },
        { name: `${prefix}gpu-rss-delta-bytes`, value: gpuRss.median, unit: "B" },
        { name: `${prefix}gpu-cpu-ms (median)`, value: gpuCpu.median, unit: "ms" },
    ];
    for (const stage of stageNames) {
        const stageAgg = aggregate(samples.map((s) => s.stageMs[stage] ?? 0));
        entries.push({ name: `${prefix}stage:${stage}`, value: stageAgg.median, unit: "ms" });
    }

    testInfo.annotations.push({
        type: "perf",
        description: JSON.stringify({
            entries,
            detail: {
                vendor: vendor.name,
                fileBytes: vendor.totalBytes,
                videoCount: vendor.videoCount,
                fileCount: vendor.filePaths.length,
                samples: samples.map((s, i) => ({
                    replay: i,
                    wallMs: s.wallMs,
                    stageMs: s.stageMs,
                    bytesRead: s.bytesRead,
                    peakUsedJSHeap: s.peakUsedJSHeap,
                    peakTotalJSHeap: s.peakTotalJSHeap,
                    crossOriginIsolated: s.crossOriginIsolated,
                    measureUASpecificMemoryBytes: s.measureUASpecificMemoryBytes,
                    ingestDoneCtx: s.ingestDoneCtx,
                    rendererRssDeltaBytes: s.rendererRssDeltaBytes,
                    gpuRssDeltaBytes: s.gpuRssDeltaBytes,
                })),
            },
        } satisfies PerfAnnotationPayload),
    });
}
