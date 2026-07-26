// Tests for carryOverTripPreviews (A8 audit finding). Importing trip-preview.ts
// is safe in node: the worker pool factory only spawns a Worker lazily on the
// first pool.request/prewarm call (see worker-pool.ts ensureSlot), and
// carryOverTripPreviews never touches the pool.

import { describe, expect, it } from "vitest";
import { carryOverTripPreviews } from "./trip-preview.js";
import type { Trip, TripFrame, VideoCandidate } from "../trips.js";

/** Minimal VideoCandidate. Only `file` matters to carryOverTripPreviews (the
 * match key); the rest are stubs to satisfy the interface. */
function makeCandidate(file: File): VideoCandidate {
    return {
        file,
        relativePath: file.name,
        fingerprint: "fp:default-cam",
        appliedExtractors: [],
        classifierMatches: { time: null, channel: null, mode: null, sequence: null },
        channel: "front",
        channelConfident: true,
        sequence: null,
        recordingMode: null,
        isTimelapse: false,
        startUtc: 0,
        durationSec: 60,
        wallDurationSec: null,
        startSource: "mp4",
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
    };
}

/** Minimal single-frame Trip wrapping one candidate as the "front" channel -
 * enough for tripAllCandidates(trip)[0] to resolve to it. Other Trip fields
 * are irrelevant to carryOverTripPreviews and are stubbed. */
function makeTrip(candidate: VideoCandidate, previewDataUrl?: string): Trip {
    const frame: TripFrame = { startUtc: 0, durationSec: 60, wallDurationSec: 60, channels: { front: candidate } };
    return {
        frames: [frame],
        startUtc: 0,
        endUtc: 60,
        durationSec: 60,
        timeline: { contentDurationSec: 60, segments: [], gaps: [] },
        totalBytes: 0,
        distanceKm: 0,
        records: [],
        events: [],
        inferredSegments: [],
        isParking: false,
        confidentChannels: new Set(),
        previewDataUrl,
    };
}

describe("carryOverTripPreviews", () => {
    it("does not smear one preview across trips sharing a basename (TeslaCam front.mp4)", () => {
        // Two distinct event folders, both with their own front.mp4 - same name,
        // different File objects/content. Only trip A had a preview generated.
        const fileA = new File([new Uint8Array(1)], "front.mp4");
        const fileB = new File([new Uint8Array(1)], "front.mp4");
        const tripA = makeTrip(makeCandidate(fileA), "data:image/jpeg;base64,AAA");
        const tripB = makeTrip(makeCandidate(fileB)); // no preview yet

        // Regroup: same File objects, fresh Trip objects (as groupTrips would produce).
        const newTripA = makeTrip(makeCandidate(fileA));
        const newTripB = makeTrip(makeCandidate(fileB));

        carryOverTripPreviews([tripA, tripB], [newTripA, newTripB]);

        expect(newTripA.previewDataUrl).toBe("data:image/jpeg;base64,AAA");
        // Name-keyed carry-over would have smeared tripA's preview onto tripB too.
        expect(newTripB.previewDataUrl).toBeUndefined();
    });

    it("carries a preview by File identity across a simulated regroup", () => {
        const file = new File([new Uint8Array(1)], "0001.mp4");
        const oldTrip = makeTrip(makeCandidate(file), "data:image/jpeg;base64,BBB");
        // New Trip object, but the SAME candidate File reference - what a real
        // regroup produces (groupTrips reuses candidate File objects).
        const newTrip = makeTrip(makeCandidate(file));

        carryOverTripPreviews([oldTrip], [newTrip]);

        expect(newTrip.previewDataUrl).toBe("data:image/jpeg;base64,BBB");
    });

    it("does not carry over when the File object identity differs (re-drop)", () => {
        const oldFile = new File([new Uint8Array(1)], "0001.mp4");
        const newFile = new File([new Uint8Array(1)], "0001.mp4"); // same name, re-picked -> new object
        const oldTrip = makeTrip(makeCandidate(oldFile), "data:image/jpeg;base64,CCC");
        const newTrip = makeTrip(makeCandidate(newFile));

        carryOverTripPreviews([oldTrip], [newTrip]);

        expect(newTrip.previewDataUrl).toBeUndefined();
    });
});
