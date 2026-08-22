import { describe, expect, it } from "vitest";

import { finalizeFollowEndReason } from "./follow-end.js";

const base = {
    initialized: true,
    lossPending: false,
    exitPending: false,
    requestedEndSec: 10,
    lastAnalyzedSec: 9.8,
    analysisIntervalSec: 0.5,
};

describe("finalizeFollowEndReason", () => {
    it("does not overwrite a confirmed exit", () => {
        expect(finalizeFollowEndReason("exited", { ...base, lossPending: true })).toBe("exited");
    });

    it("marks low confidence that reaches EOF before ride-out as lost", () => {
        expect(finalizeFollowEndReason("completed", { ...base, lossPending: true })).toBe("lost");
    });

    it("marks a materially short decode as lost", () => {
        expect(finalizeFollowEndReason("completed", { ...base, lastAnalyzedSec: 7 })).toBe("lost");
    });

    it("marks a pass that decoded no usable frame as lost", () => {
        expect(finalizeFollowEndReason("completed", { ...base, initialized: false })).toBe("lost");
    });

    it("accepts the normal sub-frame gap at the requested end", () => {
        expect(finalizeFollowEndReason("completed", base)).toBe("completed");
    });
});
