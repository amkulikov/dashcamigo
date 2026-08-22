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
        requestVideoFrameCallback: undefined,
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

describe("captureCurrentFrame privacy blur", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("burns the full effective manual + detected region set into a JPG", async () => {
        const effective = [{ id: "manual" }, { id: "auto-detected" }];
        const resolved = [{ style: "fill" }];
        mocks.activeEffectiveBlurRegions.mockReturnValue(effective);
        mocks.resolveRegionBlursAt.mockReturnValue(resolved);

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

        await captureCurrentFrame(
            () => 0,
            () => 1,
        );

        expect(mocks.resolveRegionBlursAt).toHaveBeenCalledWith(effective, "front", 1);
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
});
