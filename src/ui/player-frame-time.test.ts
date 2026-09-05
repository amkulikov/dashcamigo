import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildTripTimeline, type Trip, type TripFrame, type VideoCandidate } from "../trips.js";

const ui = vi.hoisted(() => ({ video: null as HTMLVideoElement | null, trip: null as Trip | null }));
vi.mock("./dom.js", () => ({
    channelPlayers: {
        get front() {
            return ui.video;
        },
    },
    forEachVideoSlot: (visit: (video: HTMLVideoElement) => void) => visit(ui.video!),
}));
vi.mock("./state.js", () => ({ activeTrip: () => ui.trip }));

import { _resetForTests, channelPresentedFrame, initPlayerFrameTimes } from "./player-frame-time.js";
import { videoAttachedFile } from "./player-video-src.js";

function makeTrip(file: File): Trip {
    const candidate: VideoCandidate = {
        file,
        relativePath: file.name,
        fingerprint: "generic",
        appliedExtractors: [],
        classifierMatches: { time: null, channel: null, mode: null, sequence: null },
        channel: null,
        channelConfident: false,
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
    const frames: TripFrame[] = [
        { startUtc: 1000, durationSec: 4, wallDurationSec: 4, channels: { front: candidate } },
    ];
    return {
        frames,
        timeline: buildTripTimeline(frames),
        startUtc: 1000,
        endUtc: 1004,
        durationSec: 4,
        totalBytes: file.size,
        distanceKm: 0,
        records: [],
        events: [],
        inferredSegments: [],
        isParking: false,
        confidentChannels: new Set(),
        cameraTzSec: null,
    };
}

function makeVideo() {
    const callbacks = new Map<number, VideoFrameRequestCallback>();
    let nextId = 0;
    const target = Object.assign(new EventTarget(), {
        src: "",
        readyState: 0,
        currentTime: 0,
        seeking: false,
        requestVideoFrameCallback(callback: VideoFrameRequestCallback): number {
            const id = ++nextId;
            callbacks.set(id, callback);
            return id;
        },
        cancelVideoFrameCallback(id: number): void {
            callbacks.delete(id);
        },
    });
    // Only the browser event/metadata boundary is replaced; frame identity and
    // canonical time are resolved by the actual player adapter.
    const video = target as unknown as HTMLVideoElement;
    return {
        target,
        video,
        present(mediaTime: number): void {
            const pending = [...callbacks.values()];
            callbacks.clear();
            for (const callback of pending)
                callback(0, {
                    mediaTime,
                    expectedDisplayTime: 0,
                    presentationTime: 0,
                    presentedFrames: 1,
                    width: 1920,
                    height: 1080,
                    processingDuration: 0,
                });
        },
    };
}

describe("player frame observations", () => {
    beforeEach(() => _resetForTests());

    it("retains a paused first PTS before metadata and decoded readiness arrive", () => {
        const source = makeVideo();
        ui.video = source.video;
        initPlayerFrameTimes();
        const file = new File(["video"], "generic.mp4");
        ui.trip = makeTrip(file);
        videoAttachedFile.set(source.video, file);
        source.target.src = "blob:generic";
        source.target.dispatchEvent(new Event("loadstart"));
        source.target.readyState = 1;
        source.present(0);
        source.target.dispatchEvent(new Event("loadedmetadata"));
        expect(channelPresentedFrame("front", true)).toBeNull();
        source.target.readyState = 4;
        source.target.dispatchEvent(new Event("loadeddata"));

        expect(channelPresentedFrame("front", true)?.contentSec).toBe(0);
    });

    it("keeps a seek pending until a frame arrives after seeking finishes", () => {
        const source = makeVideo();
        ui.video = source.video;
        const file = new File(["video"], "generic.mp4");
        ui.trip = makeTrip(file);
        videoAttachedFile.set(source.video, file);
        source.target.src = "blob:generic";
        initPlayerFrameTimes();
        source.target.readyState = 2;
        source.present(0);
        source.target.seeking = true;
        source.target.currentTime = 2;
        source.target.dispatchEvent(new Event("seeking"));
        source.present(0);
        source.target.seeking = false;
        source.target.dispatchEvent(new Event("seeked"));

        expect(channelPresentedFrame("front")?.contentSec).toBe(0);
        expect(channelPresentedFrame("front", true)).toBeNull();
        source.present(2);
        expect(channelPresentedFrame("front", true)?.contentSec).toBe(2);
    });

    it("settles a seek to the exact displayed PTS without a second frame", () => {
        const source = makeVideo();
        ui.video = source.video;
        const file = new File(["video"], "generic.mp4");
        ui.trip = makeTrip(file);
        videoAttachedFile.set(source.video, file);
        source.target.src = "blob:generic";
        initPlayerFrameTimes();
        source.target.readyState = 1;
        source.target.seeking = true;
        source.target.dispatchEvent(new Event("seeking"));
        source.present(0);
        source.target.readyState = 4;
        source.target.seeking = false;
        source.target.dispatchEvent(new Event("seeked"));

        expect(channelPresentedFrame("front", true)?.contentSec).toBe(0);
    });
});
