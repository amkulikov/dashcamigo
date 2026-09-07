import { recordsHaveGps } from "./parser.js";
import { tripAllCandidates, type Trip, type VideoCandidate } from "./trips.js";
import { vendorFileKey } from "./vendor-file-key.js";

export interface GpsRecognitionState {
    failedEmbeddedGps: ReadonlySet<string>;
    pendingHeavyEmbeddedGps: ReadonlyMap<string, unknown>;
    inflightEmbeddedGps: ReadonlyMap<string, number>;
}

export function hasUnfinishedRecognition(candidates: readonly VideoCandidate[], status: GpsRecognitionState): boolean {
    return candidates.some((candidate) => {
        const key = vendorFileKey(candidate);
        return (
            candidate.metadataReady !== true ||
            candidate.metadataFailed === true ||
            (status.inflightEmbeddedGps.get(key) ?? 0) > 0 ||
            // A failed heavy read stays queued for a user-initiated retry.
            (status.pendingHeavyEmbeddedGps.has(key) && !status.failedEmbeddedGps.has(key))
        );
    });
}

export function failedGpsFilesForTrip(trip: Trip, status: GpsRecognitionState): string[] {
    const candidates = tripAllCandidates(trip);
    if (hasUnfinishedRecognition(candidates, status)) return [];
    // GPS may live on another camera or arrive from a separately loaded track.
    if (recordsHaveGps(trip.records) || candidates.some((candidate) => recordsHaveGps(candidate.records))) return [];
    return candidates.filter((candidate) => status.failedEmbeddedGps.has(vendorFileKey(candidate))).map(vendorFileKey);
}
