import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BlurRegion } from "../blur-regions.js";
import type { Channel } from "../parsers/types.js";
import { groupTrips, tripAllCandidates, type Trip, type VideoCandidate } from "../trips.js";
import { flushMicrotasks, makePairedEndpoints } from "../workers/_protocol/test-helpers.js";
import { isWireMessage, type WireRequest } from "../workers/_protocol/wire.js";
import {
    DETECT_REQUEST,
    TRACK_NOTIFY_PROGRESS,
    TRACK_NOTIFY_STARTED,
    type DetectResult,
} from "../workers/tracker-protocol.js";

const ui = vi.hoisted(() => {
    vi.stubGlobal("navigator", { gpu: { requestAdapter: async () => ({}) } });
    return {
        trip: null as Trip | null,
        range: { startTripSec: 0, endTripSec: 3 },
        channels: ["front"] as Channel[],
    };
});

// The real pass/client logic runs against a Worker message boundary. Only the
// app's DOM-facing state and notification imports are severed for Node.
vi.mock("./state.js", () => ({
    activeTrip: () => ui.trip,
    state: {
        exportModeOpen: true,
        composition: {
            get channelOrder() {
                return ui.channels;
            },
        },
    },
}));
vi.mock("./export-state.js", () => ({
    exportPanelState: {
        blurStyle: "blur",
        get range() {
            return ui.range;
        },
    },
    subscribeExportState: () => () => {},
    notifyExportStateChanged: () => {},
}));
vi.mock("./notifications.js", () => ({ notify: () => {} }));

import {
    _resetForTests as resetDetection,
    captureDetectExportRequest,
    detectEnabled,
    detectPassState,
    detectRegions,
    detectStyle,
    ensureDetectPass,
    ensureDetectRegionsForExport,
    setDetectEnabled,
    setDetectStyle,
} from "./blur-detect.js";
import { _resetForTests as resetAssets, downloadBlurAssets } from "./blur-assets.js";
import { carryBlurRegions } from "./blur-regions-state.js";
import {
    _resetForTests,
    cancelTrackPass,
    cancelTrackPassesExceptTrip,
    toggleTrackPass,
    trackPassOf,
} from "./blur-track.js";
import { trackerWorkerClient } from "./tracker-worker-client.js";

function makeTrip(): Trip {
    const file = new File(["video"], "front.mp4");
    const candidate: VideoCandidate = {
        file,
        relativePath: file.name,
        fingerprint: "generic",
        appliedExtractors: [],
        classifierMatches: { time: null, channel: null, mode: null, sequence: null },
        channel: "front",
        channelConfident: true,
        sequence: null,
        recordingMode: null,
        isTimelapse: false,
        startUtc: 1000,
        durationSec: 4,
        wallDurationSec: null,
        driftLeadSec: null,
        startSource: "mp4",
        cameraTzSec: null,
        createdUtc: null,
        records: [],
        codec: null,
        codecParam: null,
        videoCodecString: null,
        rotation: 0,
        width: null,
        height: null,
        fps: null,
        audio: null,
        canPlay: true,
        needsHevcRemux: false,
        isTransportStream: false,
        isMatroska: false,
        audioNeedsTranscode: false,
        embeddedStartUtcHint: null,
        localClockOffsetHintSec: null,
    };
    return groupTrips([candidate])[0]!;
}

function makeRegion(): BlurRegion {
    return {
        id: "region-1",
        channel: "front",
        style: "blur",
        startSec: 0,
        endSec: 4,
        autoEnd: false,
        lastTrackLost: false,
        keyframes: [{ contentSec: 0, rect: { xPct: 0.2, yPct: 0.2, wPct: 0.1, hPct: 0.1 }, pinned: true }],
    };
}

function makeDetectResult(): DetectResult {
    return {
        tracksByKind: {
            plate: [
                {
                    startSec: 0,
                    endSec: 3,
                    keyframes: [{ contentSec: 0, rect: makeRegion().keyframes[0]!.rect }],
                    detHits: 2,
                    bestScore: 0.9,
                },
            ],
        },
        statsByKind: {},
        decodedFrames: 90,
        passMs: 100,
    };
}

function regroupTrip(): void {
    const previous = ui.trip!;
    ui.trip = groupTrips(tripAllCandidates(previous))[0]!;
    carryBlurRegions([previous], [ui.trip]);
}

let endpoints: ReturnType<typeof makePairedEndpoints>;
let requests: WireRequest[];

beforeEach(() => {
    _resetForTests();
    resetDetection();
    resetAssets();
    ui.trip = makeTrip();
    ui.range = { startTripSec: 0, endTripSec: 3 };
    ui.channels = ["front"];
    endpoints = makePairedEndpoints();
    requests = [];
    endpoints.workerEndpoint.addEventListener("message", (event) => {
        if (isWireMessage(event.data) && event.data.__k === "req") requests.push(event.data);
    });
    vi.stubGlobal("Worker", function Worker() {
        return endpoints.mainEndpoint;
    });
    vi.stubGlobal("window", globalThis);
    vi.stubGlobal("navigator", { gpu: { requestAdapter: async () => ({}) } });
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
    vi.stubGlobal("caches", { match: async () => undefined });
    vi.stubGlobal("fetch", async () => new Response(new Uint8Array([1, 2, 3])));
});

afterEach(() => {
    resetDetection();
    trackerWorkerClient().dispose();
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

describe("blur pass lifecycle", () => {
    it("keeps a running detection pass and fresh results when only tile order changes", async () => {
        const front = tripAllCandidates(ui.trip!)[0]!;
        const rear: VideoCandidate = { ...front, file: new File(["video"], "rear.mp4"), channel: "rear" };
        ui.trip = groupTrips([front, rear])[0]!;
        ui.channels = ["front", "rear"];
        await downloadBlurAssets(["detect-plate"]);
        setDetectEnabled("plate", true);
        const initial = captureDetectExportRequest()!;
        ensureDetectPass();
        await flushMicrotasks();
        const frontRequest = requests[0]!;

        ui.channels = ["rear", "front"];
        const reordered = captureDetectExportRequest()!;
        expect(reordered.params.key).toBe(initial.params.key);
        expect(reordered.params.channels, "new scans still follow the current tile order").toEqual(["rear", "front"]);
        ensureDetectPass();
        await flushMicrotasks();
        expect(requests, "tile reorder does not discard and repeat the active scan").toHaveLength(1);

        endpoints.workerEndpoint.postMessage({ __k: "res", id: frontRequest.id, ok: true, result: makeDetectResult() });
        await flushMicrotasks();
        await flushMicrotasks();
        const rearRequest = requests[1]!;
        expect(rearRequest.data).toMatchObject({ segments: [{ file: rear.file }] });
        endpoints.workerEndpoint.postMessage({ __k: "res", id: rearRequest.id, ok: true, result: makeDetectResult() });
        await flushMicrotasks();
        expect(detectRegions().map((region) => region.channel)).toEqual(["front", "rear"]);

        ui.channels = ["front", "rear"];
        ensureDetectPass();
        await flushMicrotasks();
        expect(requests, "a completed cache stays fresh across tile order changes").toHaveLength(2);
        expect(detectRegions()).toHaveLength(2);
    });

    it("keeps Follow running after the visible trip is rebuilt from unchanged source footage", async () => {
        const region = makeRegion();
        const pending = toggleTrackPass(ui.trip!, region);
        await flushMicrotasks();
        regroupTrip();
        cancelTrackPassesExceptTrip(ui.trip);
        await flushMicrotasks();
        expect(trackPassOf(region.id)).not.toBeNull();
        cancelTrackPass(region.id);
        expect(await pending).toBe("cancelled");
    });

    it("ignores cancelled Follow notifications after the same region restarts", async () => {
        const region = makeRegion();
        const first = toggleTrackPass(ui.trip!, region);
        await flushMicrotasks();
        const firstRequest = requests[0]!;
        cancelTrackPass(region.id);
        expect(await first).toBe("cancelled");

        const second = toggleTrackPass(ui.trip!, region);
        await flushMicrotasks();
        const secondRequest = requests[1]!;
        const firstData = firstRequest.data as { regionId: string; passId: string };
        const secondData = secondRequest.data as { regionId: string; passId: string };
        expect(firstData.passId).not.toBe(secondData.passId);

        vi.useFakeTimers();
        endpoints.workerEndpoint.postMessage({ __k: "ntf", type: TRACK_NOTIFY_STARTED, data: firstData });
        endpoints.workerEndpoint.postMessage({
            __k: "ntf",
            type: TRACK_NOTIFY_PROGRESS,
            data: { ...firstData, fractionDone: 0.9 },
        });
        await flushMicrotasks();
        expect(trackPassOf(region.id), "old progress does not move the new pass").toEqual({ fractionDone: 0 });
        expect(vi.getTimerCount(), "queue wait does not arm the replacement's inactivity cap").toBe(0);

        endpoints.workerEndpoint.postMessage({ __k: "ntf", type: TRACK_NOTIFY_STARTED, data: secondData });
        endpoints.workerEndpoint.postMessage({
            __k: "ntf",
            type: TRACK_NOTIFY_PROGRESS,
            data: { ...secondData, fractionDone: 0.25 },
        });
        await flushMicrotasks();
        expect(trackPassOf(region.id)).toEqual({ fractionDone: 0.25 });
        expect(vi.getTimerCount()).toBe(1);
        cancelTrackPass(region.id);
        expect(await second).toBe("cancelled");
        expect(vi.getTimerCount()).toBe(0);
    });

    it("keeps user cancellation authoritative when it crosses a delivered Follow response", async () => {
        const region = makeRegion();
        const before = structuredClone(region);
        const pending = toggleTrackPass(ui.trip!, region);
        await flushMicrotasks();
        endpoints.workerEndpoint.postMessage({
            __k: "res",
            id: requests[0]!.id,
            ok: true,
            result: {
                keyframes: [{ contentSec: 2, rect: { xPct: 0.6, yPct: 0.6, wPct: 0.1, hPct: 0.1 } }],
                trackedUntilSec: 4,
                endReason: "completed",
            },
        });
        queueMicrotask(() => cancelTrackPass(region.id));
        expect(await pending).toBe("cancelled");
        expect(region).toEqual(before);
    });

    it("does not apply Follow results when the inactivity timeout crosses their delivery", async () => {
        vi.useFakeTimers();
        const region = makeRegion();
        const before = structuredClone(region);
        const pending = toggleTrackPass(ui.trip!, region);
        await flushMicrotasks();
        const request = requests[0]!;
        endpoints.workerEndpoint.postMessage({ __k: "ntf", type: TRACK_NOTIFY_STARTED, data: request.data });
        await flushMicrotasks();
        endpoints.workerEndpoint.postMessage({
            __k: "res",
            id: request.id,
            ok: true,
            result: {
                keyframes: [{ contentSec: 2, rect: { xPct: 0.6, yPct: 0.6, wPct: 0.1, hPct: 0.1 } }],
                trackedUntilSec: 4,
                endReason: "completed",
            },
        });
        queueMicrotask(() => vi.runAllTimers());
        expect(await pending).toBe("failed");
        expect(region).toEqual(before);
    });

    it("restores cached covers after trimming without waiting behind another Follow", async () => {
        await downloadBlurAssets(["detect-plate"]);
        setDetectEnabled("plate", true);
        const initial = ensureDetectRegionsForExport(
            captureDetectExportRequest()!,
            new AbortController().signal,
            () => {},
        );
        await flushMicrotasks();
        const request = requests[0]!;
        endpoints.workerEndpoint.postMessage({ __k: "res", id: request.id, ok: true, result: makeDetectResult() });
        expect(await initial).toHaveLength(1);

        regroupTrip();
        expect(detectEnabled("plate"), "regroup preserves detection even without manual zones").toBe(true);
        expect(detectRegions()).toHaveLength(1);

        const region = makeRegion();
        const follow = toggleTrackPass(ui.trip!, region);
        await flushMicrotasks();
        ui.range = { startTripSec: 1, endTripSec: 2 };
        const trimmed = ensureDetectRegionsForExport(
            captureDetectExportRequest()!,
            new AbortController().signal,
            () => {},
        );
        await flushMicrotasks();
        try {
            expect(requests.filter((entry) => entry.type === DETECT_REQUEST)).toHaveLength(1);
            expect(await trimmed).toMatchObject([{ startSec: 1, endSec: 2 }]);
            expect(detectRegions()).toMatchObject([{ startSec: 1, endSec: 2 }]);
            expect(trackPassOf(region.id), "the unrelated Follow remains active").not.toBeNull();
        } finally {
            cancelTrackPass(region.id);
            expect(await follow).toBe("cancelled");
        }
    });

    it("retains an in-flight scan when regrouping preserves its source mapping", async () => {
        await downloadBlurAssets(["detect-plate"]);
        setDetectEnabled("plate", true);
        ensureDetectPass();
        await flushMicrotasks();
        const request = requests[0]!;

        regroupTrip();
        expect(detectPassState(), "the rebuilt trip still owns the running scan").not.toBeNull();
        endpoints.workerEndpoint.postMessage({ __k: "res", id: request.id, ok: true, result: makeDetectResult() });
        await flushMicrotasks();
        expect(detectEnabled("plate")).toBe(true);
        expect(detectRegions()).toHaveLength(1);
    });

    it("drops an in-flight scan when a mutable candidate changes the source mapping", async () => {
        await downloadBlurAssets(["detect-plate"]);
        setDetectEnabled("plate", true);
        ensureDetectPass();
        await flushMicrotasks();
        const request = requests[0]!;
        tripAllCandidates(ui.trip!)[0]!.rotation = 180;

        regroupTrip();
        endpoints.workerEndpoint.postMessage({ __k: "res", id: request.id, ok: true, result: makeDetectResult() });
        await flushMicrotasks();
        expect(detectPassState()).toBeNull();
        expect(detectEnabled("plate"), "source corrections preserve the user's privacy choice").toBe(true);
        expect(detectRegions(), "old pixel coordinates never appear on the changed source").toEqual([]);
        ensureDetectPass();
        await flushMicrotasks();
        const replacement = requests[1]!;
        expect(replacement.data).toMatchObject({ analyzeIntervalsByKind: { plate: [{ startSec: 0, endSec: 3 }] } });
        endpoints.workerEndpoint.postMessage({ __k: "res", id: replacement.id, ok: true, result: makeDetectResult() });
        await flushMicrotasks();
        expect(detectRegions()).toHaveLength(1);
    });

    it("keeps old export results out of a source mapping corrected on the same Trip object", async () => {
        await downloadBlurAssets(["detect-plate"]);
        setDetectEnabled("plate", true);
        const pending = ensureDetectRegionsForExport(
            captureDetectExportRequest()!,
            new AbortController().signal,
            () => {},
        );
        await flushMicrotasks();
        const request = requests[0]!;
        tripAllCandidates(ui.trip!)[0]!.rotation = 180;
        carryBlurRegions([ui.trip!], [ui.trip!]);

        endpoints.workerEndpoint.postMessage({ __k: "res", id: request.id, ok: true, result: makeDetectResult() });
        expect(await pending, "the captured export still receives its own results").toHaveLength(1);
        expect(detectEnabled("plate")).toBe(true);
        expect(detectRegions(), "the old export cannot replace the corrected trip's empty cache").toEqual([]);

        ensureDetectPass();
        await flushMicrotasks();
        const replacement = requests[1]!;
        expect(replacement.data).toMatchObject({ analyzeIntervalsByKind: { plate: [{ startSec: 0, endSec: 3 }] } });
        endpoints.workerEndpoint.postMessage({ __k: "res", id: replacement.id, ok: true, result: makeDetectResult() });
        await flushMicrotasks();
        expect(detectRegions()).toHaveLength(1);
    });

    it("preserves detection choices and rescans when channel reassignment changes the first file", async () => {
        const front = tripAllCandidates(ui.trip!)[0]!;
        const rear: VideoCandidate = { ...front, file: new File(["video"], "rear.mp4"), channel: "rear" };
        ui.trip = groupTrips([front, rear])[0]!;
        await downloadBlurAssets(["detect-plate"]);
        setDetectEnabled("plate", true);
        setDetectStyle("fill");
        ensureDetectPass();
        await flushMicrotasks();
        const request = requests[0]!;
        endpoints.workerEndpoint.postMessage({ __k: "res", id: request.id, ok: true, result: makeDetectResult() });
        await flushMicrotasks();
        expect(detectRegions()).toHaveLength(1);

        const previous = ui.trip!;
        expect(tripAllCandidates(previous)[0]!.file).toBe(front.file);
        front.channel = "rear";
        rear.channel = "front";
        regroupTrip();
        expect(tripAllCandidates(ui.trip!)[0]!.file, "the file set survives in a different order").toBe(rear.file);
        expect(detectEnabled("plate")).toBe(true);
        expect(detectStyle()).toBe("fill");
        expect(detectRegions(), "channel reassignment invalidates the cached rectangles").toEqual([]);

        ensureDetectPass();
        await flushMicrotasks();
        const replacement = requests[1]!;
        expect(replacement.data).toMatchObject({
            segments: [{ file: rear.file }],
            analyzeIntervalsByKind: { plate: [{ startSec: 0, endSec: 3 }] },
        });
        endpoints.workerEndpoint.postMessage({ __k: "res", id: replacement.id, ok: true, result: makeDetectResult() });
        await flushMicrotasks();
        expect(detectRegions()).toMatchObject([{ channel: "front", style: "fill" }]);
    });

    it.each([false, true])(
        "keeps every channel's file windows across clock corrections (export: %s)",
        async (forExport) => {
            const front = tripAllCandidates(ui.trip!)[0]!;
            const rear: VideoCandidate = { ...front, file: new File(["video"], "rear.mp4"), channel: "rear" };
            ui.trip = groupTrips([front, rear])[0]!;
            ui.channels = ["front", "rear"];
            await downloadBlurAssets(["detect-plate"]);
            setDetectEnabled("plate", true);
            const exported = forExport
                ? ensureDetectRegionsForExport(captureDetectExportRequest()!, new AbortController().signal, () => {})
                : null;
            if (!forExport) ensureDetectPass();
            await flushMicrotasks();
            const first = requests[0]!;

            front.startUtc += 3600;
            rear.startUtc += 3600;
            regroupTrip();
            endpoints.workerEndpoint.postMessage({ __k: "res", id: first.id, ok: true, result: makeDetectResult() });
            await flushMicrotasks();
            await flushMicrotasks();
            expect(requests, "the rear channel is still analyzed after the first channel finishes").toHaveLength(2);
            const second = requests[1]!;
            expect(second.data).toMatchObject({
                segments: [{ file: rear.file, startInFile: 0, endInFile: 3, tripStart: 0 }],
            });
            endpoints.workerEndpoint.postMessage({ __k: "res", id: second.id, ok: true, result: makeDetectResult() });
            await flushMicrotasks();
            expect(detectRegions().map((region) => region.channel)).toEqual(["front", "rear"]);
            if (exported) expect((await exported).map((region) => region.channel)).toEqual(["front", "rear"]);
        },
    );

    it("fails export when the captured source changes while model assets warm", async () => {
        setDetectEnabled("plate", true);
        const request = captureDetectExportRequest()!;
        let release!: (response: Response) => void;
        vi.stubGlobal(
            "fetch",
            vi
                .fn()
                .mockImplementationOnce(
                    () =>
                        new Promise<Response>((resolve) => {
                            release = resolve;
                        }),
                )
                .mockImplementation(async () => new Response(new Uint8Array([1, 2, 3]))),
        );
        const pending = ensureDetectRegionsForExport(request, new AbortController().signal, () => {});
        const rejected = expect(pending).rejects.toThrow("detect source changed after export started");
        await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
        tripAllCandidates(ui.trip!)[0]!.startUtc += 3600;
        regroupTrip();
        release(new Response(new Uint8Array([1, 2, 3])));
        await rejected;
        expect(requests, "the changed source cannot produce a falsely empty privacy result").toHaveLength(0);
    });

    it("gives sub-centisecond trim edits distinct detection contracts", () => {
        setDetectEnabled("plate", true);
        const original = captureDetectExportRequest()!;
        ui.range = { startTripSec: 0.001, endTripSec: 3.001 };
        const changed = captureDetectExportRequest()!;
        expect(changed.params.key).not.toBe(original.params.key);
        expect(original.params.startSec).toBe(0);
        expect(original.params.endSec).toBe(3);
        expect(changed.params.startSec).toBe(0.001);
    });
});
