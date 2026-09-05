import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    activeEffectiveBlurRegions: vi.fn(),
    resolveRegionBlursAt: vi.fn(),
    paintRegionBlursForView: vi.fn(),
    downloadBlob: vi.fn(),
    video: {
        readyState: 2,
        videoWidth: 100,
        videoHeight: 60,
        currentTime: 1,
        paused: true,
        seeking: false,
        src: "blob:current",
        requestVideoFrameCallback: undefined as undefined | ((callback: VideoFrameRequestCallback) => number),
        cancelVideoFrameCallback: vi.fn(),
    },
}));

vi.mock("../blur-regions.js", () => ({ resolveRegionBlursAt: mocks.resolveRegionBlursAt }));
vi.mock("../download.js", () => ({ downloadBlob: mocks.downloadBlob }));
vi.mock("../i18n/index.js", () => ({ t: (key: string) => key }));
vi.mock("../log.js", () => ({
    createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
vi.mock("../transcode/compose.js", () => ({
    createRegionBlurHelper: () => ({}),
    paintRegionBlursForView: mocks.paintRegionBlursForView,
}));
vi.mock("../trips.js", () => ({ displayClockDate: (sec: number) => new Date(sec * 1000) }));
vi.mock("./blur-effective.js", () => ({ activeEffectiveBlurRegions: mocks.activeEffectiveBlurRegions }));

vi.mock("./dom.js", () => ({
    activePlayer: () => mocks.video,
    effectiveMasterChannel: () => "front",
    dom: { playerBar: { capture: {} }, player: mocks.video },
}));
vi.mock("./state.js", () => ({
    activeCandidate: () => null,
    activeTrip: () => null,
    state: { exportModeOpen: true, channelBackends: {}, chartZoomed: false },
}));

import { captureCurrentFrame } from "./player-capture.js";

function stubCaptureCanvas(): { drawImage: ReturnType<typeof vi.fn> } {
    const ctx = { drawImage: vi.fn() };
    const canvas = {
        width: 0,
        height: 0,
        getContext: () => ctx,
        toBlob: (callback: (blob: Blob) => void) => callback(new Blob(["jpg"])),
    };
    vi.stubGlobal("document", {
        createElement: (tag: string) => {
            expect(tag).toBe("canvas");
            return canvas;
        },
    });
    return ctx;
}

function acknowledgeFrame(before?: () => void): void {
    mocks.video.requestVideoFrameCallback = (callback) => {
        queueMicrotask(() => {
            before?.();
            callback(0, {
                mediaTime: 1.25,
                expectedDisplayTime: 0,
                presentationTime: 0,
                presentedFrames: 1,
                width: 100,
                height: 60,
                processingDuration: 0,
            });
        });
        return 1;
    };
}

describe("captureCurrentFrame privacy blur", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.video.seeking = false;
        mocks.video.src = "blob:current";
        mocks.video.requestVideoFrameCallback = undefined;
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("burns the full effective manual + detected region set into a JPG", async () => {
        const effective = [{ id: "manual" }, { id: "auto-detected" }];
        const resolved = [{ style: "fill" }];
        mocks.activeEffectiveBlurRegions.mockReturnValue(effective);
        mocks.resolveRegionBlursAt.mockReturnValue(resolved);

        const ctx = stubCaptureCanvas();

        await captureCurrentFrame(
            () => 0,
            () => 1,
            () => 3,
        );

        expect(mocks.resolveRegionBlursAt).toHaveBeenCalledWith(effective, "front", 3);
        expect(mocks.paintRegionBlursForView).toHaveBeenCalledWith(
            ctx,
            resolved,
            100,
            60,
            0,
            0,
            100,
            60,
            0,
            0,
            100,
            60,
            expect.anything(),
        );
        expect(mocks.downloadBlob).toHaveBeenCalledOnce();
    });

    it("refuses a JPG while the requested seek still displays older pixels", async () => {
        mocks.video.seeking = true;
        await captureCurrentFrame(
            () => 0,
            () => 40,
            () => null,
        );
        expect(mocks.downloadBlob).not.toHaveBeenCalled();
        expect(mocks.resolveRegionBlursAt).not.toHaveBeenCalled();
    });

    it("refuses an export-mode JPG until its displayed frame has a timestamp", async () => {
        await captureCurrentFrame(
            () => 0,
            () => 40,
            () => null,
        );
        expect(mocks.downloadBlob).not.toHaveBeenCalled();
        expect(mocks.resolveRegionBlursAt).not.toHaveBeenCalled();
    });

    it("resolves a captured frame's own PTS instead of a later playhead", async () => {
        stubCaptureCanvas();
        acknowledgeFrame();
        mocks.activeEffectiveBlurRegions.mockReturnValue([]);
        mocks.resolveRegionBlursAt.mockReturnValue([]);
        const contentTime = vi.fn((_channel: string, time?: number) => (time === undefined ? null : time + 2));
        await captureCurrentFrame(
            () => 0,
            () => 40,
            contentTime,
        );
        expect(contentTime).toHaveBeenCalledWith("front", 1.25);
        expect(mocks.resolveRegionBlursAt).toHaveBeenCalledWith([], "front", 3.25);
        expect(mocks.downloadBlob).toHaveBeenCalledOnce();
    });

    it("rejects a source reload on the same video during frame acknowledgement", async () => {
        acknowledgeFrame(() => {
            mocks.video.src = "blob:replacement";
        });
        await captureCurrentFrame(
            () => 0,
            () => 40,
            () => 3.25,
        );
        expect(mocks.downloadBlob).not.toHaveBeenCalled();
        expect(mocks.resolveRegionBlursAt).not.toHaveBeenCalled();
    });
});
