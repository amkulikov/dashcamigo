import { describe, expect, it } from "vitest";
import type { TripFrame } from "../trips.js";
import { buildProvisionalCandidate } from "./ingest-candidate.js";
import { resolveRegroupPlaybackTarget } from "./player-regroup-target.js";

function source(name = "long-camera.mp4") {
    const file = new File(["video"], name);
    return buildProvisionalCandidate({
        file: { file, relativePath: name },
        fingerprint: "camera",
        startUtc: 1000,
        startSource: "mp4",
        cameraTzSec: null,
        durationSec: 92,
        records: [],
        appliedExtractors: [],
    });
}

function intervals(candidate = source()): TripFrame[] {
    return [0, 26, 52].map((start, index) => ({
        startUtc: 1000 + start,
        durationSec: index === 2 ? 40 : 26,
        wallDurationSec: index === 2 ? 40 : 26,
        channels: { interior: candidate },
        mediaOffsetSec: { interior: start },
    }));
}

describe("regroup playback target", () => {
    it("keeps the displayed source position when metadata splits a long frame", () => {
        const candidate = source();
        expect(
            resolveRegroupPlaybackTarget([{ frames: intervals(candidate) }], "interior", candidate.file, 40),
        ).toEqual({ trip: 0, frame: 1, offsetInFrame: 14 });
    });

    it("chooses the next interval at internal boundaries and preserves paused EOF", () => {
        const candidate = source();
        const trips = [{ frames: intervals(candidate) }];
        expect(resolveRegroupPlaybackTarget(trips, "interior", candidate.file, 26)).toEqual({
            trip: 0,
            frame: 1,
            offsetInFrame: 0,
        });
        expect(resolveRegroupPlaybackTarget(trips, "interior", candidate.file, 92)).toEqual({
            trip: 0,
            frame: 2,
            offsetInFrame: 40,
        });
    });

    it("follows source identity across trip splits without confusing equal basenames", () => {
        const first = source();
        const second = source();
        const trips = [{ frames: intervals(first) }, { frames: intervals(second) }];
        expect(resolveRegroupPlaybackTarget(trips, "interior", second.file, 40)).toEqual({
            trip: 1,
            frame: 1,
            offsetInFrame: 14,
        });
        expect(resolveRegroupPlaybackTarget(trips, "interior", source().file, 40)).toBeNull();
    });

    it("keeps ordinary unsplit frames on their existing file-local clock", () => {
        const candidate = source();
        const frame = { startUtc: 1000, durationSec: 92, wallDurationSec: 92, channels: { interior: candidate } };
        expect(resolveRegroupPlaybackTarget([{ frames: [frame] }], "interior", candidate.file, 40)).toEqual({
            trip: 0,
            frame: 0,
            offsetInFrame: 40,
        });
    });
});
