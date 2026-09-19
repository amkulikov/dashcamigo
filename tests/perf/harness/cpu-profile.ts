import type { CDPSession, Page } from "@playwright/test";

async function stopProfiler(session: CDPSession) {
    const { profile } = await session.send("Profiler.stop");
    return profile;
}

export type CpuProfile = Awaited<ReturnType<typeof stopProfiler>>;

export interface CpuProfileFrame {
    functionName: string;
    url: string;
    scriptId: string;
    /** Source positions are one-based; synthetic frames have no position. */
    line: number | null;
    column: number | null;
    selfMs: number;
    inclusiveMs: number;
}

export interface CpuProfileSummary {
    durationMs: number;
    sampledMs: number;
    sampleCount: number;
    timingSource: "sample-deltas" | "uniform-samples" | "hit-counts" | "none";
    idleMs: number;
    garbageCollectorMs: number;
    topSelf: CpuProfileFrame[];
    topInclusive: CpuProfileFrame[];
}

export interface CpuProfileResult {
    profile: CpuProfile;
    summary: CpuProfileSummary;
}

export interface CpuProfileRecording {
    stop(): Promise<CpuProfileResult>;
}

/** Samples the page's main V8 isolate, including idle time, but not workers or native decoder threads. */
export async function startCpuProfile(page: Page): Promise<CpuProfileRecording> {
    const session = await page.context().newCDPSession(page);
    try {
        await session.send("Profiler.enable");
        await session.send("Profiler.setSamplingInterval", { interval: 1_000 });
        await session.send("Profiler.start");
    } catch (error) {
        await Promise.allSettled([session.detach()]);
        throw error;
    }

    let result: Promise<CpuProfileResult> | undefined;
    return {
        stop() {
            result ??= (async () => {
                try {
                    const profile = await stopProfiler(session);
                    return { profile, summary: summarizeCpuProfile(profile) };
                } finally {
                    await session.detach();
                }
            })();
            return result;
        },
    };
}

/** Groups call sites by function, counting recursive frames once per sampled stack in inclusive time. */
export function summarizeCpuProfile(profile: CpuProfile, topN = 30): CpuProfileSummary {
    if (!Number.isInteger(topN) || topN < 0) throw new Error("invalid cpu profile summary limit");

    const durationMs = Math.max(0, profile.endTime - profile.startTime) / 1_000;
    const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
    const parents = new Map<number, number>();
    const keys = new Map<number, string>();
    const frames = new Map<string, CpuProfileFrame>();
    for (const node of profile.nodes) {
        for (const child of node.children ?? []) parents.set(child, node.id);
        const frame = node.callFrame;
        const key = JSON.stringify([
            frame.functionName,
            frame.scriptId,
            frame.url,
            frame.lineNumber,
            frame.columnNumber,
        ]);
        keys.set(node.id, key);
        if (!frames.has(key)) {
            frames.set(key, {
                functionName: frame.functionName || "(anonymous)",
                url: frame.url,
                scriptId: frame.scriptId,
                line: frame.lineNumber < 0 ? null : frame.lineNumber + 1,
                column: frame.columnNumber < 0 ? null : frame.columnNumber + 1,
                selfMs: 0,
                inclusiveMs: 0,
            });
        }
    }

    const selfMs = new Map<number, number>();
    const samples = profile.samples ?? [];
    const deltas = profile.timeDeltas;
    let sampleCount = samples.length;
    let timingSource: CpuProfileSummary["timingSource"] = "none";
    if (samples.length > 0) {
        const hasDeltas =
            deltas !== undefined &&
            deltas.length === samples.length &&
            deltas.every((delta) => Number.isFinite(delta) && delta >= 0);
        timingSource = hasDeltas ? "sample-deltas" : "uniform-samples";
        let sampleTime = profile.startTime;
        for (let index = 0; index < samples.length; index++) {
            const id = samples[index]!;
            let ms = durationMs / samples.length;
            if (hasDeltas) {
                // A delta locates the current sample; its stack covers the next
                // interval. The profiler startup gap precedes the first sample.
                sampleTime += deltas[index]!;
                const nextTime = index + 1 < samples.length ? sampleTime + deltas[index + 1]! : profile.endTime;
                ms = Math.max(0, Math.min(nextTime, profile.endTime) - sampleTime) / 1_000;
            }
            selfMs.set(id, (selfMs.get(id) ?? 0) + ms);
        }
    } else {
        sampleCount = profile.nodes.reduce((total, node) => total + (node.hitCount ?? 0), 0);
        if (sampleCount > 0) {
            timingSource = "hit-counts";
            for (const node of profile.nodes) {
                selfMs.set(node.id, ((node.hitCount ?? 0) / sampleCount) * durationMs);
            }
        }
    }

    let sampledMs = 0;
    for (const [id, ms] of selfMs) {
        if (!nodes.has(id)) continue;
        sampledMs += ms;
        frames.get(keys.get(id)!)!.selfMs += ms;
        const visitedNodes = new Set<number>();
        const visitedFrames = new Set<string>();
        let ancestor: number | undefined = id;
        while (ancestor !== undefined && nodes.has(ancestor) && !visitedNodes.has(ancestor)) {
            visitedNodes.add(ancestor);
            const key = keys.get(ancestor)!;
            if (!visitedFrames.has(key)) {
                frames.get(key)!.inclusiveMs += ms;
                visitedFrames.add(key);
            }
            ancestor = parents.get(ancestor);
        }
    }

    const all = [...frames.values()];
    const ranked = all.filter((frame) => frame.functionName !== "(root)" && frame.inclusiveMs > 0);
    return {
        durationMs,
        sampledMs,
        sampleCount,
        timingSource,
        idleMs: all.reduce((total, frame) => total + (frame.functionName === "(idle)" ? frame.selfMs : 0), 0),
        garbageCollectorMs: all.reduce(
            (total, frame) => total + (frame.functionName === "(garbage collector)" ? frame.selfMs : 0),
            0,
        ),
        topSelf: [...ranked].sort((left, right) => right.selfMs - left.selfMs).slice(0, topN),
        topInclusive: [...ranked].sort((left, right) => right.inclusiveMs - left.inclusiveMs).slice(0, topN),
    };
}
