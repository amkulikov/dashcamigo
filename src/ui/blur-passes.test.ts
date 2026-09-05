import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BlurRegion } from "../blur-regions.js";
import { groupTrips, type Trip, type VideoCandidate } from "../trips.js";
import { flushMicrotasks, makePairedEndpoints } from "../workers/_protocol/test-helpers.js";
import { isWireMessage, type WireRequest } from "../workers/_protocol/wire.js";
import { TRACK_NOTIFY_PROGRESS, TRACK_NOTIFY_STARTED } from "../workers/tracker-protocol.js";

const ui = vi.hoisted(() => {
    vi.stubGlobal("navigator", { gpu: { requestAdapter: async () => ({}) } });
    return {
        trip: null as Trip | null,
        range: { startTripSec: 0, endTripSec: 3 },
    };
});

// The real pass/client logic runs against a Worker message boundary. Only the
// app's DOM-facing state and notification imports are severed for Node.
vi.mock("./state.js", () => ({
    activeTrip: () => ui.trip,
    state: { exportModeOpen: true, composition: { channelOrder: ["front"] } },
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

import { captureDetectExportRequest, setDetectEnabled } from "./blur-detect.js";
import { _resetForTests, cancelTrackPass, toggleTrackPass, trackPassOf } from "./blur-track.js";
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

let endpoints: ReturnType<typeof makePairedEndpoints>;
let requests: WireRequest[];

beforeEach(() => {
    _resetForTests();
    ui.trip = makeTrip();
    ui.range = { startTripSec: 0, endTripSec: 3 };
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
});

afterEach(() => {
    trackerWorkerClient().dispose();
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

describe("blur pass lifecycle", () => {
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
