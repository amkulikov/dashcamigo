import { describe, expect, it } from "vitest";
import { weakDetectionCanReanchor } from "./detection-anchor.js";
import { boxToRect } from "./box-geometry.js";
import { appendTrackKeyframe, finalizeTrack, type FinalizeOptions, type TrackKeyframe } from "./detect-track.js";
import { TrackGeometry } from "./track-state.js";

describe("weak detection maintenance", () => {
    const current = { x: 100, y: 100, w: 60, h: 20 };

    it("allows a close detector correction with modest scale noise", () => {
        expect(weakDetectionCanReanchor({ x: 98, y: 99, w: 66, h: 22, score: 0.3 }, current)).toBe(true);
    });

    it("rejects a larger neighboring object even though it passes discovery association", () => {
        expect(weakDetectionCanReanchor({ x: 70, y: 90, w: 120, h: 40, score: 0.3 }, current)).toBe(false);
    });

    it("rejects an elongated bodywork box with high overlap", () => {
        expect(weakDetectionCanReanchor({ x: 82, y: 100, w: 96, h: 20, score: 0.3 }, current)).toBe(false);
    });

    it("rejects a nearby same-size distractor with only partial overlap", () => {
        expect(weakDetectionCanReanchor({ x: 130, y: 100, w: 60, h: 20, score: 0.3 }, current)).toBe(false);
    });

    it("stops repeated modest weak re-anchors at the original growth budget", () => {
        const geometry = new TrackGeometry({ x: 400, y: 200, w: 50, h: 20 }, 1000, 500);
        let anchors = 0;
        let stopped = false;
        for (let step = 0; step < 20; step++) {
            const previous = geometry.box;
            const candidate = {
                x: previous.x - previous.w * 0.05,
                y: previous.y - previous.h * 0.05,
                w: previous.w * 1.1,
                h: previous.h * 1.1,
                score: 0.3,
            };
            expect(weakDetectionCanReanchor(candidate, previous), "each individual correction remains modest").toBe(
                true,
            );
            if (!geometry.reanchor(candidate, 1000, 500)) {
                expect(geometry.box).toEqual(previous);
                stopped = true;
                break;
            }
            anchors++;
        }
        expect(anchors).toBeGreaterThan(3);
        expect(stopped, "weak maintenance cannot renew the initial budget").toBe(true);
        expect(geometry.box.w / 1000).toBeLessThanOrEqual(0.15);
    });

    it("admits strong growth as a new trajectory without projecting it backward", () => {
        const seed = { x: 400, y: 200, w: 50, h: 20 };
        const geometry = new TrackGeometry(seed, 1000, 500);
        const grown = { x: 345, y: 178, w: 160, h: 64 };
        expect(geometry.reanchor(grown, 1000, 500)).toBe(false);
        const replacement = new TrackGeometry(grown, 1000, 500);
        expect(replacement.box).toEqual(grown);

        const options: FinalizeOptions = {
            confirmMinHits: 1,
            confirmStrongScore: 0.7,
            confirmTrackSec: 1,
            extendBackSec: 1,
            extendForwardSec: 0.7,
            clampStartSec: 0,
            clampEndSec: 10,
        };
        const oldKeyframes: TrackKeyframe[] = [];
        const newKeyframes: TrackKeyframe[] = [];
        appendTrackKeyframe(oldKeyframes, 1.9, boxToRect(seed, 1000, 500));
        appendTrackKeyframe(newKeyframes, 2, boxToRect(grown, 1000, 500));
        const oldTrack = finalizeTrack(
            { detHits: 1, bestScore: 0.9, trackedGoodSec: 0, keyframes: oldKeyframes },
            { ...options, clampEndSec: 2 },
        )!;
        const newTrack = finalizeTrack(
            { detHits: 1, bestScore: 0.9, trackedGoodSec: 0, keyframes: newKeyframes },
            { ...options, clampStartSec: 2 },
        )!;
        expect(oldTrack.endSec).toBe(2);
        expect(newTrack.startSec).toBe(2);
        expect(oldTrack.keyframes.every((keyframe) => keyframe.rect.wPct === 0.05)).toBe(true);
        expect(newTrack.keyframes.every((keyframe) => keyframe.contentSec >= 2)).toBe(true);
    });
});
