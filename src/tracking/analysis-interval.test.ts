import { describe, expect, it } from "vitest";
import { analysisIntervalTransition } from "./analysis-interval.js";
import { finalizeTrack } from "./detect-track.js";
import { subtractIntervals, unionIntervals } from "./interval-set.js";

describe("analysis interval lifecycle", () => {
    it("finishes plates at their own cached gap while faces keep decoding", () => {
        const range = { startSec: 0, endSec: 3 };
        const plates = subtractIntervals(range, [{ startSec: 1, endSec: 2 }]);
        const faces = [range];
        expect(unionIntervals([...plates, ...faces])).toEqual([range]);

        const first = analysisIntervalTransition(null, plates, 0.9);
        expect(first.started).toBe(true);
        const gap = analysisIntervalTransition(first.active, plates, 1);
        expect(gap.active).toBeNull();
        expect(gap.finished).toBe(plates[0]);
        expect(analysisIntervalTransition(range, faces, 1).finished).toBeNull();
        const resumed = analysisIntervalTransition(gap.active, plates, 2);
        expect(resumed.started, "resumed detection gets a fresh tracker and scan cadence").toBe(true);
        expect(resumed.active).toBe(plates[1]);

        const track = finalizeTrack(
            {
                detHits: 1,
                bestScore: 0.9,
                trackedGoodSec: 0,
                keyframes: [{ contentSec: 0.9, rect: { xPct: 0.2, yPct: 0.3, wPct: 0.1, hPct: 0.1 } }],
            },
            {
                confirmMinHits: 1,
                confirmStrongScore: 0.7,
                confirmTrackSec: 1,
                extendBackSec: 1,
                extendForwardSec: 0.7,
                clampStartSec: gap.finished!.startSec,
                clampEndSec: gap.finished!.endSec,
            },
        )!;
        expect(track.startSec).toBe(0);
        expect(track.endSec, "the forward hold stops before the cached gap").toBe(1);
        expect(track.keyframes.every((keyframe) => keyframe.contentSec <= 1)).toBe(true);
    });

    it("finishes the previous interval when decoded timestamps jump across a gap", () => {
        const spans = [
            { startSec: 0, endSec: 1 },
            { startSec: 2, endSec: 3 },
        ];
        const result = analysisIntervalTransition(spans[0]!, spans, 2.1);
        expect(result).toEqual({ active: spans[1], finished: spans[0], started: true });
    });

    it("preserves live state and cadence while frames remain in the same interval", () => {
        const span = { startSec: 0, endSec: 1 };
        expect(analysisIntervalTransition(span, [span], 0.2)).toEqual({ active: span, finished: null, started: false });
        expect(analysisIntervalTransition(span, [span], 1)).toEqual({ active: null, finished: span, started: false });
    });
});
