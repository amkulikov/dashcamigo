import { describe, expect, it } from "vitest";

import { createBlurRegion, regionRectAt } from "./blur-regions.js";
import { candidateContentStart } from "./export-range.js";
import { buildTripTimeline } from "./trips.js";
import {
    isEditableContentTime,
    playbackTimeForContent,
    presentedMediaTime,
    type PresentedFrame,
    type VideoFrameState,
} from "./video-frame-time.js";

const file = new File(["video"], "rear.mp4");
const frame: PresentedFrame = { file, src: "blob:rear", mediaTime: 10 };
const video: VideoFrameState = {
    file,
    src: frame.src,
    currentTime: 10.025,
    readyState: 2,
    seeking: false,
    isFramePending: false,
    hasFrameCallbacks: true,
};
const timeline = buildTripTimeline([
    { startUtc: 1000, durationSec: 60, wallDurationSec: 60, channels: {} },
    { startUtc: 1120, durationSec: 60, wallDurationSec: 60, channels: {} },
]);

describe("presentedMediaTime", () => {
    it("keeps the exact presented PTS while the playback clock advances", () => {
        expect(presentedMediaTime(video, frame, true)).toBe(10);
        expect(presentedMediaTime({ ...video, currentTime: 20 }, frame)).toBe(10);
    });

    it("keeps a held frame covered after the master passes the region end", () => {
        const region = createBlurRegion("rear", "fill", 9, 10.01, 10, {
            xPct: 0.2,
            yPct: 0.2,
            wPct: 0.1,
            hPct: 0.1,
        });
        const shown = presentedMediaTime({ ...video, currentTime: 11 }, frame);
        expect(regionRectAt(region, shown!)).not.toBeNull();
        expect(regionRectAt(region, 11)).toBeNull();
    });

    it("keeps preview on the old frame during a seek but blocks editing", () => {
        const pending = { ...video, seeking: true, currentTime: 40, isFramePending: true };
        expect(presentedMediaTime(pending, frame)).toBe(10);
        expect(presentedMediaTime(pending, frame, true)).toBeNull();
        expect(presentedMediaTime({ ...pending, seeking: false }, frame, true)).toBeNull();
        expect(presentedMediaTime(video, { ...frame, mediaTime: 40 }, true)).toBe(40);
    });

    it("rejects the previous file and source even if the element is reused", () => {
        expect(presentedMediaTime({ ...video, file: new File(["next"], "rear.mp4") }, frame)).toBeNull();
        expect(presentedMediaTime({ ...video, src: "blob:remux-replacement" }, frame)).toBeNull();
        expect(presentedMediaTime({ ...video, readyState: 1 }, frame)).toBeNull();
        expect(presentedMediaTime(video, null)).toBeNull();
    });

    it("uses the local media clock only after a seek settles without rVFC", () => {
        const fallback = { ...video, hasFrameCallbacks: false };
        expect(presentedMediaTime(fallback, null)).toBe(10.025);
        expect(presentedMediaTime({ ...fallback, seeking: true }, null)).toBeNull();
    });
});

describe("privacy content time", () => {
    it("preserves a jump into a missing channel range for the fallback camera", () => {
        const front = [{ startUtc: 1000, driftLeadSec: null, durationSec: 60 }];
        expect(playbackTimeForContent(timeline, front, 80)).toBe(80);
    });

    it("rejects seeds outside the exportable timeline instead of moving their time", () => {
        expect(isEditableContentTime(59 + 2, 60)).toBe(false);
        expect(isEditableContentTime(60, 60)).toBe(false);
        expect(isEditableContentTime(-0.1, 60)).toBe(false);
        expect(isEditableContentTime(59.966, 60)).toBe(true);
        expect(isEditableContentTime(0, 60)).toBe(true);
    });

    it("round-trips a seed through the drifting camera instead of the playhead", () => {
        const rear = { startUtc: 1120, driftLeadSec: 2, durationSec: 60 };
        const seed = candidateContentStart(timeline, rear) + presentedMediaTime(video, frame)!;
        expect(seed, "recording pause is removed and rear lead is retained").toBe(72);
        expect(seed - candidateContentStart(timeline, rear), "Follow reads the frame the user marked").toBe(10);
        expect(playbackTimeForContent(timeline, [rear], seed)).toBe(70);
    });

    it("finds the neighbour file's displayed frame near a drift boundary", () => {
        const contiguous = buildTripTimeline([
            { startUtc: 1000, durationSec: 60, wallDurationSec: 60, channels: {} },
            { startUtc: 1060, durationSec: 60, wallDurationSec: 60, channels: {} },
        ]);
        const rear = [
            { startUtc: 1000, driftLeadSec: 2, durationSec: 60 },
            { startUtc: 1060, driftLeadSec: 2.02, durationSec: 60 },
        ];
        expect(playbackTimeForContent(contiguous, rear, 61)).toBe(59);
        expect(playbackTimeForContent(contiguous, rear, 65)).toBeCloseTo(62.98);
    });
});
