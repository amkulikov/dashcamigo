import { describe, expect, it } from "vitest";

import { pendingRecordingAnalysisProgress, recordingAnalysisPercent } from "./recording-analysis-progress.js";

describe("pendingRecordingAnalysisProgress", () => {
    it("keeps the status visible while recording details remain", () => {
        expect(pendingRecordingAnalysisProgress(17, 203)).toEqual({ completed: 17, total: 203 });
    });

    it("hides the status once every recording is settled", () => {
        expect(pendingRecordingAnalysisProgress(203, 203)).toBeNull();
        expect(pendingRecordingAnalysisProgress(204, 203)).toBeNull();
        expect(pendingRecordingAnalysisProgress(0, 0)).toBeNull();
    });

    it("clamps a resumed pass back into its valid range", () => {
        expect(pendingRecordingAnalysisProgress(-1, 203)).toEqual({ completed: 0, total: 203 });
    });
});

describe("recordingAnalysisPercent", () => {
    it("does not round an unfinished pass to 100 percent", () => {
        const progress = pendingRecordingAnalysisProgress(202, 203);
        expect(progress).not.toBeNull();
        expect(recordingAnalysisPercent(progress!)).toBe(99);
    });
});
